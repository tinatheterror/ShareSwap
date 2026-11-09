-- users.id_verified (added by 0027 and withdrawn): the "Verified" badge is users.is_verified (an approved ID AND a card on file),
-- so nothing reads or writes this column. Drops it where it exists. Idempotent.
ALTER TABLE users DROP COLUMN IF EXISTS id_verified;
