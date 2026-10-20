-- Why a claim's settlement_status is MANUAL_REVIEW: 'CAPTURE_FAILED' (a deposit capture failed or was
-- indeterminate; cleared again if a later capture succeeds) or 'HOLD_EXPIRED' (never auto-cleared).
-- Nullable, no backfill: existing flags keep a null reason and are therefore never auto-cleared.
-- Safe to re-run.
ALTER TABLE security_claims ADD COLUMN IF NOT EXISTS manual_review_reason text;
