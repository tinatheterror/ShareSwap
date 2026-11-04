-- Sign in with Apple. users.apple_id is Apple's stable `sub`; apple_links holds the encrypted refresh token used to
-- revoke the grant on deletion and the private-relay forwarding state; banned_apple_hashes blocks a banned person's
-- Apple ID after deletion (keyed hash, never the sub). Idempotent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id text;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_apple_id_unique UNIQUE (apple_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;
CREATE TABLE IF NOT EXISTS apple_links (
  user_id                  integer PRIMARY KEY CONSTRAINT apple_links_user_id_users_id_fk REFERENCES users(id),
  refresh_token_enc        text,
  email_forwarding_enabled boolean NOT NULL DEFAULT true,
  created_at               timestamp NOT NULL DEFAULT now(),
  updated_at               timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS banned_apple_hashes (
  id         serial PRIMARY KEY,
  sub_hash   text NOT NULL CONSTRAINT banned_apple_hashes_sub_hash_unique UNIQUE,
  created_at timestamp DEFAULT now()
);
