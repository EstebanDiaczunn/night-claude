/**
 * Servicio de operaciones Git para NightClaude
 */

const { exec } = require("child_process");
const { withRetry } = require("../utils/retry");
const { logger } = require("../utils/logger");
const { getConfig } = require("../config");

/**
 * Ejecuta un comando git
 * @param {string} cwd - Directorio de trabajo
 * @param {string} args - Argumentos del comando
 * @returns {Promise<string>} Output del comando
 */
const gitCmd = (cwd, args) => {
  return new Promise((resolve, reject) => {
    exec(`git ${args}`, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
};

/**
 * Ejecuta comando git con retry
 */
const gitCmdWithRetry = async (cwd, args, options = {}) => {
  const config = getConfig();
  const { attempts = config.git.retryAttempts, delay = config.git.retryDelay } = options;

  return withRetry(() => gitCmd(cwd, args), {
    attempts,
    delay,
    onRetry: (error, attempt, waitTime) => {
      logger.warning(`Git retry ${attempt}: ${args} - ${error.message}`);
    },
  });
};

/**
 * Crea una nueva rama para el trabajo nocturno
 * @param {string} projectPath - Ruta del proyecto
 * @returns {Promise<string>} Nombre de la rama creada
 */
const createBranch = async (projectPath) => {
  const date = new Date().toISOString().split("T")[0];
  const time = Date.now().toString().slice(-4);
  const branch = `claude/nightly-${date}-${time}`;

  // Verificar que es un repo git
  await gitCmd(projectPath, "rev-parse --git-dir");

  // Crear y cambiar a la nueva rama
  await gitCmdWithRetry(projectPath, `checkout -b ${branch}`);

  logger.git(`Rama creada: ${branch}`);
  return branch;
};

/**
 * Hace commit de los cambios
 * @param {string} projectPath - Ruta del proyecto
 * @param {string} message - Mensaje del commit
 * @returns {Promise<string>} Hash del commit
 */
const commit = async (projectPath, message) => {
  try {
    // Agregar todos los cambios
    await gitCmdWithRetry(projectPath, "add -A");

    // Verificar si hay cambios para commitear
    const status = await gitCmd(projectPath, "status --porcelain");
    if (!status) {
      logger.info("Sin cambios para commitear");
      return null;
    }

    // Crear commit
    const safeMessage = message.replace(/"/g, '\\"').replace(/\n/g, " ");
    await gitCmdWithRetry(projectPath, `commit -m "${safeMessage}"`);

    // Obtener hash del commit
    const hash = await gitCmd(projectPath, "rev-parse --short HEAD");
    logger.git(`Commit: ${hash} - ${message.substring(0, 50)}`);

    return hash;
  } catch (error) {
    if (error.message.includes("nothing to commit")) {
      logger.info("Sin cambios para commitear");
      return null;
    }
    throw error;
  }
};

/**
 * Obtiene los ultimos commits
 * @param {string} projectPath - Ruta del proyecto
 * @param {number} count - Cantidad de commits
 * @returns {Promise<string[]>} Lista de commits
 */
const getRecentCommits = async (projectPath, count = 10) => {
  try {
    const log = await gitCmd(projectPath, `log --oneline -${count}`);
    return log.split("\n").filter((c) => c.trim());
  } catch (error) {
    return [];
  }
};

/**
 * Obtiene el nombre de la rama actual
 */
const getCurrentBranch = async (projectPath) => {
  try {
    return await gitCmd(projectPath, "rev-parse --abbrev-ref HEAD");
  } catch (error) {
    return null;
  }
};

/**
 * Verifica si hay cambios sin commitear
 */
const hasUncommittedChanges = async (projectPath) => {
  try {
    const status = await gitCmd(projectPath, "status --porcelain");
    return status.length > 0;
  } catch (error) {
    return false;
  }
};

/**
 * Vuelve a la rama anterior
 */
const checkoutPrevious = async (projectPath) => {
  try {
    await gitCmdWithRetry(projectPath, "checkout -");
    return true;
  } catch (error) {
    return false;
  }
};

module.exports = {
  gitCmd,
  gitCmdWithRetry,
  createBranch,
  commit,
  getRecentCommits,
  getCurrentBranch,
  hasUncommittedChanges,
  checkoutPrevious,
};
