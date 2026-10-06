import assert from "node:assert/strict";
import test from "node:test";
import { compactNotificationCopy, notificationCopyLimits } from "../notification-copy";
import { HANDOFF_REMINDER_NOTIFICATION_TYPE, handoffReminder } from "../request-expiry-copy";
import {
  DUE_TOLERANCE_MS,
  EXPIRY_SWEEP_MAX_CUTOFF_AGE_MS,
  LOCK_NAME,
  buildExpirySweepOptions,
  buildSteps,
  createMemoryJobStore,
  databaseHost,
  findMissingSecrets,
  isDue,
  liveWarning,
  newDryRunLines,
  parseInvocation,
  resolveJobMode,
  resolveRemindersEnabled,
  runScheduledJobs,
  type JobStep,
  type JobStore,
} from "./run-scheduled-jobs";
import type { ScheduledJobRunners } from "../routes/routes";

// ── The reminder users get ──────────────────────────────────────────────────────
// Sent to BOTH people on a BORROW/RENT request, once, 4 hours before the late-handoff
// cutoff, only while the request is still ACCEPTED or DEPOSIT_CONFIRMED (nobody has
// confirmed a handoff). Same text is the in-app notification and the push body.
// The item name is in the title (cut at a word boundary, never with an ellipsis); the body
// is fixed wording plus the deadline in the platform time zone. Both the notification list
// and push run through compactNotificationCopy (54-character body), so the stored text must
// already fit it, or the deadline is what gets cut.

test("handoff reminder text", () => {
  assert.equal(HANDOFF_REMINDER_NOTIFICATION_TYPE, "handoff_deadline_reminder");

  assert.deepEqual(handoffReminder("Tent", new Date("2026-10-07T18:30:00Z")), {
    title: "Hand off soon: Tent",
    message: "Handed off? Confirm by Oct 7, 11:30 AM or it expires.",
  });

  assert.deepEqual(handoffReminder("Makita 18V Cordless Drill", new Date("2026-10-07T03:59:00Z")), {
    title: "Hand off soon: Makita 18V Cordless Drill",
    message: "Handed off? Confirm by Oct 6, 8:59 PM or it expires.",
  });
});

test("a very long item name is cut at a word, with no ellipsis, and the deadline is untouched", () => {
  const notice = handoffReminder(
    "Vintage Hand-Painted Ceramic Mixing Bowl Set With Wooden Lids And Serving Spoons",
    new Date("2026-10-07T03:59:00Z"),
  );
  // "…Ceramic Mixing Bowl" is exactly 40 characters, the most the title keeps; "Set" would be 44.
  assert.equal(notice.title, "Hand off soon: Vintage Hand-Painted Ceramic Mixing Bowl");
  assert.doesNotMatch(`${notice.title}${notice.message}`, /…|\.\.\./);
  assert.match(notice.message, /Oct 6, 8:59 PM/);
});

test("the reminder reaches users exactly as stored: compaction changes nothing, even on the widest date", () => {
  const names = ["Tent", "Makita 18V Cordless Drill", "x".repeat(120), "Vintage Hand-Painted Ceramic Mixing Bowl Set With Wooden Lids"];
  // Dec 22, 11:59 PM is the longest the formatted deadline gets.
  const dates = [new Date("2026-12-23T07:59:00Z"), new Date("2026-10-07T18:30:00Z"), new Date("2026-02-02T09:05:00Z")];
  for (const name of names) {
    for (const date of dates) {
      const notice = handoffReminder(name, date);
      assert.ok(notice.title.length <= notificationCopyLimits.title, `title fits: ${notice.title}`);
      assert.ok(notice.message.length <= notificationCopyLimits.body, `body fits (${notice.message.length}): ${notice.message}`);
      const delivered = compactNotificationCopy({ ...notice, type: HANDOFF_REMINDER_NOTIFICATION_TYPE });
      assert.equal(delivered.title, notice.title);
      assert.equal(delivered.message, notice.message);
    }
  }
});

// ── Secrets ─────────────────────────────────────────────────────────────────────

test("missing secrets are listed by name only, never by value", () => {
  const secretValue = "postgres://user:hunter2@db.example/prod";
  const missing = findMissingSecrets({ DATABASE_URL: secretValue } as NodeJS.ProcessEnv);
  assert.deepEqual(missing, ["REPLIT_CONNECTORS_HOSTNAME", "REPL_IDENTITY or WEB_REPL_RENEWAL"]);
  assert.ok(!JSON.stringify(missing).includes("hunter2"));
});

test("either connector token satisfies the token requirement; blank values count as missing", () => {
  const base = { DATABASE_URL: "x", REPLIT_CONNECTORS_HOSTNAME: "h" };
  assert.deepEqual(findMissingSecrets({ ...base, WEB_REPL_RENEWAL: "t" } as NodeJS.ProcessEnv), []);
  assert.deepEqual(findMissingSecrets({ ...base, REPL_IDENTITY: "t" } as NodeJS.ProcessEnv), []);
  assert.deepEqual(findMissingSecrets({ ...base, REPL_IDENTITY: "   " } as NodeJS.ProcessEnv), [
    "REPL_IDENTITY or WEB_REPL_RENEWAL",
  ]);
  assert.deepEqual(findMissingSecrets({} as NodeJS.ProcessEnv), [
    "DATABASE_URL",
    "REPLIT_CONNECTORS_HOSTNAME",
    "REPL_IDENTITY or WEB_REPL_RENEWAL",
  ]);
});

// ── Switches ────────────────────────────────────────────────────────────────────

test("modes default to dry-run and anything unrecognised is never live", () => {
  assert.equal(resolveJobMode(undefined), "dry-run");
  assert.equal(resolveJobMode(""), "dry-run");
  assert.equal(resolveJobMode("LIVE "), "live");
  assert.equal(resolveJobMode("yes"), "dry-run");
  assert.equal(resolveJobMode("off"), "off");
});

test("reminders default on and are switched off separately from expiry", () => {
  assert.equal(resolveRemindersEnabled(undefined), true);
  assert.equal(resolveRemindersEnabled("on"), true);
  assert.equal(resolveRemindersEnabled("off"), false);
  assert.equal(resolveRemindersEnabled("0"), false);
});

test("expiry dry-run keeps reminders on and applies the age cutoff", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  assert.deepEqual(buildExpirySweepOptions("dry-run", true, now), {
    now,
    expireDryRun: true,
    reminders: true,
    maxCutoffAgeMs: EXPIRY_SWEEP_MAX_CUTOFF_AGE_MS,
  });
  assert.equal(buildExpirySweepOptions("live", true, now).expireDryRun, false);
  assert.equal(buildExpirySweepOptions("dry-run", false, now).reminders, false);
  assert.equal(EXPIRY_SWEEP_MAX_CUTOFF_AGE_MS, 3 * 24 * 3_600_000);
});

// ── Gating and de-duplication ───────────────────────────────────────────────────

test("slow jobs are gated by their last success, with cron-jitter tolerance", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const every = 10 * 60_000;
  assert.equal(isDue(null, every, now), true);
  assert.equal(isDue(new Date(now.getTime() - 5 * 60_000), every, now), false);
  assert.equal(isDue(new Date(now.getTime() - every + DUE_TOLERANCE_MS), every, now), true);
  assert.equal(isDue(new Date(now.getTime() - 1), 0, now), true);
});

test("dry-run lines are reported once, then again only if they disappear and return", () => {
  const first = newDryRunLines(undefined, ["a", "b"]);
  assert.deepEqual(first.fresh, ["a", "b"]);
  const second = newDryRunLines(first.state, ["a", "b", "c"]);
  assert.deepEqual(second.fresh, ["c"]);
  const third = newDryRunLines(second.state, ["c"]);
  assert.deepEqual(third.fresh, []);
  const fourth = newDryRunLines(third.state, ["a", "c"]);
  assert.deepEqual(fourth.fresh, ["a"]);
});

// ── Orchestration: lock, skips, failures ────────────────────────────────────────

function fakeStore(options: { lockHeld?: boolean; lastSuccess?: Record<string, Date> } = {}) {
  const calls = { acquired: 0, released: 0, skips: 0, started: [] as string[], finished: [] as Array<[string, boolean]> };
  const store: JobStore = {
    async acquireLock() {
      if (options.lockHeld) return null;
      calls.acquired++;
      return { release: async () => void calls.released++ };
    },
    async load(name) {
      const lastSuccessAt = options.lastSuccess?.[name] ?? null;
      return lastSuccessAt ? { lastSuccessAt, state: {} } : null;
    },
    async markStarted(name) {
      calls.started.push(name);
    },
    async markFinished(name, outcome) {
      calls.finished.push([name, outcome.ok]);
    },
    async recordSkip() {
      return ++calls.skips;
    },
  };
  return { store, calls };
}

const step = (name: string, everyMs: number, ran: string[], fail = false): JobStep => ({
  name,
  everyMs,
  async run() {
    ran.push(name);
    if (fail) throw new Error(`${name} exploded`);
    return { summary: "done" };
  },
});

test("a run that finds the advisory lock held logs a clear skip, counts it, and runs nothing", async () => {
  const { store, calls } = fakeStore({ lockHeld: true });
  const ran: string[] = [];
  const logs: string[] = [];
  const report = await runScheduledJobs({ steps: [step("a", 0, ran)], store, log: (l) => logs.push(l) });
  const again = await runScheduledJobs({ steps: [step("a", 0, ran)], store, log: (l) => logs.push(l) });

  assert.equal(report.skipped, true);
  assert.equal(report.exitCode, 0);
  assert.equal(again.skippedTotal, 2);
  assert.deepEqual(ran, []);
  assert.equal(calls.skips, 2);
  assert.match(logs[0], /SKIPPED: another run holds the advisory lock/);
  assert.ok(logs[0].includes(LOCK_NAME));
  assert.match(logs[1], /skipped runs so far: 2/);
});

test("a failing step does not stop the others, fails the run, and still releases the lock", async () => {
  const { store, calls } = fakeStore();
  const ran: string[] = [];
  const errors: string[] = [];
  const report = await runScheduledJobs({
    steps: [step("a", 0, ran, true), step("b", 0, ran)],
    store,
    log: () => {},
    logError: (l) => errors.push(l),
  });

  assert.deepEqual(ran, ["a", "b"]);
  assert.equal(report.exitCode, 1);
  assert.deepEqual(report.outcomes.map((o) => o.status), ["failed", "ok"]);
  assert.deepEqual(calls.finished, [["a", false], ["b", true]]);
  assert.equal(calls.released, 1);
  assert.match(errors[0], /a FAILED: a exploded/);
});

test("steps that are not yet due are skipped without being marked started", async () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const { store, calls } = fakeStore({ lastSuccess: { slow: new Date(now.getTime() - 60_000) } });
  const ran: string[] = [];
  const report = await runScheduledJobs({
    steps: [step("fast", 0, ran), step("slow", 6 * 3_600_000, ran)],
    store,
    now: () => now,
    log: () => {},
  });
  assert.deepEqual(ran, ["fast"]);
  assert.deepEqual(calls.started, ["fast"]);
  assert.deepEqual(report.outcomes.map((o) => o.status), ["ok", "not_due"]);
  assert.equal(report.exitCode, 0);
});

// ── The configured steps ────────────────────────────────────────────────────────

function fakeJobs(calls: { expiry?: any; handoffMode?: string }): ScheduledJobRunners {
  return {
    runReturnRecovery: async () => ({ checked: 0, completed: 0, pending: 0 }),
    runOverdueReminders: async () => ({ remindersCreated: 0 }),
    runHandoffSweep: async (mode: "dry-run" | "live", log: (l: string) => void) => {
      calls.handoffMode = mode;
      log("[handoff-deadlines] DRY-RUN would change request 7 (BORROW, \"Tent\") auto_confirm");
      return { autoAdvancedCount: 0, flaggedCount: 0, depositExpiredCount: 0, dryRun: mode === "dry-run", candidates: [{}] } as any;
    },
    runExpirySweep: async (options: any) => {
      calls.expiry = options;
      return {
        expiredCount: 0,
        remindedCount: 2,
        failedCount: 0,
        dryRun: true,
        candidates: [
          { requestId: 9, action: "expire" as const, itemName: "Tent", cutoff: new Date("2026-10-05T00:00:00Z") },
          { requestId: 10, action: "remind" as const, itemName: "Lamp", cutoff: new Date("2026-10-07T00:00:00Z") },
        ],
      };
    },
  };
}

test("by default the expiry and handoff sweeps are dry runs and the 4h reminder is on", async () => {
  const calls: { expiry?: any; handoffMode?: string } = {};
  const steps = buildSteps(fakeJobs(calls), {} as NodeJS.ProcessEnv, async () => 0);
  assert.deepEqual(steps.map((s) => s.name), [
    "return-recovery",
    "request-expiry",
    "handoff-deadlines",
    "overdue-reminders",
    "rate-limit-cleanup",
  ]);

  const logs: string[] = [];
  const { store } = fakeStore();
  await runScheduledJobs({ steps, store, log: (l) => logs.push(l) });

  assert.equal(calls.handoffMode, "dry-run");
  assert.equal(calls.expiry.expireDryRun, true);
  assert.equal(calls.expiry.reminders, true);
  assert.equal(calls.expiry.maxCutoffAgeMs, EXPIRY_SWEEP_MAX_CUTOFF_AGE_MS);
  assert.ok(logs.some((l) => l.includes("DRY-RUN would expire request 9")));
  assert.ok(!logs.some((l) => l.includes("request 10")), "reminder candidates are not reported as expiries");
  assert.ok(logs.some((l) => l.includes("[scheduled-jobs] request-expiry: mode=dry-run reminders=on")));
});

test("switches take effect from the environment", async () => {
  const calls: { expiry?: any; handoffMode?: string } = {};
  const env = {
    SCHEDULED_JOBS_EXPIRY_MODE: "live",
    SCHEDULED_JOBS_EXPIRY_REMINDERS: "off",
    SCHEDULED_JOBS_HANDOFF_MODE: "off",
  } as NodeJS.ProcessEnv;
  const steps = buildSteps(fakeJobs(calls), env, async () => 0);
  assert.ok(!steps.some((s) => s.name === "handoff-deadlines"));
  const { store } = fakeStore();
  await runScheduledJobs({ steps, store, log: () => {} });
  assert.equal(calls.expiry.expireDryRun, false);
  assert.equal(calls.expiry.reminders, false);
});

// ── jobs:run is a report by default ─────────────────────────────────────────────

test("no flag is the deployed run; --dry-run and --live are explicit; conflicts and typos fail closed", () => {
  assert.equal(parseInvocation([]), "deployed");
  assert.equal(parseInvocation(["--dry-run"]), "dry-run");
  assert.equal(parseInvocation(["--live"]), "live");
  assert.throws(() => parseInvocation(["--dry-run", "--live"]), /cannot be combined/);
  assert.throws(() => parseInvocation(["--dryrun"]), /Unknown option/);
  // `pnpm jobs:run --live` appends --live after the script's own --dry-run: that must refuse, not go live.
  assert.throws(() => parseInvocation(["--dry-run", "--live"]));
});

test("the live warning names the database host and every live step, never credentials", () => {
  const env = {
    DATABASE_URL: "postgres://app_user:hunter2@prod-db.example.com:5432/shareswap",
    SCHEDULED_JOBS_EXPIRY_MODE: "live",
  } as NodeJS.ProcessEnv;
  const warning = liveWarning(env);
  assert.match(warning, /LIVE RUN/);
  assert.match(warning, /database host: prod-db\.example\.com/);
  assert.match(warning, /return-recovery:\s+LIVE/);
  assert.match(warning, /overdue-reminders: LIVE/);
  assert.match(warning, /request-expiry:\s+LIVE; 4h reminders ON/);
  assert.match(warning, /Ctrl\+C/);
  assert.ok(!/hunter2|app_user/.test(warning), "no credentials in the warning");
  assert.equal(databaseHost({ DATABASE_URL: "not a url" } as NodeJS.ProcessEnv), "(unparseable DATABASE_URL)");
});

test("a dry run needs only the database and cannot reach any live runner", async () => {
  assert.deepEqual(findMissingSecrets({ DATABASE_URL: "x" } as NodeJS.ProcessEnv, { reportOnly: true }), []);
  assert.deepEqual(findMissingSecrets({} as NodeJS.ProcessEnv, { reportOnly: true }), ["DATABASE_URL"]);

  const touched: string[] = [];
  const jobs: ScheduledJobRunners = {
    runReturnRecovery: async () => (touched.push("recovery"), { checked: 0, completed: 0, pending: 0 }),
    runOverdueReminders: async () => (touched.push("overdue"), { remindersCreated: 0 }),
    runHandoffSweep: async (mode) => {
      touched.push(`handoff:${mode}`);
      return { autoAdvancedCount: 0, flaggedCount: 0, depositExpiredCount: 0, dryRun: true, candidates: [] } as any;
    },
    runExpirySweep: async (options) => {
      touched.push(`expiry:${JSON.stringify({ dryRun: options.dryRun, expireDryRun: options.expireDryRun, reminders: options.reminders })}`);
      return { expiredCount: 0, remindedCount: 0, failedCount: 0, dryRun: true, candidates: [] };
    },
  };
  // Even with everything switched live in the environment, a dry run ignores it.
  const env = { SCHEDULED_JOBS_EXPIRY_MODE: "live", SCHEDULED_JOBS_HANDOFF_MODE: "live" } as NodeJS.ProcessEnv;
  let cleanups = 0;
  const steps = buildSteps(jobs, env, async () => (cleanups++, 0), { reportOnly: true });
  assert.deepEqual(steps.map((s) => s.name), ["request-expiry", "handoff-deadlines"]);

  const report = await runScheduledJobs({ steps, store: createMemoryJobStore(), log: () => {} });
  assert.equal(report.exitCode, 0);
  assert.deepEqual(touched, ['expiry:{"dryRun":true}', "handoff:dry-run"]);
  assert.equal(cleanups, 0);
});
