import assert from "node:assert/strict";
import test from "node:test";
import { withOverlapGuard } from "./overlap-guard";

// A timer tick that finds the previous tick still running is skipped, not run beside it. No database here.

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("a call while the previous one is running is skipped, logged and counted", async () => {
  const gate = deferred();
  const logs: string[] = [];
  let runs = 0;
  const guarded = withOverlapGuard("demo", async () => {
    runs++;
    await gate.promise;
    return "done";
  }, (line) => logs.push(line));

  const first = guarded();
  assert.equal(guarded.isRunning(), true);
  assert.equal(await guarded(), undefined, "the skipped call resolves undefined");
  assert.equal(await guarded(), undefined);
  assert.equal(runs, 1, "the work ran once");
  assert.equal(guarded.skippedCount(), 2);
  assert.deepEqual(logs, [
    "[demo] previous run still in progress; skipping this tick (1 skipped so far)",
    "[demo] previous run still in progress; skipping this tick (2 skipped so far)",
  ]);

  gate.resolve();
  assert.equal(await first, "done");
  assert.equal(guarded.isRunning(), false);
});

test("the next call after the previous one finishes runs normally", async () => {
  let runs = 0;
  const guarded = withOverlapGuard("demo", async () => ++runs, () => {});
  assert.equal(await guarded(), 1);
  assert.equal(await guarded(), 2);
  assert.equal(guarded.skippedCount(), 0);
});

test("a run that throws clears the flag, still throws to its caller, and the next call runs", async () => {
  let runs = 0;
  const guarded = withOverlapGuard("demo", async () => {
    runs++;
    if (runs === 1) throw new Error("boom");
    return "ok";
  }, () => {});
  await assert.rejects(guarded(), /boom/);
  assert.equal(guarded.isRunning(), false);
  assert.equal(await guarded(), "ok");
  assert.equal(runs, 2);
});

test("a synchronous throw also clears the flag", async () => {
  let runs = 0;
  const guarded = withOverlapGuard("demo", () => {
    runs++;
    if (runs === 1) throw new Error("sync boom");
    return "ok";
  }, () => {});
  await assert.rejects(guarded(), /sync boom/);
  assert.equal(guarded.isRunning(), false);
  assert.equal(await guarded(), "ok");
});

test("many simultaneous calls start exactly one run", async () => {
  const gate = deferred();
  let runs = 0;
  const guarded = withOverlapGuard("demo", async () => {
    runs++;
    await gate.promise;
  }, () => {});
  const calls = Array.from({ length: 10 }, () => guarded());
  gate.resolve();
  await Promise.all(calls);
  assert.equal(runs, 1);
  assert.equal(guarded.skippedCount(), 9);
});

test("guards are independent of each other", async () => {
  const gate = deferred();
  const a = withOverlapGuard("a", async () => { await gate.promise; return "a"; }, () => {});
  const b = withOverlapGuard("b", async () => "b", () => {});
  const runningA = a();
  assert.equal(await b(), "b", "b is not blocked by a");
  assert.equal(b.skippedCount(), 0);
  gate.resolve();
  assert.equal(await runningA, "a");
});

test("arguments are passed through", async () => {
  const guarded = withOverlapGuard("demo", async (x: number, y: number) => x + y, () => {});
  assert.equal(await guarded(2, 3), 5);
});
