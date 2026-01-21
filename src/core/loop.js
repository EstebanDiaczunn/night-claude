/**
 * Loop nocturno principal de NightClaude
 */

const { logger } = require("../utils/logger");
const { sleep } = require("../utils/retry");
const { getConfig } = require("../config");
const {
  getState,
  setState,
  saveState,
  updateTaskStatus,
  generateSummary,
  writeSummaryFile,
} = require("./state");
const { createBranch, commit, getRecentCommits } = require("../services/git");
const { runTask, stopActive, getProjectContext } = require("../services/claude");
const { checkUsageLimit, formatResetTime } = require("../services/usage");

// Flag para detener el loop
let shouldStop = false;

/**
 * Inicia el loop nocturno
 */
const startLoop = async () => {
  const state = getState();

  if (state.status === "running") {
    throw new Error("El loop ya esta corriendo");
  }

  shouldStop = false;

  setState({
    status: "running",
    startTime: state.startTime || new Date().toISOString(),
    error: null,
  });

  // Limpiar log solo si es nueva sesion
  if (!state.branch) {
    logger.clear();
  }

  logger.log("start", "NightClaude iniciado");

  try {
    await runLoop();
  } catch (error) {
    logger.error(`Error fatal: ${error.message}`);
    setState({ status: "error", error: error.message });
  }
};

/**
 * Loop principal
 */
const runLoop = async () => {
  let state = getState();
  const config = getConfig(state.project);

  // Crear rama si no existe
  if (!state.branch) {
    try {
      const branch = await createBranch(state.project);
      setState({ branch });
      state = getState();
    } catch (error) {
      throw new Error(`Error creando rama: ${error.message}`);
    }
  }

  // Obtener contexto del proyecto
  const projectContext = getProjectContext(state.project);

  // Iterar sobre las tareas
  for (let t = state.savedTaskIndex; t < state.tasks.length; t++) {
    if (shouldStop) {
      logger.info("Loop detenido por el usuario");
      setState({ status: "stopped" });
      await finalize();
      return;
    }

    state = getState();
    const task = state.tasks[t];

    // Saltar tareas completadas
    if (task.status === "completed") {
      continue;
    }

    setState({ currentTask: t });
    logger.task(`Iniciando tarea ${t + 1}/${state.tasks.length}: ${task.prompt.substring(0, 50)}...`);

    // Iterar hasta completar o agotar intentos
    for (let i = 0; i < state.maxIterations; i++) {
      if (shouldStop) break;

      setState({ iteration: i + 1 });

      // Verificar uso de API
      const usageCheck = await checkUsageLimit(state.usageLimit);
      setState({ usage: usageCheck.usage });

      if (usageCheck.exceeded) {
        const resetTime = formatResetTime(
          usageCheck.usage.fiveHourReset || usageCheck.usage.sevenDayReset
        );

        const pauseReason = `Limite alcanzado: ${usageCheck.usage.fiveHour}% (5h) / ${usageCheck.usage.sevenDay}% (7d)`;

        logger.log("pause", pauseReason);

        if (resetTime) {
          logger.info(`La cuota se reinicia: ${resetTime}`);
        }

        setState({
          status: "paused",
          pauseReason,
          savedTaskIndex: t,
        });

        await finalize();
        return;
      }

      // Ejecutar tarea con Claude
      try {
        const result = await runTask(state.project, task.prompt, t, {
          projectContext,
          onOutput: (text) => {
            // Podriamos emitir progreso aqui si queremos
          },
        });

        if (result.completed) {
          updateTaskStatus(t, "completed");
          logger.done(`Tarea ${t + 1} completada en ${Math.round(result.duration / 1000)}s`);

          // Hacer commit
          try {
            await commit(
              state.project,
              `feat(nightclaude): Tarea ${t + 1} - ${task.prompt.substring(0, 50)}`
            );
          } catch (e) {
            logger.warning(`No se pudo hacer commit: ${e.message}`);
          }

          break; // Siguiente tarea
        }

        if (result.blocked) {
          updateTaskStatus(t, "blocked");
          logger.log("blocked", `Tarea ${t + 1} bloqueada`);
          break; // Siguiente tarea
        }

        // No se completo ni bloqueo, esperar antes de reintentar
        logger.info(`Iteracion ${i + 1}: tarea no completada, reintentando...`);
        await sleep(config.iterationDelay);
      } catch (error) {
        if (error.message.includes("Timeout") || error.message.includes("tiempo limite")) {
          logger.warning(`Tarea ${t + 1} excedio el tiempo limite`);
          updateTaskStatus(t, "blocked");
          break;
        }
        throw error;
      }
    }
  }

  // Todas las tareas procesadas
  logger.log("complete", "Todas las tareas procesadas");
  setState({ status: "completed" });
  await finalize();
};

/**
 * Finaliza la sesion
 */
const finalize = async () => {
  const state = getState();

  try {
    // Obtener commits recientes
    const commits = await getRecentCommits(state.project, 15);

    // Generar resumen
    generateSummary(commits);

    // Escribir archivo de resumen
    writeSummaryFile(state.project);

    // Guardar estado para poder continuar
    saveState(state.project);
  } catch (error) {
    logger.error(`Error finalizando: ${error.message}`);
  }
};

/**
 * Detiene el loop
 */
const stopLoop = () => {
  shouldStop = true;
  stopActive();
  logger.info("Deteniendo loop...");
};

/**
 * Continua el loop desde donde quedo
 */
const continueLoop = async () => {
  const state = getState();

  if (state.status !== "paused") {
    throw new Error("Solo se puede continuar desde estado pausado");
  }

  shouldStop = false;
  setState({ status: "running", pauseReason: null });

  logger.info("Continuando desde donde quedo...");

  try {
    await runLoop();
  } catch (error) {
    logger.error(`Error continuando: ${error.message}`);
    setState({ status: "error", error: error.message });
  }
};

/**
 * Verifica si el loop esta corriendo
 */
const isLoopRunning = () => {
  const state = getState();
  return state.status === "running";
};

module.exports = {
  startLoop,
  stopLoop,
  continueLoop,
  isLoopRunning,
};
