-- Content safeguards (Apple guideline 1.2): moderator removal of listings, hidden reviews and messages,
-- blocks between users, reports, and an audit log of moderator actions. Idempotent. The foreign keys carry the names Drizzle
-- gives them, so a later schema sync finds nothing to change.
ALTER TABLE items ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'visible';
ALTER TABLE items ADD COLUMN IF NOT EXISTS moderation_note text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS moderated_at timestamp;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS hidden_at timestamp;
ALTER TABLE user_reviews ADD COLUMN IF NOT EXISTS hidden_at timestamp;

CREATE TABLE IF NOT EXISTS user_blocks (
  id         serial PRIMARY KEY,
  blocker_id integer NOT NULL CONSTRAINT user_blocks_blocker_id_users_id_fk REFERENCES users(id),
  blocked_id integer NOT NULL CONSTRAINT user_blocks_blocked_id_users_id_fk REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_blocks_pair_uidx ON user_blocks (blocker_id, blocked_id);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON user_blocks (blocked_id);

CREATE TABLE IF NOT EXISTS content_reports (
  id              serial PRIMARY KEY,
  reporter_id     integer CONSTRAINT content_reports_reporter_id_users_id_fk REFERENCES users(id),
  target_type     text NOT NULL,
  target_id       integer NOT NULL,
  target_user_id  integer CONSTRAINT content_reports_target_user_id_users_id_fk REFERENCES users(id),
  reason          text NOT NULL,
  details         text,
  snapshot        jsonb,
  status          text NOT NULL DEFAULT 'open',
  resolved_by     integer CONSTRAINT content_reports_resolved_by_users_id_fk REFERENCES users(id),
  resolved_at     timestamp,
  resolution_note text,
  created_at      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_reports_status_created_idx ON content_reports (status, created_at);
CREATE INDEX IF NOT EXISTS content_reports_target_user_idx ON content_reports (target_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS content_reports_open_uidx ON content_reports (reporter_id, target_type, target_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS moderation_actions (
  id          serial PRIMARY KEY,
  admin_id    integer CONSTRAINT moderation_actions_admin_id_users_id_fk REFERENCES users(id),
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   integer NOT NULL,
  report_id   integer CONSTRAINT moderation_actions_report_id_content_reports_id_fk REFERENCES content_reports(id),
  note        text,
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS moderation_actions_target_idx ON moderation_actions (target_type, target_id);
