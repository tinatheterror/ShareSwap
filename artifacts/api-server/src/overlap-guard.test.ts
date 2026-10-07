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

// ── staleAfterMs: abandon a run that has been going too long, one at a time ────────────────────

type Gate = { promise: Promise<void>; resolve: () => void };

function staleHarness(staleAfterMs?: number) {
  const clock = { t: 1_000 };
  const warns: string[] = [];
  const errors: string[] = [];
  const gates: Gate[] = [];
  let starts = 0;
  const guarded = withOverlapGuard<[], number>(
    "demo",
    async () => {
      const n = ++starts;
      const gate = deferred();
      gates.push(gate);
      await gate.promise;
      return n;
    },
    (line) => warns.push(line),
    { staleAfterMs, now: () => clock.t, logError: (line) => errors.push(line), registry: { isStopping: () => false, trackRun: (_n, p) => p } },
  );
  return { guarded, clock, warns, errors, gates, starts: () => starts };
}

test("staleAfterMs unset: a run is never abandoned, however old", async () => {
  const h = staleHarness();
  const first = h.guarded();
  h.clock.t += 24 * 3_600_000;
  assert.equal(await h.guarded(), undefined);
  assert.equal(h.starts(), 1);
  assert.equal(h.guarded.abandonedCount(), 0);
  assert.deepEqual(h.errors, []);
  h.gates[0].resolve();
  await first;
});

test("before the threshold the tick is skipped; at the threshold the old run is abandoned and a new one starts", async () => {
  const h = staleHarness(60_000);
  const first = h.guarded();
  h.clock.t += 59_999;
  assert.equal(await h.guarded(), undefined, "one ms short: skipped");
  assert.equal(h.starts(), 1);
  assert.equal(h.guarded.skippedCount(), 1);

  h.clock.t += 1; // exactly staleAfterMs
  const second = h.guarded();
  assert.equal(h.starts(), 2, "the new run started beside the old one");
  assert.equal(h.guarded.abandonedCount(), 1);
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0], /previous run still going after 60000ms \(staleAfterMs=60000\); abandoning it and starting a new run/);

  h.gates[0].resolve();
  h.gates[1].resolve();
  assert.equal(await first, 1);
  assert.equal(await second, 2);
});

test("a late-settling abandoned run does not clear the newer run's flag", async () => {
  const h = staleHarness(1_000);
  const first = h.guarded();
  h.clock.t += 1_000;
  const second = h.guarded();
  assert.equal(h.starts(), 2);

  h.gates[0].resolve(); // the abandoned run finishes late
  await first;
  assert.equal(h.guarded.isRunning(), true, "the new run is still the current one");
  assert.equal(await h.guarded(), undefined, "so the next tick is skipped, not started");
  assert.equal(h.starts(), 2);

  h.gates[1].resolve();
  await second;
  assert.equal(h.guarded.isRunning(), false);
  const third = h.guarded();
  assert.equal(h.starts(), 3, "after the new run finishes, ticks run normally again");
  h.gates[2].resolve();
  await third;
});

test("only one abandoned run at a time: a second stale run is skipped while the first is unfinished", async () => {
  const h = staleHarness(1_000);
  const first = h.guarded();
  h.clock.t += 1_000;
  const second = h.guarded(); // abandons the first
  assert.equal(h.starts(), 2);

  h.clock.t += 5_000; // the second run is now stale too, and the first still has not finished
  assert.equal(await h.guarded(), undefined);
  assert.equal(await h.guarded(), undefined);
  assert.equal(h.starts(), 2, "no third run");
  assert.equal(h.guarded.abandonedCount(), 1);
  assert.equal(h.guarded.skippedCount(), 2);
  assert.match(h.errors[h.errors.length - 1], /earlier abandoned run has not finished either; skipping this tick/);

  // Once the abandoned run finally settles, the stale second run can be abandoned in turn.
  h.gates[0].resolve();
  await first;
  const third = h.guarded();
  assert.equal(h.starts(), 3);
  assert.equal(h.guarded.abandonedCount(), 2);

  h.gates[1].resolve();
  h.gates[2].resolve();
  await Promise.all([second, third]);
});

test("an abandoned run that later throws reaches only its own caller and leaves the guard state alone", async () => {
  const clock = { t: 0 };
  let n = 0;
  const gates: Gate[] = [];
  const guarded = withOverlapGuard<[], number>(
    "demo",
    async () => {
      const mine = ++n;
      const gate = deferred();
      gates.push(gate);
      await gate.promise;
      if (mine === 1) throw new Error("late failure");
      return mine;
    },
    () => {},
    { staleAfterMs: 100, now: () => clock.t, logError: () => {}, registry: { isStopping: () => false, trackRun: (_n, p) => p } },
  );
  const first = guarded();
  clock.t = 100;
  const second = guarded();
  gates[0].resolve();
  await assert.rejects(first, /late failure/);
  assert.equal(guarded.isRunning(), true);
  gates[1].resolve();
  assert.equal(await second, 2);
  assert.equal(guarded.isRunning(), false);
});

test("both the abandoned and the new run are tracked, so a shutdown waits for both", async () => {
  const tracked: string[] = [];
  const clock = { t: 0 };
  const gate = deferred();
  const guarded = withOverlapGuard<[], void>("demo", async () => { await gate.promise; }, () => {}, {
    staleAfterMs: 10,
    now: () => clock.t,
    logError: () => {},
    registry: { isStopping: () => false, trackRun: (name, p) => (tracked.push(name), p) },
  });
  const a = guarded();
  clock.t = 10;
  const b = guarded();
  assert.deepEqual(tracked, ["demo", "demo"]);
  gate.resolve();
  await Promise.all([a, b]);
});
