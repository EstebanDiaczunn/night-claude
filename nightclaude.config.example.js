/**
 * Ejemplo de archivo de configuracion para NightClaude
 *
 * Copia este archivo a tu proyecto como:
 *   nightclaude.config.js
 *
 * O como JSON:
 *   nightclaude.config.json
 *   .nightclauderc
 */

module.exports = {
  // Maximo de iteraciones por tarea (default: 50)
  maxIterations: 50,

  // Porcentaje de uso de API en el que pausar (default: 90)
  usageLimit: 90,

  // Timeout para cada tarea en ms (default: 30 minutos)
  taskTimeout: 30 * 60 * 1000,

  // Delay entre iteraciones en ms (default: 3 segundos)
  iterationDelay: 3000,

  // Configuracion de Git
  git: {
    // Intentos de retry para comandos git
    retryAttempts: 3,
    // Delay entre reintentos en ms
    retryDelay: 1000,
  },

  // Configuracion de API
  api: {
    // Intentos de retry para llamadas a API
    retryAttempts: 3,
    // Delay entre reintentos en ms
    retryDelay: 2000,
  },

  // Configuracion de logging
  logging: {
    // Maximo de entradas en memoria
    maxEntries: 500,
    // Persistir logs a archivo
    persistToFile: true,
  },
};
