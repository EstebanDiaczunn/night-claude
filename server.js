const express = require("express");
const { spawn, exec, execSync } = require("child_process");
const { WebSocketServer } = require("ws");
const path = require("path");
const fs = require("fs");
const os = require("os");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = 3333;
const isWindows = os.platform() === "win32";

// ============================================
// ESTADO GLOBAL
// ============================================
let state = {
  status: "idle",
  project: null,
  tasks: [],
  currentTask: 0,
  iteration: 0,
  maxIterations: 50,
  usageLimit: 90,
  branch: null,
  log: [],
  summary: null,
  startTime: null,
  pauseReason: null,
  usage: { fiveHour: 0, sevenDay: 0 },
  savedTaskIndex: 0,
};

let wss;
let claudeProcess = null;
let shouldStop = false;

const broadcast = (data) => {
  if (wss) {
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify(data));
      }
    });
  }
};

const addLog = (type, message) => {
  const entry = {
    time: new Date().toISOString(),
    type,
    message: message.substring(0, 500),
  };
  state.log.push(entry);
  broadcast({ type: "log", data: entry });
  console.log(`[${type}] ${message.substring(0, 100)}`);
};

// ============================================
// OBTENER TOKEN OAUTH DE CLAUDE CODE
// ============================================
const getClaudeToken = () => {
  try {
    if (isWindows) {
      // Windows: leer de archivo de credenciales
      const claudeDir = path.join(os.homedir(), ".claude");
      const possiblePaths = [
        path.join(claudeDir, ".credentials"),
        path.join(claudeDir, "credentials.json"),
        path.join(
          os.homedir(),
          "AppData",
          "Roaming",
          "Claude",
          "credentials.json",
        ),
      ];

      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          const data = JSON.parse(fs.readFileSync(p, "utf8"));
          if (data.claudeAiOauth?.accessToken)
            return data.claudeAiOauth.accessToken;
          if (data.accessToken) return data.accessToken;
        }
      }
    } else {
      // macOS/Linux: Keychain
      try {
        const result = execSync(
          'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
          { encoding: "utf8" },
        );
        const data = JSON.parse(result.trim());
        return data.claudeAiOauth?.accessToken;
      } catch (e) {}
    }
  } catch (e) {
    console.error("Error obteniendo token:", e.message);
  }
  return null;
};

// ============================================
// OBTENER USO REAL DE LA API DE ANTHROPIC
// ============================================
const getUsageFromAPI = async () => {
  const token = getClaudeToken();

  if (!token) {
    addLog("warning", "No se encontró token OAuth - usando estimación");
    return getUsageFromLocalFiles();
  }

  try {
    const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "NightClaude/1.0",
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
    });

    if (!response.ok) throw new Error(`API ${response.status}`);

    const data = await response.json();

    return {
      fiveHour: Math.round((data.five_hour?.utilization || 0) * 100),
      sevenDay: Math.round((data.seven_day?.utilization || 0) * 100),
      fiveHourReset: data.five_hour?.resets_at,
      sevenDayReset: data.seven_day?.resets_at,
      source: "api",
    };
  } catch (e) {
    return getUsageFromLocalFiles();
  }
};

// ============================================
// FALLBACK: ESTIMAR USO DESDE ARCHIVOS LOCALES
// ============================================
const getUsageFromLocalFiles = () => {
  try {
    const claudeDir = path.join(os.homedir(), ".claude", "projects");
    if (!fs.existsSync(claudeDir))
      return { fiveHour: 0, sevenDay: 0, source: "none" };

    const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
    let tokensFiveHour = 0;

    const scanDir = (dir) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) scanDir(filePath);
        else if (file.endsWith(".jsonl") && stat.mtimeMs > fiveHoursAgo) {
          try {
            const lines = fs.readFileSync(filePath, "utf8").split("\n");
            for (const line of lines) {
              try {
                const entry = JSON.parse(line);
                tokensFiveHour += entry.usage?.total_tokens || 0;
              } catch (e) {}
            }
          } catch (e) {}
        }
      }
    };

    scanDir(claudeDir);
    const limit = 88000; // Max5 estimate

    return {
      fiveHour: Math.min(100, Math.round((tokensFiveHour / limit) * 100)),
      sevenDay: 0,
      source: "local",
    };
  } catch (e) {
    return { fiveHour: 0, sevenDay: 0, source: "error" };
  }
};

// ============================================
// GIT
// ============================================
const gitCmd = (cwd, args) =>
  new Promise((resolve, reject) => {
    exec(`git ${args}`, { cwd }, (err, stdout) => {
      if (err) reject(err.message);
      else resolve(stdout.trim());
    });
  });

const createBranch = async (projectPath) => {
  const date = new Date().toISOString().split("T")[0];
  const time = Date.now().toString().slice(-4);
  const branch = `claude/nightly-${date}-${time}`;

  await gitCmd(projectPath, "rev-parse --git-dir");
  await gitCmd(projectPath, `checkout -b ${branch}`);
  addLog("git", `Rama: ${branch}`);
  return branch;
};

// ============================================
// EJECUTAR CLAUDE CODE
// ============================================
const runClaudeTask = (projectPath, prompt, taskIndex) => {
  return new Promise((resolve, reject) => {
    const fullPrompt = `TAREA ${taskIndex + 1}: ${prompt}

REGLAS:
- Completá la tarea sin pedir confirmación
- Hacé commits con mensajes descriptivos
- Al terminar exitosamente: <promise>COMPLETE</promise>
- Si te trabás: <promise>BLOCKED</promise> y explicá por qué`;

    addLog("task", `Tarea ${taskIndex + 1}: ${prompt.substring(0, 50)}...`);

    claudeProcess = spawn(
      "claude",
      ["-p", fullPrompt, "--dangerously-skip-permissions"],
      {
        cwd: projectPath,
        shell: true,
      },
    );

    let output = "";
    let completed = false;
    let blocked = false;

    claudeProcess.stdout.on("data", (data) => {
      const text = data.toString();
      output += text;
      if (text.includes("<promise>COMPLETE</promise>")) completed = true;
      if (text.includes("<promise>BLOCKED</promise>")) blocked = true;
    });

    claudeProcess.on("close", (code) => {
      claudeProcess = null;
      resolve({ output, completed, blocked, code });
    });

    claudeProcess.on("error", reject);
  });
};

// ============================================
// LOOP NOCTURNO
// ============================================
const runNightLoop = async () => {
  state.status = "running";
  state.startTime = new Date().toISOString();
  shouldStop = false;

  if (!state.branch) state.log = [];
  broadcast({ type: "status", data: state });
  addLog("start", "🌙 NightClaude iniciado");

  try {
    if (!state.branch) {
      state.branch = await createBranch(state.project);
    }
    broadcast({ type: "status", data: state });

    for (let t = state.savedTaskIndex; t < state.tasks.length; t++) {
      if (shouldStop) break;

      state.currentTask = t;
      const task = state.tasks[t];
      if (task.status === "completed") continue;

      for (let i = 0; i < state.maxIterations; i++) {
        if (shouldStop) break;

        state.iteration = i + 1;
        broadcast({ type: "status", data: state });

        // *** CHECK USAGE ***
        const usage = await getUsageFromAPI();
        state.usage = usage;
        broadcast({ type: "usage", data: usage });
        const express = require("express");
        const { spawn, exec, execSync } = require("child_process");
        const { WebSocketServer } = require("ws");
        const path = require("path");
        const fs = require("fs");
        const os = require("os");

        const app = express();
        app.use(express.json());
        app.use(express.static(path.join(__dirname, "public")));

        const PORT = 3333;
        const isWindows = os.platform() === "win32";

        // ============================================
        // ESTADO GLOBAL
        // ============================================
        let state = {
          status: "idle",
          project: null,
          tasks: [],
          currentTask: 0,
          iteration: 0,
          maxIterations: 50,
          usageLimit: 90,
          branch: null,
          log: [],
          summary: null,
          startTime: null,
          pauseReason: null,
          usage: { fiveHour: 0, sevenDay: 0 },
          savedTaskIndex: 0,
        };

        let wss;
        let claudeProcess = null;
        let shouldStop = false;

        const broadcast = (data) => {
          if (wss) {
            wss.clients.forEach((client) => {
              if (client.readyState === 1) {
                client.send(JSON.stringify(data));
              }
            });
          }
        };

        const addLog = (type, message) => {
          const entry = {
            time: new Date().toISOString(),
            type,
            message: message.substring(0, 500),
          };
          state.log.push(entry);
          broadcast({ type: "log", data: entry });
          console.log(`[${type}] ${message.substring(0, 100)}`);
        };

        // ============================================
        // OBTENER TOKEN OAUTH DE CLAUDE CODE
        // ============================================
        const getClaudeToken = () => {
          try {
            if (isWindows) {
              // Windows: leer de archivo de credenciales
              const claudeDir = path.join(os.homedir(), ".claude");
              const possiblePaths = [
                path.join(claudeDir, ".credentials.json"), // Este es el correcto en Windows
                path.join(claudeDir, ".credentials"),
                path.join(claudeDir, "credentials.json"),
              ];

              for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                  const data = JSON.parse(fs.readFileSync(p, "utf8"));
                  if (data.claudeAiOauth?.accessToken)
                    return data.claudeAiOauth.accessToken;
                  if (data.accessToken) return data.accessToken;
                }
              }
            } else {
              // macOS/Linux: Keychain
              try {
                const result = execSync(
                  'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
                  { encoding: "utf8" },
                );
                const data = JSON.parse(result.trim());
                return data.claudeAiOauth?.accessToken;
              } catch (e) {}
            }
          } catch (e) {
            console.error("Error obteniendo token:", e.message);
          }
          return null;
        };

        // ============================================
        // OBTENER USO REAL DE LA API DE ANTHROPIC
        // ============================================
        const getUsageFromAPI = async () => {
          const token = getClaudeToken();

          if (!token) {
            addLog("warning", "No se encontró token OAuth - usando estimación");
            return getUsageFromLocalFiles();
          }

          try {
            const response = await fetch(
              "https://api.anthropic.com/api/oauth/usage",
              {
                method: "GET",
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                  "User-Agent": "NightClaude/1.0",
                  Authorization: `Bearer ${token}`,
                  "anthropic-beta": "oauth-2025-04-20",
                },
              },
            );

            if (!response.ok) throw new Error(`API ${response.status}`);

            const data = await response.json();

            return {
              fiveHour: Math.round(data.five_hour?.utilization || 0), // API ya devuelve %
              sevenDay: Math.round(data.seven_day?.utilization || 0),
              fiveHourReset: data.five_hour?.resets_at,
              sevenDayReset: data.seven_day?.resets_at,
              source: "api",
            };
          } catch (e) {
            return getUsageFromLocalFiles();
          }
        };

        // ============================================
        // FALLBACK: ESTIMAR USO DESDE ARCHIVOS LOCALES
        // ============================================
        const getUsageFromLocalFiles = () => {
          try {
            const claudeDir = path.join(os.homedir(), ".claude", "projects");
            if (!fs.existsSync(claudeDir))
              return { fiveHour: 0, sevenDay: 0, source: "none" };

            const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
            let tokensFiveHour = 0;

            const scanDir = (dir) => {
              const files = fs.readdirSync(dir);
              for (const file of files) {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) scanDir(filePath);
                else if (
                  file.endsWith(".jsonl") &&
                  stat.mtimeMs > fiveHoursAgo
                ) {
                  try {
                    const lines = fs.readFileSync(filePath, "utf8").split("\n");
                    for (const line of lines) {
                      try {
                        const entry = JSON.parse(line);
                        tokensFiveHour += entry.usage?.total_tokens || 0;
                      } catch (e) {}
                    }
                  } catch (e) {}
                }
              }
            };

            scanDir(claudeDir);
            const limit = 88000; // Max5 estimate

            return {
              fiveHour: Math.min(
                100,
                Math.round((tokensFiveHour / limit) * 100),
              ),
              sevenDay: 0,
              source: "local",
            };
          } catch (e) {
            return { fiveHour: 0, sevenDay: 0, source: "error" };
          }
        };

        // ============================================
        // GIT
        // ============================================
        const gitCmd = (cwd, args) =>
          new Promise((resolve, reject) => {
            exec(`git ${args}`, { cwd }, (err, stdout) => {
              if (err) reject(err.message);
              else resolve(stdout.trim());
            });
          });

        const createBranch = async (projectPath) => {
          const date = new Date().toISOString().split("T")[0];
          const time = Date.now().toString().slice(-4);
          const branch = `claude/nightly-${date}-${time}`;

          await gitCmd(projectPath, "rev-parse --git-dir");
          await gitCmd(projectPath, `checkout -b ${branch}`);
          addLog("git", `Rama: ${branch}`);
          return branch;
        };

        // ============================================
        // EJECUTAR CLAUDE CODE
        // ============================================
        const runClaudeTask = (projectPath, prompt, taskIndex) => {
          return new Promise((resolve, reject) => {
            const fullPrompt = `TAREA ${taskIndex + 1}: ${prompt}

        REGLAS:
        - Completá la tarea sin pedir confirmación
        - Hacé commits con mensajes descriptivos
        - Al terminar exitosamente: <promise>COMPLETE</promise>
        - Si te trabás: <promise>BLOCKED</promise> y explicá por qué`;

            addLog(
              "task",
              `Tarea ${taskIndex + 1}: ${prompt.substring(0, 50)}...`,
            );

            claudeProcess = spawn(
              "claude",
              ["-p", fullPrompt, "--dangerously-skip-permissions"],
              {
                cwd: projectPath,
                shell: true,
              },
            );

            let output = "";
            let completed = false;
            let blocked = false;

            claudeProcess.stdout.on("data", (data) => {
              const text = data.toString();
              output += text;
              if (text.includes("<promise>COMPLETE</promise>"))
                completed = true;
              if (text.includes("<promise>BLOCKED</promise>")) blocked = true;
            });

            claudeProcess.on("close", (code) => {
              claudeProcess = null;
              resolve({ output, completed, blocked, code });
            });

            claudeProcess.on("error", reject);
          });
        };

        // ============================================
        // LOOP NOCTURNO
        // ============================================
        const runNightLoop = async () => {
          state.status = "running";
          state.startTime = new Date().toISOString();
          shouldStop = false;

          if (!state.branch) state.log = [];
          broadcast({ type: "status", data: state });
          addLog("start", "🌙 NightClaude iniciado");

          try {
            if (!state.branch) {
              state.branch = await createBranch(state.project);
            }
            broadcast({ type: "status", data: state });

            for (let t = state.savedTaskIndex; t < state.tasks.length; t++) {
              if (shouldStop) break;

              state.currentTask = t;
              const task = state.tasks[t];
              if (task.status === "completed") continue;

              for (let i = 0; i < state.maxIterations; i++) {
                if (shouldStop) break;

                state.iteration = i + 1;
                broadcast({ type: "status", data: state });

                // *** CHECK USAGE ***
                const usage = await getUsageFromAPI();
                state.usage = usage;
                broadcast({ type: "usage", data: usage });

                const currentUsage = Math.max(usage.fiveHour, usage.sevenDay);

                if (currentUsage >= state.usageLimit) {
                  state.status = "paused";
                  state.pauseReason = `Límite: ${usage.fiveHour}% (5h) / ${usage.sevenDay}% (7d)`;
                  state.savedTaskIndex = t;
                  addLog("pause", state.pauseReason);

                  if (usage.fiveHourReset) {
                    addLog(
                      "info",
                      `Reset 5h: ${new Date(usage.fiveHourReset).toLocaleString("es-AR")}`,
                    );
                  }

                  broadcast({ type: "status", data: state });
                  await generateSummary();
                  saveState();
                  return;
                }

                const result = await runClaudeTask(
                  state.project,
                  task.prompt,
                  t,
                );

                if (result.completed) {
                  state.tasks[t].status = "completed";
                  addLog("done", `✅ Tarea ${t + 1} completada`);
                  try {
                    await gitCmd(state.project, "add -A");
                    await gitCmd(
                      state.project,
                      `commit -m "feat: Tarea ${t + 1} - ${task.prompt.substring(0, 40)}" --allow-empty`,
                    );
                  } catch (e) {}
                  break;
                }

                if (result.blocked) {
                  state.tasks[t].status = "blocked";
                  addLog("blocked", `⚠️ Tarea ${t + 1} bloqueada`);
                  break;
                }

                await new Promise((r) => setTimeout(r, 3000));
              }
            }

            await generateSummary();
            state.status = "completed";
            addLog("complete", "☀️ Completado");
            broadcast({ type: "status", data: state });
          } catch (err) {
            state.status = "error";
            addLog("error", err.message);
            broadcast({ type: "status", data: state });
          }
        };

        // ============================================
        // RESUMEN
        // ============================================
        const generateSummary = async () => {
          let commits = [];
          try {
            const log = await gitCmd(state.project, "log --oneline -10");
            commits = log.split("\n").filter((c) => c);
          } catch (e) {}

          const mins = Math.round(
            (Date.now() - new Date(state.startTime).getTime()) / 60000,
          );

          state.summary = {
            branch: state.branch,
            duration: `${Math.floor(mins / 60)}h ${mins % 60}m`,
            tasksCompleted: state.tasks.filter((t) => t.status === "completed")
              .length,
            tasksBlocked: state.tasks.filter((t) => t.status === "blocked")
              .length,
            tasksPending: state.tasks.filter((t) => t.status === "pending")
              .length,
            commits,
            usage: state.usage,
          };

          const md = `# 🌙 NightClaude - Resumen

        **Fecha:** ${new Date().toLocaleString("es-AR")}
        **Duración:** ${state.summary.duration}
        **Rama:** \`${state.branch}\`

        ## Uso: ${state.usage.fiveHour}% (5h) / ${state.usage.sevenDay}% (7d)

        ## Tareas
        ${state.tasks.map((t, i) => `- ${t.status === "completed" ? "✅" : t.status === "blocked" ? "⚠️" : "⏳"} ${t.prompt.substring(0, 60)}`).join("\n")}

        ## Commits
        ${commits.map((c) => `- ${c}`).join("\n") || "_Sin commits_"}

        ## Log
        ${state.log
          .slice(-20)
          .map((l) => `- [${l.type}] ${l.message.substring(0, 80)}`)
          .join("\n")}
        `;

          fs.writeFileSync(
            path.join(state.project, "NIGHTCLAUDE_SUMMARY.md"),
            md,
          );
        };

        const saveState = () => {
          fs.writeFileSync(
            path.join(state.project, ".nightclaude-state.json"),
            JSON.stringify(state, null, 2),
          );
        };

        // ============================================
        // API
        // ============================================
        app.get("/api/state", (req, res) => res.json(state));

        app.get("/api/usage", async (req, res) =>
          res.json(await getUsageFromAPI()),
        );

        app.post("/api/config", (req, res) => {
          const { project, tasks, maxIterations, usageLimit } = req.body;

          if (!fs.existsSync(project)) {
            return res.status(400).json({ error: "Proyecto no existe" });
          }

          try {
            execSync("claude --version");
          } catch (e) {
            return res.status(400).json({ error: "Claude Code no instalado" });
          }

          state = {
            ...state,
            project,
            tasks: tasks.map((t) => ({ prompt: t, status: "pending" })),
            maxIterations: maxIterations || 50,
            usageLimit: usageLimit || 90,
            status: "configured",
            branch: null,
            savedTaskIndex: 0,
            log: [],
          };

          res.json({ ok: true });
        });

        app.post("/api/start", (req, res) => {
          if (state.status === "running")
            return res.status(400).json({ error: "Ya corriendo" });
          res.json({ ok: true });
          runNightLoop();
        });

        app.post("/api/stop", (req, res) => {
          shouldStop = true;
          if (claudeProcess) claudeProcess.kill();
          state.status = "stopped";
          broadcast({ type: "status", data: state });
          res.json({ ok: true });
        });

        app.post("/api/continue", (req, res) => {
          if (state.status !== "paused")
            return res.status(400).json({ error: "No pausado" });
          res.json({ ok: true });
          runNightLoop();
        });

        app.post("/api/feedback", (req, res) => {
          const { feedback } = req.body;
          state.tasks.unshift({
            prompt: `CORRECCIÓN: ${feedback}`,
            status: "pending",
          });
          state.savedTaskIndex = 0;
          state.status = "configured";
          res.json({ ok: true });
        });

        app.post("/api/reset", (req, res) => {
          state = {
            status: "idle",
            project: null,
            tasks: [],
            currentTask: 0,
            iteration: 0,
            maxIterations: 50,
            usageLimit: 90,
            branch: null,
            log: [],
            summary: null,
            startTime: null,
            pauseReason: null,
            usage: { fiveHour: 0, sevenDay: 0 },
            savedTaskIndex: 0,
          };
          res.json({ ok: true });
        });

        // ============================================
        // START
        // ============================================
        const server = app.listen(PORT, () => {
          console.log(`
          ╔════════════════════════════════════════╗
          ║  🌙 NightClaude v1.0                   ║
          ║  http://localhost:${PORT}                 ║
          ║                                        ║
          ║  • Detección real de uso via API       ║
          ║  • Pausa al ${state.usageLimit}% del límite            ║
          ║  • Continúa donde quedó                ║
          ╚════════════════════════════════════════╝
          `);
        });

        wss = new WebSocketServer({ server });
        wss.on("connection", (ws) =>
          ws.send(JSON.stringify({ type: "status", data: state })),
        );
        const currentUsage = Math.max(usage.fiveHour, usage.sevenDay);

        if (currentUsage >= state.usageLimit) {
          state.status = "paused";
          state.pauseReason = `Límite: ${usage.fiveHour}% (5h) / ${usage.sevenDay}% (7d)`;
          state.savedTaskIndex = t;
          addLog("pause", state.pauseReason);

          if (usage.fiveHourReset) {
            addLog(
              "info",
              `Reset 5h: ${new Date(usage.fiveHourReset).toLocaleString("es-AR")}`,
            );
          }

          broadcast({ type: "status", data: state });
          await generateSummary();
          saveState();
          return;
        }

        const result = await runClaudeTask(state.project, task.prompt, t);

        if (result.completed) {
          state.tasks[t].status = "completed";
          addLog("done", `✅ Tarea ${t + 1} completada`);
          try {
            await gitCmd(state.project, "add -A");
            await gitCmd(
              state.project,
              `commit -m "feat: Tarea ${t + 1} - ${task.prompt.substring(0, 40)}" --allow-empty`,
            );
          } catch (e) {}
          break;
        }

        if (result.blocked) {
          state.tasks[t].status = "blocked";
          addLog("blocked", `⚠️ Tarea ${t + 1} bloqueada`);
          break;
        }

        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    await generateSummary();
    state.status = "completed";
    addLog("complete", "☀️ Completado");
    broadcast({ type: "status", data: state });
  } catch (err) {
    state.status = "error";
    addLog("error", err.message);
    broadcast({ type: "status", data: state });
  }
};

// ============================================
// RESUMEN
// ============================================
const generateSummary = async () => {
  let commits = [];
  try {
    const log = await gitCmd(state.project, "log --oneline -10");
    commits = log.split("\n").filter((c) => c);
  } catch (e) {}

  const mins = Math.round(
    (Date.now() - new Date(state.startTime).getTime()) / 60000,
  );

  state.summary = {
    branch: state.branch,
    duration: `${Math.floor(mins / 60)}h ${mins % 60}m`,
    tasksCompleted: state.tasks.filter((t) => t.status === "completed").length,
    tasksBlocked: state.tasks.filter((t) => t.status === "blocked").length,
    tasksPending: state.tasks.filter((t) => t.status === "pending").length,
    commits,
    usage: state.usage,
  };

  const md = `# 🌙 NightClaude - Resumen

**Fecha:** ${new Date().toLocaleString("es-AR")}
**Duración:** ${state.summary.duration}
**Rama:** \`${state.branch}\`

## Uso: ${state.usage.fiveHour}% (5h) / ${state.usage.sevenDay}% (7d)

## Tareas
${state.tasks.map((t, i) => `- ${t.status === "completed" ? "✅" : t.status === "blocked" ? "⚠️" : "⏳"} ${t.prompt.substring(0, 60)}`).join("\n")}

## Commits
${commits.map((c) => `- ${c}`).join("\n") || "_Sin commits_"}

## Log
${state.log
  .slice(-20)
  .map((l) => `- [${l.type}] ${l.message.substring(0, 80)}`)
  .join("\n")}
`;

  fs.writeFileSync(path.join(state.project, "NIGHTCLAUDE_SUMMARY.md"), md);
};

const saveState = () => {
  fs.writeFileSync(
    path.join(state.project, ".nightclaude-state.json"),
    JSON.stringify(state, null, 2),
  );
};

// ============================================
// API
// ============================================
app.get("/api/state", (req, res) => res.json(state));

app.get("/api/usage", async (req, res) => res.json(await getUsageFromAPI()));

app.post("/api/config", (req, res) => {
  const { project, tasks, maxIterations, usageLimit } = req.body;

  if (!fs.existsSync(project)) {
    return res.status(400).json({ error: "Proyecto no existe" });
  }

  try {
    execSync("claude --version");
  } catch (e) {
    return res.status(400).json({ error: "Claude Code no instalado" });
  }

  state = {
    ...state,
    project,
    tasks: tasks.map((t) => ({ prompt: t, status: "pending" })),
    maxIterations: maxIterations || 50,
    usageLimit: usageLimit || 90,
    status: "configured",
    branch: null,
    savedTaskIndex: 0,
    log: [],
  };

  res.json({ ok: true });
});

app.post("/api/start", (req, res) => {
  if (state.status === "running")
    return res.status(400).json({ error: "Ya corriendo" });
  res.json({ ok: true });
  runNightLoop();
});

app.post("/api/stop", (req, res) => {
  shouldStop = true;
  if (claudeProcess) claudeProcess.kill();
  state.status = "stopped";
  broadcast({ type: "status", data: state });
  res.json({ ok: true });
});

app.post("/api/continue", (req, res) => {
  if (state.status !== "paused")
    return res.status(400).json({ error: "No pausado" });
  res.json({ ok: true });
  runNightLoop();
});

app.post("/api/feedback", (req, res) => {
  const { feedback } = req.body;
  state.tasks.unshift({ prompt: `CORRECCIÓN: ${feedback}`, status: "pending" });
  state.savedTaskIndex = 0;
  state.status = "configured";
  res.json({ ok: true });
});

app.post("/api/reset", (req, res) => {
  state = {
    status: "idle",
    project: null,
    tasks: [],
    currentTask: 0,
    iteration: 0,
    maxIterations: 50,
    usageLimit: 90,
    branch: null,
    log: [],
    summary: null,
    startTime: null,
    pauseReason: null,
    usage: { fiveHour: 0, sevenDay: 0 },
    savedTaskIndex: 0,
  };
  res.json({ ok: true });
});

// ============================================
// START
// ============================================
const server = app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════╗
  ║  🌙 NightClaude v1.0                   ║
  ║  http://localhost:${PORT}                 ║
  ║                                        ║
  ║  • Detección real de uso via API       ║
  ║  • Pausa al ${state.usageLimit}% del límite            ║
  ║  • Continúa donde quedó                ║
  ╚════════════════════════════════════════╝
  `);
});

wss = new WebSocketServer({ server });
wss.on("connection", (ws) =>
  ws.send(JSON.stringify({ type: "status", data: state })),
);
