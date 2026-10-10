import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@workspace/db";

const migrationRelativePaths = [
  "lib/db/scripts/0002_deposit_renewal_columns.sql",
  "lib/db/scripts/0003_hybrid_security_deposit.sql",
  "lib/db/scripts/0004_overdue_claim_settlement.sql",
  "lib/db/scripts/0005_unique_review_submission.sql",
  "lib/db/scripts/0006_unique_user_achievements.sql",
  "lib/db/scripts/0007_deposit_capture_columns.sql",
];

async function findMigrationPath(migrationRelativePath: string) {
  const candidates = [
    path.resolve(process.cwd(), migrationRelativePath),
    path.resolve(process.cwd(), "../..", migrationRelativePath),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known workspace/package working directory.
    }
  }
  throw new Error(`Required startup migration not found: ${migrationRelativePath}`);
}

// Bookkeeping for scripts/run-scheduled-jobs.ts: when each job last ran (so slow jobs
// can be gated inside a once-a-minute cron), how many runs were skipped because the
// advisory lock was held, and small per-job state such as already-reported dry-run lines.
export const SCHEDULED_JOB_RUNS_SQL = `
CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  job_name         TEXT        PRIMARY KEY,
  last_started_at  TIMESTAMPTZ,
  last_success_at  TIMESTAMPTZ,
  last_status      TEXT,
  last_error       TEXT,
  run_count        BIGINT      NOT NULL DEFAULT 0,
  skipped_count    BIGINT      NOT NULL DEFAULT 0,
  last_skipped_at  TIMESTAMPTZ,
  state            JSONB       NOT NULL DEFAULT '{}'::jsonb
)`;

// Kill switches (see job-switches.ts): config only. A job with no row has no switch and uses its
// environment default, so nothing is seeded. last-run bookkeeping stays in scheduled_job_runs.
//   mode               'live' | 'dry-run' | 'off'
//   max_cutoff_age_ms  optional; used by the request-expiry-on-read job only
export const JOB_SWITCHES_SQL = `
CREATE TABLE IF NOT EXISTS job_switches (
  job_name          TEXT        PRIMARY KEY,
  mode              TEXT        NOT NULL CHECK (mode IN ('live', 'dry-run', 'off')),
  max_cutoff_age_ms BIGINT      CHECK (max_cutoff_age_ms IS NULL OR max_cutoff_age_ms > 0),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        TEXT,
  note              TEXT
)`;

/** Runs one idempotent CREATE TABLE IF NOT EXISTS, tolerating the race between two processes doing it at once. */
export async function createTableIfMissing(sql: string) {
  try {
    await pool.query(sql);
  } catch (err) {
    // Two processes creating it at once: 42P07 duplicate_table, or 23505 on pg_type's unique index.
    const code = (err as { code?: string }).code;
    if (code !== "42P07" && code !== "23505") throw err;
  }
}

/** Idempotent; also called by the job script so it never depends on the API having restarted. */
export async function ensureScheduledJobRunsTable() {
  await createTableIfMissing(SCHEDULED_JOB_RUNS_SQL);
}

/** Idempotent and safe to run from several processes at once, like ensureScheduledJobRunsTable. */
export async function ensureJobSwitchesTable() {
  await createTableIfMissing(JOB_SWITCHES_SQL);
}

export async function applyStartupMigrations() {
  for (const relativePath of migrationRelativePaths) {
    const migrationPath = await findMigrationPath(relativePath);
    const migrationSql = await readFile(migrationPath, "utf8");
    await pool.query(migrationSql);
  }
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
}