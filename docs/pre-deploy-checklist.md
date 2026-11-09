# Pre-deploy checklist: chargeback policy, recovery debts, dispute alerts, private evidence

For the release that contains migrations 0022 to 0030. It complements docs/go-live-checklist.md (live keys, legal text, TERMS_VERSION), which is not repeated here. Do the steps in order; each says what to look for before you go on.

## 1. Database backup (first, before anything else)

- [ ] Take a full dump of production and keep it somewhere that is not the same host:
  `pg_dump "$PRODUCTION_DATABASE_URL" -Fc -f shareswap-pre-0022-$(date +%Y%m%d-%H%M).dump`
- [ ] Prove it is readable: `pg_restore --list shareswap-pre-0022-*.dump | head -n 20` shows the tables, and ideally restore it into a scratch database once.
- [ ] Note the row counts you will compare afterwards: `select count(*) from users, item_requests, wallet_transactions, wallet_chargebacks` (run each count separately) and `select coalesce(sum(rental_balance),0) from users`.

## 2. Migrations 0022 to 0030

**How production migrations run.** The API's production build is the esbuild bundle (`artifacts/api-server/.replit-artifact/artifact.toml`: build `pnpm --filter @workspace/api-server run build`, run `node artifacts/api-server/dist/index.mjs`). Nothing in the build, the run command or `[deployment.postBuild]` calls drizzle. On every boot, before any route or job starts, `applyStartupMigrations()` (`artifacts/api-server/src/index.ts`) runs the numbered SQL files in `lib/db/scripts` through the `ensure…` functions; if one fails the process exits and the deploy does not go live. The files are idempotent and only add things. **Never run `drizzle-kit push` against production**: `lib/db/drizzle.config.ts` now refuses any database that is not a test database unless `ALLOW_NON_TEST_DATABASE=<database name>` is set, so a push at production fails by itself.

**The `post-merge` exemption.** `scripts/post-merge.sh` (the workspace's post-merge hook, not part of a deployment) runs `drizzle-kit push --force` against the workspace development database. That is not a test database, so the script sets `ALLOW_NON_TEST_DATABASE` to that database's name (read from its own `DATABASE_URL`) and nothing else. Do not copy that line anywhere else, and do not set `ALLOW_NON_TEST_DATABASE` in the production deployment.

- 0022 (`lib/db/scripts/0022_platform_disputes.sql`): tables `platform_disputes`, `account_review_flags`, `dispute_evidence`; columns `kind`, `reason`, `created_by` on `wallet_chargebacks` (existing rows become `kind = 'dispute'`).
- 0023 (`lib/db/scripts/0023_dispute_deadline_alerts.sql`): `evidence_due_alert_sent_at`, `auth_expiry_alert_sent_at` on `platform_disputes`.
- 0024 (`lib/db/scripts/0024_dispute_deposit_expiry.sql`, `ensureDisputeDepositExpiryColumns`): `urgent_manual_review` (default false), `deposit_uncollectible_at`, `rental_completed_at`, `rental_completed_by` on `platform_disputes`. Written when a deposit authorization expires during an unreviewed dispute, and by the admin "close the rental, dispute stays open" action.
- 0025 (`lib/db/scripts/0025_evidence_uploads.sql`, `ensureEvidenceUploadsTable`): table `evidence_uploads` (token, storage key, uploader) for private evidence photos.
- 0026 (`lib/db/scripts/0026_evidence_upload_purpose.sql`, same ensure function): `evidence_uploads.purpose` (default `dispute_evidence`; also `claim_evidence`, `return_dispute`).
- 0027 was added and then withdrawn (the file is gone): it created `users.id_verified`, which nothing reads. **0028** (`lib/db/scripts/0028_drop_id_verified.sql`, `ensureIdVerifiedColumnDropped`) drops that column wherever it exists (the workspace dev database may have it; production only if an earlier build with 0027 was deployed), and does nothing otherwise. The "Verified" check-mark badge is `users.is_verified` (an approved ID **and** a card on file), unchanged; borrow and rent gating uses `getVerificationForUser`.
- 0029 (`lib/db/scripts/0029_biometric_consents.sql`, `ensureBiometricConsentsTable`): table `biometric_consents` (user, version of the text agreed to, time). `POST /api/persona/create-inquiry` now answers 403 `BIOMETRIC_CONSENT_REQUIRED` unless the member has agreed at the current version (the notice and checkbox on the web and mobile verification screens record it through `POST /api/biometric-consent`). Check after deploy: `select to_regclass('biometric_consents');` returns a name. Changing the consent wording needs a new `BIOMETRIC_CONSENT_VERSION` (a test fails otherwise), which asks everyone again. Rollback: an old build ignores the table; a new build with the table dropped refuses every verification.
- 0030 (`lib/db/scripts/0030_persona_redactions.sql`, `ensurePersonaRedactionsTable`): table `persona_redactions` (Persona inquiry ids queued when an account is deleted, with attempts, the last error and when Persona confirmed). Account deletion now asks Persona to redact each of the member's inquiries (`DELETE /api/v1/inquiries/{id}`, needs `PERSONA_API_KEY` in the API deployment and in the scheduled deletion job); a failure never blocks the deletion and is retried by every live `finalizeDueDeletions` run. Check after deploy: `select to_regclass('persona_redactions');` returns a name, and later `select status, count(*) from persona_redactions group by 1;` shows no long-lived `pending` rows (their `last_error` says why).

- [ ] Deploy with the environment from step 3. Read the boot log: no error from either ensure function.
- [ ] Check: `select to_regclass('platform_disputes'), to_regclass('account_review_flags'), to_regclass('dispute_evidence'), to_regclass('evidence_uploads');` returns four names, `select count(*) from information_schema.columns where table_name='users' and column_name='id_verified';` returns 0, `select column_name from information_schema.columns where table_name='platform_disputes' and column_name in ('urgent_manual_review','deposit_uncollectible_at','rental_completed_at','rental_completed_by');` returns four rows, `select column_name from information_schema.columns where table_name='evidence_uploads' and column_name='purpose';` returns one row, and `select column_name from information_schema.columns where table_name='wallet_chargebacks' and column_name in ('kind','reason','created_by');` returns three rows.
- [ ] The counts from step 1 are unchanged.
- Rollback: redeploy the previous build. The new tables and columns are harmless to it (the new columns have defaults). Drop them only if you need to (and only after the old build is serving again): `drop table evidence_uploads; alter table platform_disputes drop column urgent_manual_review, drop column deposit_uncollectible_at, drop column rental_completed_at, drop column rental_completed_by; drop table dispute_evidence, account_review_flags, platform_disputes; alter table wallet_chargebacks drop column kind, drop column reason, drop column created_by;`.

## 3. Environment variables and secrets

Names only. Set them in the deployment that serves the API AND in the Scheduled Deployment that runs `run-scheduled-jobs` (it refuses to run live without `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`).

| Name | Must be | Why |
|---|---|---|
| `DATABASE_URL` | production database (with `sslmode=verify-full`, see go-live-checklist) | |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` | the keys of the account that holds the payments (boot logs test or live and the account id) | |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | set (boot stops without it) | existing |
| **`STRIPE_DISPUTE_WEBHOOK_SECRET`** | **set before real payments**; the signing secret of the dispute endpoint in step 4. Without it the boot logs a warning and every dispute event is rejected: nothing is recorded, no admin is alerted, no owner is asked for evidence | new behaviour depends on it |
| **`CHARGEBACK_RECOVERY_FROM_OWNERS`** | **unset.** Only the exact value `true` turns on charging owners' wallets for chargebacks, so never set it at launch (not even to `false`; unset is the clean state). The launch policy is that ShareSwap absorbs the loss and the fee | policy |
| `BIOMETRIC_CONSENT_RETAIN_AFTER_DELETION` | unset (the minimal consent record is kept after an account is deleted); `false` deletes it with the account. Counsel's call, see go-live-checklist | new |
| `PERSONA_API_KEY` | set in the API deployment **and** the scheduled deletion job (account deletion redacts the member's Persona inquiries with it) | existing key, new use |
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
- [ ] Admins review a dispute on the admin Disputes page ("Card disputes" > Review and evidence), which uses these endpoints: `GET /api/admin/chargebacks` (shows Stripe's evidence due date and the deposit authorization expiry), `GET /api/admin/chargebacks/:id/evidence` (the bundle to submit to Stripe by hand; ShareSwap does not send it to Stripe), `POST /api/admin/chargebacks/:id/review` (note required), `POST /api/admin/chargebacks/:id/complete-rental` (expired deposit hold only; closes the rental, the dispute stays open, no money moves). A dispute left unreviewed keeps the rental's deposit hold in place and blocks cancelling or completing that rental. Agree who works this queue before launch.

## 5. Backfill and the USD test-data cleanup: order

**Production numbers are unknown until these dry runs are run on production.** Every figure seen so far (the count of USD requests, wallet balances, the user and request ids named below such as 337 and 339, the evidence-file references) came from the workspace development database (`ep-billowing-river…`, `neondb`), which is a different Neon host from production (`ep-holy-bonus…`). Do not reuse them: run each dry run with the production environment and choose the cleanup flags (`--close-without-hold`, `--refund-rental-payments`) only from the production dry-run output. The ids in the examples below are placeholders.

Why this order: the cleanup zeroes wallets with an `adjustment` row, which only keeps the ledger consistent once the ledger has been backfilled. Both scripts are dry runs by default. Run them from `artifacts/api-server` with the production environment. **Their live runs now refuse a database that is not a test database** (`wallet:backfill --live` is not guarded; `usd-test-data:clean --live` and `evidence:purge-public --apply` are): for those, add `ALLOW_NON_TEST_DATABASE=<the production database name>` to that one command, and do not export it.

1. [ ] Backup (step 1) and deploy (step 2). Do not run these before the new build is live.
2. [ ] **Backfill dry run:** `pnpm run wallet:backfill`. Read `wouldWrite`, `byKind` and `balancesNotExplainedByLedger`.
3. [ ] **Backfill live:** `pnpm run wallet:backfill --live` (safe to repeat). Run the dry run again: `wouldWrite` is 0 and `balancesNotExplainedByLedger` is empty (anything left needs a person to look at it before the cleanup).
4. [ ] **Cleanup dry run**, with the options you intend to use live (they are part of the hash):
   `pnpm run usd-test-data:clean --close-without-hold <ids from the production dry run> [--refund-rental-payments]`
   Read: every request and whether it is `release_hold`, `close_only` or `close_without_hold`; the list of rental payments already charged (amount, intent id, live or test); any payment that says "could not be read from Stripe" (wrong keys for that payment: stop and fix `STRIPE_SECRET_KEY`); users marked skipped; the plan hash.
5. [ ] Decide on `--refund-rental-payments`. It is off by default; with it, each charged payment is refunded for what is left, once (stable key per request and intent).
6. [ ] **Cleanup live**, the same options, plus the hash from the dry run you just read: `pnpm run usd-test-data:clean --close-without-hold <the same ids> --live --confirm <hash>`. If anything changed since, it refuses; run the dry run again. Cancelling requests and refunds cannot be undone.
7. [ ] Dry run once more: no open USD requests left; backfill dry run again: no drift.
8. [ ] Only then continue with the go-live checklist's "clear test-mode Stripe IDs at the switch" and the live-key switch.

## 6. Smoke test after deploy

- [ ] `POST /api/admin/members/:id/recovery-debts` on a throwaway account with a balance: the balance is taken at once, a `debt_payment` ledger row appears, and a withdrawal is refused with code `RECOVERY_DEBT` while anything is still owed.
- [ ] An owner opens the notification "Please send us your evidence" on web and on the mobile app, sees the dispute and sends a note and a photo.
- [ ] A card payment with a stored card still goes through, and the log has no `PRE-CHARGE CARD CHECK SKIPPED` line (if it appears, the card check is not running).

## 7. Private evidence photos

- [ ] Claim evidence (`/api/uploads/claim-evidence`), the return-dispute photo (`/api/uploads/dispute-photo`) and dispute evidence (`/api/uploads/dispute-evidence`) now store private files readable only through `/api/private-files/:token` (the uploader, the parties it is attached to, admins). Listing, profile and condition photos stay public. Evidence uploaded before this release still has public `/storage/...` or `/uploads/...` URLs.
- [ ] Find them: `pnpm --filter @workspace/api-server run evidence:purge-public` (a dry run: lists records and files). Decide what to do with real claim evidence before deleting anything; the script removes the files and the references (`--apply`, with the override in step 5), and keeps a file that is also a listing photo.
- [ ] Tests never use the real bucket (`TEST_OBJECT_STORAGE_BUCKET_ID` is the only bucket a test may use). Do not set it in production.
- [ ] Broken condition-verification photos: `pnpm --filter @workspace/api-server run condition-photos:fix` (dry run) lists verifications whose photos contain `/uploads/undefined` (the dev database has none; production is not known). `--apply` removes only those entries and keeps the verifications; it needs the override from step 5.
