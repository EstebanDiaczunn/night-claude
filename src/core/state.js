/**
 * Manejo de estado de NightClaude
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../utils/logger");

/**
 * Estado inicial
 */
const createInitialState = () => ({
  status: "idle", // idle | configured | running | paused | completed | stopped | error
  project: null,
  tasks: [],
  currentTask: 0,
  iteration: 0,
  maxIterations: 50,
  usageLimit: 90,
  branch: null,
  log: [],
  summary: null,
  startTime: null,
  pauseReason: null,
  usage: { fiveHour: 0, sevenDay: 0 },
  savedTaskIndex: 0,
  error: null,
});

// Estado global
let state = createInitialState();

// Listeners para cambios de estado
let listeners = [];

/**
 * Obtiene el estado actual
 */
const getState = () => ({ ...state });

/**
 * Actualiza el estado
 */
const setState = (updates) => {
  const oldState = { ...state };
  state = { ...state, ...updates };

  // Sincronizar log con logger
  state.log = logger.getAll();

  // Notificar listeners
  notifyListeners(state, oldState);

  return state;
};

/**
 * Resetea el estado al inicial
 */
const resetState = () => {
  state = createInitialState();
  logger.clear();
  notifyListeners(state, null);
  return state;
};

/**
 * Suscribe a cambios de estado
 */
const subscribe = (callback) => {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter((l) => l !== callback);
  };
};

/**
 * Notifica a todos los listeners
 */
const notifyListeners = (newState, oldState) => {
  listeners.forEach((listener) => {
    try {
      listener(newState, oldState);
    } catch (e) {
      console.error("Error en listener de estado:", e);
    }
  });
};

/**
 * Guarda el estado a archivo para poder reanudar
 */
const saveState = (projectPath = null) => {
  const savePath = projectPath || state.project;
  if (!savePath) return false;

  try {
    const statePath = path.join(savePath, ".nightclaude-state.json");
    const stateToSave = {
      ...state,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(statePath, JSON.stringify(stateToSave, null, 2));
    logger.info(`Estado guardado en ${statePath}`);
    return true;
  } catch (error) {
    logger.error(`Error guardando estado: ${error.message}`);
    return false;
  }
};

/**
 * Carga estado desde archivo
 */
const loadState = (projectPath) => {
  try {
    const statePath = path.join(projectPath, ".nightclaude-state.json");
    if (!fs.existsSync(statePath)) {
      return null;
    }

    const savedState = JSON.parse(fs.readFileSync(statePath, "utf8"));
    logger.info(`Estado cargado desde ${statePath}`);
    return savedState;
  } catch (error) {
    logger.warning(`Error cargando estado: ${error.message}`);
    return null;
  }
};

/**
 * Restaura estado guardado
 */
const restoreState = (projectPath) => {
  const savedState = loadState(projectPath);
  if (savedState) {
    state = { ...savedState, status: "paused" };
    notifyListeners(state, null);
    return true;
  }
  return false;
};

/**
 * Actualiza el estado de una tarea
 */
const updateTaskStatus = (taskIndex, status) => {
  if (state.tasks[taskIndex]) {
    state.tasks[taskIndex].status = status;
    notifyListeners(state, null);
  }
};

/**
 * Genera el resumen de la sesion
 */
const generateSummary = (commits = []) => {
  if (!state.startTime) return null;

  const mins = Math.round((Date.now() - new Date(state.startTime).getTime()) / 60000);

  const summary = {
    branch: state.branch,
    duration: `${Math.floor(mins / 60)}h ${mins % 60}m`,
    tasksCompleted: state.tasks.filter((t) => t.status === "completed").length,
    tasksBlocked: state.tasks.filter((t) => t.status === "blocked").length,
    tasksPending: state.tasks.filter((t) => t.status === "pending").length,
    totalTasks: state.tasks.length,
    commits,
    usage: state.usage,
    iterations: state.iteration,
  };

  setState({ summary });
  return summary;
};

/**
 * Genera archivo markdown de resumen
 */
const writeSummaryFile = (projectPath = null) => {
  const savePath = projectPath || state.project;
  if (!savePath || !state.summary) return false;

  try {
    const md = `# NightClaude - Resumen de Sesion

**Fecha:** ${new Date().toLocaleString("es-AR")}
**Duracion:** ${state.summary.duration}
**Rama:** \`${state.branch || "N/A"}\`

## Uso de API
- 5 horas: ${state.usage.fiveHour || 0}%
- 7 dias: ${state.usage.sevenDay || 0}%

## Resumen de Tareas
- Completadas: ${state.summary.tasksCompleted}/${state.summary.totalTasks}
- Bloqueadas: ${state.summary.tasksBlocked}
- Pendientes: ${state.summary.tasksPending}

## Tareas
${state.tasks
  .map(
    (t, i) =>
      `${i + 1}. ${t.status === "completed" ? "[x]" : t.status === "blocked" ? "[!]" : "[ ]"} ${t.prompt.substring(0, 80)}`
  )
  .join("\n")}

## Commits
${state.summary.commits?.length ? state.summary.commits.map((c) => `- ${c}`).join("\n") : "_Sin commits_"}

## Log (ultimas 30 entradas)
${state.log
  .slice(-30)
  .map((l) => `- [${l.type}] ${l.message.substring(0, 100)}`)
  .join("\n")}

---
_Generado por NightClaude v2.0_
`;

    fs.writeFileSync(path.join(savePath, "NIGHTCLAUDE_SUMMARY.md"), md);
    return true;
  } catch (error) {
    logger.error(`Error escribiendo resumen: ${error.message}`);
    return false;
  }
};

module.exports = {
  createInitialState,
  getState,
  setState,
  resetState,
  subscribe,
  saveState,
  loadState,
  restoreState,
  updateTaskStatus,
  generateSummary,
  writeSummaryFile,
};
