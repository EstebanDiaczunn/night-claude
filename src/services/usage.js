/**
 * Servicio de monitoreo de uso de API de Anthropic
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { getClaudeToken } = require("./token");
const { withRetry } = require("../utils/retry");
const { logger } = require("../utils/logger");
const { getConfig } = require("../config");

/**
 * Estructura de respuesta de uso
 * @typedef {Object} UsageData
 * @property {number} fiveHour - Porcentaje de uso en 5 horas
 * @property {number} sevenDay - Porcentaje de uso en 7 dias
 * @property {string|null} fiveHourReset - Timestamp de reset de 5h
 * @property {string|null} sevenDayReset - Timestamp de reset de 7d
 * @property {string} source - Fuente de los datos (api|local|error)
 */

/**
 * Obtiene el uso actual de la API de Anthropic
 * @returns {Promise<UsageData>}
 */
const getUsage = async () => {
  // Intentar obtener de la API primero
  const apiUsage = await getUsageFromAPI();
  if (apiUsage.source === "api") {
    return apiUsage;
  }

  // Fallback a estimacion local
  return getUsageFromLocalFiles();
};

/**
 * Obtiene uso desde la API de Anthropic
 */
const getUsageFromAPI = async () => {
  const token = getClaudeToken();

  if (!token) {
    logger.warning("No se encontro token OAuth - usando estimacion local");
    return { source: "no_token" };
  }

  const config = getConfig();

  try {
    const result = await withRetry(
      async () => {
        const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "NightClaude/2.0",
            Authorization: `Bearer ${token}`,
            "anthropic-beta": "oauth-2025-04-20",
          },
        });

        if (!response.ok) {
          throw new Error(`API responded with ${response.status}`);
        }

        return response.json();
      },
      {
        attempts: config.api.retryAttempts,
        delay: config.api.retryDelay,
        onRetry: (error, attempt) => {
          logger.warning(`Retry ${attempt} obteniendo uso de API: ${error.message}`);
        },
      }
    );

    return {
      fiveHour: Math.round((result.five_hour?.utilization || 0) * 100),
      sevenDay: Math.round((result.seven_day?.utilization || 0) * 100),
      fiveHourReset: result.five_hour?.resets_at || null,
      sevenDayReset: result.seven_day?.resets_at || null,
      source: "api",
    };
  } catch (error) {
    logger.warning(`Error obteniendo uso de API: ${error.message}`);
    return { source: "api_error", error: error.message };
  }
};

/**
 * Estima uso desde archivos locales de Claude
 */
const getUsageFromLocalFiles = () => {
  try {
    const claudeDir = path.join(os.homedir(), ".claude", "projects");

    if (!fs.existsSync(claudeDir)) {
      return {
        fiveHour: 0,
        sevenDay: 0,
        fiveHourReset: null,
        sevenDayReset: null,
        source: "none",
      };
    }

    const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let tokensFiveHour = 0;
    let tokensSevenDay = 0;

    const scanDir = (dir) => {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          try {
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
              scanDir(filePath);
            } else if (file.endsWith(".jsonl")) {
              const lines = fs.readFileSync(filePath, "utf8").split("\n");
              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const entry = JSON.parse(line);
                  const timestamp = new Date(entry.timestamp || 0).getTime();
                  const tokens = entry.usage?.total_tokens || 0;

                  if (timestamp > fiveHoursAgo) {
                    tokensFiveHour += tokens;
                  }
                  if (timestamp > sevenDaysAgo) {
                    tokensSevenDay += tokens;
                  }
                } catch (e) {
                  // Linea invalida, ignorar
                }
              }
            }
          } catch (e) {
            // Error accediendo archivo, ignorar
          }
        }
      } catch (e) {
        // Error leyendo directorio, ignorar
      }
    };

    scanDir(claudeDir);

    // Limites estimados (aproximados)
    const fiveHourLimit = 88000;
    const sevenDayLimit = 500000;

    return {
      fiveHour: Math.min(100, Math.round((tokensFiveHour / fiveHourLimit) * 100)),
      sevenDay: Math.min(100, Math.round((tokensSevenDay / sevenDayLimit) * 100)),
      fiveHourReset: null,
      sevenDayReset: null,
      source: "local",
    };
  } catch (error) {
    logger.error(`Error estimando uso local: ${error.message}`);
    return {
      fiveHour: 0,
      sevenDay: 0,
      fiveHourReset: null,
      sevenDayReset: null,
      source: "error",
    };
  }
};

/**
 * Verifica si el uso actual excede el limite
 * @param {number} limit - Limite en porcentaje (0-100)
 * @returns {Promise<{exceeded: boolean, current: number, usage: UsageData}>}
 */
const checkUsageLimit = async (limit = 90) => {
  const usage = await getUsage();
  const current = Math.max(usage.fiveHour || 0, usage.sevenDay || 0);

  return {
    exceeded: current >= limit,
    current,
    usage,
  };
};

/**
 * Formatea el tiempo de reset para mostrar
 */
const formatResetTime = (resetTimestamp) => {
  if (!resetTimestamp) return null;

  try {
    const resetDate = new Date(resetTimestamp);
    return resetDate.toLocaleString("es-AR", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return null;
  }
};

module.exports = {
  getUsage,
  getUsageFromAPI,
  getUsageFromLocalFiles,
  checkUsageLimit,
  formatResetTime,
};
