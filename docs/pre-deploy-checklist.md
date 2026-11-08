# Pre-deploy checklist: chargeback policy, recovery debts, dispute alerts

For the release that contains migrations 0022 and 0023. It complements docs/go-live-checklist.md (live keys, legal text, TERMS_VERSION), which is not repeated here. Do the steps in order; each says what to look for before you go on.

## 1. Database backup (first, before anything else)

- [ ] Take a full dump of production and keep it somewhere that is not the same host:
  `pg_dump "$PRODUCTION_DATABASE_URL" -Fc -f shareswap-pre-0022-$(date +%Y%m%d-%H%M).dump`
- [ ] Prove it is readable: `pg_restore --list shareswap-pre-0022-*.dump | head -n 20` shows the tables, and ideally restore it into a scratch database once.
- [ ] Note the row counts you will compare afterwards: `select count(*) from users, item_requests, wallet_transactions, wallet_chargebacks` (run each count separately) and `select coalesce(sum(rental_balance),0) from users`.

## 2. Migrations 0022 and 0023

They run by themselves at boot (`applyStartupMigrations` calls `ensurePlatformDisputes` and `ensureDisputeAlertColumns`; production boots from the SQL files, never from drizzle). Both are idempotent and only add things. Do not run `drizzle-kit push` against production.

- 0022 (`lib/db/scripts/0022_platform_disputes.sql`): tables `platform_disputes`, `account_review_flags`, `dispute_evidence`; columns `kind`, `reason`, `created_by` on `wallet_chargebacks` (existing rows become `kind = 'dispute'`).
- 0023 (`lib/db/scripts/0023_dispute_deadline_alerts.sql`): `evidence_due_alert_sent_at`, `auth_expiry_alert_sent_at` on `platform_disputes`.

- [ ] Deploy with the environment from step 3. Read the boot log: no error from either ensure function.
- [ ] Check: `select to_regclass('platform_disputes'), to_regclass('account_review_flags'), to_regclass('dispute_evidence');` returns three names, and `select column_name from information_schema.columns where table_name='wallet_chargebacks' and column_name in ('kind','reason','created_by');` returns three rows.
- [ ] The counts from step 1 are unchanged.
- Rollback: redeploy the previous build. The new tables and columns are harmless to it (the new columns have defaults). Drop them only if you need to: `drop table dispute_evidence, account_review_flags, platform_disputes; alter table wallet_chargebacks drop column kind, drop column reason, drop column created_by;`.

## 3. Environment variables and secrets

Names only. Set them in the deployment that serves the API AND in the Scheduled Deployment that runs `run-scheduled-jobs` (it refuses to run live without `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`).

| Name | Must be | Why |
|---|---|---|
| `DATABASE_URL` | production database (with `sslmode=verify-full`, see go-live-checklist) | |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` | the keys of the account that holds the payments (boot logs test or live and the account id) | |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | set (boot stops without it) | existing |
| **`STRIPE_DISPUTE_WEBHOOK_SECRET`** | **set before real payments**; the signing secret of the dispute endpoint in step 4. Without it the boot logs a warning and every dispute event is rejected: nothing is recorded, no admin is alerted, no owner is asked for evidence | new behaviour depends on it |
| **`CHARGEBACK_RECOVERY_FROM_OWNERS`** | **unset.** Only the exact value `true` turns on charging owners' wallets for chargebacks, so never set it at launch (not even to `false`; unset is the clean state). The launch policy is that ShareSwap absorbs the loss and the fee | policy |
| `TERMS_ENFORCEMENT` | unset | existing |
| `RESEND_API_KEY`, `EMAIL_FROM`, `MODERATION_EMAIL`, `BANNED_EMAIL_HASH_KEY` | set | existing |
| `SCHEDULED_JOBS_EXPIRY_MODE`, `SCHEDULED_JOBS_HANDOFF_MODE` | your decision (default is dry-run) | existing |

- [ ] The `overdue-reminders` job must be running live: the 48-hour dispute alerts are sent from the same sweep (every 6 hours in the scheduled job, so an alert arrives 42 to 48 hours ahead). Check there is no `job_switches` row for `overdue-reminders` set to `off` or `dry-run`.
- [ ] `TERMS_VERSION` is not changed by this release. Bump it later, after counsel, per go-live-checklist.

## 4. Stripe webhook for disputes

- [ ] In the Stripe dashboard (the mode that matches the keys in step 3) add an endpoint: `https://shareswap.app/api/stripe/dispute-webhook`
- [ ] Events: `charge.dispute.created`, `charge.dispute.funds_withdrawn`, `charge.dispute.closed`.
- [ ] Copy its signing secret into `STRIPE_DISPUTE_WEBHOOK_SECRET` and redeploy. Test mode and live mode have different endpoints and different secrets.
- [ ] Prove it end to end in test mode first: pay with the card `4000000000000259` (it creates a dispute), then check: the log shows `[dispute-webhook] charge.dispute.created du_...: recorded: platform loss, no wallet change`; one row in `platform_disputes`; a notification for every admin; an `account_review_flags` row for the borrower; a `dispute_evidence_requested` notification for the owner; the owner's wallet balance unchanged; Stripe shows the delivery as 200. Then close the dispute (win it) and check `outcome`, `loss_amount_cents` and `loss_fee_cents`.
- [ ] Until the app has an admin screen for it, an admin reviews a dispute through the API: `GET /api/admin/chargebacks` (shows Stripe's evidence due date and the deposit authorization expiry), `GET /api/admin/chargebacks/:id/evidence` (the bundle to submit to Stripe by hand), `POST /api/admin/chargebacks/:id/review` (note required). A dispute left unreviewed keeps the rental's deposit hold in place and blocks cancelling or completing that rental. Agree who works this queue before launch.

## 5. Backfill and the USD test-data cleanup: order

Why this order: the cleanup zeroes wallets with an `adjustment` row, which only keeps the ledger consistent once the ledger has been backfilled. Both scripts are dry runs by default. Run them from `artifacts/api-server` with the production environment.

1. [ ] Backup (step 1) and deploy (step 2). Do not run these before the new build is live.
2. [ ] **Backfill dry run:** `pnpm run wallet:backfill`. Read `wouldWrite`, `byKind` and `balancesNotExplainedByLedger`.
3. [ ] **Backfill live:** `pnpm run wallet:backfill --live` (safe to repeat). Run the dry run again: `wouldWrite` is 0 and `balancesNotExplainedByLedger` is empty (anything left needs a person to look at it before the cleanup).
4. [ ] **Cleanup dry run**, with the options you intend to use live (they are part of the hash):
   `pnpm run usd-test-data:clean --close-without-hold 337,339 [--refund-rental-payments]`
   Read: every request and whether it is `release_hold`, `close_only` or `close_without_hold`; the list of rental payments already charged (amount, intent id, live or test); any payment that says "could not be read from Stripe" (wrong keys for that payment: stop and fix `STRIPE_SECRET_KEY`); users marked skipped; the plan hash.
5. [ ] Decide on `--refund-rental-payments`. It is off by default; with it, each charged payment is refunded for what is left, once (stable key per request and intent).
6. [ ] **Cleanup live**, the same options, plus the hash from the dry run you just read: `pnpm run usd-test-data:clean --close-without-hold 337,339 --live --confirm <hash>`. If anything changed since, it refuses; run the dry run again. Cancelling requests and refunds cannot be undone.
7. [ ] Dry run once more: no open USD requests left; backfill dry run again: no drift.
8. [ ] Only then continue with the go-live checklist's "clear test-mode Stripe IDs at the switch" and the live-key switch.

## 6. Smoke test after deploy

- [ ] `POST /api/admin/members/:id/recovery-debts` on a throwaway account with a balance: the balance is taken at once, a `debt_payment` ledger row appears, and a withdrawal is refused with code `RECOVERY_DEBT` while anything is still owed.
- [ ] An owner opens the notification "Please send us your evidence" on web and on the mobile app, sees the dispute and sends a note and a photo.
- [ ] A card payment with a stored card still goes through, and the log has no `PRE-CHARGE CARD CHECK SKIPPED` line (if it appears, the card check is not running).
