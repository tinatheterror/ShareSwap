import { pathToFileURL } from "node:url";
import type { ScheduledJobRunners } from "../routes/routes";

// One entry point for the Scheduled Deployment (cron `* * * * *`, command
// `node artifacts/api-server/dist/run-scheduled-jobs.mjs`; locally `pnpm jobs:run`).
//
// Replit's scheduler has a 1-minute floor and NO concurrency limit, so every run first takes a
// Postgres advisory lock and exits quietly if another run holds it (counted in scheduled_job_runs).
// Slow jobs are gated by their own last_success_at in that table, so the once-a-minute cron
// runs each of them only when due.
//
// Nothing here replaces the in-process timers in routes.ts; both can run, because every pass
// claims its rows (UPDATE ... WHERE status = ..., operation tokens, at-most-once reminder stamp).
//
// Invocation:
//   (no flag)   what the Scheduled Deployment runs: lock, bookkeeping, every step as configured.
//   --dry-run   `pnpm jobs:run`. Safe on any database: only the expiry and handoff sweeps run, as
//               reports; no lock, no scheduled_job_runs writes, no reminders, no Stripe, no cleanup.
//               (Route setup may still issue its usual idempotent CREATE TABLE IF NOT EXISTS.)
//   --live      `pnpm jobs:run:live`. Same as the deployed run, but prints a loud warning naming the
//               database host and the live steps, then waits LIVE_WARNING_DELAY_MS first.
//
// Switches (all read from the environment, so going live never needs a code change):
//   SCHEDULED_JOBS_EXPIRY_MODE         off | dry-run (default) | live
//   SCHEDULED_JOBS_EXPIRY_REMINDERS    on (default) | off      the 4h "hand off soon" reminder
//   SCHEDULED_JOBS_HANDOFF_MODE        off | dry-run (default) | live
// Anything unrecognised is a dry run, never a live one.

export const LOCK_NAME = "shareswap:scheduled-jobs";
/** A hung step would hold the lock and skip every later run, so the whole process gives up. */
export const RUN_TIMEOUT_MS = 5 * 60_000;
/** Cron jitter: a job "every 10 min" is due after 9m30s so it does not drift to every 11. */
export const DUE_TOLERANCE_MS = 30_000;
/**
 * The expiry sweep only acts on requests whose cutoff passed within this window; older ones
 * are for scripts/expire-stale-requests.ts (silent), so a first run cannot notify about
 * long-dead requests. Same window as the handoff sweep.
 */
export const EXPIRY_SWEEP_MAX_CUTOFF_AGE_MS = 3 * 24 * 3_600_000;
export const OVERDUE_REMINDER_EVERY_MS = 6 * 3_600_000;
export const RATE_LIMIT_CLEANUP_EVERY_MS = 10 * 60_000;
const MAX_REPORTED_LINES = 500;

// ── Secrets ─────────────────────────────────────────────────────────────────────

/**
 * Names only, never values. Stripe and SendGrid credentials come from the Replit connector
 * (stripe.server.ts / sendgrid.ts), so what the job needs is the connector host plus a token:
 * REPL_IDENTITY in the workspace, WEB_REPL_RENEWAL in a deployment.
 */
export const REQUIRED_SECRETS: ReadonlyArray<string | readonly string[]> = [
  "DATABASE_URL",
  "REPLIT_CONNECTORS_HOSTNAME",
  ["REPL_IDENTITY", "WEB_REPL_RENEWAL"],
];

export function findMissingSecrets(
  env: NodeJS.ProcessEnv,
  { reportOnly = false }: { reportOnly?: boolean } = {},
): string[] {
  const present = (name: string) => (env[name] ?? "").trim() !== "";
  const missing: string[] = [];
  // A report-only run never touches Stripe or SendGrid, so it needs only the database.
  for (const requirement of reportOnly ? (["DATABASE_URL"] as const) : REQUIRED_SECRETS) {
    if (typeof requirement === "string") {
      if (!present(requirement)) missing.push(requirement);
    } else if (!requirement.some(present)) {
      missing.push(requirement.join(" or "));
    }
  }
  return missing;
}

// ── Command line ────────────────────────────────────────────────────────────────

export const LIVE_WARNING_DELAY_MS = 5_000;

export type InvocationMode = "deployed" | "dry-run" | "live";

/** Throws on conflicting or unknown flags so a typo can never fall through to a live run. */
export function parseInvocation(argv: readonly string[]): InvocationMode {
  const flags = argv.filter((arg) => arg.startsWith("-"));
  const unknown = flags.filter((flag) => flag !== "--dry-run" && flag !== "--live");
  if (unknown.length > 0) throw new Error(`Unknown option(s): ${unknown.join(", ")}. Use --dry-run or --live.`);
  const dry = flags.includes("--dry-run");
  const live = flags.includes("--live");
  if (dry && live) throw new Error("--dry-run and --live cannot be combined.");
  return dry ? "dry-run" : live ? "live" : "deployed";
}

/** Host only; never the URL, user or password. */
export function databaseHost(env: NodeJS.ProcessEnv): string {
  try {
    return new URL(env.DATABASE_URL ?? "").hostname || "(unknown host)";
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

export function liveWarning(env: NodeJS.ProcessEnv): string {
  const bar = "!".repeat(78);
  const expiry = resolveJobMode(env.SCHEDULED_JOBS_EXPIRY_MODE);
  const handoff = resolveJobMode(env.SCHEDULED_JOBS_HANDOFF_MODE);
  const reminders = resolveRemindersEnabled(env.SCHEDULED_JOBS_EXPIRY_REMINDERS);
  return [
    bar,
    "!! LIVE RUN — this will change real data on the database below.",
    `!! database host: ${databaseHost(env)}`,
    "!! return-recovery:  LIVE (finishes approved returns; calls Stripe)",
    "!! overdue-reminders: LIVE every 6h (notifications, push, overdue stages, penalties)",
    "!! rate-limit-cleanup: LIVE (deletes expired rows)",
    `!! request-expiry:   ${expiry.toUpperCase()}${expiry === "off" ? "" : `; 4h reminders ${reminders ? "ON (sends notifications + push)" : "off"}`}`,
    `!! handoff-deadlines: ${handoff.toUpperCase()}`,
    `!! Starting in ${LIVE_WARNING_DELAY_MS / 1000}s — press Ctrl+C now to abort. For a safe report use: pnpm jobs:run`,
    bar,
  ].join("\n");
}

// ── Switches ────────────────────────────────────────────────────────────────────

export type JobMode = "off" | "dry-run" | "live";

export function resolveJobMode(raw: string | undefined): JobMode {
  const value = raw?.trim().toLowerCase();
  if (value === "live") return "live";
  if (value === "off") return "off";
  return "dry-run";
}

export function resolveRemindersEnabled(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return !(value === "off" || value === "false" || value === "0" || value === "no");
}

/** Expiry stays a dry run unless explicitly live; reminders are controlled separately. */
export function buildExpirySweepOptions(mode: Exclude<JobMode, "off">, reminders: boolean, now: Date) {
  return {
    now,
    expireDryRun: mode !== "live",
    reminders,
    maxCutoffAgeMs: EXPIRY_SWEEP_MAX_CUTOFF_AGE_MS,
  };
}

// ── Gating and de-duplication ───────────────────────────────────────────────────

export function isDue(lastSuccessAt: Date | null, everyMs: number, now: Date): boolean {
  if (everyMs <= 0 || !lastSuccessAt) return true;
  return now.getTime() - lastSuccessAt.getTime() >= everyMs - DUE_TOLERANCE_MS;
}

/**
 * A dry run repeats every minute; report a line only when it was not in the previous run's
 * set. The stored set is replaced each run, so a candidate that disappears and returns is
 * reported again.
 */
export function newDryRunLines(
  previous: Record<string, unknown> | undefined,
  current: string[],
): { fresh: string[]; state: Record<string, unknown> } {
  const seen = new Set(Array.isArray(previous?.reported) ? (previous!.reported as string[]) : []);
  return {
    fresh: current.filter((line) => !seen.has(line)),
    state: { reported: current.slice(0, MAX_REPORTED_LINES) },
  };
}

// ── Run orchestration (database-free; the store and lock are injected) ──────────

export interface JobContext {
  now: Date;
  state: Record<string, unknown>;
  log: (line: string) => void;
}

export interface JobResult {
  summary: string;
  /** Replaces the stored state when given; omit to keep it. */
  state?: Record<string, unknown>;
}

export interface JobStep {
  name: string;
  /** 0 = every run. */
  everyMs: number;
  run(ctx: JobContext): Promise<JobResult>;
}

export interface JobStore {
  /** Null when another run holds the lock. */
  acquireLock(): Promise<{ release(): Promise<void> } | null>;
  load(name: string): Promise<{ lastSuccessAt: Date | null; state: Record<string, unknown> } | null>;
  markStarted(name: string, now: Date): Promise<void>;
  markFinished(
    name: string,
    outcome: { ok: boolean; error?: string; state?: Record<string, unknown>; now: Date },
  ): Promise<void>;
  /** Returns the running total of skipped runs. */
  recordSkip(now: Date): Promise<number>;
}

export interface StepOutcome {
  name: string;
  status: "ok" | "failed" | "not_due";
  summary?: string;
  error?: string;
}

export interface RunReport {
  skipped: boolean;
  skippedTotal?: number;
  outcomes: StepOutcome[];
  /** Skipped runs are healthy (0); a failed step makes the cron run fail (1). */
  exitCode: 0 | 1;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function runScheduledJobs({
  steps,
  store,
  now = () => new Date(),
  log = (line) => console.log(line),
  logError = (line) => console.error(line),
}: {
  steps: JobStep[];
  store: JobStore;
  now?: () => Date;
  log?: (line: string) => void;
  logError?: (line: string) => void;
}): Promise<RunReport> {
  const lock = await store.acquireLock();
  if (!lock) {
    let total: number | undefined;
    try {
      total = await store.recordSkip(now());
    } catch (err) {
      logError(`[scheduled-jobs] could not record the skipped run: ${errorMessage(err)}`);
    }
    log(
      `[scheduled-jobs] SKIPPED: another run holds the advisory lock "${LOCK_NAME}"` +
        (total === undefined ? "" : ` (skipped runs so far: ${total})`),
    );
    return { skipped: true, skippedTotal: total, outcomes: [], exitCode: 0 };
  }

  const outcomes: StepOutcome[] = [];
  try {
    for (const step of steps) {
      const startedAt = now();
      try {
        const row = await store.load(step.name);
        if (!isDue(row?.lastSuccessAt ?? null, step.everyMs, startedAt)) {
          outcomes.push({ name: step.name, status: "not_due" });
          continue;
        }
        await store.markStarted(step.name, startedAt);
        const result = await step.run({
          now: startedAt,
          state: row?.state ?? {},
          log: (line) => log(line),
        });
        await store.markFinished(step.name, { ok: true, state: result.state, now: now() });
        outcomes.push({ name: step.name, status: "ok", summary: result.summary });
        log(`[scheduled-jobs] ${step.name}: ${result.summary}`);
      } catch (err) {
        const message = errorMessage(err);
        outcomes.push({ name: step.name, status: "failed", error: message });
        logError(`[scheduled-jobs] ${step.name} FAILED: ${message}`);
        await store
          .markFinished(step.name, { ok: false, error: message.slice(0, 500), now: now() })
          .catch(() => {});
      }
    }
  } finally {
    await lock.release().catch((err) => logError(`[scheduled-jobs] lock release failed: ${errorMessage(err)}`));
  }
  return {
    skipped: false,
    outcomes,
    exitCode: outcomes.some((o) => o.status === "failed") ? 1 : 0,
  };
}

// ── The steps ───────────────────────────────────────────────────────────────────

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * `reportOnly` (the --dry-run invocation) ignores the environment switches: the expiry and
 * handoff sweeps run as pure reports (nothing expires, no reminder is sent) and every step
 * that writes, notifies or calls Stripe is left out.
 */
export function buildSteps(
  jobs: ScheduledJobRunners,
  env: NodeJS.ProcessEnv,
  deleteExpiredRateLimitRows: () => Promise<number>,
  { reportOnly = false }: { reportOnly?: boolean } = {},
): JobStep[] {
  if (reportOnly) return buildReportOnlySteps(jobs);
  const expiryMode = resolveJobMode(env.SCHEDULED_JOBS_EXPIRY_MODE);
  const reminders = resolveRemindersEnabled(env.SCHEDULED_JOBS_EXPIRY_REMINDERS);
  const handoffMode = resolveJobMode(env.SCHEDULED_JOBS_HANDOFF_MODE);
  const steps: JobStep[] = [];

  steps.push({
    name: "return-recovery",
    everyMs: 0,
    async run() {
      const r = await jobs.runReturnRecovery();
      return { summary: `checked=${r.checked} completed=${r.completed} pending=${r.pending}` };
    },
  });

  if (expiryMode !== "off") {
    steps.push({
      name: "request-expiry",
      everyMs: 0,
      async run({ now, state, log }) {
        const result = await jobs.runExpirySweep(buildExpirySweepOptions(expiryMode, reminders, now));
        let nextState: Record<string, unknown> | undefined;
        if (expiryMode === "dry-run") {
          const lines = result.candidates
            .filter((c) => c.action === "expire")
            .map(
              (c) =>
                `[request-expiry] DRY-RUN would expire request ${c.requestId} ("${short(c.itemName, 40)}") — cutoff ${c.cutoff.toISOString()}`,
            );
          const { fresh, state: stored } = newDryRunLines(state, lines);
          fresh.forEach(log);
          nextState = stored;
        }
        return {
          summary:
            `mode=${expiryMode} reminders=${reminders ? "on" : "off"} expired=${result.expiredCount} ` +
            `reminded=${result.remindedCount} failed=${result.failedCount} ` +
            `wouldExpire=${expiryMode === "dry-run" ? result.candidates.filter((c) => c.action === "expire").length : 0}`,
          state: nextState,
        };
      },
    });
  }

  if (handoffMode !== "off") {
    steps.push({
      name: "handoff-deadlines",
      everyMs: 0,
      async run({ state, log }) {
        const lines: string[] = [];
        const result = await jobs.runHandoffSweep(handoffMode, (line) => lines.push(line));
        let nextState: Record<string, unknown> | undefined;
        if (handoffMode === "dry-run") {
          const { fresh, state: stored } = newDryRunLines(state, lines);
          fresh.forEach(log);
          nextState = stored;
        } else {
          lines.forEach(log);
        }
        return {
          summary:
            `mode=${handoffMode} candidates=${result.candidates.length} autoConfirmed=${result.autoAdvancedCount} ` +
            `flagged=${result.flaggedCount} depositCancelled=${result.depositExpiredCount}`,
          state: nextState,
        };
      },
    });
  }

  steps.push({
    name: "overdue-reminders",
    everyMs: OVERDUE_REMINDER_EVERY_MS,
    async run() {
      const r = await jobs.runOverdueReminders();
      return { summary: `remindersCreated=${r.remindersCreated}` };
    },
  });

  steps.push({
    name: "rate-limit-cleanup",
    everyMs: RATE_LIMIT_CLEANUP_EVERY_MS,
    async run() {
      return { summary: `removed=${await deleteExpiredRateLimitRows()}` };
    },
  });

  return steps;
}

function buildReportOnlySteps(jobs: ScheduledJobRunners): JobStep[] {
  return [
    {
      name: "request-expiry",
      everyMs: 0,
      async run({ now, log }) {
        // Full dryRun, not expireDryRun: no reminder may be sent either.
        const result = await jobs.runExpirySweep({ now, dryRun: true, maxCutoffAgeMs: EXPIRY_SWEEP_MAX_CUTOFF_AGE_MS });
        for (const c of result.candidates) {
          const verb = c.action === "expire" ? "expire" : "remind (4h reminder)";
          log(`[request-expiry] REPORT would ${verb} request ${c.requestId} ("${short(c.itemName, 40)}") — cutoff ${c.cutoff.toISOString()}`);
        }
        const wouldExpire = result.candidates.filter((c) => c.action === "expire").length;
        return { summary: `report only: wouldExpire=${wouldExpire} wouldRemind=${result.candidates.length - wouldExpire}` };
      },
    },
    {
      name: "handoff-deadlines",
      everyMs: 0,
      async run({ log }) {
        const result = await jobs.runHandoffSweep("dry-run", log);
        return { summary: `report only: candidates=${result.candidates.length}` };
      },
    },
  ];
}

/** Dry runs leave no trace: no lock, no scheduled_job_runs rows, no gating. */
export function createMemoryJobStore(): JobStore {
  return {
    acquireLock: async () => ({ release: async () => {} }),
    load: async () => null,
    markStarted: async () => {},
    markFinished: async () => {},
    recordSkip: async () => 0,
  };
}

// ── Postgres-backed store ───────────────────────────────────────────────────────

interface PgQueryResult {
  rows: any[];
  rowCount: number | null;
}
interface PgClientLike {
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
  release(): void;
}
export interface PgPoolLike {
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
  connect(): Promise<PgClientLike>;
}

export function createPgJobStore(pool: PgPoolLike): JobStore {
  return {
    async acquireLock() {
      // Session-level lock on a dedicated connection: it is released explicitly below, and
      // by Postgres itself if this process dies or is killed.
      const client = await pool.connect();
      try {
        const { rows } = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [LOCK_NAME]);
        if (rows[0]?.ok !== true) {
          client.release();
          return null;
        }
      } catch (err) {
        client.release();
        throw err;
      }
      return {
        async release() {
          try {
            await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_NAME]);
          } finally {
            client.release();
          }
        },
      };
    },
    async load(name) {
      const { rows } = await pool.query(
        "SELECT last_success_at, state FROM scheduled_job_runs WHERE job_name = $1",
        [name],
      );
      if (!rows[0]) return null;
      return {
        lastSuccessAt: rows[0].last_success_at ? new Date(rows[0].last_success_at) : null,
        state: rows[0].state ?? {},
      };
    },
    async markStarted(name, now) {
      await pool.query(
        `INSERT INTO scheduled_job_runs (job_name, last_started_at, last_status, run_count)
         VALUES ($1, $2::timestamptz, 'running', 1)
         ON CONFLICT (job_name) DO UPDATE
           SET last_started_at = $2::timestamptz, last_status = 'running',
               run_count = scheduled_job_runs.run_count + 1`,
        [name, now],
      );
    },
    async markFinished(name, { ok, error, state, now }) {
      await pool.query(
        `UPDATE scheduled_job_runs
            SET last_status = $2::text,
                last_error = $3::text,
                last_success_at = CASE WHEN $2::text = 'ok' THEN $4::timestamptz ELSE last_success_at END,
                state = COALESCE($5::jsonb, state)
          WHERE job_name = $1`,
        [name, ok ? "ok" : "failed", error ?? null, now, state === undefined ? null : JSON.stringify(state)],
      );
    },
    async recordSkip(now) {
      const { rows } = await pool.query(
        `INSERT INTO scheduled_job_runs (job_name, skipped_count, last_skipped_at)
         VALUES ('_runner', 1, $1::timestamptz)
         ON CONFLICT (job_name) DO UPDATE
           SET skipped_count = scheduled_job_runs.skipped_count + 1, last_skipped_at = $1::timestamptz
         RETURNING skipped_count`,
        [now],
      );
      return Number(rows[0]?.skipped_count ?? 0);
    },
  };
}

// ── Entry point ─────────────────────────────────────────────────────────────────

/** Returns the process exit code. */
export async function main(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  let invocation: InvocationMode;
  try {
    invocation = parseInvocation(argv);
  } catch (err) {
    console.error(`[scheduled-jobs] ${errorMessage(err)}`);
    return 1;
  }
  const reportOnly = invocation === "dry-run";

  // Checked before anything that reads them: importing the database module throws without DATABASE_URL.
  const missing = findMissingSecrets(env, { reportOnly });
  if (missing.length > 0) {
    console.error(
      `[scheduled-jobs] FATAL: missing required secret(s): ${missing.join(", ")}. ` +
        "Add them to this Scheduled Deployment's own secrets (they are not inherited from the API server's list).",
    );
    return 1;
  }

  if (reportOnly) {
    console.log(
      `[scheduled-jobs] DRY RUN against database host ${databaseHost(env)}: report only — no lock, no ` +
        "bookkeeping writes, no reminders, no Stripe, no cleanup. Use `pnpm jobs:run:live` for a real run.",
    );
  } else if (invocation === "live") {
    console.error(liveWarning(env));
    await new Promise((resolve) => setTimeout(resolve, LIVE_WARNING_DELAY_MS));
  }

  const watchdog = setTimeout(() => {
    console.error(`[scheduled-jobs] FATAL: run exceeded ${RUN_TIMEOUT_MS / 1000}s; exiting so the advisory lock is released.`);
    process.exit(1);
  }, RUN_TIMEOUT_MS);

  try {
    const [{ pool }, { ensureScheduledJobRunsTable }, { registerRoutes }, { default: express }] = await Promise.all([
      import("@workspace/db"),
      import("../startup-migrations"),
      import("../routes/routes"),
      import("express"),
    ]);

    if (!reportOnly) await ensureScheduledJobRunsTable();

    let jobs: ScheduledJobRunners | undefined;
    registerRoutes(express(), { startBackgroundJobs: false, onScheduledJobs: (j) => (jobs = j) });
    if (!jobs) throw new Error("registerRoutes did not provide the scheduled job runners");

    const steps = buildSteps(
      jobs,
      env,
      async () => {
        const result = await pool.query("DELETE FROM rate_limit_store WHERE reset_time < NOW()");
        return result.rowCount ?? 0;
      },
      { reportOnly },
    );
    const store = reportOnly ? createMemoryJobStore() : createPgJobStore(pool as unknown as PgPoolLike);
    const report = await runScheduledJobs({ steps, store });
    return report.exitCode;
  } finally {
    clearTimeout(watchdog);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error("[scheduled-jobs] FATAL:", err);
      process.exit(1);
    },
  );
}
