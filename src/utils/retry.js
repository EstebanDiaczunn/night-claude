/**
 * Utilidad de retry con backoff exponencial
 */

/**
 * Ejecuta una funcion con reintentos
 * @param {Function} fn - Funcion async a ejecutar
 * @param {Object} options - Opciones de retry
 * @returns {Promise} - Resultado de la funcion
 */
const withRetry = async (fn, options = {}) => {
  const {
    attempts = 3,
    delay = 1000,
    backoff = 2,
    onRetry = null,
    shouldRetry = () => true,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      if (attempt === attempts || !shouldRetry(error, attempt)) {
        throw error;
      }

      const waitTime = delay * Math.pow(backoff, attempt - 1);

      if (onRetry) {
        onRetry(error, attempt, waitTime);
      }

      await sleep(waitTime);
    }
  }

  throw lastError;
};

/**
 * Sleep helper
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Timeout wrapper para promesas
 */
const withTimeout = (promise, ms, message = "Timeout") => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    ),
  ]);
};

module.exports = { withRetry, sleep, withTimeout };
