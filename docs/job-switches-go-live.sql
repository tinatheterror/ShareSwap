-- Going live with the handoff-deadlines and request-expiry jobs.
-- Run each numbered block on its own in the Production console. Blocks 1-4 only read.
-- Cutoffs use the platform zone America/Vancouver (PLATFORM_TIME_ZONE); change 'America/Vancouver' below if that env var is set.
-- item_requests timestamps are stored as UTC wall time without a zone, so "now" is compared as now() AT TIME ZONE 'UTC'.

-- ── 1. Every job switch ──────────────────────────────────────────────────────────
SELECT job_name, mode, max_cutoff_age_ms, updated_at, updated_by, note
FROM job_switches
ORDER BY job_name;

-- ── 2. handoff-deadlines: what the scheduled sweep would change right now ───────
-- Same selection as runHandoffDeadlineSweep: BORROW/RENT only, deadline passed within the last 3 days.
SELECT r.id AS request_id, r.request_type, i.name AS item, 'flag' AS transition,
       'AWAITING_HANDOFF_CONFIRM -> HANDOFF_FLAGGED (one party denied, other silent)' AS change,
       r.handoff_confirm_deadline AS deadline
FROM item_requests r
JOIN items i ON i.id = r.item_id
WHERE r.status = 'AWAITING_HANDOFF_CONFIRM'
  AND r.request_type IN ('BORROW', 'RENT')
  AND r.handoff_confirm_deadline < now() AT TIME ZONE 'UTC'
  AND r.handoff_confirm_deadline >= (now() AT TIME ZONE 'UTC') - interval '3 days'
  AND (COALESCE(r.owner_denied_handoff, false) OR COALESCE(r.borrower_denied_handoff, false))
  AND NOT COALESCE(r.owner_confirmed_handoff, false)
  AND NOT COALESCE(r.borrower_confirmed_handoff, false)
UNION ALL
SELECT r.id, r.request_type, i.name, 'auto_confirm',
       'AWAITING_HANDOFF_CONFIRM -> IN_PROGRESS (' ||
         CASE WHEN COALESCE(r.owner_confirmed_handoff, false) THEN 'owner' ELSE 'borrower' END ||
         ' confirmed, other silent); item set unavailable' ||
         CASE WHEN r.request_type = 'BORROW' THEN '; ShareCoins move borrower ' || r.requester_id || ' -> owner ' || i.owner_id ELSE '' END,
       r.handoff_confirm_deadline
FROM item_requests r
JOIN items i ON i.id = r.item_id
WHERE r.status = 'AWAITING_HANDOFF_CONFIRM'
  AND r.request_type IN ('BORROW', 'RENT')
  AND r.handoff_confirm_deadline < now() AT TIME ZONE 'UTC'
  AND r.handoff_confirm_deadline >= (now() AT TIME ZONE 'UTC') - interval '3 days'
  AND (COALESCE(r.owner_confirmed_handoff, false) OR COALESCE(r.borrower_confirmed_handoff, false))
  AND NOT COALESCE(r.owner_denied_handoff, false)
  AND NOT COALESCE(r.borrower_denied_handoff, false)
UNION ALL
SELECT r.id, r.request_type, i.name, 'deposit_timeout',
       'ACCEPTED -> CANCELLED (in-app deposit not paid within 48h); item set available',
       r.accepted_at + interval '48 hours'
FROM item_requests r
JOIN items i ON i.id = r.item_id
WHERE r.status = 'ACCEPTED'
  AND r.deposit_method = 'in_app'
  AND r.request_type IN ('RENT', 'BORROW')
  AND r.accepted_at < (now() AT TIME ZONE 'UTC') - interval '48 hours'
  AND r.accepted_at >= (now() AT TIME ZONE 'UTC') - interval '3 days' - interval '48 hours'
ORDER BY deadline;

-- ── 3. request-expiry: what the sweep would change right now ─────────────────────
-- Cutoff = the later of (end of the day before the last day) and (end of the start day), as computeHandoffCutoff.
-- "expire" rows are moved to EXPIRED (deposit hold released, up-front fees refunded, both people notified) once live;
-- "remind" rows get the 'hand off soon' reminder, which is sent in dry-run too unless reminders are switched off.
WITH days AS (
  SELECT r.id, r.request_type, r.status, r.expiry_reminder_sent_at, i.name AS item,
         COALESCE(r.counter_start_date, r.start_date)::date AS start_day,
         COALESCE(r.counter_end_date, r.end_date)::date AS end_day
  FROM item_requests r
  JOIN items i ON i.id = r.item_id
  WHERE r.status IN ('ACCEPTED', 'DEPOSIT_CONFIRMED')
    AND r.request_type IN ('BORROW', 'RENT')
    AND COALESCE(r.counter_start_date, r.start_date) IS NOT NULL
    AND COALESCE(r.counter_end_date, r.end_date) IS NOT NULL
), cut AS (
  SELECT d.*,
         GREATEST(
           GREATEST(d.end_day, d.start_day)::timestamp AT TIME ZONE 'America/Vancouver' - interval '1 millisecond',
           (d.start_day + 1)::timestamp AT TIME ZONE 'America/Vancouver' - interval '1 millisecond'
         ) AS cutoff
  FROM days d
)
SELECT id AS request_id, request_type, status, item, cutoff,
       CASE WHEN now() > cutoff THEN 'expire' ELSE 'remind' END AS action
FROM cut
WHERE (now() > cutoff AND cutoff >= now() - interval '3 days')
   OR (now() <= cutoff AND now() >= cutoff - interval '4 hours' AND expiry_reminder_sent_at IS NULL)
ORDER BY cutoff;

-- ── 4. What the web-polled endpoint does today (it ignores job_switches and is always live) ──
-- POST /api/requests/check-handoff-deadlines also covers SWAP and has no 3-day window; plus the both-silent timeout.
SELECT r.id AS request_id, r.request_type, i.name AS item, r.start_date, r.handoff_confirm_deadline
FROM item_requests r
JOIN items i ON i.id = r.item_id
WHERE r.status = 'AWAITING_HANDOFF_CONFIRM'
  AND NOT COALESCE(r.owner_confirmed_handoff, false)
  AND NOT COALESCE(r.borrower_confirmed_handoff, false)
  AND r.start_date < (now() AT TIME ZONE 'UTC') - interval '48 hours';  -- both silent: would be CANCELLED

-- ── 5. Set both to live (writes) ─────────────────────────────────────────────────
-- A live row must carry updated_by and note (table CHECK). An existing max_cutoff_age_ms is left alone.
INSERT INTO job_switches (job_name, mode, updated_by, note)
VALUES
  ('handoff-deadlines', 'live', 'Tina', 'Tina: going live after dry-run review'),
  ('request-expiry',    'live', 'Tina', 'Tina: going live after dry-run review')
ON CONFLICT (job_name) DO UPDATE
  SET mode = EXCLUDED.mode,
      updated_by = EXCLUDED.updated_by,
      note = EXCLUDED.note,
      updated_at = now()
RETURNING job_name, mode, updated_at, updated_by, note;

-- ── 6. Switch both back to dry-run (writes) ──────────────────────────────────────
INSERT INTO job_switches (job_name, mode, updated_by, note)
VALUES
  ('handoff-deadlines', 'dry-run', 'Tina', 'Tina: back to dry-run'),
  ('request-expiry',    'dry-run', 'Tina', 'Tina: back to dry-run')
ON CONFLICT (job_name) DO UPDATE
  SET mode = EXCLUDED.mode,
      updated_by = EXCLUDED.updated_by,
      note = EXCLUDED.note,
      updated_at = now()
RETURNING job_name, mode, updated_at, updated_by, note;
