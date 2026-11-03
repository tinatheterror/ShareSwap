-- When a person was confirmed to have reached the age of majority, and the province or state it was judged by (for
-- example CA-ON, US-AL). Null = not yet confirmed (accounts from before this, and new Google sign-ins, are asked on their next
-- visit). The birth date is never stored. Idempotent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_confirmed_at timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_region text;
