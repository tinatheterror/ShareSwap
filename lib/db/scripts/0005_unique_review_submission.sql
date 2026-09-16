-- Do not silently delete legacy duplicates: their reputation and reward effects
-- require a domain-aware repair. Fail startup with the affected keys instead.
DO $$
DECLARE
  duplicate_keys text;
BEGIN
  SELECT string_agg(
    format('(reviewer_id=%s, transaction_id=%s, count=%s)',
      reviewer_id, transaction_id, duplicate_count),
    ', '
  )
  INTO duplicate_keys
  FROM (
    SELECT reviewer_id, transaction_id, count(*) AS duplicate_count
    FROM user_reviews
    WHERE transaction_id IS NOT NULL
    GROUP BY reviewer_id, transaction_id
    HAVING count(*) > 1
    LIMIT 20
  ) duplicates;

  IF duplicate_keys IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot enforce unique review submissions; repair duplicate reviews first: %',
      duplicate_keys;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS user_reviews_reviewer_transaction_uidx
  ON user_reviews(reviewer_id, transaction_id);