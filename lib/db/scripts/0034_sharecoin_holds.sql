-- ShareCoins reserved for accepted borrows and swaps (Phase 2 of docs/sharecoin-funds-design.md). Accepting reserves what the
-- payer will owe; the payer's spendable balance is their balance minus their ACTIVE holds; the handoff SETTLES a hold and every
-- other way a request ends RELEASES it. A hold is only a reservation on its request, so deleting a request deletes it. kind is BORROW or SWAP only (rentals are money, borrow deposits are card holds).
-- Idempotent.
CREATE TABLE IF NOT EXISTS sharecoin_holds (
  id          serial PRIMARY KEY,
  request_id  integer NOT NULL CONSTRAINT sharecoin_holds_request_id_item_requests_id_fk REFERENCES item_requests(id) ON DELETE CASCADE,
  payer_id    integer NOT NULL CONSTRAINT sharecoin_holds_payer_id_users_id_fk REFERENCES users(id),
  receiver_id integer NOT NULL CONSTRAINT sharecoin_holds_receiver_id_users_id_fk REFERENCES users(id),
  kind        text NOT NULL,
  amount      integer NOT NULL,
  status      text NOT NULL DEFAULT 'ACTIVE',
  reason      text,
  created_at  timestamp NOT NULL DEFAULT now(),
  resolved_at timestamp,
  CONSTRAINT sharecoin_holds_kind_check CHECK (kind IN ('BORROW', 'SWAP')),
  CONSTRAINT sharecoin_holds_status_check CHECK (status IN ('ACTIVE', 'SETTLED', 'RELEASED')),
  CONSTRAINT sharecoin_holds_amount_check CHECK (amount > 0),
  CONSTRAINT sharecoin_holds_reason_check CHECK ((status = 'ACTIVE' AND reason IS NULL) OR (status = 'SETTLED' AND reason IN ('handoff_manual', 'handoff_pin', 'handoff_auto', 'dispute_settled')) OR (status = 'RELEASED' AND reason IN ('cancelled', 'expired', 'deposit_timeout', 'account_deleted', 'dispute_released', 'flag_rejected', 'request_ended', 'migration')))
);
CREATE UNIQUE INDEX IF NOT EXISTS sharecoin_holds_active_request_uidx ON sharecoin_holds (request_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS sharecoin_holds_payer_active_idx ON sharecoin_holds (payer_id) WHERE status = 'ACTIVE';

-- (Existing accepted borrows and swaps that owe coins but have no hold are cancelled by ensureShareCoinHoldsTable in
-- startup-migrations.ts, once, when this table is first created; it needs the application's quote arithmetic. Test data only.)
