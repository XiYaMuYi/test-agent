import test from "node:test";
import assert from "node:assert/strict";

test("worker exposes a named bootstrap descriptor", async () => {
  const module = await import("../dist/main.js");

  assert.deepEqual(module.workerSkeleton, {
    application: "worker",
    runtime: "node",
    stage: "bootstrap",
  });
});
