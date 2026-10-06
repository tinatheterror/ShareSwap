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

/** Idempotent; also called by the job script so it never depends on the API having restarted. */
export async function ensureScheduledJobRunsTable() {
  try {
    await pool.query(SCHEDULED_JOB_RUNS_SQL);
  } catch (err) {
    // Two processes creating it at once: 42P07 duplicate_table, or 23505 on pg_type's unique index.
    const code = (err as { code?: string }).code;
    if (code !== "42P07" && code !== "23505") throw err;
  }
}

export async function applyStartupMigrations() {
  for (const relativePath of migrationRelativePaths) {
    const migrationPath = await findMigrationPath(relativePath);
    const migrationSql = await readFile(migrationPath, "utf8");
    await pool.query(migrationSql);
  }
  await ensureScheduledJobRunsTable();
}