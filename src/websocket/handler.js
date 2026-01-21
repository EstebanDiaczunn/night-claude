/**
 * Handler de WebSocket para NightClaude
 */

const { WebSocketServer } = require("ws");
const { getState, subscribe } = require("../core/state");
const { logger } = require("../utils/logger");

let wss = null;

/**
 * Inicializa el servidor WebSocket
 */
const initWebSocket = (server) => {
  wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    // Enviar estado inicial
    ws.send(
      JSON.stringify({
        type: "status",
        data: getState(),
      })
    );

    // Manejar mensajes del cliente
    ws.on("message", (message) => {
      try {
        const msg = JSON.parse(message);
        handleClientMessage(ws, msg);
      } catch (e) {
        // Mensaje invalido
      }
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error.message);
    });
  });

  // Suscribirse a cambios de estado
  subscribe((state) => {
    broadcast({ type: "status", data: state });
  });

  // Suscribirse a logs
  logger.onLog((entry) => {
    broadcast({ type: "log", data: entry });
  });

  return wss;
};

/**
 * Envia mensaje a todos los clientes conectados
 */
const broadcast = (data) => {
  if (!wss) return;

  const message = JSON.stringify(data);

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      // OPEN
      try {
        client.send(message);
      } catch (e) {
        // Error enviando
      }
    }
  });
};

/**
 * Maneja mensajes del cliente
 */
const handleClientMessage = (ws, msg) => {
  switch (msg.type) {
    case "ping":
      ws.send(JSON.stringify({ type: "pong", time: Date.now() }));
      break;

    case "getState":
      ws.send(JSON.stringify({ type: "status", data: getState() }));
      break;

    default:
      // Tipo desconocido
      break;
  }
};

/**
 * Obtiene el numero de clientes conectados
 */
const getClientCount = () => {
  return wss ? wss.clients.size : 0;
};

module.exports = {
  initWebSocket,
  broadcast,
  getClientCount,
};
