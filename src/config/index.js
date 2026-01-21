/**
 * Configuracion centralizada de NightClaude
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

const DEFAULT_CONFIG = {
  port: 3333,
  maxIterations: 50,
  usageLimit: 90,
  taskTimeout: 30 * 60 * 1000, // 30 minutos
  iterationDelay: 3000, // 3 segundos entre iteraciones
  git: {
    retryAttempts: 3,
    retryDelay: 1000,
  },
  api: {
    retryAttempts: 3,
    retryDelay: 2000,
  },
  logging: {
    maxEntries: 500,
    persistToFile: true,
  },
};

/**
 * Carga configuracion desde archivo si existe
 */
const loadProjectConfig = (projectPath) => {
  const configPaths = [
    path.join(projectPath, "nightclaude.config.js"),
    path.join(projectPath, "nightclaude.config.json"),
    path.join(projectPath, ".nightclauderc"),
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        if (configPath.endsWith(".js")) {
          return require(configPath);
        }
        return JSON.parse(fs.readFileSync(configPath, "utf8"));
      } catch (e) {
        console.warn(`Error cargando config de ${configPath}:`, e.message);
      }
    }
  }
  return {};
};

/**
 * Combina configuracion default con proyecto
 */
const getConfig = (projectPath = null) => {
  const projectConfig = projectPath ? loadProjectConfig(projectPath) : {};
  return {
    ...DEFAULT_CONFIG,
    ...projectConfig,
    git: { ...DEFAULT_CONFIG.git, ...projectConfig.git },
    api: { ...DEFAULT_CONFIG.api, ...projectConfig.api },
    logging: { ...DEFAULT_CONFIG.logging, ...projectConfig.logging },
  };
};

/**
 * Detecta la plataforma
 */
const getPlatform = () => {
  const platform = os.platform();
  return {
    isWindows: platform === "win32",
    isMac: platform === "darwin",
    isLinux: platform === "linux",
    name: platform,
  };
};

module.exports = {
  DEFAULT_CONFIG,
  loadProjectConfig,
  getConfig,
  getPlatform,
};
