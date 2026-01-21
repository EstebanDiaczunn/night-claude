/**
 * Servicio de ejecucion de Claude Code
 */

const { spawn } = require("child_process");
const { withTimeout } = require("../utils/retry");
const { logger } = require("../utils/logger");
const { getConfig } = require("../config");

// Proceso activo de Claude
let activeProcess = null;

/**
 * Resultado de ejecucion de tarea
 * @typedef {Object} TaskResult
 * @property {string} output - Salida completa del proceso
 * @property {boolean} completed - Si la tarea se completo exitosamente
 * @property {boolean} blocked - Si la tarea se bloqueo
 * @property {number} code - Codigo de salida del proceso
 * @property {number} duration - Duracion en ms
 */

/**
 * Genera el prompt estructurado para una tarea
 */
const buildPrompt = (prompt, taskIndex, options = {}) => {
  const { projectContext = null, previousAttempt = null } = options;

  let fullPrompt = `TAREA ${taskIndex + 1}: ${prompt}

REGLAS IMPORTANTES:
- Completa la tarea sin pedir confirmacion
- Haz commits con mensajes descriptivos en espanol
- Si necesitas crear archivos, hazlo directamente
- Si necesitas instalar dependencias, hazlo
- Cuando termines exitosamente, escribe exactamente: <promise>COMPLETE</promise>
- Si te trabas o no puedes continuar, escribe: <promise>BLOCKED</promise> y explica por que`;

  if (projectContext) {
    fullPrompt += `

CONTEXTO DEL PROYECTO:
${projectContext}`;
  }

  if (previousAttempt) {
    fullPrompt += `

INTENTO ANTERIOR:
Esta es una continuacion. El intento anterior termino asi:
${previousAttempt.substring(0, 500)}

Por favor continua desde donde quedo o intenta un enfoque diferente.`;
  }

  return fullPrompt;
};

/**
 * Ejecuta una tarea con Claude Code
 * @param {string} projectPath - Ruta del proyecto
 * @param {string} prompt - Descripcion de la tarea
 * @param {number} taskIndex - Indice de la tarea
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<TaskResult>}
 */
const runTask = (projectPath, prompt, taskIndex, options = {}) => {
  const config = getConfig(projectPath);
  const { timeout = config.taskTimeout, onOutput = null } = options;

  const fullPrompt = buildPrompt(prompt, taskIndex, options);

  logger.task(`Iniciando tarea ${taskIndex + 1}: ${prompt.substring(0, 60)}...`);

  const taskPromise = new Promise((resolve, reject) => {
    const startTime = Date.now();

    activeProcess = spawn(
      "claude",
      ["-p", fullPrompt, "--dangerously-skip-permissions"],
      {
        cwd: projectPath,
        shell: true,
        env: { ...process.env, FORCE_COLOR: "0" },
      }
    );

    let output = "";
    let completed = false;
    let blocked = false;

    const handleData = (data) => {
      const text = data.toString();
      output += text;

      // Detectar marcadores de estado
      if (text.includes("<promise>COMPLETE</promise>")) {
        completed = true;
      }
      if (text.includes("<promise>BLOCKED</promise>")) {
        blocked = true;
      }

      // Callback opcional para streaming
      if (onOutput) {
        onOutput(text, { completed, blocked });
      }
    };

    activeProcess.stdout.on("data", handleData);
    activeProcess.stderr.on("data", handleData);

    activeProcess.on("close", (code) => {
      const duration = Date.now() - startTime;
      activeProcess = null;

      resolve({
        output,
        completed,
        blocked,
        code,
        duration,
      });
    });

    activeProcess.on("error", (error) => {
      activeProcess = null;
      reject(error);
    });
  });

  // Aplicar timeout
  return withTimeout(
    taskPromise,
    timeout,
    `Tarea ${taskIndex + 1} excedio el tiempo limite (${Math.round(timeout / 60000)} min)`
  );
};

/**
 * Detiene el proceso activo de Claude
 */
const stopActive = () => {
  if (activeProcess) {
    logger.info("Deteniendo proceso de Claude...");
    activeProcess.kill("SIGTERM");

    // Si no muere en 5 segundos, forzar
    setTimeout(() => {
      if (activeProcess) {
        activeProcess.kill("SIGKILL");
      }
    }, 5000);

    return true;
  }
  return false;
};

/**
 * Verifica si hay un proceso activo
 */
const isRunning = () => {
  return activeProcess !== null;
};

/**
 * Obtiene el contexto del proyecto para mejorar los prompts
 */
const getProjectContext = (projectPath) => {
  const fs = require("fs");
  const path = require("path");
  let context = [];

  // Leer package.json si existe
  const packagePath = path.join(projectPath, "package.json");
  if (fs.existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
      context.push(`- Proyecto: ${pkg.name || "Node.js"}`);
      context.push(`- Version: ${pkg.version || "N/A"}`);
      if (pkg.dependencies) {
        const deps = Object.keys(pkg.dependencies).slice(0, 10).join(", ");
        context.push(`- Dependencias principales: ${deps}`);
      }
    } catch (e) {}
  }

  // Detectar framework
  const indicators = {
    "next.config.js": "Next.js",
    "nuxt.config.js": "Nuxt.js",
    "angular.json": "Angular",
    "vue.config.js": "Vue.js",
    "Cargo.toml": "Rust",
    "go.mod": "Go",
    "requirements.txt": "Python",
    "Gemfile": "Ruby",
  };

  for (const [file, framework] of Object.entries(indicators)) {
    if (fs.existsSync(path.join(projectPath, file))) {
      context.push(`- Framework: ${framework}`);
      break;
    }
  }

  return context.length > 0 ? context.join("\n") : null;
};

module.exports = {
  runTask,
  stopActive,
  isRunning,
  buildPrompt,
  getProjectContext,
};
