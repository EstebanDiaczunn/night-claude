/**
 * TEST 2: Leer .credentials.json específicamente
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const credPath = path.join(os.homedir(), ".claude", ".credentials.json");

console.log("═══════════════════════════════════════════");
console.log("  TEST 2: Leyendo .credentials.json");
console.log("═══════════════════════════════════════════\n");

console.log(`Archivo: ${credPath}\n`);

if (!fs.existsSync(credPath)) {
  console.log("✗ No existe");
  process.exit(1);
}

try {
  const content = fs.readFileSync(credPath, "utf8");
  const data = JSON.parse(content);

  console.log("✓ Archivo leído correctamente\n");
  console.log("Estructura del JSON:");
  console.log("─────────────────────────────────────────\n");

  // Mostrar estructura sin valores sensibles
  const showStructure = (obj, indent = "") => {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === "object" && val !== null) {
        console.log(`${indent}${key}: {`);
        showStructure(val, indent + "  ");
        console.log(`${indent}}`);
      } else if (typeof val === "string") {
        // Mostrar solo primeros 30 chars si parece un token/secret
        const isSecret =
          key.toLowerCase().includes("token") ||
          key.toLowerCase().includes("secret") ||
          key.toLowerCase().includes("key") ||
          val.startsWith("sk-");
        if (isSecret) {
          console.log(
            `${indent}${key}: "${val.substring(0, 25)}..." (${val.length} chars)`,
          );
        } else {
          console.log(
            `${indent}${key}: "${val.substring(0, 50)}${val.length > 50 ? "..." : ""}"`,
          );
        }
      } else {
        console.log(`${indent}${key}: ${val}`);
      }
    }
  };

  showStructure(data);

  // Buscar token
  console.log("\n─────────────────────────────────────────");
  console.log("Buscando token OAuth...\n");

  let token = null;

  if (data.claudeAiOauth?.accessToken) {
    token = data.claudeAiOauth.accessToken;
    console.log("✓ Encontrado en: claudeAiOauth.accessToken");
  } else if (data.accessToken) {
    token = data.accessToken;
    console.log("✓ Encontrado en: accessToken");
  } else if (data.oauth?.accessToken) {
    token = data.oauth.accessToken;
    console.log("✓ Encontrado en: oauth.accessToken");
  } else {
    console.log("✗ No se encontró campo de token conocido");
    console.log("\nCampos disponibles en raíz:", Object.keys(data));
  }

  if (token) {
    console.log(`Token: ${token.substring(0, 30)}...`);
    console.log(`Longitud: ${token.length} caracteres`);

    // Probar la API
    console.log("\n═══════════════════════════════════════════");
    console.log("Probando API de uso con el token...\n");

    fetch("https://api.anthropic.com/api/oauth/usage", {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "claude-code/2.0.31",
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
    })
      .then(async (response) => {
        console.log(`HTTP Status: ${response.status}`);
        const text = await response.text();

        if (response.ok) {
          const data = JSON.parse(text);
          console.log("\n✓ ¡LA API FUNCIONA!\n");
          console.log("Respuesta:");
          console.log(JSON.stringify(data, null, 2));

          if (data.five_hour) {
            console.log(
              `\n📊 Uso 5h: ${Math.round(data.five_hour.utilization * 100)}%`,
            );
          }
          if (data.seven_day) {
            console.log(
              `📊 Uso 7d: ${Math.round(data.seven_day.utilization * 100)}%`,
            );
          }
        } else {
          console.log(`\n✗ Error: ${text}`);
        }
      })
      .catch((err) => {
        console.log(`✗ Error de red: ${err.message}`);
      });
  }
} catch (e) {
  console.log(`✗ Error: ${e.message}`);
}
