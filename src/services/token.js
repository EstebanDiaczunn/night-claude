/**
 * Servicio de obtencion de token OAuth de Claude Code
 * Soporta macOS, Windows y Linux
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { getPlatform } = require("../config");

/**
 * Obtiene el token OAuth de Claude Code
 * @returns {string|null} Token o null si no se encuentra
 */
const getClaudeToken = () => {
  const platform = getPlatform();

  try {
    if (platform.isWindows) {
      return getTokenWindows();
    } else if (platform.isMac) {
      return getTokenMac();
    } else if (platform.isLinux) {
      return getTokenLinux();
    }
  } catch (e) {
    console.error(`Error obteniendo token (${platform.name}):`, e.message);
  }

  // Fallback: intentar leer de archivos comunes
  return getTokenFromFiles();
};

/**
 * Obtiene token en Windows desde archivos de credenciales
 */
const getTokenWindows = () => {
  const claudeDir = path.join(os.homedir(), ".claude");
  const possiblePaths = [
    path.join(claudeDir, ".credentials.json"),
    path.join(claudeDir, ".credentials"),
    path.join(claudeDir, "credentials.json"),
    path.join(os.homedir(), "AppData", "Roaming", "Claude", "credentials.json"),
  ];

  return findTokenInFiles(possiblePaths);
};

/**
 * Obtiene token en macOS desde Keychain
 */
const getTokenMac = () => {
  try {
    const result = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    const data = JSON.parse(result.trim());
    return extractToken(data);
  } catch (e) {
    // Fallback a archivos
    return getTokenFromFiles();
  }
};

/**
 * Obtiene token en Linux
 * Intenta secret-tool (GNOME Keyring), pass, o archivos
 */
const getTokenLinux = () => {
  // Intentar GNOME Keyring via secret-tool
  try {
    const result = execSync(
      'secret-tool lookup service "Claude Code-credentials" 2>/dev/null',
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    if (result.trim()) {
      const data = JSON.parse(result.trim());
      return extractToken(data);
    }
  } catch (e) {
    // No disponible
  }

  // Intentar libsecret via D-Bus (alternativa)
  try {
    const result = execSync(
      `python3 -c "
import secretstorage
conn = secretstorage.dbus_init()
collection = secretstorage.get_default_collection(conn)
for item in collection.get_all_items():
    if 'Claude' in item.get_label():
        print(item.get_secret().decode())
        break
" 2>/dev/null`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    if (result.trim()) {
      const data = JSON.parse(result.trim());
      return extractToken(data);
    }
  } catch (e) {
    // No disponible
  }

  // Fallback a archivos
  return getTokenFromFiles();
};

/**
 * Busca token en archivos comunes (fallback para todas las plataformas)
 */
const getTokenFromFiles = () => {
  const claudeDir = path.join(os.homedir(), ".claude");
  const possiblePaths = [
    path.join(claudeDir, ".credentials.json"),
    path.join(claudeDir, ".credentials"),
    path.join(claudeDir, "credentials.json"),
    path.join(claudeDir, "auth.json"),
  ];

  return findTokenInFiles(possiblePaths);
};

/**
 * Busca token en lista de archivos
 */
const findTokenInFiles = (paths) => {
  for (const filePath of paths) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(content);
        const token = extractToken(data);
        if (token) return token;
      } catch (e) {
        // Continuar con siguiente archivo
      }
    }
  }
  return null;
};

/**
 * Extrae token de objeto de credenciales
 */
const extractToken = (data) => {
  if (!data) return null;

  // Formato claudeAiOauth
  if (data.claudeAiOauth?.accessToken) {
    return data.claudeAiOauth.accessToken;
  }

  // Formato directo
  if (data.accessToken) {
    return data.accessToken;
  }

  // Formato oauth
  if (data.oauth?.accessToken) {
    return data.oauth.accessToken;
  }

  return null;
};

/**
 * Verifica si hay un token disponible
 */
const hasToken = () => {
  return getClaudeToken() !== null;
};

module.exports = {
  getClaudeToken,
  hasToken,
};
