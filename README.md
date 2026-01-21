# NightClaude v2.0

**Claude Code trabaja mientras dormis.**

NightClaude es una herramienta de automatizacion que permite delegar tareas de desarrollo a Claude Code para que trabaje de forma desatendida durante la noche o en horarios no laborales.

## Caracteristicas

- **Automatizacion nocturna**: Configura tareas y deja que Claude trabaje mientras descansas
- **Control de uso de API**: Monitorea y pausa automaticamente al alcanzar limites
- **Integracion Git**: Crea ramas automaticas y commits descriptivos
- **Estado recuperable**: Guarda progreso para continuar despues de pausas
- **Multi-plataforma**: Soporte para macOS, Windows y Linux
- **Interfaz web moderna**: UI intuitiva con actualizaciones en tiempo real
- **Feedback loop**: Agrega correcciones que se procesan como nuevas tareas

## Requisitos

- Node.js 18 o superior
- Claude Code instalado y logueado (`claude` en PATH)
- Git

## Instalacion

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/night-claude.git
cd night-claude

# Instalar dependencias
npm install

# Iniciar
npm start
```

Abri http://localhost:3333

## Uso

### 1. Configura

Ingresa la ruta de tu proyecto y lista las tareas (una por linea):

```
Implementar cache Redis para el endpoint /api/users
Agregar tests unitarios para UserService
Refactorizar queries N+1 en ProductController
Actualizar dependencias a sus ultimas versiones
```

### 2. Inicia

Click en "Buenas noches" y NightClaude:
- Crea una rama `claude/nightly-YYYY-MM-DD-XXXX`
- Ejecuta cada tarea con Claude Code
- Hace commits automaticos
- Pausa si alcanza el limite de API

### 3. Revisa

Al despertar veras:
- Resumen de tareas completadas/bloqueadas
- Commits realizados
- Uso de API
- Opcion de agregar feedback

## Archivo de Configuracion

Podes crear un archivo `nightclaude.config.js` en tu proyecto:

```javascript
module.exports = {
  maxIterations: 50,        // Intentos por tarea
  usageLimit: 90,           // % de API para pausar
  taskTimeout: 30 * 60000,  // 30 min timeout por tarea
  iterationDelay: 3000,     // Delay entre reintentos
};
```

Tambien soporta `nightclaude.config.json` o `.nightclauderc`.

## Estructura del Proyecto

```
night-claude/
├── src/
│   ├── server.js           # Servidor principal
│   ├── config/             # Configuracion
│   ├── services/           # Servicios (Claude, Git, Token, Usage)
│   ├── core/               # Loop y estado
│   ├── api/                # Rutas REST
│   ├── websocket/          # WebSocket handler
│   └── utils/              # Utilidades
├── public/
│   └── index.html          # Frontend React
├── tests/                  # Tests
└── package.json
```

## API REST

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/state` | GET | Estado actual |
| `/api/usage` | GET | Uso de API |
| `/api/config` | POST | Configurar proyecto |
| `/api/start` | POST | Iniciar loop |
| `/api/stop` | POST | Detener |
| `/api/continue` | POST | Continuar desde pausa |
| `/api/feedback` | POST | Agregar correccion |
| `/api/reset` | POST | Resetear todo |

## Control de Limites

NightClaude detecta tu uso de la API de Anthropic de dos formas:

### 1. API OAuth (preferida)
Lee el token de Claude Code y consulta `api.anthropic.com/api/oauth/usage` para obtener el porcentaje exacto de uso.

### 2. Fallback Local
Si no puede acceder a la API, estima el uso escaneando los archivos JSONL en `~/.claude/projects/`.

### Comportamiento de Pausa
- Antes de cada iteracion verifica el uso
- Si `max(5h%, 7d%) >= usageLimit` → **PAUSA**
- Guarda estado para poder continuar
- Muestra cuando se reinicia la cuota

## Tips para Prompts

**Buenos prompts:**
```
Implementar cache Redis para prescripciones con TTL de 5 minutos
Agregar tests unitarios para PrescriptionService cubriendo casos edge
Refactorizar queries N+1 en PatientController usando eager loading
Migrar de moment.js a date-fns en todo el proyecto
```

**Evitar:**
```
Mejorar el codigo
Arreglar bugs
Hacer que funcione mejor
```

## Archivos Generados

En tu proyecto:
- `NIGHTCLAUDE_SUMMARY.md` - Resumen de la sesion
- `.nightclaude-state.json` - Estado para continuar
- `.nightclaude.log` - Log detallado

## Tests

```bash
npm test
```

## Seguridad

**IMPORTANTE**: NightClaude ejecuta Claude Code con `--dangerously-skip-permissions`, lo que significa que Claude tiene control total sin confirmaciones.

- Solo usa en proyectos de confianza
- Revisa siempre los cambios antes de mergear
- El servidor corre en localhost por defecto

## Troubleshooting

### "No se encontro token OAuth"
- Asegurate de estar logueado en Claude Code (`claude`)
- En Linux, puede necesitar `secret-tool` o credenciales en archivo

### "Claude Code no instalado"
- Instala Claude Code y asegurate que `claude` este en PATH
- Verifica con `claude --version`

### "El proyecto no es un repositorio Git"
- Inicializa git en tu proyecto: `git init`

## Licencia

MIT

## Autor

Esteban Nicolas Diaczun
