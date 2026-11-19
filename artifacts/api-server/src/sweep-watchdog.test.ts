import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, like } from "drizzle-orm";
import { db, notifications, pool, users } from "@workspace/db";
import type { SwitchDecision, SwitchQuery } from "./job-switches.js";
import {
  SWEEP_STALE_AFTER_MS,
  checkSweepHeartbeats,
  staleSweepNotice,
  sweepStaleNotificationType,
  watchedSweeps,
} from "./sweep-watchdog.js";

const HOUR = 3_600_000;
const NOW = new Date("2026-11-20T12:00:00.000Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

const live = (source: "table" | "env" = "table"): SwitchDecision => ({ ok: true, mode: "live", maxCutoffAgeMs: null, source });

/** scheduled_job_runs and job_switches answered from memory; `lastSuccess` is keyed by the sweep's own run name. */
function fakeQuery(lastSuccess: Record<string, Date | null>, switchedAt: Date | null = null) {
  const calls: { text: string; params: unknown[] }[] = [];
  const query: SwitchQuery = async (text, params) => {
    calls.push({ text, params });
    if (text.includes("scheduled_job_runs")) {
      const names = params[0] as string[];
      return { rows: [{ last_success_at: lastSuccess[names[0]] ?? null }] };
    }
    return { rows: [{ updated_at: switchedAt }] };
  };
  return { query, calls };
}

function harness(overrides: Parameters<typeof checkSweepHeartbeats>[0] = {}) {
  const recorded: { job: string; userIds: number[]; title: string; message: string }[] = [];
  const pushed: number[][] = [];
  const logs: string[] = [];
  const deps = {
    now: NOW,
    env: {} as NodeJS.ProcessEnv,
    resolveSwitch: async () => live(),
    adminIds: async () => [11, 12],
    alertedSince: async () => false,
    recordAlert: async (job: string, userIds: number[], title: string, message: string) => { recorded.push({ job, userIds, title, message }); },
    push: async (userIds: number[]) => { pushed.push(userIds); },
    log: (line: string) => logs.push(line),
    ...overrides,
  };
  return { deps, recorded, pushed, logs };
}

const byJob = (checks: Awaited<ReturnType<typeof checkSweepHeartbeats>>, job: string) => checks.find((c) => c.job === job)!;

after(async () => {
  await pool.end();
});

test("a sweep that ran within 24 hours is fresh and nobody is told", async () => {
  const { query } = fakeQuery({ "request-expiry": ago(1), "handoff-deadlines": ago(23) });
  const h = harness({ query });
  const checks = await checkSweepHeartbeats(h.deps);
  assert.equal(byJob(checks, "request-expiry").health, "fresh");
  assert.equal(byJob(checks, "handoff-deadlines").health, "fresh");
  assert.equal(h.recorded.length, 0);
});

test("a live sweep that has not succeeded for over 24 hours alerts every admin once, in-app and by push", async () => {
  const { query } = fakeQuery({ "request-expiry": ago(30), "handoff-deadlines": ago(1) });
  const h = harness({ query });
  const checks = await checkSweepHeartbeats(h.deps);
  const expiry = byJob(checks, "request-expiry");
  assert.equal(expiry.health, "stale");
  assert.equal(expiry.alerted, true);
  assert.equal(byJob(checks, "handoff-deadlines").health, "fresh");
  assert.equal(h.recorded.length, 1, "only the stale sweep is reported");
  assert.deepEqual(h.recorded[0].userIds, [11, 12]);
  assert.equal(h.recorded[0].job, "request-expiry");
  assert.match(h.recorded[0].message, /not run successfully since 2026-11-19 06:00 UTC/);
  assert.deepEqual(h.pushed, [[11, 12]]);
});

test("exactly 24 hours is not yet stale", async () => {
  const { query } = fakeQuery({ "request-expiry": new Date(NOW.getTime() - SWEEP_STALE_AFTER_MS), "handoff-deadlines": ago(1) });
  const h = harness({ query });
  assert.equal(byJob(await checkSweepHeartbeats(h.deps), "request-expiry").health, "fresh");
});

test("a stale sweep already reported in the last 24 hours is not reported again", async () => {
  const { query } = fakeQuery({ "request-expiry": ago(50), "handoff-deadlines": ago(1) });
  const asked: [string, Date][] = [];
  const h = harness({ query, alertedSince: async (job, since) => { asked.push([job, since]); return true; } });
  const expiry = byJob(await checkSweepHeartbeats(h.deps), "request-expiry");
  assert.equal(expiry.health, "stale");
  assert.equal(expiry.alerted, false);
  assert.equal(h.recorded.length, 0);
  assert.equal(h.pushed.length, 0);
  assert.deepEqual(asked, [["request-expiry", ago(24)]]);
});

test("a sweep that never ran says so, once it has been live for more than 24 hours", async () => {
  const { query } = fakeQuery({}, ago(30));
  const h = harness({ query });
  const checks = await checkSweepHeartbeats(h.deps);
  assert.equal(byJob(checks, "request-expiry").health, "stale");
  assert.equal(byJob(checks, "request-expiry").lastSuccessAt, null);
  assert.match(h.recorded[0].message, /never run successfully/);
});

test("a sweep switched live a moment ago has 24 hours before it can be stale", async () => {
  const { query } = fakeQuery({ "request-expiry": ago(300) }, ago(1));
  const h = harness({ query });
  const checks = await checkSweepHeartbeats(h.deps);
  assert.equal(byJob(checks, "request-expiry").health, "fresh", "an old last run does not count against a fresh switch");
  assert.equal(h.recorded.length, 0);
});

test("a sweep that is off or in dry-run is not watched at all", async () => {
  for (const mode of ["off", "dry-run"] as const) {
    const { query, calls } = fakeQuery({});
    const h = harness({ query, resolveSwitch: async () => ({ ok: true, mode, maxCutoffAgeMs: null, source: "table" }) });
    const checks = await checkSweepHeartbeats(h.deps);
    assert.ok(checks.every((c) => c.health === "not-watched"), mode);
    assert.equal(calls.length, 0, `${mode}: nothing is read`);
    assert.equal(h.recorded.length, 0);
  }
});

test("a switch that cannot be read says nothing either way", async () => {
  const { query } = fakeQuery({});
  const h = harness({ query, resolveSwitch: async () => ({ ok: false, error: "no table" }) });
  const checks = await checkSweepHeartbeats(h.deps);
  assert.ok(checks.every((c) => c.health === "unknown"));
  assert.equal(h.recorded.length, 0);
});

test("a failing read is logged and treated as unknown, and the other sweep is still checked", async () => {
  const query: SwitchQuery = async (text, params) => {
    if ((params[0] as string[])[0] === "request-expiry") throw new Error("boom");
    return { rows: [{ last_success_at: ago(1), updated_at: null }] };
  };
  const h = harness({ query });
  const checks = await checkSweepHeartbeats(h.deps);
  assert.equal(byJob(checks, "request-expiry").health, "unknown");
  assert.equal(byJob(checks, "handoff-deadlines").health, "fresh");
  assert.ok(h.logs.some((l) => l.includes("could not check request-expiry: boom")));
});

test("the handoff sweep counts the API timer's runs too; expiry counts only the scheduled job's", () => {
  const sweeps = watchedSweeps({});
  assert.deepEqual(sweeps.find((s) => s.job === "request-expiry")!.runNames, ["request-expiry"]);
  assert.deepEqual(sweeps.find((s) => s.job === "handoff-deadlines")!.runNames, ["handoff-deadlines", "timer:handoff-deadlines"]);
});

test("the environment modes the scheduled job uses decide the default when there is no switch row", () => {
  const sweeps = watchedSweeps({ SCHEDULED_JOBS_EXPIRY_MODE: "live", SCHEDULED_JOBS_HANDOFF_MODE: "off" } as NodeJS.ProcessEnv);
  assert.equal(sweeps.find((s) => s.job === "request-expiry")!.envMode, "live");
  assert.equal(sweeps.find((s) => s.job === "handoff-deadlines")!.envMode, "off");
  assert.equal(watchedSweeps({}).find((s) => s.job === "request-expiry")!.envMode, "dry-run");
});

test("live from the environment alone has no switch time, so only the last run counts", async () => {
  const { query, calls } = fakeQuery({ "request-expiry": ago(40), "handoff-deadlines": ago(40) }, ago(1));
  const h = harness({ query, resolveSwitch: async () => live("env") });
  const checks = await checkSweepHeartbeats(h.deps);
  assert.ok(checks.every((c) => c.health === "stale"));
  assert.ok(!calls.some((c) => c.text.includes("job_switches")));
});

test("with no admin to tell it logs the problem and records nothing", async () => {
  const { query } = fakeQuery({ "request-expiry": ago(30), "handoff-deadlines": ago(1) });
  const h = harness({ query, adminIds: async () => [] });
  const expiry = byJob(await checkSweepHeartbeats(h.deps), "request-expiry");
  assert.equal(expiry.health, "stale");
  assert.equal(expiry.alerted, false);
  assert.equal(h.recorded.length, 0);
  assert.ok(h.logs.some((l) => l.includes("no admin to tell")));
});

test("a failing push does not undo the alert", async () => {
  const { query } = fakeQuery({ "request-expiry": ago(30), "handoff-deadlines": ago(1) });
  const h = harness({ query, push: async () => { throw new Error("no push"); } });
  assert.equal(byJob(await checkSweepHeartbeats(h.deps), "request-expiry").alerted, true);
  assert.equal(h.recorded.length, 1);
});

test("the notice wording", () => {
  assert.equal(staleSweepNotice("Request expiry", null).title, "Request expiry sweep has stopped");
  assert.match(staleSweepNotice("Request expiry", new Date("2026-11-18T03:10:00Z")).message, /since 2026-11-18 03:10 UTC/);
});

test("with the real notification table: the alert reaches each admin once per 24 hours and then stays quiet", async () => {
  const type = sweepStaleNotificationType("request-expiry");
  await db.delete(notifications).where(like(notifications.type, "sweep_stale_alert:%"));
  const [member] = await db.insert(users).values({ username: `sweep-watchdog-${Date.now()}`, displayName: "Watchdog Test", password: "x", emailVerified: true } as typeof users.$inferInsert).returning({ id: users.id });
  try {
    // The notification goes to a plain member standing in for an admin (tests never create admin users).
    const realNow = Date.now();
    const { query } = fakeQuery({ "request-expiry": new Date(realNow - 30 * HOUR), "handoff-deadlines": new Date(realNow - HOUR) });
    const pushes: number[][] = [];
    const deps = { now: NOW, env: {} as NodeJS.ProcessEnv, query, resolveSwitch: async () => live(), adminIds: async () => [member.id], push: async (ids: number[]) => { pushes.push(ids); }, log: () => {} };

    const first = byJob(await checkSweepHeartbeats({ ...deps, now: new Date() }), "request-expiry");
    assert.equal(first.alerted, true);
    const rows = await db.select().from(notifications).where(eq(notifications.type, type));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, member.id);
    assert.equal(rows[0].isRead, false);

    const second = byJob(await checkSweepHeartbeats({ ...deps, now: new Date() }), "request-expiry");
    assert.equal(second.health, "stale");
    assert.equal(second.alerted, false, "already told within 24 hours");
    assert.equal((await db.select().from(notifications).where(eq(notifications.type, type))).length, 1);
    assert.deepEqual(pushes, [[member.id]]);
  } finally {
    await db.delete(notifications).where(eq(notifications.userId, member.id));
    await db.delete(users).where(eq(users.id, member.id));
  }
});
