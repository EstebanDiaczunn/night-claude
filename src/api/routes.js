/**
 * Rutas de API REST para NightClaude
 */

const express = require("express");
const { getState, setState, resetState, restoreState } = require("../core/state");
const { startLoop, stopLoop, continueLoop } = require("../core/loop");
const { getUsage } = require("../services/usage");
const { validateConfig, validatePrerequisites } = require("../utils/validator");
const { logger } = require("../utils/logger");
const { getConfig } = require("../config");

const router = express.Router();

/**
 * GET /api/state - Obtiene el estado actual
 */
router.get("/state", (req, res) => {
  const state = getState();
  // Sincronizar log
  state.log = logger.getAll();
  res.json(state);
});

/**
 * GET /api/usage - Obtiene el uso actual de API
 */
router.get("/usage", async (req, res) => {
  try {
    const usage = await getUsage();
    res.json(usage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/health - Health check
 */
router.get("/health", (req, res) => {
  const state = getState();
  res.json({
    status: "ok",
    loopStatus: state.status,
    uptime: process.uptime(),
  });
});

/**
 * POST /api/config - Configura el proyecto y tareas
 */
router.post("/config", (req, res) => {
  const { project, tasks, maxIterations, usageLimit } = req.body;

  // Validar configuracion
  const validation = validateConfig({ project, tasks, maxIterations, usageLimit });
  if (!validation.valid) {
    return res.status(400).json({
      error: "Configuracion invalida",
      details: validation.errors,
    });
  }

  // Verificar prerequisitos
  const prereqs = validatePrerequisites(project);
  if (!prereqs.valid) {
    return res.status(400).json({
      error: "Prerequisitos no cumplidos",
      details: prereqs.errors,
    });
  }

  // Cargar configuracion del proyecto si existe
  const config = getConfig(project);

  // Actualizar estado
  setState({
    project,
    tasks: tasks.map((t) => ({ prompt: t.trim(), status: "pending" })),
    maxIterations: maxIterations || config.maxIterations,
    usageLimit: usageLimit || config.usageLimit,
    status: "configured",
    branch: null,
    savedTaskIndex: 0,
    error: null,
  });

  // Configurar logger para el proyecto
  logger.setLogFile(project);

  logger.info(`Proyecto configurado: ${project}`);
  logger.info(`Tareas: ${tasks.length}`);

  res.json({ ok: true, tasksCount: tasks.length });
});

/**
 * POST /api/start - Inicia el loop nocturno
 */
router.post("/start", async (req, res) => {
  const state = getState();

  if (state.status === "running") {
    return res.status(400).json({ error: "Ya esta corriendo" });
  }

  if (!state.project || state.tasks.length === 0) {
    return res.status(400).json({ error: "Primero configura el proyecto" });
  }

  res.json({ ok: true });

  // Iniciar loop en background
  setImmediate(() => {
    startLoop().catch((error) => {
      logger.error(`Error iniciando loop: ${error.message}`);
    });
  });
});

/**
 * POST /api/stop - Detiene el loop
 */
router.post("/stop", (req, res) => {
  stopLoop();
  setState({ status: "stopped" });
  res.json({ ok: true });
});

/**
 * POST /api/continue - Continua desde pausa
 */
router.post("/continue", async (req, res) => {
  const state = getState();

  if (state.status !== "paused") {
    return res.status(400).json({ error: "No esta pausado" });
  }

  res.json({ ok: true });

  // Continuar en background
  setImmediate(() => {
    continueLoop().catch((error) => {
      logger.error(`Error continuando: ${error.message}`);
    });
  });
});

/**
 * POST /api/feedback - Agrega feedback como nueva tarea
 */
router.post("/feedback", (req, res) => {
  const { feedback } = req.body;

  if (!feedback || typeof feedback !== "string" || feedback.trim().length === 0) {
    return res.status(400).json({ error: "Feedback vacio" });
  }

  const state = getState();

  // Agregar como primera tarea pendiente
  const newTasks = [
    { prompt: `CORRECCION: ${feedback.trim()}`, status: "pending" },
    ...state.tasks,
  ];

  setState({
    tasks: newTasks,
    savedTaskIndex: 0,
    status: "configured",
  });

  logger.info(`Feedback agregado: ${feedback.substring(0, 50)}...`);

  res.json({ ok: true, tasksCount: newTasks.length });
});

/**
 * POST /api/reset - Resetea todo el estado
 */
router.post("/reset", (req, res) => {
  stopLoop();
  resetState();
  logger.info("Estado reseteado");
  res.json({ ok: true });
});

/**
 * POST /api/restore - Restaura estado guardado
 */
router.post("/restore", (req, res) => {
  const { project } = req.body;

  if (!project) {
    return res.status(400).json({ error: "Project path requerido" });
  }

  const restored = restoreState(project);

  if (restored) {
    logger.info(`Estado restaurado desde ${project}`);
    res.json({ ok: true, state: getState() });
  } else {
    res.status(404).json({ error: "No se encontro estado guardado" });
  }
});

/**
 * GET /api/logs - Obtiene los logs
 */
router.get("/logs", (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  const logs = logger.getAll();
  const start = Math.max(0, logs.length - Number(limit) - Number(offset));
  const end = logs.length - Number(offset);

  res.json({
    total: logs.length,
    logs: logs.slice(start, end),
  });
});

module.exports = router;
