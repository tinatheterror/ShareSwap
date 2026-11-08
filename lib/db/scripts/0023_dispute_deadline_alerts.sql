-- When admins were alerted that a dispute's Stripe evidence deadline, or its rental's deposit authorization, is within 48 hours.
-- One alert each, ever. Idempotent.
ALTER TABLE platform_disputes ADD COLUMN IF NOT EXISTS evidence_due_alert_sent_at timestamp;
ALTER TABLE platform_disputes ADD COLUMN IF NOT EXISTS auth_expiry_alert_sent_at timestamp;
