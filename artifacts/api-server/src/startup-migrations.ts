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
    // Two processes creating it at once: 42P07 duplicate_table, 23505 on pg_type's unique index, or 42710 duplicate_object
    // (the table's row type already exists).
    const code = (err as { code?: string }).code;
    if (code !== "42P07" && code !== "23505" && code !== "42710") throw err;
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

const PAYMENT_CURRENCY_FILE = "lib/db/scripts/0011_payment_currency.sql";

/**
 * item_requests.payment_currency (0011): the currency a request's Stripe objects are in. Every request query
 * selects it, so a missing column would fail them all; the file is idempotent and only runs when it is absent.
 */
export async function ensurePaymentCurrencyColumn() {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = current_schema() AND table_name = 'item_requests' AND column_name = 'payment_currency') AS present`,
  );
  if (rows[0]?.present === true) return;
  try {
    await runMigrationFile(PAYMENT_CURRENCY_FILE);
  } catch (err) {
    if ((err as { code?: string }).code !== "42701") throw err;
  }
}

const CONTENT_SAFEGUARDS_FILE = "lib/db/scripts/0012_content_safeguards.sql";

/**
 * Moderation columns and the blocks / reports / audit tables (0012). Item queries filter on
 * items.moderation_status, so a missing column would fail them all; the file is idempotent and only runs
 * when the column or one of the tables is absent.
 */
export async function ensureContentSafeguards() {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = current_schema() AND table_name = 'items' AND column_name = 'moderation_status') AS column_present,
            to_regclass('user_blocks') IS NOT NULL AND to_regclass('content_reports') IS NOT NULL
              AND to_regclass('moderation_actions') IS NOT NULL AS tables_present`,
  );
  if (rows[0]?.column_present === true && rows[0]?.tables_present === true) return;
  try {
    await runMigrationFile(CONTENT_SAFEGUARDS_FILE);
  } catch (err) {
    // Two processes running it at once: 42P07 duplicate_table, 42701 duplicate_column, 23505 on pg_type's unique index.
    const code = (err as { code?: string }).code;
    if (code !== "42P07" && code !== "42701" && code !== "23505") throw err;
  }
}

const WISHLIST_HIDDEN_AT_FILE = "lib/db/scripts/0013_wishlist_hidden_at.sql";

/** wishlists.hidden_at (0013): the wishlist feed filters on it, so a missing column would fail the feed. */
export async function ensureWishlistHiddenAt() {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = current_schema() AND table_name = 'wishlists' AND column_name = 'hidden_at') AS present`,
  );
  if (rows[0]?.present === true) return;
  try {
    await runMigrationFile(WISHLIST_HIDDEN_AT_FILE);
  } catch (err) {
    if ((err as { code?: string }).code !== "42701") throw err;
  }
}

const TERMS_ACCEPTANCE_FILE = "lib/db/scripts/0014_terms_acceptance.sql";

/** users.terms_acceptance columns (0014): every /api/user read selects them, so a missing column would fail them all. */
export async function ensureTermsAcceptanceColumns() {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'users' AND column_name IN ('terms_accepted_at', 'terms_version')) AS present`,
  );
  if (rows[0]?.present === 2) return;
  try {
    await runMigrationFile(TERMS_ACCEPTANCE_FILE);
  } catch (err) {
    if ((err as { code?: string }).code !== "42701") throw err;
  }
}

const AGE_CONFIRMATION_FILE = "lib/db/scripts/0016_age_confirmation.sql";

/** users.age_confirmed_at / age_region (0016): every /api/user read selects them, so a missing column would fail them all. */
export async function ensureAgeConfirmationColumns() {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'users' AND column_name IN ('age_confirmed_at', 'age_region')) AS present`,
  );
  if (rows[0]?.present === 2) return;
  try {
    await runMigrationFile(AGE_CONFIRMATION_FILE);
  } catch (err) {
    if ((err as { code?: string }).code !== "42701") throw err;
  }
}

const AI_CONSENTS_FILE = "lib/db/scripts/0015_ai_consents.sql";

/** ai_consents (0015): every AI feature reads it before sending anything to OpenAI, so a missing table would fail them all. */
export async function ensureAiConsentsTable() {
  const { rows } = await pool.query(`SELECT to_regclass('ai_consents') IS NOT NULL AS present`);
  if (rows[0]?.present === true) return;
  try {
    await runMigrationFile(AI_CONSENTS_FILE);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "42P07" && code !== "23505") throw err;
  }
}

const APPLE_SIGN_IN_FILE = "lib/db/scripts/0017_apple_sign_in.sql";

/** users.apple_id, apple_links and banned_apple_hashes (0017): the user reads select apple_id, so a missing column would fail them all. */
export async function ensureAppleSignInTables() {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'apple_id') AS col,
            to_regclass('apple_links') IS NOT NULL AS links,
            to_regclass('banned_apple_hashes') IS NOT NULL AS banned`,
  );
  if (rows[0]?.col === 1 && rows[0]?.links === true && rows[0]?.banned === true) return;
  try {
    await runMigrationFile(APPLE_SIGN_IN_FILE);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "42701" && code !== "42P07" && code !== "23505") throw err;
  }
}

const CLAIM_AWARD_CREDIT_FILE = "lib/db/scripts/0018_claim_award_wallet_credit.sql";

/** deposit_settlement_operations.wallet_credited_* (0018): the claim settlement writes them, so a missing column would fail every settlement. */
export async function ensureClaimAwardCreditColumns() {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'deposit_settlement_operations'
                AND column_name IN ('wallet_credited_amount', 'wallet_credited_at')) AS present`,
  );
  if (rows[0]?.present === 2) return;
  try {
    await runMigrationFile(CLAIM_AWARD_CREDIT_FILE);
  } catch (err) {
    if ((err as { code?: string }).code !== "42701") throw err;
  }
}

const WALLET_TRANSACTIONS_FILE = "lib/db/scripts/0019_wallet_transactions.sql";

/** wallet_transactions (0019): every wallet change writes a ledger row in its transaction, so a missing table would fail them all. */
export async function ensureWalletTransactionsTable() {
  const { rows } = await pool.query(`SELECT to_regclass('wallet_transactions') IS NOT NULL AS present`);
  if (rows[0]?.present === true) return;
  try {
    await runMigrationFile(WALLET_TRANSACTIONS_FILE);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "42P07" && code !== "23505" && code !== "42710") throw err;
  }
}

const DROP_HOLD_UNTIL_FILE = "lib/db/scripts/0020_drop_rental_payouts_hold_until.sql";

/** Drops rental_payouts.hold_until (0020), which nothing reads. Only runs while the column is still there. */
export async function ensureRentalPayoutHoldUntilDropped() {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = current_schema() AND table_name = 'rental_payouts' AND column_name = 'hold_until') AS present`,
  );
  if (rows[0]?.present !== true) return;
  await runMigrationFile(DROP_HOLD_UNTIL_FILE);
}

const WALLET_CHARGEBACKS_FILE = "lib/db/scripts/0021_wallet_chargebacks.sql";

/** wallet_chargebacks (0021): every wallet credit looks for debts to pay first, so a missing table would fail them all. */
export async function ensureWalletChargebacksTable() {
  const { rows } = await pool.query(`SELECT to_regclass('wallet_chargebacks') IS NOT NULL AS present`);
  if (rows[0]?.present === true) return;
  try {
    await runMigrationFile(WALLET_CHARGEBACKS_FILE);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "42P07" && code !== "23505" && code !== "42710") throw err;
  }
}

const PLATFORM_DISPUTES_FILE = "lib/db/scripts/0022_platform_disputes.sql";

/**
 * platform_disputes, account_review_flags, dispute_evidence and wallet_chargebacks.kind/reason/created_by (0022). The dispute webhook
 * and the deposit-release guard read platform_disputes, so a missing table would fail both. Runs while any of the objects is missing.
 */
export async function ensurePlatformDisputes() {
  const { rows } = await pool.query(
    `SELECT to_regclass('platform_disputes') IS NOT NULL AND to_regclass('account_review_flags') IS NOT NULL AND to_regclass('dispute_evidence') IS NOT NULL
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'wallet_chargebacks' AND column_name = 'created_by') AS present`,
  );
  if (rows[0]?.present === true) return;
  try {
    await runMigrationFile(PLATFORM_DISPUTES_FILE);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "42P07" && code !== "23505" && code !== "42710") throw err;
  }
}

const DISPUTE_ALERT_COLUMNS_FILE = "lib/db/scripts/0023_dispute_deadline_alerts.sql";

/** platform_disputes.evidence_due_alert_sent_at / auth_expiry_alert_sent_at (0023). The reminder sweep reads them, so they must exist. */
export async function ensureDisputeAlertColumns() {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'platform_disputes'
              AND column_name IN ('evidence_due_alert_sent_at', 'auth_expiry_alert_sent_at')) = 2 AS present`,
  );
  if (rows[0]?.present === true) return;
  await runMigrationFile(DISPUTE_ALERT_COLUMNS_FILE);
}

const DISPUTE_DEPOSIT_EXPIRY_FILE = "lib/db/scripts/0024_dispute_deposit_expiry.sql";

/** platform_disputes.urgent_manual_review / deposit_uncollectible_at / rental_completed_at / rental_completed_by (0024). The deposit expiry sweep writes them. */
export async function ensureDisputeDepositExpiryColumns() {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'platform_disputes'
              AND column_name IN ('urgent_manual_review', 'deposit_uncollectible_at', 'rental_completed_at', 'rental_completed_by')) = 4 AS present`,
  );
  if (rows[0]?.present === true) return;
  await runMigrationFile(DISPUTE_DEPOSIT_EXPIRY_FILE);
}

const EVIDENCE_UPLOADS_FILE = "lib/db/scripts/0025_evidence_uploads.sql";
const EVIDENCE_UPLOAD_PURPOSE_FILE = "lib/db/scripts/0026_evidence_upload_purpose.sql";

/** evidence_uploads (0025) and its purpose column (0026): the upload routes and the evidence validation read them. */
export async function ensureEvidenceUploadsTable() {
  const { rows } = await pool.query(`SELECT to_regclass('evidence_uploads') IS NOT NULL AS present`);
  if (rows[0]?.present !== true) {
    try {
      await runMigrationFile(EVIDENCE_UPLOADS_FILE);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "42P07" && code !== "23505" && code !== "42710") throw err;
    }
  }
  const purpose = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'evidence_uploads' AND column_name = 'purpose') AS present`,
  );
  if (purpose.rows[0]?.present !== true) await runMigrationFile(EVIDENCE_UPLOAD_PURPOSE_FILE);
}

const DROP_ID_VERIFIED_FILE = "lib/db/scripts/0028_drop_id_verified.sql";

/** Drops users.id_verified (0028) wherever the withdrawn migration 0027 had added it. Cheap no-op once the column is gone. */
export async function ensureIdVerifiedColumnDropped() {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'id_verified') AS present`,
  );
  if (rows[0]?.present !== true) return;
  await runMigrationFile(DROP_ID_VERIFIED_FILE);
}

const BIOMETRIC_CONSENTS_FILE = "lib/db/scripts/0029_biometric_consents.sql";

/** biometric_consents (0029): POST /api/persona/create-inquiry reads it, so a missing table would stop every verification. */
export async function ensureBiometricConsentsTable() {
  const { rows } = await pool.query(`SELECT to_regclass('biometric_consents') IS NOT NULL AS present`);
  if (rows[0]?.present === true) return;
  try {
    await runMigrationFile(BIOMETRIC_CONSENTS_FILE);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "42P07" && code !== "23505") throw err;
  }
}

export async function applyStartupMigrations() {
  for (const relativePath of migrationRelativePaths) {
    await runMigrationFile(relativePath);
  }
  await ensureCancellationRecord();
  await ensurePaymentCurrencyColumn();
  await ensureContentSafeguards();
  await ensureWishlistHiddenAt();
  await ensureTermsAcceptanceColumns();
  await ensureAiConsentsTable();
  await ensureAgeConfirmationColumns();
  await ensureAppleSignInTables();
  await ensureClaimAwardCreditColumns();
  await ensureWalletTransactionsTable();
  await ensureWalletChargebacksTable();
  await ensurePlatformDisputes();
  await ensureDisputeAlertColumns();
  await ensureDisputeDepositExpiryColumns();
  await ensureEvidenceUploadsTable();
  await ensureIdVerifiedColumnDropped();
  await ensureBiometricConsentsTable();
  await ensureRentalPayoutHoldUntilDropped();
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  await ensureJobSwitchesAttributionConstraint();
}