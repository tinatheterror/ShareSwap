-- Alerts for the admin inbox (a new report, a blocked account deletion) waiting to be emailed. Emails are limited to one per
-- window per kind; every alert is queued here first, and the next email (or the summary at the end of the window) carries all
-- the unsent ones, so none is lost. payload holds ids and reasons only, never a name or address. Idempotent.
CREATE TABLE IF NOT EXISTS admin_alert_queue (
  id         serial PRIMARY KEY,
  kind       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  sent_at    timestamp
);
CREATE INDEX IF NOT EXISTS admin_alert_queue_unsent_idx ON admin_alert_queue (kind, id) WHERE sent_at IS NULL;
