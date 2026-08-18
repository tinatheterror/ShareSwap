-- Repair script: bring DB into sync with schema.ts
-- Run: psql $DATABASE_URL -f lib/db/scripts/0001_schema_sync_cleanup.sql
--
-- This is a one-time repair script (not a drizzle-kit migration file).
-- drizzle-kit push does not read or apply SQL files in this directory.
-- After running this script, `pnpm --filter @workspace/db run push` should
-- complete with "[i] No changes detected" or "[✓] Changes applied" and no
-- interactive prompts.
--
-- Idempotent: every statement is guarded by a catalog check or IF EXISTS so
-- the script is a true no-op when run on a database that is already in sync.

-- -------------------------------------------------------------------------
-- 1. Add missing unique constraints (catalog-checked, true no-op on rerun).
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'users'
      AND constraint_name = 'users_referral_code_unique'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_referral_code_unique UNIQUE (referral_code);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'achievements'
      AND constraint_name = 'achievements_name_unique'
  ) THEN
    ALTER TABLE achievements ADD CONSTRAINT achievements_name_unique UNIQUE (name);
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 2. Drop the session table (removed from schema).
-- -------------------------------------------------------------------------
DROP TABLE IF EXISTS session;

-- -------------------------------------------------------------------------
-- 3. Drop orphaned columns from users.
-- -------------------------------------------------------------------------
ALTER TABLE users DROP COLUMN IF EXISTS follower_count;
ALTER TABLE users DROP COLUMN IF EXISTS following_count;

-- -------------------------------------------------------------------------
-- 4. Drop orphaned columns from item_requests (courier/handoff fields
--    removed after the delivery-arrangement refactor).
-- -------------------------------------------------------------------------
ALTER TABLE item_requests DROP COLUMN IF EXISTS courier_booked_by;
ALTER TABLE item_requests DROP COLUMN IF EXISTS courier_issue;
ALTER TABLE item_requests DROP COLUMN IF EXISTS courier_issue_note;
ALTER TABLE item_requests DROP COLUMN IF EXISTS courier_address;
ALTER TABLE item_requests DROP COLUMN IF EXISTS courier_pickup_window;
ALTER TABLE item_requests DROP COLUMN IF EXISTS courier_tracking_id;
ALTER TABLE item_requests DROP COLUMN IF EXISTS courier_status;
ALTER TABLE item_requests DROP COLUMN IF EXISTS handoff_confirmed_by;
ALTER TABLE item_requests DROP COLUMN IF EXISTS courier_booking_id;
ALTER TABLE item_requests DROP COLUMN IF EXISTS courier_booked_at;
ALTER TABLE item_requests DROP COLUMN IF EXISTS handoff_auto_confirmed_by;
ALTER TABLE item_requests DROP COLUMN IF EXISTS handoff_deadline_extended;
ALTER TABLE item_requests DROP COLUMN IF EXISTS handoff_flagged_for_review;
ALTER TABLE item_requests DROP COLUMN IF EXISTS handoff_disputed_by;
ALTER TABLE item_requests DROP COLUMN IF EXISTS early_handoff_requested_by_owner;
ALTER TABLE item_requests DROP COLUMN IF EXISTS early_handoff_requested_by_renter;
ALTER TABLE item_requests DROP COLUMN IF EXISTS early_handoff_approved_at;

-- -------------------------------------------------------------------------
-- 5. Drop orphaned column from items (replaced by is_gift).
-- -------------------------------------------------------------------------
ALTER TABLE items DROP COLUMN IF EXISTS is_giftable;

-- -------------------------------------------------------------------------
-- 6. Drop orphaned columns from verifications.
-- -------------------------------------------------------------------------
ALTER TABLE verifications DROP COLUMN IF EXISTS verified_at;
ALTER TABLE verifications DROP COLUMN IF EXISTS failure_reason;

-- -------------------------------------------------------------------------
-- 7. Drop orphaned columns from wishlists.
-- -------------------------------------------------------------------------
ALTER TABLE wishlists DROP COLUMN IF EXISTS is_expired;
ALTER TABLE wishlists DROP COLUMN IF EXISTS expiration_reason;

-- -------------------------------------------------------------------------
-- 8. Drop orphaned columns from rental_returns.
-- -------------------------------------------------------------------------
ALTER TABLE rental_returns DROP COLUMN IF EXISTS return_condition;
ALTER TABLE rental_returns DROP COLUMN IF EXISTS condition_photos;
ALTER TABLE rental_returns DROP COLUMN IF EXISTS lender_confirmed;
ALTER TABLE rental_returns DROP COLUMN IF EXISTS dispute_reason;
ALTER TABLE rental_returns DROP COLUMN IF EXISTS dispute_resolved;
ALTER TABLE rental_returns DROP COLUMN IF EXISTS created_at;

-- -------------------------------------------------------------------------
-- 9. Fix column type mismatches.
--    Each conversion checks information_schema.columns before altering so
--    it is a true no-op when the column is already the target type.
--    pin_expires_at is guarded to only convert from 'timestamp without time
--    zone'; it is never run when the column is already timestamptz, avoiding
--    the session-timezone re-interpretation hazard on reruns.
-- -------------------------------------------------------------------------

-- trust_deposit_amount: character varying → numeric(10,2)
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'item_requests'
    AND column_name  = 'trust_deposit_amount';

  IF col_type = 'character varying' THEN
    ALTER TABLE item_requests
      ALTER COLUMN trust_deposit_amount
      SET DATA TYPE numeric(10,2)
      USING trust_deposit_amount::numeric(10,2);
  END IF;
END $$;

-- deposit_payment_intent_id: character varying → text
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'item_requests'
    AND column_name  = 'deposit_payment_intent_id';

  IF col_type = 'character varying' THEN
    ALTER TABLE item_requests
      ALTER COLUMN deposit_payment_intent_id
      SET DATA TYPE text
      USING deposit_payment_intent_id::text;
  END IF;
END $$;

-- deposit_status: character varying → text
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'item_requests'
    AND column_name  = 'deposit_status';

  IF col_type = 'character varying' THEN
    ALTER TABLE item_requests
      ALTER COLUMN deposit_status
      SET DATA TYPE text
      USING deposit_status::text;
  END IF;
END $$;

-- pin_expires_at: timestamp without time zone → timestamp with time zone
-- Guard: only convert from 'timestamp without time zone'. When the column is
-- already 'timestamp with time zone' the block is a no-op. The AT TIME ZONE
-- 'UTC' clause is only valid when the source is naive; this guard ensures we
-- never double-convert or shift already-correct timestamptz values.
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'item_requests'
    AND column_name  = 'pin_expires_at';

  IF col_type = 'timestamp without time zone' THEN
    ALTER TABLE item_requests
      ALTER COLUMN pin_expires_at
      SET DATA TYPE timestamp with time zone
      USING pin_expires_at AT TIME ZONE 'UTC';
  END IF;
END $$;
