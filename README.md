# 🌙 NightClaude

Claude Code trabaja mientras dormís.

## Requisitos

- Node.js 18+
- Claude Code instalado y logueado (`claude` en PATH)
- Git

## Instalación

```bash
npm install
npm start
```

Abrí http://localhost:3333

## Flujo

1. **Configurá** → Ruta del proyecto + tareas + límite de uso
2. **"Buenas noches"** → Claude crea rama `claude/nightly-FECHA` y trabaja
3. **Dormí** → Claude itera hasta completar o llegar al límite
4. **"Buenos días"** → Ves resumen, das feedback, Claude corrige

## 🔒 Control de Límites

NightClaude detecta tu uso REAL de dos formas:

### 1. API OAuth de Anthropic (preferida)
- Lee el token de Claude Code desde tu sistema
- Llama a `api.anthropic.com/api/oauth/usage`
- Obtiene porcentaje exacto de uso 5h y 7d

### 2. Fallback: Archivos locales
- Lee los JSONL en `~/.claude/projects/`
- Estima uso basándose en tokens consumidos

### Comportamiento de pausa
- Antes de cada iteración, verifica el uso
- Si `max(5h, 7d) >= límite configurado` → **PAUSA**
- Guarda estado en `.nightclaude-state.json`
- Muestra cuándo se reinicia el límite
- Podés **continuar** cuando la cuota se reinicie

## Archivos generados

```
tu-proyecto/
├── NIGHTCLAUDE_SUMMARY.md     # Resumen para leer al despertar
├── .nightclaude-state.json    # Estado para continuar
└── rama: claude/nightly-FECHA # Con los cambios
```

## Tips

```
✅ Buenos prompts:
- Implementar cache Redis para prescripciones con TTL 5min
- Agregar tests unitarios para PrescriptionService
- Refactorizar queries N+1 en PatientController

❌ Prompts vagos:
- Mejorar el código
- Arreglar bugs
```

## Limitaciones

- En Windows, la ubicación del token puede variar
- La estimación local es aproximada si falla la API
- El límite semanal es compartido con claude.ai
