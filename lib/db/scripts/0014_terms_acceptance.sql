-- When a person last accepted the Terms and Community Guidelines, and which version. Null = never (accounts from
-- before this, and new Google sign-ins, are asked on their next visit). Idempotent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version text;
