/**
 * Tests para manejo de estado
 */

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert");
const {
  getState,
  setState,
  resetState,
  createInitialState,
  updateTaskStatus,
  generateSummary,
} = require("../src/core/state");

describe("State Management", () => {
  beforeEach(() => {
    resetState();
  });

  test("deberia retornar estado inicial", () => {
    const state = getState();
    assert.strictEqual(state.status, "idle");
    assert.strictEqual(state.project, null);
    assert.deepStrictEqual(state.tasks, []);
  });

  test("deberia actualizar estado", () => {
    setState({ project: "/test/path", status: "configured" });
    const state = getState();
    assert.strictEqual(state.project, "/test/path");
    assert.strictEqual(state.status, "configured");
  });

  test("deberia mantener propiedades existentes al actualizar", () => {
    setState({ project: "/test" });
    setState({ status: "running" });
    const state = getState();
    assert.strictEqual(state.project, "/test");
    assert.strictEqual(state.status, "running");
  });

  test("deberia resetear al estado inicial", () => {
    setState({ project: "/test", status: "running" });
    resetState();
    const state = getState();
    assert.strictEqual(state.status, "idle");
    assert.strictEqual(state.project, null);
  });

  test("deberia actualizar estado de tarea", () => {
    setState({
      tasks: [
        { prompt: "tarea 1", status: "pending" },
        { prompt: "tarea 2", status: "pending" },
      ],
    });
    updateTaskStatus(0, "completed");
    const state = getState();
    assert.strictEqual(state.tasks[0].status, "completed");
    assert.strictEqual(state.tasks[1].status, "pending");
  });

  test("deberia generar resumen correctamente", () => {
    setState({
      startTime: new Date(Date.now() - 3600000).toISOString(), // 1 hora atras
      branch: "claude/nightly-test",
      tasks: [
        { prompt: "t1", status: "completed" },
        { prompt: "t2", status: "blocked" },
        { prompt: "t3", status: "pending" },
      ],
      usage: { fiveHour: 50, sevenDay: 20 },
    });

    const summary = generateSummary(["abc123 commit 1"]);

    assert.strictEqual(summary.branch, "claude/nightly-test");
    assert.strictEqual(summary.tasksCompleted, 1);
    assert.strictEqual(summary.tasksBlocked, 1);
    assert.strictEqual(summary.tasksPending, 1);
    assert.strictEqual(summary.totalTasks, 3);
    assert.deepStrictEqual(summary.commits, ["abc123 commit 1"]);
  });
});
