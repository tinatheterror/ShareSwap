import assert from "node:assert/strict";
import test from "node:test";
import { BackgroundJobRegistry } from "./background-jobs-registry";
import { withOverlapGuard } from "./overlap-guard";

// The registry holds every timer handle and every run in flight, so a shutdown can stop and wait. No database.

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => (resolve = res));
  return { promise, resolve };
}

test("stop() clears timeouts and intervals so they never fire", async () => {
  const registry = new BackgroundJobRegistry();
  let timeouts = 0;
  let intervals = 0;
  registry.setTimeout(() => timeouts++, 30);
  registry.setInterval(() => intervals++, 10);
  const result = await registry.stop({ timeoutMs: 1000 });
  await sleep(80);
  assert.equal(timeouts, 0);
  assert.equal(intervals, 0);
  assert.deepEqual(result, { timedOut: [], waitedFor: 0 });
});

test("a timeout that already fired is forgotten and stop() has nothing to clear for it", async () => {
  const registry = new BackgroundJobRegistry();
  let fired = 0;
  registry.setTimeout(() => fired++, 5);
  await sleep(30);
  assert.equal(fired, 1);
  await registry.stop({ timeoutMs: 1000 });
});

test("nothing can be scheduled once stopping", async () => {
  const registry = new BackgroundJobRegistry();
  await registry.stop({ timeoutMs: 100 });
  assert.equal(registry.isStopping(), true);
  let fired = 0;
  assert.equal(registry.setTimeout(() => fired++, 5), null);
  assert.equal(registry.setInterval(() => fired++, 5), null);
  await sleep(30);
  assert.equal(fired, 0);
});

test("stop() waits for runs already in flight", async () => {
  const registry = new BackgroundJobRegistry();
  const gate = deferred();
  let finished = false;
  registry.trackRun("slow", gate.promise.then(() => void (finished = true)));
  const stopping = registry.stop({ timeoutMs: 2000 });
  await sleep(20);
  assert.equal(finished, false, "stop() is still waiting");
  gate.resolve();
  const result = await stopping;
  assert.equal(finished, true);
  assert.deepEqual(result, { timedOut: [], waitedFor: 1 });
  assert.equal(registry.inFlightCount(), 0);
});

test("stop() gives up at the timeout and names what was still running", async () => {
  const registry = new BackgroundJobRegistry();
  registry.trackRun("never-ends", new Promise<void>(() => {}));
  const done = deferred();
  registry.trackRun("quick", done.promise);
  done.resolve();
  const result = await registry.stop({ timeoutMs: 40 });
  assert.deepEqual(result.timedOut, ["never-ends"]);
  assert.equal(result.waitedFor, 2);
});

test("stop() is idempotent: later calls return the first result", async () => {
  const registry = new BackgroundJobRegistry();
  registry.trackRun("never-ends", new Promise<void>(() => {}));
  const first = registry.stop({ timeoutMs: 30 });
  const second = registry.stop({ timeoutMs: 5000 });
  assert.equal(first, second);
  assert.deepEqual((await second).timedOut, ["never-ends"]);
});

test("a rejected tracked run does not make stop() throw", async () => {
  const registry = new BackgroundJobRegistry();
  const failing = Promise.reject(new Error("boom"));
  registry.trackRun("failing", failing);
  failing.catch(() => {});
  const result = await registry.stop({ timeoutMs: 500 });
  assert.deepEqual(result.timedOut, []);
});

test("a guarded timer: after stop() no new tick starts, the running one finishes, and it is tracked", async () => {
  const registry = new BackgroundJobRegistry();
  const gate = deferred();
  let started = 0;
  const guarded = withOverlapGuard("demo", async () => {
    started++;
    await gate.promise;
  }, () => {}, { registry });

  const first = guarded();
  assert.equal(registry.inFlightCount(), 1);
  const stopping = registry.stop({ timeoutMs: 2000 });
  assert.equal(await guarded(), undefined, "a tick after stop is ignored");
  assert.equal(started, 1);
  assert.equal(guarded.skippedCount(), 0, "and it is not counted as an overlap skip");
  gate.resolve();
  await first;
  assert.deepEqual((await stopping).timedOut, []);
  assert.equal(await guarded(), undefined);
  assert.equal(started, 1, "still no new run after the old one finished");
});
