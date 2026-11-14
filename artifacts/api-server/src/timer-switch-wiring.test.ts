import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { inArray } from "drizzle-orm";
import express from "express";
import { db, itemRequests, items, messages, notifications, pool, shareCoinsTransactions, users } from "@workspace/db";
import { startRateLimitCleanup } from "./auth.js";
import { backgroundJobs } from "./background-jobs-registry.js";
import { timerRunName } from "./job-switches.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";

// The real timers, started by the real registerRoutes / startRateLimitCleanup, must read their own switch
// row on every tick. Rows are set up for four jobs and the timers' own handlers are fired by hand:
//   return-recovery   off      -> its work must not run (no timer:return-recovery record)
//   overdue-reminders dry-run  -> it has no dry-run, so it is skipped (no record)
//   handoff-deadlines dry-run  -> runs, in dry-run: a dry run only reads, so it is safe on any test database
//   rate-limit-cleanup live    -> runs (it only deletes expired rate-limit rows)
// A job that ran leaves a timer:<job> row in scheduled_job_runs; a job that was skipped leaves none.

const ROUTES_TIMER_MS = 30_000;
const CLEANUP_TIMER_MS = 60_000;
const ROWS: Array<[string, string]> = [
  ["return-recovery", "off"],
  ["overdue-reminders", "dry-run"],
  ["handoff-deadlines", "dry-run"],
  ["rate-limit-cleanup", "live"],
];
const names = ROWS.map(([name]) => name);

// A BORROW and a SWAP, both past their handoff-confirm deadline: the timer's handoff sweep (a dry run here)
// must report the BORROW and never the SWAP.
const FIXTURE = `timer-wiring-${Date.now()}`;
const fixtureRequestIds: number[] = [];
const fixtureItemIds: number[] = [];
const fixtureUserIds: number[] = [];
let swapRequestId = 0;
let borrowRequestId = 0;

let savedSwitches: Array<Record<string, unknown>> = [];
let savedTimerRuns: Array<Record<string, unknown>> = [];

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  savedSwitches = (await pool.query("SELECT * FROM job_switches WHERE job_name = ANY($1)", [names])).rows;
  savedTimerRuns = (await pool.query("SELECT * FROM scheduled_job_runs WHERE job_name = ANY($1)", [names.map(timerRunName)])).rows;
  await pool.query("DELETE FROM job_switches WHERE job_name = ANY($1)", [names]);
  await pool.query("DELETE FROM scheduled_job_runs WHERE job_name = ANY($1)", [names.map(timerRunName)]);
  // A live row must say who set it and why (job_switches_live_needs_attribution).
  for (const [name, mode] of ROWS) {
    await pool.query("INSERT INTO job_switches (job_name, mode, updated_by, note) VALUES ($1, $2, $3, $4)", [name, mode, mode === "live" ? "test" : null, mode === "live" ? "test fixture" : null]);
  }

  const [owner, borrower] = await db
    .insert(users)
    .values([
      { username: `${FIXTURE}-owner`, password: "x", emailVerified: true, shareCoins: "0.00" },
      { username: `${FIXTURE}-borrower`, password: "x", emailVerified: true, shareCoins: "50.00" },
    ])
    .returning({ id: users.id });
  fixtureUserIds.push(owner.id, borrower.id);
  const mk = async (requestType: string) => {
    const [item] = await db
      .insert(items)
      .values({
        ownerId: owner.id, name: `${FIXTURE}-${requestType}`, description: "x", conditionRating: 4, photos: [],
        isLendable: true, isRentable: true, isSwappable: true, isGift: true, isAvailable: true,
        replacementValue: 100, securityDeposit: "10.00", lendingDuration: 7, shareCoinsReward: "0", shareCoinPrice: "7.00",
      })
      .returning({ id: items.id });
    fixtureItemIds.push(item.id);
    const [request] = await db
      .insert(itemRequests)
      .values({
        itemId: item.id, requesterId: borrower.id, requestType, status: "AWAITING_HANDOFF_CONFIRM",
        startDate: new Date("2026-10-01T00:00:00.000Z"), endDate: new Date("2026-10-08T00:00:00.000Z"),
        ownerConfirmedHandoff: true, borrowerConfirmedHandoff: false,
        handoffConfirmDeadline: new Date(Date.now() - 3_600_000),
      })
      .returning({ id: itemRequests.id });
    fixtureRequestIds.push(request.id);
    return request.id;
  };
  swapRequestId = await mk("SWAP");
  borrowRequestId = await mk("BORROW");
});

after(async () => {
  await backgroundJobs.stop({ timeoutMs: 5_000 });
  if (fixtureRequestIds.length) {
    await db.delete(messages).where(inArray(messages.requestId, fixtureRequestIds));
    await db.delete(notifications).where(inArray(notifications.requestId, fixtureRequestIds));
    await db.delete(itemRequests).where(inArray(itemRequests.id, fixtureRequestIds));
  }
  if (fixtureUserIds.length) await db.delete(shareCoinsTransactions).where(inArray(shareCoinsTransactions.userId, fixtureUserIds));
  if (fixtureItemIds.length) await db.delete(items).where(inArray(items.id, fixtureItemIds));
  if (fixtureUserIds.length) await db.delete(users).where(inArray(users.id, fixtureUserIds));
  await pool.query("DELETE FROM job_switches WHERE job_name = ANY($1)", [names]);
  await pool.query("DELETE FROM scheduled_job_runs WHERE job_name = ANY($1)", [names.map(timerRunName)]);
  for (const row of savedSwitches) {
    await pool.query("INSERT INTO job_switches (job_name, mode, max_cutoff_age_ms, updated_at, updated_by, note) VALUES ($1,$2,$3,$4,$5,$6)", [row.job_name, row.mode, row.max_cutoff_age_ms, row.updated_at, row.updated_by, row.note]);
  }
  for (const row of savedTimerRuns) {
    await pool.query("INSERT INTO scheduled_job_runs (job_name, last_started_at, last_success_at, last_status, last_error, run_count, skipped_count, last_skipped_at, state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [row.job_name, row.last_started_at, row.last_success_at, row.last_status, row.last_error, row.run_count, row.skipped_count, row.last_skipped_at, row.state]);
  }
  await pool.end();
});

const fakeHandle = () => ({ unref() { return this; }, ref() { return this; }, hasRef: () => false, [Symbol.toPrimitive]: () => 0 });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function timerRows() {
  const { rows } = await pool.query(
    "SELECT job_name, last_status, state FROM scheduled_job_runs WHERE job_name = ANY($1)",
    [names.map(timerRunName)],
  );
  return new Map(rows.map((r) => [r.job_name as string, r]));
}

async function waitFor(job: string, ms = 8_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await timerRows()).has(timerRunName(job))) return;
    await sleep(50);
  }
}

test("the real timers read their switch rows: off and dry-run skip, dry-run and live run, and each is recorded as timer:<job>", async () => {
  const saved = { BACKGROUND_JOBS: process.env.BACKGROUND_JOBS, E2E_TEST_MODE: process.env.E2E_TEST_MODE, EXPIRY_SWEEP_TIMER: process.env.EXPIRY_SWEEP_TIMER };
  process.env.BACKGROUND_JOBS = "on";
  delete process.env.E2E_TEST_MODE;
  delete process.env.EXPIRY_SWEEP_TIMER;
  const original = globalThis.setTimeout;
  const handlers = new Map<number, Array<() => void>>();
  const spy = mock.method(globalThis, "setTimeout", ((handler: any, ms?: number, ...rest: any[]) => {
    if (ms === ROUTES_TIMER_MS || ms === CLEANUP_TIMER_MS) {
      handlers.set(ms, [...(handlers.get(ms) ?? []), handler]);
      return fakeHandle();
    }
    return (original as any)(handler, ms, ...rest);
  }) as any);
  try {
    registerRoutes(express());
    assert.equal(startRateLimitCleanup(process.env), true);
  } finally {
    spy.mock.restore();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.equal(handlers.get(ROUTES_TIMER_MS)?.length, 1);
  assert.equal(handlers.get(CLEANUP_TIMER_MS)?.length, 1);

  const logged: string[] = [];
  const logSpy = mock.method(console, "log", (...args: unknown[]) => void logged.push(args.join(" ")));
  const plainBefore = JSON.stringify((await pool.query("SELECT * FROM scheduled_job_runs WHERE job_name = ANY($1) ORDER BY job_name", [names])).rows);
  handlers.get(ROUTES_TIMER_MS)![0](); // starts overdue-reminders, return-recovery and handoff-deadlines
  handlers.get(CLEANUP_TIMER_MS)![0](); // starts rate-limit-cleanup
  await waitFor("handoff-deadlines");
  await waitFor("rate-limit-cleanup");
  await sleep(500); // time for a job that was wrongly let through to leave its record
  logSpy.mock.restore();

  const rows = await timerRows();
  assert.equal(rows.get(timerRunName("handoff-deadlines"))?.last_status, "ok");
  assert.equal(rows.get(timerRunName("handoff-deadlines"))?.state.mode, "dry-run", "the sweep ran as a dry run");
  assert.equal(rows.get(timerRunName("rate-limit-cleanup"))?.last_status, "ok");
  assert.equal(rows.get(timerRunName("rate-limit-cleanup"))?.state.mode, "live");
  assert.equal(rows.has(timerRunName("return-recovery")), false, "off: return recovery's work did not run");
  assert.equal(rows.has(timerRunName("overdue-reminders")), false, "dry-run: overdue reminders has no dry-run, so it was skipped");
  // The timer's handoff sweep passes BORROW/RENT only: the BORROW is reported, the SWAP never is.
  assert.ok(logged.some((l) => l.includes(`DRY-RUN would change request ${borrowRequestId} `)), "the BORROW past its deadline is reported");
  assert.ok(!logged.some((l) => l.includes(`request ${swapRequestId} `)), "the SWAP past its deadline is not");
  // The script's own rows (plain names) are untouched by the timers.
  const plainAfter = JSON.stringify((await pool.query("SELECT * FROM scheduled_job_runs WHERE job_name = ANY($1) ORDER BY job_name", [names])).rows);
  assert.equal(plainAfter, plainBefore);
});

// ── HANDOFF_DEADLINE_SWEEP_MODE=off with no switch row ──────────────────────────────────────────
// The handoff timer is always scheduled (a row can turn it on), so "off" means every tick reads the switch,
// finds no row, resolves off from the environment and returns. Nothing may run and nothing may be written.
// A control with the environment at dry-run (same fixture, still no row) proves the observation can see work.

/** Starts the real routes timers under `mode`, fires the 30s timer's handler by hand, and returns what it logged. */
async function fireRoutesTimers(handoffMode: string, settle: (logged: string[]) => Promise<void>): Promise<string[]> {
  const saved = {
    BACKGROUND_JOBS: process.env.BACKGROUND_JOBS,
    E2E_TEST_MODE: process.env.E2E_TEST_MODE,
    EXPIRY_SWEEP_TIMER: process.env.EXPIRY_SWEEP_TIMER,
    HANDOFF_DEADLINE_SWEEP_MODE: process.env.HANDOFF_DEADLINE_SWEEP_MODE,
  };
  process.env.BACKGROUND_JOBS = "on";
  delete process.env.E2E_TEST_MODE;
  delete process.env.EXPIRY_SWEEP_TIMER;
  process.env.HANDOFF_DEADLINE_SWEEP_MODE = handoffMode; // read when the 30s handler runs, so it stays set until then
  const original = globalThis.setTimeout;
  const handlers: Array<() => void> = [];
  const spy = mock.method(globalThis, "setTimeout", ((handler: any, ms?: number, ...rest: any[]) => {
    if (ms === ROUTES_TIMER_MS) {
      handlers.push(handler);
      return fakeHandle();
    }
    return (original as any)(handler, ms, ...rest);
  }) as any);
  const logged: string[] = [];
  const logSpy = mock.method(console, "log", (...args: unknown[]) => void logged.push(args.join(" ")));
  try {
    registerRoutes(express());
    spy.mock.restore();
    assert.equal(handlers.length, 1);
    handlers[0](); // starts overdue-reminders and return-recovery (rows keep them from running) and handoff-deadlines
    await settle(logged);
  } finally {
    logSpy.mock.restore();
    spy.mock.restore();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return logged;
}

/** A fresh BORROW past its handoff-confirm deadline. The sweep reports each candidate once per process, so each phase needs its own. */
async function overdueBorrow(label: string): Promise<number> {
  const [item] = await db
    .insert(items)
    .values({
      ownerId: fixtureUserIds[0], name: `${FIXTURE}-${label}`, description: "x", conditionRating: 4, photos: [],
      isLendable: true, isRentable: true, isSwappable: true, isGift: true, isAvailable: true,
      replacementValue: 100, securityDeposit: "10.00", lendingDuration: 7, shareCoinsReward: "0", shareCoinPrice: "7.00",
    })
    .returning({ id: items.id });
  fixtureItemIds.push(item.id);
  const [request] = await db
    .insert(itemRequests)
    .values({
      itemId: item.id, requesterId: fixtureUserIds[1], requestType: "BORROW", status: "AWAITING_HANDOFF_CONFIRM",
      startDate: new Date("2026-10-01T00:00:00.000Z"), endDate: new Date("2026-10-08T00:00:00.000Z"),
      ownerConfirmedHandoff: true, borrowerConfirmedHandoff: false,
      handoffConfirmDeadline: new Date(Date.now() - 3_600_000),
    })
    .returning({ id: itemRequests.id });
  fixtureRequestIds.push(request.id);
  return request.id;
}

test("HANDOFF_DEADLINE_SWEEP_MODE=off with no job_switches row: a handoff tick runs no work and writes nothing", async () => {
  await pool.query("DELETE FROM job_switches WHERE job_name = 'handoff-deadlines'");
  await pool.query("DELETE FROM scheduled_job_runs WHERE job_name = $1", [timerRunName("handoff-deadlines")]);

  // Control: environment dry-run, no row. An overdue BORROW is reported, so a tick that works is visible in the log.
  const controlRequestId = await overdueBorrow("control");
  const controlLog = await fireRoutesTimers("dry-run", async (logged) => {
    const until = Date.now() + 8_000;
    while (Date.now() < until && !logged.some((l) => l.includes(`DRY-RUN would change request ${controlRequestId} `))) await sleep(50);
  });
  assert.ok(
    controlLog.some((l) => l.includes(`DRY-RUN would change request ${controlRequestId} `)),
    "control: with the environment at dry-run the overdue BORROW is reported",
  );
  await pool.query("DELETE FROM scheduled_job_runs WHERE job_name = $1", [timerRunName("handoff-deadlines")]);

  // A request no tick has seen yet: a tick wrongly let through in the off phase would report it (dry run) or change it (live).
  const offRequestId = await overdueBorrow("off");

  const snapshot = async () => ({
    runs: (await pool.query("SELECT * FROM scheduled_job_runs WHERE job_name = ANY($1) ORDER BY job_name", [[...names, ...names.map(timerRunName)]])).rows,
    switches: (await pool.query("SELECT * FROM job_switches ORDER BY job_name")).rows,
    requests: (await pool.query("SELECT * FROM item_requests WHERE id = ANY($1) ORDER BY id", [fixtureRequestIds])).rows,
    notifications: (await pool.query("SELECT count(*)::int AS n FROM notifications WHERE request_id = ANY($1)", [fixtureRequestIds])).rows,
    messages: (await pool.query("SELECT count(*)::int AS n FROM messages WHERE request_id = ANY($1)", [fixtureRequestIds])).rows,
    coins: (await pool.query("SELECT count(*)::int AS n FROM share_coins_transactions WHERE user_id = ANY($1)", [fixtureUserIds])).rows,
  });
  const before = await snapshot();
  assert.equal(before.switches.some((r) => r.job_name === "handoff-deadlines"), false, "precondition: no handoff row");

  const offLog = await fireRoutesTimers("off", async () => void (await sleep(1_000))); // time for a tick that was wrongly let through

  assert.deepEqual(offLog.filter((l) => l.includes("[handoff-deadlines]")), [], "off: nothing is logged, not even the sweep mode");
  assert.ok(!offLog.some((l) => l.includes(`request ${offRequestId} `)), "off: the fresh overdue BORROW is not reported");
  assert.equal((await timerRows()).has(timerRunName("handoff-deadlines")), false, "off: no timer:handoff-deadlines record");
  assert.deepEqual(await snapshot(), before, "off: scheduled_job_runs, job_switches, the requests and their side effects are unchanged");
});
