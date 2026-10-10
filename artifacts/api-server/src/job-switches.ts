import { isDeployment } from "./background-jobs-gate";
import type { JobMode } from "./scheduled-job-options";

// Kill switches kept in the database (job_switches, config only) so an operator can turn a job
// off, or back to dry-run, without a redeploy. Last-run bookkeeping stays in scheduled_job_runs.
//
// A job with no row has no switch: its environment default applies. A switch that cannot be read is
// never treated as "on": callers skip the run (or, on the read path, act as if the mode were off).
// Kept apart from scripts/run-scheduled-jobs.ts for the same reason as scheduled-job-options.ts:
// the API server imports this file, and importing the script would bundle it into the server.

/** The scheduled sweep (scripts/run-scheduled-jobs.ts, and the optional in-process timer). */
export const REQUEST_EXPIRY_JOB = "request-expiry";
/** Expiry attempted while a request is read or redeemed (inbox, request list, handoff guard). */
export const REQUEST_EXPIRY_ON_READ_JOB = "request-expiry-on-read";

export type SwitchQuery = (text: string, params: unknown[]) => Promise<{ rows: any[] }>;

const poolQuery: SwitchQuery = async (text, params) => {
  const { pool } = await import("@workspace/db");
  return pool.query(text, params);
};

export interface JobSwitch {
  mode: JobMode;
  /** Only the read path uses this: requests whose cutoff passed longer ago are left to the silent cleanup. */
  maxCutoffAgeMs: number | null;
}

/** Strict: unlike resolveJobMode, an unrecognised value is not "dry-run", it is an error. */
export function parseSwitchMode(raw: unknown): JobMode | null {
  return raw === "live" || raw === "dry-run" || raw === "off" ? raw : null;
}

/** The row for `name`, or null when there is none. Throws when the table cannot be read or the row is invalid. */
export async function readJobSwitch(name: string, query: SwitchQuery = poolQuery): Promise<JobSwitch | null> {
  const { rows } = await query("SELECT mode, max_cutoff_age_ms FROM job_switches WHERE job_name = $1", [name]);
  const row = rows[0];
  if (!row) return null;
  const mode = parseSwitchMode(row.mode);
  if (!mode) throw new Error(`job_switches row for ${name} has an invalid mode`);
  const rawAge = row.max_cutoff_age_ms;
  const maxCutoffAgeMs = rawAge === null || rawAge === undefined ? null : Number(rawAge);
  if (maxCutoffAgeMs !== null && !(Number.isFinite(maxCutoffAgeMs) && maxCutoffAgeMs > 0)) {
    throw new Error(`job_switches row for ${name} has an invalid max_cutoff_age_ms`);
  }
  return { mode, maxCutoffAgeMs };
}

export type SwitchDecision =
  | { ok: true; mode: JobMode; maxCutoffAgeMs: number | null; source: "table" | "env" }
  | { ok: false; error: string };

/** A row wins over the environment mode; no row means the environment mode; an unreadable table means no decision. */
export async function resolveJobSwitch(
  name: string,
  envMode: JobMode,
  query: SwitchQuery = poolQuery,
): Promise<SwitchDecision> {
  try {
    const row = await readJobSwitch(name, query);
    if (row) return { ok: true, mode: row.mode, maxCutoffAgeMs: row.maxCutoffAgeMs, source: "table" };
    return { ok: true, mode: envMode, maxCutoffAgeMs: null, source: "env" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── Read path ───────────────────────────────────────────────────────────────────

export interface ExpiryReadPolicy {
  mode: JobMode;
  maxCutoffAgeMs: number | null;
}

export const READ_EXPIRY_OFF: ExpiryReadPolicy = { mode: "off", maxCutoffAgeMs: null };

/**
 * REQUEST_EXPIRY_ON_READ_MODE=live|dry-run|off. Unset: dry-run in a deployment (it logs what it would
 * expire; going live is a deliberate switch), off everywhere else, so a workspace pointed at real data
 * never acts on read. Anything unrecognised is off.
 */
export function resolveOnReadEnvMode(env: NodeJS.ProcessEnv): JobMode {
  const raw = env.REQUEST_EXPIRY_ON_READ_MODE?.trim().toLowerCase();
  if (raw === undefined || raw === "") return isDeployment(env) ? "dry-run" : "off";
  return parseSwitchMode(raw) ?? "off";
}

const LOG_FAILURE_EVERY_MS = 60_000;
let lastFailureLogAt = 0;

/** Never throws, and never returns anything but off when the switch could not be read. */
export async function resolveReadExpiryPolicy(
  env: NodeJS.ProcessEnv = process.env,
  query: SwitchQuery = poolQuery,
  logError: (line: string) => void = console.error,
  nowMs: () => number = Date.now,
): Promise<ExpiryReadPolicy> {
  const decision = await resolveJobSwitch(REQUEST_EXPIRY_ON_READ_JOB, resolveOnReadEnvMode(env), query);
  if (decision.ok) return { mode: decision.mode, maxCutoffAgeMs: decision.maxCutoffAgeMs };
  const now = nowMs();
  if (now - lastFailureLogAt >= LOG_FAILURE_EVERY_MS) {
    lastFailureLogAt = now;
    logError(`[request-expiry] could not read the ${REQUEST_EXPIRY_ON_READ_JOB} switch; expiry on read is off for this call: ${decision.error}`);
  }
  return READ_EXPIRY_OFF;
}

// ── Last-run recording (scheduled_job_runs) ─────────────────────────────────────

export interface ReadCheckSummary {
  mode: JobMode;
  expired: number;
  wouldExpire: number;
}

/**
 * Records what the read path did in scheduled_job_runs, at most once per `everyMs` per process (it runs
 * on every inbox load); the counts of the checks in between are added up. Off runs are not recorded.
 * Fire and forget: a failed write is ignored.
 */
export function createReadRunRecorder(options: {
  query?: SwitchQuery;
  now?: () => Date;
  everyMs?: number;
} = {}): (summary: ReadCheckSummary) => Promise<void> {
  const query = options.query ?? poolQuery;
  const now = options.now ?? (() => new Date());
  const everyMs = options.everyMs ?? 60_000;
  let lastWriteMs = 0;
  let pending = { checks: 0, expired: 0, wouldExpire: 0 };
  return async (summary) => {
    if (summary.mode === "off") return;
    pending.checks += 1;
    pending.expired += summary.expired;
    pending.wouldExpire += summary.wouldExpire;
    const at = now();
    if (at.getTime() - lastWriteMs < everyMs) return;
    lastWriteMs = at.getTime();
    const state = { mode: summary.mode, ...pending };
    pending = { checks: 0, expired: 0, wouldExpire: 0 };
    try {
      await query(
        `INSERT INTO scheduled_job_runs (job_name, last_started_at, last_success_at, last_status, run_count, state)
         VALUES ($1, $2::timestamptz, $2::timestamptz, 'ok', 1, $3::jsonb)
         ON CONFLICT (job_name) DO UPDATE
           SET last_started_at = $2::timestamptz, last_success_at = $2::timestamptz,
               last_status = 'ok', last_error = NULL,
               run_count = scheduled_job_runs.run_count + 1, state = $3::jsonb`,
        [REQUEST_EXPIRY_ON_READ_JOB, at, JSON.stringify(state)],
      );
    } catch {
      // Bookkeeping only.
    }
  };
}
