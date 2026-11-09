-- What a private upload is for, so each flow only accepts its own files: dispute_evidence, claim_evidence, return_dispute. Idempotent.
ALTER TABLE evidence_uploads ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'dispute_evidence';
