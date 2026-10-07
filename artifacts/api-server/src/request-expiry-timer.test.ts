import assert from "node:assert/strict";
import test from "node:test";
import type { RequestExpirySweepOptions, RequestExpirySweepResult } from "./request-expiry-service";
import {
  EXPIRY_SWEEP_TIMER_INTERVAL_MS,
  isExpirySweepTimerEnabled,
  startRequestExpirySweepTimer,
} from "./request-expiry-timer";
import { EXPIRY_SWEEP_MAX_CUTOFF_AGE_MS } from "./scheduled-job-options";

// The in-process request-expiry timer is an opt-in: EXPIRY_SWEEP_TIMER=on. Off by default. When on,
// expiry is always a dry run and reminders follow SCHEDULED_JOBS_EXPIRY_REMINDERS. No database here:
// the sweep itself is a stub, and the sweep's own tests cover what it does to rows.

const NOW = new Date("2026-10-04T20:00:00.000Z");
const CUTOFF = new Date("2026-10-05T06:59:59.000Z");

const emptyResult = (overrides: Partial<RequestExpirySweepResult> = {}): RequestExpirySweepResult => ({
  expiredCount: 0,
  remindedCount: 0,
  failedCount: 0,
  dryRun: true,
  candidates: [],
  ...overrides,
});

/** Lets the unawaited startup sweep finish; a tick fired while it runs is skipped by the overlap guard. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(env: NodeJS.ProcessEnv, results: Array<RequestExpirySweepResult | Error> = []) {
  const sweepCalls: RequestExpirySweepOptions[] = [];
  const scheduled: Array<{ run: () => void; everyMs: number }> = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const queue = [...results];
  const timer = startRequestExpirySweepTimer({
    env,
    now: () => NOW,
    sweep: async (options) => {
      sweepCalls.push(options);
      const next = queue.shift() ?? emptyResult();
      if (next instanceof Error) throw next;
      return next;
    },
    schedule: (run, everyMs) => void scheduled.push({ run, everyMs }),
    log: (line) => void logs.push(line),
    logError: (line) => void errors.push(line),
  });
  return { timer, sweepCalls, scheduled, logs, errors };
}

test("the timer is off unless EXPIRY_SWEEP_TIMER is exactly 'on'", () => {
  for (const raw of [undefined, "", "off", "false", "0", "1", "true", "yes", "onn", "dry-run"]) {
    assert.equal(isExpirySweepTimerEnabled(raw), false, `${JSON.stringify(raw)} must stay off`);
  }
  for (const raw of ["on", "ON", " On "]) {
    assert.equal(isExpirySweepTimerEnabled(raw), true, `${JSON.stringify(raw)} turns it on`);
  }
});

test("switched off, nothing runs, nothing is scheduled and nothing is logged", () => {
  for (const env of [{}, { EXPIRY_SWEEP_TIMER: "" }, { EXPIRY_SWEEP_TIMER: "off" }, { EXPIRY_SWEEP_TIMER: "true" }]) {
    const h = harness(env);
    assert.equal(h.timer, null);
    assert.equal(h.sweepCalls.length, 0);
    assert.equal(h.scheduled.length, 0);
    assert.deepEqual(h.logs, []);
  }
});

test("a missing or off timer switch is not overridden by the scheduled-jobs switches", () => {
  const h = harness({ SCHEDULED_JOBS_EXPIRY_MODE: "live", SCHEDULED_JOBS_EXPIRY_REMINDERS: "on" });
  assert.equal(h.timer, null);
  assert.equal(h.sweepCalls.length, 0);
  assert.equal(h.scheduled.length, 0);
});

test("switched on, it sweeps once right away and then every minute", async () => {
  const h = harness({ EXPIRY_SWEEP_TIMER: "on" });
  assert.ok(h.timer);
  assert.equal(h.sweepCalls.length, 1, "first sweep runs at startup");
  await settle();
  assert.equal(h.scheduled.length, 1);
  assert.equal(h.scheduled[0].everyMs, EXPIRY_SWEEP_TIMER_INTERVAL_MS);
  assert.equal(EXPIRY_SWEEP_TIMER_INTERVAL_MS, 60_000);

  h.scheduled[0].run();
  assert.equal(h.sweepCalls.length, 2, "each tick runs one more sweep");
  assert.deepEqual(h.logs, ["[request-expiry] in-process sweep ON: expiry dry-run, reminders on"]);
});

test("expiry is always a dry run and reminders are not, whatever the other switches say", () => {
  const h = harness({ EXPIRY_SWEEP_TIMER: "on", SCHEDULED_JOBS_EXPIRY_MODE: "live" });
  const options = h.sweepCalls[0];
  assert.equal(options.expireDryRun, true, "the timer never expires anything, even if the job is live");
  assert.notEqual(options.dryRun, true, "dryRun would suppress reminders too");
  assert.equal(options.reminders, true);
  assert.equal(options.now?.getTime(), NOW.getTime());
  assert.equal(options.maxCutoffAgeMs, EXPIRY_SWEEP_MAX_CUTOFF_AGE_MS);
});

test("reminders follow SCHEDULED_JOBS_EXPIRY_REMINDERS", () => {
  const on = harness({ EXPIRY_SWEEP_TIMER: "on", SCHEDULED_JOBS_EXPIRY_REMINDERS: "on" });
  assert.equal(on.sweepCalls[0].reminders, true);
  const off = harness({ EXPIRY_SWEEP_TIMER: "on", SCHEDULED_JOBS_EXPIRY_REMINDERS: "off" });
  assert.equal(off.sweepCalls[0].reminders, false);
  assert.equal(off.sweepCalls[0].expireDryRun, true);
  assert.deepEqual(off.logs, ["[request-expiry] in-process sweep ON: expiry dry-run, reminders off"]);
});

test("each would-expire request is logged once while it stays a candidate, and again if it comes back", async () => {
  const candidate = (requestId: number) => ({ requestId, action: "expire" as const, itemName: "Tent", cutoff: CUTOFF });
  const h = harness({ EXPIRY_SWEEP_TIMER: "on" }, [
    emptyResult({ candidates: [candidate(1), candidate(2)] }), // startup sweep
    emptyResult({ candidates: [candidate(1), candidate(2)] }), // unchanged: silent
    emptyResult({ candidates: [candidate(2)] }), // 1 left the list
    emptyResult({ candidates: [candidate(1), candidate(2)] }), // 1 is back: logged again
  ]);
  await settle();
  await h.timer!.tick();
  await h.timer!.tick();
  await h.timer!.tick();

  const wouldExpire = h.logs.filter((l) => l.includes("would expire"));
  assert.deepEqual(wouldExpire, [
    `[request-expiry] DRY-RUN would expire request 1 — cutoff ${CUTOFF.toISOString()}`,
    `[request-expiry] DRY-RUN would expire request 2 — cutoff ${CUTOFF.toISOString()}`,
    `[request-expiry] DRY-RUN would expire request 1 — cutoff ${CUTOFF.toISOString()}`,
  ]);
});

test("reminder candidates are not logged as would-expire, and sent reminders are counted", async () => {
  const h = harness({ EXPIRY_SWEEP_TIMER: "on" }, [
    emptyResult({
      remindedCount: 1,
      candidates: [{ requestId: 7, action: "remind", itemName: "Tent", cutoff: CUTOFF }],
    }),
  ]);
  await settle(); // the startup sweep carries this result
  assert.equal(h.logs.some((l) => l.includes("would expire")), false);
  assert.ok(h.logs.includes("[request-expiry] sweep reminded=1 failed=0"));
});

test("a failing sweep is logged and the next tick still runs", async () => {
  const h = harness({ EXPIRY_SWEEP_TIMER: "on" }, [new Error("db down"), emptyResult()]);
  await settle();
  await h.timer!.tick();
  assert.equal(h.sweepCalls.length, 2);
  assert.equal(h.errors.length, 1);
  assert.equal(h.errors[0], "[request-expiry] sweep failed:");
});

// ── Overlap guard: a slow sweep makes the next tick skip instead of running beside it ──────────

function slowSweepHarness() {
  const releases: Array<(result: RequestExpirySweepResult | Error) => void> = [];
  const scheduled: Array<() => void> = [];
  const logs: string[] = [];
  const errors: string[] = [];
  let sweepCalls = 0;
  const timer = startRequestExpirySweepTimer({
    env: { EXPIRY_SWEEP_TIMER: "on" },
    now: () => NOW,
    sweep: () => {
      sweepCalls++;
      return new Promise<RequestExpirySweepResult>((resolve, reject) => {
        releases.push((r) => (r instanceof Error ? reject(r) : resolve(r)));
      });
    },
    schedule: (run) => void scheduled.push(run),
    log: (line) => void logs.push(line),
    logError: (line) => void errors.push(line),
  });
  return { timer, releases, scheduled, logs, errors, calls: () => sweepCalls };
}

test("a tick that fires while the previous sweep is still running is skipped and logged", async () => {
  const h = slowSweepHarness();
  assert.equal(h.calls(), 1, "the startup sweep is running");

  h.scheduled[0](); // interval tick 1
  h.scheduled[0](); // interval tick 2
  await h.timer!.tick(); // a direct tick too
  assert.equal(h.calls(), 1, "no second sweep started beside the first");
  const skips = h.logs.filter((l) => l.includes("skipping this tick"));
  assert.equal(skips.length, 3);
  assert.equal(skips[0], "[request-expiry] previous run still in progress; skipping this tick (1 skipped so far)");

  h.releases[0](emptyResult());
  await new Promise((resolve) => setImmediate(resolve));
  h.scheduled[0]();
  assert.equal(h.calls(), 2, "once the first sweep finished, the next tick runs");
  h.releases[1](emptyResult());
});

test("a sweep that fails frees the guard so the next tick runs", async () => {
  const h = slowSweepHarness();
  h.releases[0](new Error("db down"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.errors.length, 1);
  h.scheduled[0]();
  assert.equal(h.calls(), 2);
  h.releases[1](emptyResult());
});

test("skipped ticks do not repeat would-expire logging or lose the already-reported set", async () => {
  const candidate = { requestId: 1, action: "expire" as const, itemName: "Tent", cutoff: CUTOFF };
  const h = slowSweepHarness();
  h.scheduled[0](); // skipped
  h.releases[0](emptyResult({ candidates: [candidate] }));
  await new Promise((resolve) => setImmediate(resolve));
  h.scheduled[0](); // second real sweep, same candidate
  h.releases[1](emptyResult({ candidates: [candidate] }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.logs.filter((l) => l.includes("would expire")).length, 1);
});
