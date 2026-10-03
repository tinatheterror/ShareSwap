-- A claim now captures the full deposit when it is opened; resolution refunds
-- (captured - retained). Record what was charged, to which card, and the outcome.
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS deposit_captured_amount numeric(10, 2);
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS deposit_captured_at timestamp;
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS deposit_card_brand text;
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS deposit_card_last4 text;
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS deposit_refunded_amount numeric(10, 2);
ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS deposit_retained_amount numeric(10, 2);
