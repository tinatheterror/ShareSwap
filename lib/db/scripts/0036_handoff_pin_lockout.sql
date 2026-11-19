-- item_requests.pin_locked_until: while it is in the future, handoff-code entry is locked (5 wrong tries lock it for 15 minutes).
-- Idempotent.
ALTER TABLE "item_requests" ADD COLUMN IF NOT EXISTS "pin_locked_until" timestamp with time zone;
