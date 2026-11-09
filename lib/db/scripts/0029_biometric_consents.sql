-- A member's explicit consent to ID and face data being collected for identity verification (Persona), with the version of the
-- text they agreed to. One row per member; agreeing to a newer version replaces it. Idempotent.
CREATE TABLE IF NOT EXISTS biometric_consents (
  id           serial PRIMARY KEY,
  user_id      integer NOT NULL CONSTRAINT biometric_consents_user_id_users_id_fk REFERENCES users(id),
  version      text NOT NULL,
  consented_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS biometric_consents_user_uidx ON biometric_consents (user_id);
