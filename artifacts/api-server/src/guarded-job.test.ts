import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { pool } from "@workspace/db";
import { guardedJob } from "./guarded-job";
import {
  createTimerRunRecorder,
  timerRunName,
  type SwitchDecision,
  type SwitchQuery,
  type TimerRunRecord,
} from "./job-switches";
import { createPgJobStore, isDue, OVERDUE_REMINDER_EVERY_MS, type PgPoolLike } from "./scripts/run-scheduled-jobs";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations";
import type { JobMode } from "./scheduled-job-options";

// The in-process timers (return-recovery, overdue-reminders, handoff-deadlines, rate-limit-cleanup,
// request-expiry) all run through guardedJob. Most tests need no database: the switch reader, the
// recorder and the work are stubs.

interface TestJob {
  name: string;
  envMode: JobMode;
  supportsDryRun: boolean;
}

const JOBS: readonly TestJob[] = [
  { name: "return-recovery", envMode: "live", supportsDryRun: false },
  { name: "overdue-reminders", envMode: "live", supportsDryRun: false },
  { name: "handoff-deadlines", envMode: "dry-run", supportsDryRun: true },
  { name: "rate-limit-cleanup", envMode: "live", supportsDryRun: false },
  { name: "request-expiry", envMode: "dry-run", supportsDryRun: true },
];

const decide = (mode: JobMode): SwitchDecision => ({ ok: true, mode, maxCutoffAgeMs: null, source: "table" });

function harness(
  job: TestJob,
  resolve: (envMode: JobMode) => Promise<SwitchDecision>,
  work?: (mode: "live" | "dry-run") => Promise<string | void>,
) {
  const calls: string[] = [];
  const records: Array<[string, TimerRunRecord]> = [];
  const logs: string[] = [];
  const errors: string[] = [];
  let clock = 1_000_000;
  const tick = guardedJob({
    ...job,
    resolveSwitch: resolve,
    recordRun: async (name, record) => void records.push([name, record]),
    run: async (mode) => {
      calls.push(mode);
      return work ? work(mode) : `ran ${mode}`;
    },
    log: (l) => void logs.push(l),
    logError: (l) => void errors.push(l),
    nowMs: () => clock,
  });
  return { tick, calls, records, logs, errors, advance: (ms: number) => void (clock += ms) };
}

// ── Disabled, unreadable, dry-run ───────────────────────────────────────────────

for (const job of JOBS) {
  test(`${job.name}: a disabled job does not call its work, and is not recorded`, async () => {
    const h = harness(job, async () => decide("off"));
    await h.tick();
    await h.tick();
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.records, []);
    assert.deepEqual(h.errors, []);
  });

  test(`${job.name}: a failed switch read skips the tick and never enables anything`, async () => {
    // Whatever the environment says (live included), an unreadable switch runs nothing.
    let reads = 0;
    const h = harness({ ...job, envMode: "live" }, async () => (reads++, { ok: false, error: 'relation "job_switches" does not exist' }));
    await h.tick();
    assert.equal(reads, 1);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.records, []);
    assert.equal(h.errors.length, 1);
    assert.match(h.errors[0], new RegExp(`\\[${job.name}\\] tick skipped: could not read the ${job.name} switch`));
  });

  test(`${job.name}: a switch reader that throws skips the tick too`, async () => {
    const h = harness(job, async () => {
      throw new Error("connection reset");
    });
    await h.tick();
    assert.deepEqual(h.calls, []);
    assert.equal(h.errors.length, 1);
  });
}

test("an unreadable switch is logged at most once a minute, and the job resumes when it is readable", async () => {
  let readable = false;
  const h = harness(JOBS[0], async (envMode) => (readable ? { ok: true, mode: envMode, maxCutoffAgeMs: null, source: "env" } : { ok: false, error: "down" }));
  await h.tick();
  h.advance(10_000);
  await h.tick();
  assert.equal(h.errors.length, 1);
  h.advance(60_000);
  await h.tick();
  assert.equal(h.errors.length, 2);
  readable = true;
  await h.tick();
  assert.deepEqual(h.calls, ["live"]);
});

test("dry-run: jobs with no dry-run skip and say so once; the two sweeps run in dry-run", async () => {
  for (const job of JOBS.filter((j) => !j.supportsDryRun)) {
    const h = harness(job, async () => decide("dry-run"));
    await h.tick();
    await h.tick();
    await h.tick();
    assert.deepEqual(h.calls, [], `${job.name} has no dry-run`);
    assert.deepEqual(h.records, []);
    assert.equal(h.logs.filter((l) => l.includes("has no dry-run")).length, 1, "logged once");
  }
  for (const job of JOBS.filter((j) => j.supportsDryRun)) {
    const h = harness(job, async () => decide("dry-run"));
    await h.tick();
    assert.deepEqual(h.calls, ["dry-run"]);
  }
});

test("the dry-run skip is logged again after the mode changed and came back", async () => {
  let mode: JobMode = "dry-run";
  const h = harness(JOBS[3], async () => decide(mode));
  await h.tick();
  mode = "off";
  await h.tick();
  mode = "dry-run";
  await h.tick();
  assert.equal(h.logs.filter((l) => l.includes("has no dry-run")).length, 2);
});

// ── Running and recording ───────────────────────────────────────────────────────

test("a row wins over the environment mode, and no row falls back to it", async () => {
  const live = harness(JOBS[2], async () => decide("live"));
  await live.tick();
  assert.deepEqual(live.calls, ["live"], "row live beats env dry-run");
  const fallback = harness(JOBS[2], async (envMode) => ({ ok: true, mode: envMode, maxCutoffAgeMs: null, source: "env" }));
  await fallback.tick();
  assert.deepEqual(fallback.calls, ["dry-run"]);
});

test("a run is recorded under the plain name (the recorder adds timer:)", async () => {
  const h = harness(JOBS[1], async () => decide("live"), async () => "remindersCreated=3");
  await h.tick();
  assert.deepEqual(h.records, [["overdue-reminders", { ok: true, mode: "live", summary: "remindersCreated=3" }]]);
});

test("a run that throws is logged and recorded as failed, and the tick does not throw", async () => {
  const h = harness(JOBS[0], async () => decide("live"), async () => {
    throw new Error("stripe down");
  });
  await assert.doesNotReject(() => h.tick());
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0], /\[return-recovery\] run failed/);
  assert.deepEqual(h.records, [["return-recovery", { ok: false, mode: "live", error: "stripe down" }]]);
  // The next tick runs again.
  await h.tick();
  assert.equal(h.calls.length, 2);
});

test("a failing recorder never fails the job", async () => {
  const calls: string[] = [];
  const tick = guardedJob({
    ...JOBS[0],
    resolveSwitch: async () => decide("live"),
    recordRun: async () => {
      throw new Error("scheduled_job_runs missing");
    },
    run: async () => void calls.push("ran"),
    logError: () => {},
  });
  await assert.doesNotReject(() => tick());
  assert.deepEqual(calls, ["ran"]);
});

test("it runs inside the overlap guard: a tick during a slow run (or a slow switch read) is skipped", async () => {
  let release!: () => void;
  const slow = new Promise<void>((resolve) => (release = resolve));
  const h = harness(JOBS[0], async () => (await slow, decide("live")));
  const first = h.tick();
  await h.tick(); // skipped: the first is still reading its switch
  release();
  await first;
  assert.deepEqual(h.calls, ["live"]);
  assert.ok(h.logs.some((l) => l.includes("previous run still in progress")));
  assert.equal(h.tick.skippedCount(), 1);
});

// ── The recorder: timer:<job>, throttled ────────────────────────────────────────

test("every timer records as timer:<job>, never as the plain name", async () => {
  const written: string[] = [];
  const record = createTimerRunRecorder({ query: async (_t, params) => (written.push(String(params[0])), { rows: [] }), everyMs: 0 });
  for (const job of JOBS) await record(job.name, { ok: true, mode: "live" });
  assert.deepEqual(written, JOBS.map((j) => `timer:${j.name}`));
  assert.equal(timerRunName("x"), "timer:x");
  for (const w of written) assert.ok(!JOBS.some((j) => j.name === w));
});

test("recording is throttled per job, the runs in between are counted, and ok/failed changes are always written", async () => {
  const writes: unknown[][] = [];
  let clock = 5_000_000;
  const record = createTimerRunRecorder({ query: async (_t, params) => (writes.push(params), { rows: [] }), now: () => new Date(clock), everyMs: 60_000 });
  await record("return-recovery", { ok: true, mode: "live" });
  await record("overdue-reminders", { ok: true, mode: "live" });
  assert.equal(writes.length, 2, "each job has its own throttle");
  clock += 10_000;
  await record("return-recovery", { ok: true, mode: "live" });
  clock += 10_000;
  await record("return-recovery", { ok: true, mode: "live" });
  assert.equal(writes.length, 2, "throttled");
  clock += 1_000;
  await record("return-recovery", { ok: false, mode: "live", error: "boom" });
  assert.equal(writes.length, 3, "a change to failed is written at once");
  assert.equal(writes[2][2], "failed");
  assert.equal(writes[2][3], "boom");
  assert.equal(writes[2][4], 3, "the throttled runs are counted");
  clock += 61_000;
  await record("return-recovery", { ok: false, mode: "live", error: "boom" });
  assert.equal(writes.length, 4);
});

test("a failing write is ignored", async () => {
  const record = createTimerRunRecorder({ query: (async () => { throw new Error("no table"); }) as SwitchQuery, everyMs: 0 });
  await assert.doesNotReject(() => record("return-recovery", { ok: true, mode: "live" }));
});

// ── Against the real database: a timer's last run never makes the script skip ───

const poolAsPg = pool as unknown as PgPoolLike;
const testJob = `timer-test-${process.pid}-${Date.now()}`;

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
});

after(async () => {
  await pool.query("DELETE FROM scheduled_job_runs WHERE job_name = ANY($1)", [[testJob, timerRunName(testJob)]]);
  await pool.end();
});

test("the timer's last run does not make the script skip the step", async () => {
  const record = createTimerRunRecorder({ everyMs: 0 });
  await record(testJob, { ok: true, mode: "live", summary: "remindersCreated=1" });

  const timerRow = await pool.query("SELECT last_status, last_success_at, run_count FROM scheduled_job_runs WHERE job_name = $1", [timerRunName(testJob)]);
  assert.equal(timerRow.rows[0].last_status, "ok");
  assert.ok(timerRow.rows[0].last_success_at, "the timer's run is recorded");

  // The script's gate reads the plain name: untouched, so the step is still due, however recent the timer's run.
  const store = createPgJobStore(poolAsPg);
  assert.equal(await store.load(testJob), null);
  assert.equal(isDue(null, OVERDUE_REMINDER_EVERY_MS, new Date()), true);
  const plain = await pool.query("SELECT 1 FROM scheduled_job_runs WHERE job_name = $1", [testJob]);
  assert.equal(plain.rowCount, 0);
});

test("recording upserts timer:<job>: run_count adds up, and a failure keeps the last success", async () => {
  const record = createTimerRunRecorder({ everyMs: 0 });
  await record(testJob, { ok: true, mode: "live" });
  const before = (await pool.query("SELECT last_success_at, run_count FROM scheduled_job_runs WHERE job_name = $1", [timerRunName(testJob)])).rows[0];
  await new Promise((r) => setTimeout(r, 15));
  await record(testJob, { ok: false, mode: "live", error: "stripe down" });
  const after = (await pool.query("SELECT last_status, last_error, last_success_at, run_count, state FROM scheduled_job_runs WHERE job_name = $1", [timerRunName(testJob)])).rows[0];
  assert.equal(after.last_status, "failed");
  assert.equal(after.last_error, "stripe down");
  assert.equal(new Date(after.last_success_at).getTime(), new Date(before.last_success_at).getTime(), "a failure does not touch last_success_at");
  assert.equal(Number(after.run_count), Number(before.run_count) + 1);
  assert.equal(after.state.mode, "live");
});
