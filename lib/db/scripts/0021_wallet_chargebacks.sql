-- One row per Stripe dispute (chargeback) charged to a member's wallet. collected_cents is what has been taken back so far,
-- from the wallet balance when the dispute opened and from later credits (see payDebtsFromCredit); what is still owed is
-- principal_cents + fee_cents - collected_cents while status is 'open' (undecided) or 'lost'. A dispute we win ('won') has
-- its collected amount returned to the wallet and owes nothing. Idempotent.
CREATE TABLE IF NOT EXISTS wallet_chargebacks (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  dispute_id text NOT NULL,
  payment_intent_id text,
  request_id integer,
  currency text NOT NULL,
  principal_cents integer NOT NULL,
  fee_cents integer NOT NULL DEFAULT 0,
  collected_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  created_at timestamp NOT NULL DEFAULT now(),
  closed_at timestamp,
  CONSTRAINT wallet_chargebacks_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT wallet_chargebacks_request_id_item_requests_id_fk FOREIGN KEY (request_id) REFERENCES item_requests(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_chargebacks_dispute_id_uniq ON wallet_chargebacks (dispute_id);
CREATE INDEX IF NOT EXISTS wallet_chargebacks_user_idx ON wallet_chargebacks (user_id, status);
