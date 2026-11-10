import assert from "node:assert/strict";
import test from "node:test";
import { createCoalescingRunner } from "./coalesce.ts";

test("a burst of schedules runs only the latest task once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const runs: string[] = [];
  const runner = createCoalescingRunner({ delayMs: 100 });

  for (const label of ["a", "b", "c"]) {
    runner.schedule("k", async () => {
      runs.push(label);
    });
  }
  assert.equal(runner.isPending("k"), true);
  assert.deepEqual(runs, []);

  t.mock.timers.tick(100);
  await runner.flush("k");

  assert.deepEqual(runs, ["c"]);
  assert.equal(runner.isPending("k"), false);
  assert.equal(runner.size(), 0);
});

test("work scheduled during a run triggers exactly one follow-up", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const runs: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runner = createCoalescingRunner({ delayMs: 50 });

  runner.schedule("k", async () => {
    runs.push("first");
    await gate;
  });
  t.mock.timers.tick(50);
  await Promise.resolve();

  runner.schedule("k", async () => {
    runs.push("second");
  });
  runner.schedule("k", async () => {
    runs.push("third");
  });
  assert.deepEqual(runs, ["first"]);

  release();
  await runner.flush("k");

  assert.deepEqual(runs, ["first", "third"]);
  assert.equal(runner.size(), 0);
});

test("separate keys run independently", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const runs: string[] = [];
  const runner = createCoalescingRunner({ delayMs: 10 });

  runner.schedule("a", async () => {
    runs.push("a");
  });
  runner.schedule("b", async () => {
    runs.push("b");
  });
  t.mock.timers.tick(10);
  await runner.flush("a");
  await runner.flush("b");

  assert.deepEqual(runs.sort(), ["a", "b"]);
});

test("a rejected task is reported and does not block later work", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const errors: string[] = [];
  const runs: string[] = [];
  const runner = createCoalescingRunner({
    delayMs: 10,
    onError: (error: unknown, key: string) => errors.push(`${key}:${(error as Error).message}`),
  });

  runner.schedule("k", async () => {
    throw new Error("boom");
  });
  t.mock.timers.tick(10);
  await runner.flush("k");

  runner.schedule("k", async () => {
    runs.push("recovered");
  });
  t.mock.timers.tick(10);
  await runner.flush("k");

  assert.deepEqual(errors, ["k:boom"]);
  assert.deepEqual(runs, ["recovered"]);
});

test("cancel drops queued work but flush still runs a task already queued", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const runs: string[] = [];
  const runner = createCoalescingRunner({ delayMs: 100 });

  runner.schedule("k", async () => {
    runs.push("cancelled");
  });
  runner.cancel("k");
  t.mock.timers.tick(100);
  await runner.flush("k");
  assert.deepEqual(runs, []);

  // Node's assert narrows its argument, so use a fresh array rather than
  // pushing into one already compared against `[]`.
  const kept: string[] = [];
  runner.schedule("k", async () => {
    kept.push("kept");
  });
  await runner.flush("k");
  assert.deepEqual(kept, ["kept"]);
});

test("stop prevents further runs", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const runs: string[] = [];
  const runner = createCoalescingRunner({ delayMs: 10 });

  runner.schedule("k", async () => {
    runs.push("before");
  });
  runner.stop();
  runner.schedule("k", async () => {
    runs.push("after");
  });
  t.mock.timers.tick(10);
  await runner.flush("k");

  assert.deepEqual(runs, []);
  assert.equal(runner.size(), 0);
});
