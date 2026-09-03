-- Hybrid security-deposit selection. Safe to run on every API startup.
ALTER TABLE item_requests
  ADD COLUMN IF NOT EXISTS deposit_mode text,
  ADD COLUMN IF NOT EXISTS deposit_selection_state text,
  ADD COLUMN IF NOT EXISTS deposit_selection_reason text,
  ADD COLUMN IF NOT EXISTS deposit_required_protection_end timestamp,
  ADD COLUMN IF NOT EXISTS deposit_consent_at timestamp;