-- Chargeback policy for launch: ShareSwap absorbs dispute losses and fees, owners are never charged automatically. Idempotent.
--   platform_disputes     one row per Stripe dispute, kept on the platform side (amount, fee, outcome, platform loss, who and what).
--   account_review_flags  a member's account flagged for an admin to look at after a dispute on their payment.
--   dispute_evidence      what the owner sent when asked for evidence on a dispute.
--   wallet_chargebacks    gains kind/reason/created_by so an admin can record a recovery debt for proven fraud or misconduct.
CREATE TABLE IF NOT EXISTS platform_disputes (
  id serial PRIMARY KEY,
  dispute_id text NOT NULL,
  payment_intent_id text,
  request_id integer,
  owner_id integer,
  borrower_id integer,
  reason text,
  amount_cents integer NOT NULL,
  currency text NOT NULL,
  fee_cents integer NOT NULL DEFAULT 0,
  outcome text NOT NULL DEFAULT 'open',
  returned_cents integer NOT NULL DEFAULT 0,
  loss_amount_cents integer NOT NULL DEFAULT 0,
  loss_fee_cents integer NOT NULL DEFAULT 0,
  rental_was_open boolean NOT NULL DEFAULT false,
  review_status text NOT NULL DEFAULT 'pending_admin',
  review_note text,
  reviewed_by integer,
  reviewed_at timestamp,
  evidence_due_by timestamp,
  evidence_requested_at timestamp,
  evidence_submitted_to_stripe_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  closed_at timestamp,
  CONSTRAINT platform_disputes_request_id_item_requests_id_fk FOREIGN KEY (request_id) REFERENCES item_requests(id),
  CONSTRAINT platform_disputes_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES users(id),
  CONSTRAINT platform_disputes_borrower_id_users_id_fk FOREIGN KEY (borrower_id) REFERENCES users(id),
  CONSTRAINT platform_disputes_reviewed_by_users_id_fk FOREIGN KEY (reviewed_by) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_disputes_dispute_id_uniq ON platform_disputes (dispute_id);
CREATE INDEX IF NOT EXISTS platform_disputes_request_idx ON platform_disputes (request_id, review_status);

CREATE TABLE IF NOT EXISTS account_review_flags (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  source text NOT NULL,
  dispute_id text NOT NULL,
  request_id integer,
  reason text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  resolved_at timestamp,
  resolved_by integer,
  CONSTRAINT account_review_flags_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT account_review_flags_request_id_item_requests_id_fk FOREIGN KEY (request_id) REFERENCES item_requests(id),
  CONSTRAINT account_review_flags_resolved_by_users_id_fk FOREIGN KEY (resolved_by) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS account_review_flags_user_dispute_uniq ON account_review_flags (user_id, dispute_id);

CREATE TABLE IF NOT EXISTS dispute_evidence (
  id serial PRIMARY KEY,
  dispute_id text NOT NULL,
  user_id integer NOT NULL,
  note text,
  photo_urls text[],
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT dispute_evidence_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS dispute_evidence_dispute_idx ON dispute_evidence (dispute_id);

ALTER TABLE wallet_chargebacks ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'dispute';
ALTER TABLE wallet_chargebacks ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE wallet_chargebacks ADD COLUMN IF NOT EXISTS created_by integer;
DO $$ BEGIN
  ALTER TABLE wallet_chargebacks ADD CONSTRAINT wallet_chargebacks_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
