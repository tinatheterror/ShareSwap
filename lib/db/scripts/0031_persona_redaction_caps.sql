-- A Persona redaction that keeps failing is marked 'failed' after a cap (attempts or age) and admins are told once. Idempotent.
ALTER TABLE persona_redactions ADD COLUMN IF NOT EXISTS failed_at timestamp;
ALTER TABLE persona_redactions ADD COLUMN IF NOT EXISTS admin_notified_at timestamp;
