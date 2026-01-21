/**
 * NightClaude v2.0
 * Claude Code trabaja mientras dormis
 *
 * Servidor principal
 */

const express = require("express");
const path = require("path");
const { getConfig } = require("./config");
const apiRoutes = require("./api/routes");
const { initWebSocket } = require("./websocket/handler");
const { logger } = require("./utils/logger");
const { validatePrerequisites } = require("./utils/validator");

// Inicializar app Express
const app = express();

// Middleware
app.use(express.json());

// Servir archivos estaticos desde public/
app.use(express.static(path.join(__dirname, "..", "public")));

// API routes
app.use("/api", apiRoutes);

// Fallback para SPA - servir index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// Error handler global
app.use((err, req, res, next) => {
  logger.error(`Error HTTP: ${err.message}`);
  res.status(500).json({ error: err.message });
});

// Configuracion
const config = getConfig();
const PORT = process.env.PORT || config.port;

// Iniciar servidor
const server = app.listen(PORT, () => {
  // Verificar prerequisitos al iniciar
  const prereqs = validatePrerequisites();

  console.log(`
  ╔═══════════════════════════════════════════════╗
  ║                                               ║
  ║       🌙 NightClaude v2.0                     ║
  ║       Claude Code trabaja mientras dormis     ║
  ║                                               ║
  ╠═══════════════════════════════════════════════╣
  ║                                               ║
  ║   URL:     http://localhost:${PORT}              ║
  ║                                               ║
  ║   Estado:                                     ║
  ║   ${prereqs.details.claude.installed ? "✓" : "✗"} Claude Code ${prereqs.details.claude.installed ? "instalado" : "NO instalado"}            ║
  ║   ${prereqs.details.git.installed ? "✓" : "✗"} Git ${prereqs.details.git.installed ? "instalado" : "NO instalado"}                    ║
  ║                                               ║
  ║   Caracteristicas:                            ║
  ║   • Deteccion real de uso via API             ║
  ║   • Pausa automatica al limite                ║
  ║   • Soporte macOS/Windows/Linux               ║
  ║   • Logs persistentes                         ║
  ║   • Estado recuperable                        ║
  ║                                               ║
  ╚═══════════════════════════════════════════════╝
  `);

  if (!prereqs.valid) {
    console.log("\n⚠️  ADVERTENCIAS:");
    prereqs.errors.forEach((e) => console.log(`   - ${e}`));
    console.log("");
  }
});

// Inicializar WebSocket
initWebSocket(server);

// Manejo de cierre graceful
const shutdown = () => {
  console.log("\nCerrando NightClaude...");
  server.close(() => {
    console.log("Servidor cerrado");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

module.exports = { app, server };
