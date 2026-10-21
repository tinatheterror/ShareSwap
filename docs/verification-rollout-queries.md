# Verification levels: production queries

Read the rule in `artifacts/api-server/src/verification.ts`. A **verified account** is `email_verified = true`
or `phone_verified = true`. Before the verification-levels commits, any account with a `google_id` or
`auth_provider = 'google'` also counted. None of these statements has been run against any database.

## Schema changes

None. The verification-levels commits (`54510bc2` onward) do not touch `lib/db`; they only read existing
columns (`users.email_verified`, `users.phone_verified`, `users.google_id`, `users.auth_provider`,
`users.stripe_payment_method_id`, `verifications.status`, `item_requests.*`). There is no SQL to run in the
Development database before Republishing.

## 1. Verified under the old rule, not under the new one (read-only)

Counts by reason. Every row here was counted as verified only because of its Google link.

```sql
SELECT
  CASE
    WHEN google_id IS NOT NULL AND auth_provider = 'google' THEN 'google_id and auth_provider = google'
    WHEN google_id IS NOT NULL THEN 'google_id only'
    ELSE 'auth_provider = google only'
  END AS reason,
  count(*) AS users
FROM users
WHERE (COALESCE(email_verified, false) = true OR google_id IS NOT NULL OR auth_provider = 'google')
  AND NOT (COALESCE(email_verified, false) = true OR COALESCE(phone_verified, false) = true)
GROUP BY 1
ORDER BY users DESC;
```

To list them instead of counting (email shown so you can judge whether Google really vouched for it):

```sql
SELECT id, username, email, auth_provider, google_id IS NOT NULL AS has_google_id, created_at
FROM users
WHERE (COALESCE(email_verified, false) = true OR google_id IS NOT NULL OR auth_provider = 'google')
  AND NOT (COALESCE(email_verified, false) = true OR COALESCE(phone_verified, false) = true)
ORDER BY created_at DESC;
```

## 2. Backfill: mark existing Google accounts email-verified

Existing Google accounts were never checked for Google's `email_verified` claim, so this trusts that Google
accounts have real emails. A Google user who signs in again is fixed automatically; this covers everyone
else. Run the count first and check it against query 1.

```sql
-- Affected rows (read-only). Run this first.
SELECT count(*) AS rows_to_update
FROM users
WHERE (google_id IS NOT NULL OR auth_provider = 'google')
  AND COALESCE(email_verified, false) = false
  AND email IS NOT NULL;

-- The backfill. Run only after the count looks right.
UPDATE users
SET email_verified = true
WHERE (google_id IS NOT NULL OR auth_provider = 'google')
  AND COALESCE(email_verified, false) = false
  AND email IS NOT NULL;
```

Google accounts with no email on file are left alone: they have no address to verify, and
`/api/auth/resend-verification` now answers "No email address on file to verify" for them.

## 3. Users with the most open gift claims (read-only, for an admin)

Open means `PENDING` or `ACCEPTED`. Run it in the admin database console; there is no endpoint for it.

```sql
SELECT u.id, u.username, u.email, count(*) AS open_gift_claims
FROM item_requests r
JOIN users u ON u.id = r.requester_id
WHERE r.request_type = 'GIFT'
  AND r.status IN ('PENDING', 'ACCEPTED')
GROUP BY u.id, u.username, u.email
ORDER BY open_gift_claims DESC, u.id
LIMIT 25;
```
