/**
 * Sistema de logging para NightClaude
 */

const fs = require("fs");
const path = require("path");

class Logger {
  constructor(options = {}) {
    this.entries = [];
    this.maxEntries = options.maxEntries || 500;
    this.persistToFile = options.persistToFile || false;
    this.logFilePath = options.logFilePath || null;
    this.listeners = [];
  }

  /**
   * Agrega un listener para nuevas entradas
   */
  onLog(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  /**
   * Notifica a todos los listeners
   */
  notify(entry) {
    this.listeners.forEach((listener) => {
      try {
        listener(entry);
      } catch (e) {
        console.error("Error en listener de log:", e);
      }
    });
  }

  /**
   * Agrega una entrada de log
   */
  log(type, message, meta = {}) {
    const entry = {
      time: new Date().toISOString(),
      type,
      message: String(message).substring(0, 500),
      ...meta,
    };

    this.entries.push(entry);

    // Limitar cantidad de entradas en memoria
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    // Log a consola
    const icon = this.getIcon(type);
    console.log(`${icon} [${type.toUpperCase()}] ${message.substring(0, 150)}`);

    // Persistir si esta habilitado
    if (this.persistToFile && this.logFilePath) {
      this.appendToFile(entry);
    }

    // Notificar listeners
    this.notify(entry);

    return entry;
  }

  /**
   * Obtiene icono segun tipo
   */
  getIcon(type) {
    const icons = {
      start: "🌙",
      task: "📋",
      done: "✅",
      complete: "☀️",
      error: "❌",
      warning: "⚠️",
      pause: "⏸️",
      git: "📦",
      info: "ℹ️",
      blocked: "🚫",
      usage: "📊",
    };
    return icons[type] || "•";
  }

  /**
   * Shortcuts para tipos comunes
   */
  info(message, meta) {
    return this.log("info", message, meta);
  }
  error(message, meta) {
    return this.log("error", message, meta);
  }
  warning(message, meta) {
    return this.log("warning", message, meta);
  }
  task(message, meta) {
    return this.log("task", message, meta);
  }
  git(message, meta) {
    return this.log("git", message, meta);
  }
  done(message, meta) {
    return this.log("done", message, meta);
  }

  /**
   * Persiste entrada a archivo
   */
  appendToFile(entry) {
    try {
      const line = JSON.stringify(entry) + "\n";
      fs.appendFileSync(this.logFilePath, line);
    } catch (e) {
      console.error("Error escribiendo log a archivo:", e.message);
    }
  }

  /**
   * Configura path de archivo de log
   */
  setLogFile(projectPath) {
    this.logFilePath = path.join(projectPath, ".nightclaude.log");
    this.persistToFile = true;
  }

  /**
   * Obtiene las ultimas N entradas
   */
  getRecent(count = 20) {
    return this.entries.slice(-count);
  }

  /**
   * Obtiene todas las entradas
   */
  getAll() {
    return [...this.entries];
  }

  /**
   * Limpia el log
   */
  clear() {
    this.entries = [];
  }
}

// Singleton para uso global
const logger = new Logger();

module.exports = { Logger, logger };
