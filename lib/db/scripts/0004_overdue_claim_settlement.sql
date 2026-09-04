-- Overdue tracking and claims are separate from transaction/deposit status.
ALTER TABLE item_requests
  ADD COLUMN IF NOT EXISTS overdue_stage text DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS overdue_stage_changed_at timestamp,
  ADD COLUMN IF NOT EXISTS return_deadline_at timestamp,
  ADD COLUMN IF NOT EXISTS claim_decision_deadline_at timestamp;
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS settlement_start_deadline_at timestamp;
ALTER TABLE extension_requests
  ADD COLUMN IF NOT EXISTS previous_end_date timestamp,
  ADD COLUMN IF NOT EXISTS approved_end_date timestamp,
  ADD COLUMN IF NOT EXISTS approved_by integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS deposit_protection_review_required boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS request_lifecycle_events (
 id serial PRIMARY KEY, request_id integer NOT NULL REFERENCES item_requests(id),
 event_type text NOT NULL, actor_id integer REFERENCES users(id), idempotency_key text NOT NULL UNIQUE,
 details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS request_lifecycle_events_request_created_idx ON request_lifecycle_events(request_id, created_at);
CREATE TABLE IF NOT EXISTS security_claims (
 id serial PRIMARY KEY, request_id integer NOT NULL REFERENCES item_requests(id),
 owner_id integer NOT NULL REFERENCES users(id), borrower_id integer NOT NULL REFERENCES users(id),
 claim_type text NOT NULL, status text NOT NULL DEFAULT 'OPEN', reason text NOT NULL,
 evidence jsonb NOT NULL DEFAULT '[]'::jsonb, borrower_response text, borrower_responded_at timestamp,
 borrower_notified_at timestamp, response_deadline_at timestamp,
 requested_amount numeric(10,2) NOT NULL, approved_amount numeric(10,2), decision_reason text,
 decided_by integer REFERENCES users(id), decided_at timestamp, deposit_payment_intent_id text,
 settlement_status text NOT NULL DEFAULT 'PENDING', created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS security_claims_request_idx ON security_claims(request_id);
CREATE INDEX IF NOT EXISTS security_claims_status_idx ON security_claims(status);
-- PostgreSQL partial uniqueness is the final backstop in addition to route
-- row locks: a transaction may have at most one unresolved claim.
CREATE UNIQUE INDEX IF NOT EXISTS security_claims_one_active_per_request
  ON security_claims(request_id)
  WHERE status IN ('OPEN','CUSTOMER_RESPONSE_PENDING','UNDER_REVIEW','APPROVED','PROCESSING');
CREATE TABLE IF NOT EXISTS deposit_settlement_operations (
 id serial PRIMARY KEY, claim_id integer REFERENCES security_claims(id),
 request_id integer NOT NULL REFERENCES item_requests(id), operation_key text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'PENDING', approved_amount numeric(10,2) NOT NULL,
 retained_amount numeric(10,2) NOT NULL DEFAULT 0, released_amount numeric(10,2) NOT NULL DEFAULT 0,
 stripe_payment_intent_id text, stripe_refund_id text, error text, created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz);
CREATE INDEX IF NOT EXISTS deposit_settlement_operations_request_idx ON deposit_settlement_operations(request_id);
ALTER TABLE deposit_settlement_operations ADD COLUMN IF NOT EXISTS stripe_capture_id text;