/**
 * Tests para utilidades de retry
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const { withRetry, sleep, withTimeout } = require("../src/utils/retry");

describe("withRetry", () => {
  test("deberia ejecutar funcion exitosa una vez", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return "success";
    });
    assert.strictEqual(result, "success");
    assert.strictEqual(calls, 1);
  });

  test("deberia reintentar en caso de error", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("fail");
        return "success";
      },
      { attempts: 3, delay: 10 }
    );
    assert.strictEqual(result, "success");
    assert.strictEqual(calls, 3);
  });

  test("deberia fallar despues de agotar intentos", async () => {
    let calls = 0;
    await assert.rejects(
      async () => {
        await withRetry(
          async () => {
            calls++;
            throw new Error("always fail");
          },
          { attempts: 2, delay: 10 }
        );
      },
      { message: "always fail" }
    );
    assert.strictEqual(calls, 2);
  });
});

describe("sleep", () => {
  test("deberia esperar el tiempo indicado", async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 45, `Elapsed ${elapsed}ms should be >= 45ms`);
  });
});

describe("withTimeout", () => {
  test("deberia resolver si termina a tiempo", async () => {
    const result = await withTimeout(
      Promise.resolve("done"),
      1000
    );
    assert.strictEqual(result, "done");
  });

  test("deberia rechazar si excede timeout", async () => {
    await assert.rejects(
      async () => {
        await withTimeout(
          new Promise((r) => setTimeout(r, 1000)),
          50,
          "Timeout!"
        );
      },
      { message: "Timeout!" }
    );
  });
});
