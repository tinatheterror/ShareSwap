-- rental_payouts.hold_until was written when a rental's earnings were held (the request's end date, or 7 days out) and never
-- read by anything: earnings are released when the handoff is confirmed, not at a date. Dropped so it stops suggesting a
-- time-based hold. Idempotent.
ALTER TABLE rental_payouts DROP COLUMN IF EXISTS hold_until;
