/**
 * Tests para el validador
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const { validateConfig } = require("../src/utils/validator");

describe("validateConfig", () => {
  test("deberia rechazar config sin project", () => {
    const result = validateConfig({
      tasks: ["tarea 1"],
    });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.field === "project"));
  });

  test("deberia rechazar config sin tasks", () => {
    const result = validateConfig({
      project: "/tmp/test",
    });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.field === "tasks"));
  });

  test("deberia rechazar tasks vacias", () => {
    const result = validateConfig({
      project: "/tmp",
      tasks: [],
    });
    assert.strictEqual(result.valid, false);
  });

  test("deberia rechazar maxIterations invalido", () => {
    const result = validateConfig({
      project: "/tmp",
      tasks: ["tarea"],
      maxIterations: 5000,
    });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.field === "maxIterations"));
  });

  test("deberia rechazar usageLimit fuera de rango", () => {
    const result = validateConfig({
      project: "/tmp",
      tasks: ["tarea"],
      usageLimit: 5,
    });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.field === "usageLimit"));
  });

  test("deberia aceptar config valida", () => {
    const result = validateConfig({
      project: "/tmp",
      tasks: ["tarea 1", "tarea 2"],
      maxIterations: 50,
      usageLimit: 90,
    });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });
});
