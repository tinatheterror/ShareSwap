-- Deposit authorization renewal state.
-- Idempotent so it is safe on every API startup and in manual release tooling.
ALTER TABLE item_requests
  ADD COLUMN IF NOT EXISTS deposit_authorization_expires_at timestamp,
  ADD COLUMN IF NOT EXISTS deposit_renewal_status text,
  ADD COLUMN IF NOT EXISTS deposit_renewal_attempted_at timestamp,
  ADD COLUMN IF NOT EXISTS deposit_renewal_error text,
  ADD COLUMN IF NOT EXISTS deposit_renewal_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_previous_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS deposit_operation_token text,
  ADD COLUMN IF NOT EXISTS deposit_operation_type text,
  ADD COLUMN IF NOT EXISTS deposit_released_at timestamp;