-- Request expiry: a BORROW/RENT request that nobody handed off before its
-- late-handoff cutoff ends as EXPIRED, a terminal status distinct from
-- CANCELLED and DECLINED. The status column is free text (no enum or CHECK
-- constraint), so only the two timestamps below are new.
--
--   expired_at              when the request actually moved to EXPIRED (history, stats,
--                           and the 7-day chat auto-archive clock). Not the cutoff itself,
--                           which is always derived from the agreed dates.
--   expiry_reminder_sent_at set once the "hand off soon" reminder went out, so the
--                           reminder is sent at most once per request.
--
-- Both are nullable with no default: existing rows are untouched and no
-- backfill is needed. Safe to re-run.
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS expired_at timestamp;
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at timestamp;
