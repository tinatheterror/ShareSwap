-- Dispute evidence photos are private: each upload is recorded with who made it, behind an unguessable token. Idempotent.
CREATE TABLE IF NOT EXISTS evidence_uploads (
  id serial PRIMARY KEY,
  token text,
  storage_key text,
  content_type text,
  user_id integer NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT evidence_uploads_token_unique UNIQUE (token)
);
