-- The wallet ledger: one signed row for every change to users.rental_balance (the wallet). users.rental_balance stays the
-- cached total; a row is written in the same transaction that changes it. idempotency_key is unique so a retry, a reconcile
-- pass or the backfill cannot record the same event twice. amount_cents is signed (+ credit, - debit) in `currency`.
--   kind: rental_payout | claim_award | withdrawal | withdrawal_reversal
-- Idempotent.
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  kind text NOT NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'cad',
  request_id integer,
  claim_id integer,
  rental_payout_id integer,
  idempotency_key text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT wallet_transactions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT wallet_transactions_request_id_item_requests_id_fk FOREIGN KEY (request_id) REFERENCES item_requests(id),
  CONSTRAINT wallet_transactions_claim_id_security_claims_id_fk FOREIGN KEY (claim_id) REFERENCES security_claims(id),
  CONSTRAINT wallet_transactions_rental_payout_id_rental_payouts_id_fk FOREIGN KEY (rental_payout_id) REFERENCES rental_payouts(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_idempotency_key_uniq ON wallet_transactions (idempotency_key);
CREATE INDEX IF NOT EXISTS wallet_transactions_user_idx ON wallet_transactions (user_id, created_at);
