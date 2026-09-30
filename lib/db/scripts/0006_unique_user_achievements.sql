-- Existing duplicate badges may already have paid coins and sent notifications.
-- Do not discard that history to make the index creation succeed.
-- See docs/duplicate-badge-reconciliation.md for the reviewed, audited repair.
DO $$
DECLARE
  duplicate_keys text;
BEGIN
  SELECT string_agg(
    format('(user_id=%s, achievement_id=%s, count=%s)',
      user_id, achievement_id, duplicate_count),
    ', '
  )
  INTO duplicate_keys
  FROM (
    SELECT user_id, achievement_id, count(*) AS duplicate_count
    FROM user_achievements
    WHERE user_id IS NOT NULL AND achievement_id IS NOT NULL
    GROUP BY user_id, achievement_id
    HAVING count(*) > 1
    LIMIT 20
  ) duplicates;

  IF duplicate_keys IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot enforce unique badge awards; run badges:duplicates report and follow docs/duplicate-badge-reconciliation.md first: %',
      duplicate_keys;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS user_achievements_user_achievement_uidx
  ON user_achievements(user_id, achievement_id);