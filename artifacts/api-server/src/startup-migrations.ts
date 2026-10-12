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
//   updated_by, note   required (non-blank) on a 'live' row, so a live switch always says who set it and why;
//                      off and dry-run rows may leave them empty. job-switches.ts checks the same rule on read.
export const JOB_SWITCHES_ATTRIBUTION_CONSTRAINT = "job_switches_live_needs_attribution";
export const JOB_SWITCHES_ATTRIBUTION_CHECK = `mode <> 'live' OR (coalesce(updated_by ~ '\\S', false) AND coalesce(note ~ '\\S', false))`;

export const JOB_SWITCHES_SQL = `
CREATE TABLE IF NOT EXISTS job_switches (
  job_name          TEXT        PRIMARY KEY,
  mode              TEXT        NOT NULL CHECK (mode IN ('live', 'dry-run', 'off')),
  max_cutoff_age_ms BIGINT      CHECK (max_cutoff_age_ms IS NULL OR max_cutoff_age_ms > 0),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        TEXT,
  note              TEXT,
  CONSTRAINT ${JOB_SWITCHES_ATTRIBUTION_CONSTRAINT} CHECK (${JOB_SWITCHES_ATTRIBUTION_CHECK})
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

export type AttributionConstraintResult = "present" | "added" | "added-not-valid";

/**
 * Adds the live-needs-attribution CHECK to a job_switches table created before it had one. Does nothing when
 * the constraint exists. If the table already has rows it is added NOT VALID: new and updated rows are checked,
 * existing ones are not scanned or rejected (readJobSwitch still refuses a live row without attribution).
 * `table` is a plain lower-case identifier; it is a parameter only so a test can use a scratch table.
 */
export async function ensureJobSwitchesAttributionConstraint(table = "job_switches"): Promise<AttributionConstraintResult> {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`Invalid table name: ${table}`);
  const existing = await pool.query(
    "SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass($1) AND conname = $2",
    [table, JOB_SWITCHES_ATTRIBUTION_CONSTRAINT],
  );
  if ((existing.rowCount ?? 0) > 0) return "present";
  const { rows } = await pool.query(`SELECT EXISTS (SELECT 1 FROM ${table}) AS has_rows`);
  const notValid = rows[0]?.has_rows === true;
  try {
    await pool.query(
      `ALTER TABLE ${table} ADD CONSTRAINT ${JOB_SWITCHES_ATTRIBUTION_CONSTRAINT} CHECK (${JOB_SWITCHES_ATTRIBUTION_CHECK})${notValid ? " NOT VALID" : ""}`,
    );
  } catch (err) {
    // Another process added it between the check and the ALTER: 42710 duplicate_object.
    if ((err as { code?: string }).code === "42710") return "present";
    throw err;
  }
  return notValid ? "added-not-valid" : "added";
}

async function runMigrationFile(relativePath: string) {
  const migrationPath = await findMigrationPath(relativePath);
  const migrationSql = await readFile(migrationPath, "utf8");
  await pool.query(migrationSql);
}

const CANCELLATION_RECORD_FILE = "lib/db/scripts/0009_cancellation_record.sql";
const CANCELLATION_RECORD_COLUMNS = [
  "cancelled_at",
  "cancelled_by",
  "cancelled_from_status",
  "cancel_reason",
  "cancelled_with_penalty",
  "cancel_deposit_state",
  "expired_reason",
];

/**
 * The cancellation record columns on item_requests and the request_refunds ledger (0009). Idempotent
 * (IF NOT EXISTS throughout) and cheap when there is nothing to do: ADD COLUMN IF NOT EXISTS still takes
 * a table lock, so the file only runs when a column or the ledger is actually missing. Also called by the
 * job script so expiring a request never depends on the API having restarted first.
 */
export async function ensureCancellationRecord() {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'item_requests' AND column_name = ANY($1)) AS columns,
            to_regclass('request_refunds') IS NOT NULL AS ledger`,
    [CANCELLATION_RECORD_COLUMNS],
  );
  if (rows[0]?.columns === CANCELLATION_RECORD_COLUMNS.length && rows[0]?.ledger === true) return;
  try {
    await runMigrationFile(CANCELLATION_RECORD_FILE);
  } catch (err) {
    // Two processes creating it at once: 42P07 duplicate_table, 42701 duplicate_column, 23505 on pg_type's unique index.
    const code = (err as { code?: string }).code;
    if (code !== "42P07" && code !== "42701" && code !== "23505") throw err;
  }
}

export async function applyStartupMigrations() {
  for (const relativePath of migrationRelativePaths) {
    await runMigrationFile(relativePath);
  }
  await ensureCancellationRecord();
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  await ensureJobSwitchesAttributionConstraint();
}