/**
 * Validacion de entrada para NightClaude
 */

const fs = require("fs");
const { execSync } = require("child_process");

/**
 * Errores de validacion
 */
class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

/**
 * Valida configuracion de proyecto
 */
const validateConfig = (config) => {
  const errors = [];

  // Validar project path
  if (!config.project) {
    errors.push({ field: "project", message: "Ruta del proyecto es requerida" });
  } else if (!fs.existsSync(config.project)) {
    errors.push({ field: "project", message: "El proyecto no existe" });
  } else {
    const stat = fs.statSync(config.project);
    if (!stat.isDirectory()) {
      errors.push({ field: "project", message: "La ruta debe ser un directorio" });
    }
  }

  // Validar tasks
  if (!config.tasks || !Array.isArray(config.tasks)) {
    errors.push({ field: "tasks", message: "Las tareas deben ser un array" });
  } else if (config.tasks.length === 0) {
    errors.push({ field: "tasks", message: "Debe haber al menos una tarea" });
  } else {
    config.tasks.forEach((task, i) => {
      if (!task || typeof task !== "string" || task.trim().length === 0) {
        errors.push({ field: `tasks[${i}]`, message: `Tarea ${i + 1} esta vacia` });
      }
    });
  }

  // Validar maxIterations
  if (config.maxIterations !== undefined) {
    const max = Number(config.maxIterations);
    if (isNaN(max) || max < 1 || max > 1000) {
      errors.push({
        field: "maxIterations",
        message: "maxIterations debe ser entre 1 y 1000",
      });
    }
  }

  // Validar usageLimit
  if (config.usageLimit !== undefined) {
    const limit = Number(config.usageLimit);
    if (isNaN(limit) || limit < 10 || limit > 100) {
      errors.push({
        field: "usageLimit",
        message: "usageLimit debe ser entre 10 y 100",
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Verifica que Claude Code este instalado
 */
const checkClaudeInstalled = () => {
  try {
    execSync("claude --version", { stdio: "pipe" });
    return { installed: true, error: null };
  } catch (e) {
    return {
      installed: false,
      error: "Claude Code no esta instalado o no esta en PATH",
    };
  }
};

/**
 * Verifica que Git este instalado
 */
const checkGitInstalled = () => {
  try {
    execSync("git --version", { stdio: "pipe" });
    return { installed: true, error: null };
  } catch (e) {
    return {
      installed: false,
      error: "Git no esta instalado o no esta en PATH",
    };
  }
};

/**
 * Verifica que el proyecto sea un repo git
 */
const checkGitRepo = (projectPath) => {
  try {
    execSync("git rev-parse --git-dir", { cwd: projectPath, stdio: "pipe" });
    return { isRepo: true, error: null };
  } catch (e) {
    return {
      isRepo: false,
      error: "El proyecto no es un repositorio Git",
    };
  }
};

/**
 * Valida todos los prerequisitos
 */
const validatePrerequisites = (projectPath) => {
  const results = {
    claude: checkClaudeInstalled(),
    git: checkGitInstalled(),
    repo: projectPath ? checkGitRepo(projectPath) : { isRepo: false, error: null },
  };

  const errors = [];
  if (!results.claude.installed) errors.push(results.claude.error);
  if (!results.git.installed) errors.push(results.git.error);
  if (projectPath && !results.repo.isRepo) errors.push(results.repo.error);

  return {
    valid: errors.length === 0,
    errors,
    details: results,
  };
};

module.exports = {
  ValidationError,
  validateConfig,
  checkClaudeInstalled,
  checkGitInstalled,
  checkGitRepo,
  validatePrerequisites,
};
