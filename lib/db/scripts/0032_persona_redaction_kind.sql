-- What a persona_redactions row is: an 'inquiry' to redact, an 'account_lookup' (find the member's Persona accounts by reference id user_<id>) or an 'account' to redact. Idempotent.
ALTER TABLE persona_redactions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'inquiry';
