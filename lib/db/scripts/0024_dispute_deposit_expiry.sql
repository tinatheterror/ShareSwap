-- A deposit authorization ran out while a card dispute was unreviewed. Idempotent.
--   urgent_manual_review         the case needs a person now: the deposit can no longer be collected through the original authorization.
--   deposit_uncollectible_at     when that was recorded.
--   rental_completed_by / _at    an admin closed the rental operationally; the dispute itself stays open. No money moves.
ALTER TABLE platform_disputes ADD COLUMN IF NOT EXISTS urgent_manual_review boolean NOT NULL DEFAULT false;
ALTER TABLE platform_disputes ADD COLUMN IF NOT EXISTS deposit_uncollectible_at timestamp;
ALTER TABLE platform_disputes ADD COLUMN IF NOT EXISTS rental_completed_at timestamp;
ALTER TABLE platform_disputes ADD COLUMN IF NOT EXISTS rental_completed_by integer REFERENCES users(id);
