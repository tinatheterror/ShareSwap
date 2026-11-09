-- Persona inquiries to redact when an account is deleted: one row per inquiry, so the step can be retried until Persona confirms. Idempotent.
CREATE TABLE IF NOT EXISTS persona_redactions (
  id              serial PRIMARY KEY,
  user_id         integer NOT NULL CONSTRAINT persona_redactions_user_id_users_id_fk REFERENCES users(id),
  inquiry_id      text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  created_at      timestamp NOT NULL DEFAULT now(),
  last_attempt_at timestamp,
  redacted_at     timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS persona_redactions_inquiry_uidx ON persona_redactions (inquiry_id);
