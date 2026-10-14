-- Stripe processing fees the platform absorbed by refunding cancelled and expired BORROW/RENT requests,
-- by month. Read-only; not a migration (it is not run at startup).
--
-- Card refunds only (a released hold moves no money and costs no fee), and only rows where Stripe's
-- balance transaction could be read (absorbed_fee_cents is NULL otherwise). Amounts are USD.
--
-- Revisit absorbing the fee when absorbed_fee_usd reaches 100 in a month, or 10% of that month's
-- platform-fee revenue, for two months running.
SELECT date_trunc('month', created_at) AS month,
       trigger,
       count(*)                          AS refunds,
       sum(amount_cents) / 100.0         AS refunded_usd,
       sum(absorbed_fee_cents) / 100.0   AS absorbed_fee_usd
FROM request_refunds
WHERE kind <> 'deposit_hold_release'
  AND absorbed_fee_cents IS NOT NULL
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
