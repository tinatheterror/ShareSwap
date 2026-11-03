-- Consent to send a kind of content to OpenAI, per person and AI feature. Idempotent.
CREATE TABLE IF NOT EXISTS ai_consents (
  id           serial PRIMARY KEY,
  user_id      integer NOT NULL CONSTRAINT ai_consents_user_id_users_id_fk REFERENCES users(id),
  feature      text NOT NULL,
  version      text NOT NULL,
  consented_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_consents_user_feature_uidx ON ai_consents (user_id, feature);
