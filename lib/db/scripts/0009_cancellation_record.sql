-- BORROW/RENT cancellation and expiry record.
--
-- Until now a cancel only set status = CANCELLED: when, by whom, from which status, why, whether it
-- cost anyone trust points, and where the deposit stood were not stored anywhere. These columns are
-- written by the BORROW/RENT cancel route (and the requester's withdraw of a PENDING request); SWAP
-- and GIFT cancels do not write them yet.
--
--   cancelled_at            when the cancel was recorded (UTC, like the other timestamp columns)
--   cancelled_by            users.id of whoever cancelled (requester or owner)
--   cancelled_from_status   the status the request had under the cancel's row lock
--   cancel_reason           'user_requested' | 'changed_plans' | 'item_unavailable' | 'other' | 'withdrawn'
--   cancelled_with_penalty  true when the -5 rule applied (a deposit was placed). The points actually
--                           taken off are in reputation_activities; the score floor can make them less
--   cancel_deposit_state    'none' | 'in_person' | 'unpaid' | 'authorized' | 'charged', read from the
--                           deposit fields before they were released
--   expired_reason          why an EXPIRED request expired: 'no_handoff_no_deposit' or
--                           'no_handoff_deposit_paid' (data for a future no-show report)
--
-- request_refunds is a ledger of what was released or refunded on a cancel or expiry, including the
-- Stripe processing fee the platform absorbed (read from Stripe's balance transaction), so the cost of
-- refunding can be totalled by month.
--
-- Everything is nullable or new, with no defaults and no backfill: existing rows are untouched, and the
-- file is safe to re-run.
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS cancelled_at timestamp;
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS cancelled_by integer;
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS cancelled_from_status text;
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS cancelled_with_penalty boolean;
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS cancel_deposit_state text;
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS expired_reason text;

CREATE TABLE IF NOT EXISTS request_refunds (
  id                       serial PRIMARY KEY,
  request_id               integer NOT NULL,
  trigger                  text NOT NULL,
  kind                     text NOT NULL,
  stripe_payment_intent_id text,
  stripe_refund_id         text,
  amount_cents             bigint,
  currency                 text NOT NULL DEFAULT 'usd',
  charge_fee_cents         bigint,
  fee_returned_cents       bigint,
  absorbed_fee_cents       bigint,
  created_at               timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS request_refunds_refund_id_uidx ON request_refunds (stripe_refund_id) WHERE stripe_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS request_refunds_request_idx ON request_refunds (request_id);
CREATE INDEX IF NOT EXISTS request_refunds_created_idx ON request_refunds (created_at);
