-- users.id_verified: the member has an approved ID verification, with or without a card. It drives the "ID verified" badge;
-- users.is_verified (ID and card) keeps gating borrowing and renting. Idempotent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_verified boolean NOT NULL DEFAULT false;
UPDATE users SET id_verified = true
WHERE id_verified = false AND EXISTS (SELECT 1 FROM verifications v WHERE v.user_id = users.id AND v.status = 'approved');
