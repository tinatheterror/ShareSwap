import { and, eq, gte } from "drizzle-orm";
import { db, notifications } from "@workspace/db";
import { HANDOFF_DEADLINES_JOB, REQUEST_EXPIRY_JOB, resolveJobSwitch, timerRunName, type SwitchDecision, type SwitchQuery } from "./job-switches";
import { resolveJobMode, type JobMode } from "./scheduled-job-options";

// Tells every admin when a sweep that is switched live has not run successfully for 24 hours.
//
// The expiry and handoff sweeps only run if something calls them (the Scheduled Deployment, and for the handoff sweep also
// the API's own timer), and a scheduler that has stopped says nothing. This watches the bookkeeping those runs leave in
// scheduled_job_runs. It lives in the API server's timer, not in the scheduled job, so a dead scheduler cannot also silence
// its own alarm. An external dead-man's-switch (HEARTBEAT_URL, see run-scheduled-jobs.ts) covers the API being down too.
//
//   - Only a sweep that is LIVE is watched. A step that is off or in dry-run leaves its last_success_at alone, so it would
//     look stale for ever. "Live" is decided as the sweeps decide it: a job_switches row, else the environment mode.
//   - A sweep switched live recently is given 24 hours from the switch (job_switches.updated_at) before it can be stale.
//   - One alert per sweep per 24 hours: the alert's own notification rows are the record (type sweep_stale_alert:<job>).
//   - A switch or table that cannot be read is "unknown": nothing is said either way.

export const SWEEP_STALE_AFTER_MS = 24 * 3_600_000;
export const SWEEP_WATCHDOG_JOB = "sweep-watchdog";
export const SWEEP_WATCHDOG_EVERY_MS = 15 * 60_000;
export const SWEEP_STALE_NOTIFICATION_PREFIX = "sweep_stale_alert:";
export const sweepStaleNotificationType = (job: string) => `${SWEEP_STALE_NOTIFICATION_PREFIX}${job}`;

export interface WatchedSweep {
  /** The job_switches row and the scheduled_job_runs row of the scheduled job. */
  job: string;
  label: string;
  /** scheduled_job_runs rows whose last success counts as "this sweep ran". */
  runNames: string[];
  envMode: JobMode;
}

/**
 * The expiry timer inside the API is always a dry run, so only the scheduled job's own row counts for expiry. The handoff
 * timer honours the live switch, so its row counts too.
 */
export function watchedSweeps(env: NodeJS.ProcessEnv = process.env): WatchedSweep[] {
  return [
    { job: REQUEST_EXPIRY_JOB, label: "Request expiry", runNames: [REQUEST_EXPIRY_JOB], envMode: resolveJobMode(env.SCHEDULED_JOBS_EXPIRY_MODE) },
    {
      job: HANDOFF_DEADLINES_JOB,
      label: "Handoff deadlines",
      runNames: [HANDOFF_DEADLINES_JOB, timerRunName(HANDOFF_DEADLINES_JOB)],
      envMode: resolveJobMode(env.SCHEDULED_JOBS_HANDOFF_MODE),
    },
  ];
}

export type SweepHealth = "fresh" | "stale" | "not-watched" | "unknown";

export interface SweepCheck {
  job: string;
  label: string;
  health: SweepHealth;
  /** The latest successful run of this sweep, or null when there has never been one. */
  lastSuccessAt: Date | null;
  /** True when this call told the admins. */
  alerted: boolean;
}

export interface WatchdogDeps {
  now?: Date;
  env?: NodeJS.ProcessEnv;
  /** Reads scheduled_job_runs and job_switches; defaults to the pool. */
  query?: SwitchQuery;
  resolveSwitch?: (job: string, envMode: JobMode, query?: SwitchQuery) => Promise<SwitchDecision>;
  /** Admin user ids to tell; defaults to every active admin. */
  adminIds?: () => Promise<number[]>;
  /** True when this sweep already has an alert newer than `since`. */
  alertedSince?: (job: string, since: Date) => Promise<boolean>;
  /** Records the in-app alert for each admin. */
  recordAlert?: (job: string, userIds: number[], title: string, message: string) => Promise<void>;
  /** Best-effort push to the admins; failures are ignored. */
  push?: (userIds: number[], payload: { title: string; body: string; data?: Record<string, unknown> }) => Promise<void>;
  log?: (line: string) => void;
}

const poolQuery: SwitchQuery = async (text, params) => {
  const { pool } = await import("@workspace/db");
  return pool.query(text, params);
};

async function defaultAdminIds(): Promise<number[]> {
  const { adminUserIds } = await import("./platform-disputes");
  return adminUserIds();
}

async function defaultAlertedSince(job: string, since: Date): Promise<boolean> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.type, sweepStaleNotificationType(job)), gte(notifications.createdAt, since)))
    .limit(1);
  return rows.length > 0;
}

async function defaultRecordAlert(job: string, userIds: number[], title: string, message: string): Promise<void> {
  if (userIds.length === 0) return;
  await db.insert(notifications).values(userIds.map((userId) => ({ userId, type: sweepStaleNotificationType(job), title, message, isRead: false })));
}

async function defaultPush(userIds: number[], payload: { title: string; body: string; data?: Record<string, unknown> }): Promise<void> {
  const { sendPushToUsers } = await import("./push-notifications");
  await sendPushToUsers(userIds, payload, "requests");
}

const utc = (date: Date) => `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function staleSweepNotice(label: string, lastSuccessAt: Date | null) {
  return {
    title: `${label} sweep has stopped`,
    message: lastSuccessAt
      ? `${label} is switched live but has not run successfully since ${utc(lastSuccessAt)} (over 24 hours). Check the Scheduled Deployment and its logs.`
      : `${label} is switched live but has never run successfully. Check the Scheduled Deployment and its logs.`,
  };
}

/** Checks every watched sweep once; tells the admins about each stale one that has not been reported in the last 24 hours. */
export async function checkSweepHeartbeats(deps: WatchdogDeps = {}): Promise<SweepCheck[]> {
  const now = deps.now ?? new Date();
  const query = deps.query ?? poolQuery;
  const resolveSwitch = deps.resolveSwitch ?? resolveJobSwitch;
  const log = deps.log ?? console.log;
  const results: SweepCheck[] = [];

  for (const sweep of watchedSweeps(deps.env ?? process.env)) {
    const base = { job: sweep.job, label: sweep.label, lastSuccessAt: null as Date | null, alerted: false };
    try {
      const decision = await resolveSwitch(sweep.job, sweep.envMode, query);
      if (!decision.ok) {
        results.push({ ...base, health: "unknown" });
        continue;
      }
      if (decision.mode !== "live") {
        results.push({ ...base, health: "not-watched" });
        continue;
      }

      const runs = await query("SELECT max(last_success_at) AS last_success_at FROM scheduled_job_runs WHERE job_name = ANY($1)", [sweep.runNames]);
      const lastSuccessAt: Date | null = runs.rows[0]?.last_success_at ? new Date(runs.rows[0].last_success_at) : null;
      let since = lastSuccessAt;
      if (decision.source === "table") {
        // Switched live a moment ago: it has had no chance to run yet.
        const row = await query("SELECT updated_at FROM job_switches WHERE job_name = $1", [sweep.job]);
        const switchedAt: Date | null = row.rows[0]?.updated_at ? new Date(row.rows[0].updated_at) : null;
        if (switchedAt && (!since || switchedAt.getTime() > since.getTime())) since = switchedAt;
      }

      const stale = !since || now.getTime() - since.getTime() > SWEEP_STALE_AFTER_MS;
      if (!stale) {
        results.push({ ...base, lastSuccessAt, health: "fresh" });
        continue;
      }

      const windowStart = new Date(now.getTime() - SWEEP_STALE_AFTER_MS);
      const alreadyTold = await (deps.alertedSince ?? defaultAlertedSince)(sweep.job, windowStart);
      let alerted = false;
      const notice = staleSweepNotice(sweep.label, lastSuccessAt);
      if (!alreadyTold) {
        const admins = await (deps.adminIds ?? defaultAdminIds)();
        if (admins.length === 0) {
          log(`[sweep-watchdog] ${notice.message} (no admin to tell)`);
        } else {
          await (deps.recordAlert ?? defaultRecordAlert)(sweep.job, admins, notice.title, notice.message);
          alerted = true;
          log(`[sweep-watchdog] ${notice.message} Told ${admins.length} admin(s).`);
          try {
            await (deps.push ?? defaultPush)(admins, { title: notice.title, body: notice.message, data: { type: sweepStaleNotificationType(sweep.job) } });
          } catch {
            // The in-app alert is what counts.
          }
        }
      }
      results.push({ ...base, lastSuccessAt, health: "stale", alerted });
    } catch (error) {
      log(`[sweep-watchdog] could not check ${sweep.job}: ${error instanceof Error ? error.message : String(error)}`);
      results.push({ ...base, health: "unknown" });
    }
  }
  return results;
}
