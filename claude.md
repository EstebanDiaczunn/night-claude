# NightClaude - Project Instructions

## Overview

NightClaude es una aplicación Node.js que automatiza tareas de desarrollo ejecutando Claude Code CLI de forma desatendida ("mientras dormís"). Monitorea el uso real de la API de Anthropic para pausar antes de exceder límites, crea ramas Git para aislar cambios, y genera resúmenes del trabajo realizado.

**Stack:** Node.js, Express, WebSocket, React (inline), Claude Code CLI

## Architecture

```
night-claude/
├── server.js       # Backend Express + WebSocket + lógica principal
├── index.html      # Frontend React (single-file, Babel transpile)
├── test-usage.js   # Script de prueba para OAuth/API
└── package.json    # Dependencies: express, ws
```

### Key Components (server.js)

- **Estado global** (`state`): Tracking de status, tareas, iteraciones, uso API
- **getClaudeToken()**: Obtiene OAuth token desde Keychain (macOS) o archivos (Windows)
- **getUsageFromAPI()**: Consulta `api.anthropic.com/api/oauth/usage` para límites reales
- **getUsageFromLocalFiles()**: Fallback estimando tokens desde `~/.claude/projects/*.jsonl`
- **runClaudeTask()**: Ejecuta `claude -p <prompt> --dangerously-skip-permissions`
- **runNightLoop()**: Loop principal que itera tareas, verifica uso, pausa si necesario
- **API endpoints**: `/api/config`, `/api/start`, `/api/stop`, `/api/continue`, `/api/feedback`, `/api/reset`

## Development

```bash
# Install dependencies
npm install

# Run server (default: http://localhost:3333)
npm start

# Test OAuth token + API usage
node test-usage.js
```

### Prerequisites

- Node.js 18+
- Claude Code CLI instalado y logueado (`claude --version` debe funcionar)
- Git configurado en el sistema

## Code Style

- JavaScript ES6+ con CommonJS modules (`require`/`module.exports`)
- Async/await para operaciones asíncronas
- Variables en camelCase, constantes en UPPER_CASE
- Funciones descriptivas con comentarios de sección (`// ====`)
- Frontend: React funcional con hooks, JSX transpilado por Babel

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/state` | GET | Estado actual del sistema |
| `/api/usage` | GET | Uso actual de la API (5h/7d) |
| `/api/config` | POST | Configurar proyecto y tareas |
| `/api/start` | POST | Iniciar loop nocturno |
| `/api/stop` | POST | Detener ejecución |
| `/api/continue` | POST | Continuar tras pausa por límite |
| `/api/feedback` | POST | Agregar corrección como nueva tarea |
| `/api/reset` | POST | Resetear estado completo |

## Task Flow

1. Usuario configura: ruta proyecto + lista de tareas + límite de uso
2. Sistema crea rama `claude/nightly-FECHA-TIMESTAMP`
3. Por cada tarea:
   - Verifica uso de API (pausa si >= límite)
   - Ejecuta Claude Code con prompt estructurado
   - Detecta `<promise>COMPLETE</promise>` o `<promise>BLOCKED</promise>`
   - Hace commit automático al completar
4. Genera `NIGHTCLAUDE_SUMMARY.md` en el proyecto
5. Guarda estado en `.nightclaude-state.json` para continuar

## Important Notes

- **Seguridad**: El servidor ejecuta `claude --dangerously-skip-permissions` - solo usar en entornos confiables
- **Tokens OAuth**: En macOS usa Keychain (`security find-generic-password`), en Windows busca en `~/.claude/.credentials.json`
- **Rate limits**: Respeta límites 5h y 7d de Anthropic, pausando proactivamente
- **Git**: Nunca trabaja en la rama actual, siempre crea `claude/nightly-*`
- **WebSocket**: Frontend se conecta vía WS para actualizaciones en tiempo real

## Common Issues

- **"Claude Code no instalado"**: Verificar que `claude` esté en PATH
- **"No se encontró token OAuth"**: Verificar login con `claude auth status`
- **Errores de Git**: Asegurar que el proyecto esté inicializado con Git
- **API 401**: Token OAuth expirado, re-autenticar con `claude auth login`

## Testing

```bash
# Verificar lectura de token y API
node test-usage.js

# El test muestra:
# - Estructura del archivo de credenciales
# - Token encontrado (parcial)
# - Respuesta de la API de uso
```
