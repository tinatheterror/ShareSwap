-- A wishlist post a moderator hid. Unlike is_active, its owner cannot turn it back on. Idempotent.
ALTER TABLE wishlists ADD COLUMN IF NOT EXISTS hidden_at timestamp;
