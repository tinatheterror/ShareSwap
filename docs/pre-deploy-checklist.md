# Pre-deploy checklist: chargeback policy, recovery debts, dispute alerts, private evidence

For the release that contains migrations 0022 to 0032. It complements docs/go-live-checklist.md (live keys, legal text, TERMS_VERSION), which is not repeated here. Do the steps in order; each says what to look for before you go on.

**Production has no real members yet (every account, request, payment and verification there is the owner's own testing), so the recommended path is the [Fresh start](#fresh-start-launch-production-with-an-empty-database) below, which replaces sections 1, 2 (the manual checks), 5, 7, 8 and 10. Sections 3, 4, 6 and 9 still apply.** Sections 1 to 10 remain for the case where production does hold real data.

## Fresh start: launch production with an empty database

Use this instead of backfill, the USD cleanup, the evidence purge, the condition-photo fix, the consent query and the sandbox reset. It rests on one fact: **production holds only test data**. If a real member has signed up since, stop and use sections 1 to 10 instead.

**What an empty database needs (checked 2026-11-09 by rehearsing it on a throwaway local database: boot on an empty one, push with and without the override, boot twice, push again).**

- The base tables come from `drizzle-kit push` of `lib/db/src/schema` (55 tables). The numbered SQL files and the `ensure…` functions that run at boot only *alter or add* to tables that already exist, so **an empty database cannot be booted without the push first**: the boot stops with `relation "item_requests" does not exist`.
- After the push, the boot (`applyStartupMigrations`) succeeds, is safe to run any number of times, and adds `job_switches` and `scheduled_job_runs`. A second push then reports "No changes detected", so the two agree. `session`, `rate_limit_store` and `native_oauth_tokens` are created the first time the app uses them.
- **Seed data the app needs: none that you must supply.** Created by the boot when the table is empty: `achievements` (8 rows) and `sponsored_games` (3 sample games). Categories are lists in the code, not rows. `subscription_plans` and `community_challenges` are never read or written, so they stay empty. `job_switches` is deliberately unseeded (a job with no row uses its environment default).
- **Two things to do by hand after the first boot:**
  1. **The first admin.** Nothing in the code makes an admin; `users.is_admin` is only ever set by SQL. Sign up through the real app (this records the Terms and age confirmation and proves Resend works), then: `UPDATE users SET is_admin = true WHERE lower(email) = lower('<your address>');` (expect `UPDATE 1`). Admins receive dispute, moderation and Persona-failure notices, so make only the people who should see them admins.
  2. **The sample games.** The three games ("Memory Match", "Number Puzzle", "Word Quest", with invented sponsors and a CodePen link) are live: `GET /api/games/sponsored` lists them and finishing one pays ShareCoins (3.50 to 5.00). Decide whether members should see them. To hide them, `UPDATE sponsored_games SET is_active = false;`. **Do not `DELETE` them**: the boot recreates them whenever the table is empty.

### A. Back up, then build the empty database

Run these yourself, from a machine with `pg_dump` and `psql` (version 16 or newer; `select version()` tells you the server's). Use the **direct** connection string (the host without `-pooler`) for the dump. Nothing here is run by the assistant.

1. [ ] **Back up.** `pg_dump "$PRODUCTION_DATABASE_URL" -Fc --no-owner -f shareswap-prod-final-$(date +%Y%m%d-%H%M).dump`, then `pg_restore --list shareswap-prod-final-*.dump` must list the tables. Keep the file off the Replit host. It holds your test accounts' password hashes and photos' references; delete it when you no longer need the rollback.
2. [ ] **Check how production's `DATABASE_URL` is managed.** If it is a secret you set yourself (a Neon project of your own), use **A1** (a new database next to the old one: nothing is deleted, rollback is one secret). If Replit's database integration owns it and you cannot point it elsewhere, use **A2** (wipe in place: irreversible except from the dump).

**A1. New database, old one untouched (recommended).**

3. [ ] Create it: in the Neon console (Databases > New database) or `psql "<the same URL but database postgres>" -c 'CREATE DATABASE shareswap_live;'`. Use a **lower-case** name; the examples use `shareswap_live`. Same role, same host. Its URL is the old one with `/shareswap_live` as the database and the same `sslmode=verify-full`.
4. [ ] Build the tables with the **one-command override** (never `export` it; the shell's own `DATABASE_URL` is the development database): `DATABASE_URL="<the new URL>" ALLOW_NON_TEST_DATABASE=shareswap_live pnpm --filter @workspace/db run push-force`. It must end with "Changes applied" and nothing else must be set to the old database in that command. This is the only time a push targets production; it is safe here because the target is empty (nothing can be dropped).
5. [ ] Check: `select count(*) from pg_tables where schemaname='public';` returns **55**, and `select count(*) from users;` returns **0**.
6. [ ] In **both** the API deployment's secrets **and** the Scheduled Deployment's (it refuses to run live without `DATABASE_URL`), change `DATABASE_URL` to the new URL. Set the rest of section 3, including `CUSTOM_DOMAIN`. Redeploy.
7. [ ] Read the boot log: no error from any `ensure…` function, "Achievements initialized", "Sample games initialized", and no `[persona] PERSONA_API_KEY is a SANDBOX key` line. Check: `select count(*) from pg_tables where schemaname='public';` returns **57** (55 plus `job_switches` and `scheduled_job_runs`), `select count(*) from achievements;` returns 8, `sponsored_games` 3, and every other table 0 (plus `session` rows once someone has signed in).
8. [ ] Do the two hand steps above (first admin, sample games).
9. [ ] Rollback at any point before real members arrive: set `DATABASE_URL` back to the old URL in both places and redeploy. The old database is untouched until you drop it. Drop it (and delete the dump) only after the launch has been stable for a while.

**A2. Wipe in place (only if A1 is impossible).** After step 1 (a verified dump is mandatory): `psql "$PRODUCTION_DATABASE_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, then grant the application role what it had if the role does not own the schema (`GRANT ALL ON SCHEMA public TO <role>;`), then steps 4 (with the real database name in `ALLOW_NON_TEST_DATABASE`), 5, 7 and 8. Triple-check the URL names production: this is irreversible except from the dump.

Everyone is signed out by the change (the `session` table is new), including the mobile apps; they land on the login screen.

### B. Test data outside the database

The database swap strands these, so clean them in this order. **Optionally, first, delete your test accounts through the app** (Settings > Delete account, or "Delete my account now") while the old database is still live: account deletion removes the Stripe Customer and Express Connect account, asks Persona to redact the inquiries and accounts, and ends the Apple link. It needs the account to have no open requests, claims, deposits or payouts, and the wallet withdrawn. It is the only cleanup that reaches all three systems, but it is slower than the manual cleanups below.

- [ ] **Object Storage (Replit).** Images are keyed `images/…` (public listing and profile photos, served at `/storage/images/…`) and `private/…` (evidence). With an empty database every object is an orphan, and the private ones are personal data. In the workspace's Object Storage tool, open the bucket named by `DEFAULT_OBJECT_STORAGE_BUCKET_ID` **in the production deployment** and delete all objects. First compare that id with the one in the workspace: if both are the same bucket, deleting also removes the images the development database points to. The folders `./uploads` and `./private-uploads` are only a fallback when Object Storage fails; an autoscale deployment starts from a clean disk on every deploy, so there is nothing to clean there. Tests never use this bucket (`TEST_OBJECT_STORAGE_BUCKET_ID` is the only bucket a test may use).
- [ ] **Stripe.** First see which mode production is on: the boot log prints "test keys" or "live keys" and the account id.
  - *Test mode:* nothing real exists. Dashboard in test mode: delete the test data (the "Delete all test data" action; it removes test customers, payments and Connect accounts). Keep the settings that are not data: products and prices (the app finds the Member and Pro prices by `metadata.tier`/`metadata.app`) and webhook endpoints. Then do the live-mode setup in go-live-checklist.md ("Stripe dashboard (live mode)"). Live mode starts empty.
  - *Live mode (you made real charges while testing):* Stripe never deletes charges, payment intents, refunds, transfers or payouts; they stay in reports and in the balance history for good. What you can do: refund test charges you want back (the processing fee is not returned); cancel open deposit holds (`requires_capture` payment intents; an unclaimed hold expires on its own after about 7 days, so waiting is fine); delete test **Customers** (Dashboard, or `DELETE /v1/customers/{id}`; this detaches their cards and cancels subscriptions); delete the **Express Connect accounts** you created for testing (`DELETE /v1/accounts/{id}`; allowed only for accounts your platform created and only at a zero balance, otherwise reject them in the Dashboard). Make a list from Customers and Connected accounts, filtered by created date, before the swap.
  - Either way, the go-live items "Clear test-mode Stripe IDs at the switch" and "Stale Connect handling" are **not needed**: no row will hold an old Stripe ID.
- [ ] **Persona.** The production key was a sandbox key, so Persona's **Production** environment holds nothing, and the Sandbox environment holds only simulated checks. If you used real photos of your own ID or face in the sandbox, redact those inquiries and their accounts in the sandbox dashboard (Inquiries, then Accounts). Otherwise leave the sandbox alone. The new `PERSONA_API_KEY` must be the production key (`persona_production_…`) with the template confirmed in Production, plan active and 30-day redaction set by Persona (the item in section 3).
- [ ] **Resend.** The app uses Resend only to send transactional email (it stores no contacts or audiences), and sent emails cannot be deleted; they age out of the Emails log under your plan's retention. Cleanup is: remove your own test addresses from the Suppressions list if bounces or complaints put them there, and revoke any old API key before the new one goes live.
- [ ] **Left alone on purpose:** push tokens and Apple/Google link rows (in the database, gone with it); Sign in with Apple and Google (your test sign-ins simply create a new account on first use); OpenAI (the app stores nothing there); Uber Direct (if you made test deliveries they stay in its dashboard).

### C. Email for real members: the Resend sending domain

What the code needs (`artifacts/api-server/src/mail.ts`): `RESEND_API_KEY` and `EMAIL_FROM` set, or every send fails with "Resend is not configured". `EMAIL_FROM` is passed to Resend unchanged as the sender, there is no Reply-To (replies go to the sender), and every link in an email is built from `CUSTOM_DOMAIN` in production.

- [ ] **A verified domain in Resend.** Resend > Domains: `shareswap.app` shows **Verified** (its DNS records, SPF and DKIM, present at your DNS host; the return-path record lives on a sending subdomain, so your normal mail records are unaffected). Resend refuses to send from an address on an unverified domain.
- [ ] **`EMAIL_FROM` is an address on that verified domain**, e.g. `support@shareswap.app`; Resend also accepts `ShareSwap <support@shareswap.app>`. A gmail.com or other foreign address is rejected.
- [ ] **That address can receive mail.** Because replies go to it (and `SUPPORT_EMAIL` and `MODERATION_EMAIL` default to `support@` and `moderation@shareswap.app`), those inboxes must exist at your mail host. Sending through Resend does not create a mailbox.
- [ ] **`CUSTOM_DOMAIN=shareswap.app`** is set in the API deployment. Without it the links in verification, password-reset, account-deletion and "verify again" emails point at a development or localhost address.
- [ ] **A production-only API key**, created for the verified domain with sending access only, set as `RESEND_API_KEY` in the API deployment and the Scheduled Deployment. Check your Resend plan's daily and monthly sending limits against launch expectations.
- [ ] **DMARC**: publish a `_dmarc` TXT record (start with `p=none` and a report address) so mailbox providers trust the domain. Recommended for a launch, not enforced by the app.
- [ ] **Apple private relay** (members who use Sign in with Apple): register the sending domain and the sender address under Services > Sign in with Apple for Email Communication, or mail to `@privaterelay.appleid.com` addresses is dropped (already in go-live-checklist.md).
- [ ] **Prove it**: sign up in the app with a real address you can read (the first admin does this): the verification email arrives in the inbox, not spam, from the right sender, with a link on `https://shareswap.app/…`.

### D. What the fresh start makes unnecessary

| Step | Fresh start |
|---|---|
| 1 Backup before 0022 | Replaced by A step 1 (one dump, taken before the swap) |
| 2 Migrations 0022 to 0032: manual checks, "counts unchanged", rollback SQL | Not needed: the push builds the current schema and the boot ensures are no-ops. Still deploy and read the boot log (A7) |
| 3 Environment | **Still needed**, plus `CUSTOM_DOMAIN` |
| 4 Stripe dispute webhook | **Still needed** (live mode endpoint and secret) |
| 5 Backfill and the USD cleanup | **Not needed**: no wallet balances to explain and no USD test requests. Do not run `wallet:backfill` or `usd-test-data:clean` |
| 6 Smoke test | **Still needed**, on the new database |
| 7 Private evidence, `evidence:purge-public`, `condition-photos:fix` | **Not needed**: no database rows point at legacy files. Empty the bucket instead (B) |
| 8 Members verified before consent | **Not needed**: no members. The matching counsel item in go-live-checklist.md ("Consent for members verified before consent was required") is moot |
| 9 Persona sandbox check | **Done 2026-11-11** (passed against Persona's sandbox; no need to repeat unless the redaction code or Persona's API changes) |
| 10 Reset sandbox verifications | **Not needed**: no verification exists. Do not run `persona:reset-sandbox` |
| go-live: clear test-mode Stripe IDs, stale customer/card/Connect handling | **Not needed to launch** (no stored Stripe IDs) |

## 1. Database backup (first, before anything else)

- [ ] Take a full dump of production and keep it somewhere that is not the same host:
  `pg_dump "$PRODUCTION_DATABASE_URL" -Fc -f shareswap-pre-0022-$(date +%Y%m%d-%H%M).dump`
- [ ] Prove it is readable: `pg_restore --list shareswap-pre-0022-*.dump | head -n 20` shows the tables, and ideally restore it into a scratch database once.
- [ ] Note the row counts you will compare afterwards: `select count(*) from users, item_requests, wallet_transactions, wallet_chargebacks` (run each count separately) and `select coalesce(sum(rental_balance),0) from users`.

## 2. Migrations 0022 to 0032

**How production migrations run.** The API's production build is the esbuild bundle (`artifacts/api-server/.replit-artifact/artifact.toml`: build `pnpm --filter @workspace/api-server run build`, run `node artifacts/api-server/dist/index.mjs`). Nothing in the build, the run command or `[deployment.postBuild]` calls drizzle. On every boot, before any route or job starts, `applyStartupMigrations()` (`artifacts/api-server/src/index.ts`) runs the numbered SQL files in `lib/db/scripts` through the `ensure…` functions; if one fails the process exits and the deploy does not go live. The files are idempotent and only add things. **Never run `drizzle-kit push` against a production database that holds data** (the one exception is building a new, empty database in the Fresh start path above): `lib/db/drizzle.config.ts` now refuses any database that is not a test database unless `ALLOW_NON_TEST_DATABASE=<database name>` is set, so a push at production fails by itself.

**The `post-merge` exemption.** `scripts/post-merge.sh` (the workspace's post-merge hook, not part of a deployment) runs `drizzle-kit push --force` against the workspace development database. That is not a test database, so the script sets `ALLOW_NON_TEST_DATABASE` to that database's name (read from its own `DATABASE_URL`) and nothing else. Do not copy that line anywhere else, and do not set `ALLOW_NON_TEST_DATABASE` in the production deployment.

- 0022 (`lib/db/scripts/0022_platform_disputes.sql`): tables `platform_disputes`, `account_review_flags`, `dispute_evidence`; columns `kind`, `reason`, `created_by` on `wallet_chargebacks` (existing rows become `kind = 'dispute'`).
- 0023 (`lib/db/scripts/0023_dispute_deadline_alerts.sql`): `evidence_due_alert_sent_at`, `auth_expiry_alert_sent_at` on `platform_disputes`.
- 0024 (`lib/db/scripts/0024_dispute_deposit_expiry.sql`, `ensureDisputeDepositExpiryColumns`): `urgent_manual_review` (default false), `deposit_uncollectible_at`, `rental_completed_at`, `rental_completed_by` on `platform_disputes`. Written when a deposit authorization expires during an unreviewed dispute, and by the admin "close the rental, dispute stays open" action.
- 0025 (`lib/db/scripts/0025_evidence_uploads.sql`, `ensureEvidenceUploadsTable`): table `evidence_uploads` (token, storage key, uploader) for private evidence photos.
- 0026 (`lib/db/scripts/0026_evidence_upload_purpose.sql`, same ensure function): `evidence_uploads.purpose` (default `dispute_evidence`; also `claim_evidence`, `return_dispute`).
- 0027 was added and then withdrawn (the file is gone): it created `users.id_verified`, which nothing reads. **0028** (`lib/db/scripts/0028_drop_id_verified.sql`, `ensureIdVerifiedColumnDropped`) drops that column wherever it exists (the workspace dev database may have it; production only if an earlier build with 0027 was deployed), and does nothing otherwise. The "Verified" check-mark badge is `users.is_verified` (an approved ID **and** a card on file), unchanged; borrow and rent gating uses `getVerificationForUser`.
- 0029 (`lib/db/scripts/0029_biometric_consents.sql`, `ensureBiometricConsentsTable`): table `biometric_consents` (user, version of the text agreed to, time). `POST /api/persona/create-inquiry` now answers 403 `BIOMETRIC_CONSENT_REQUIRED` unless the member has agreed at the current version (the notice and checkbox on the web and mobile verification screens record it through `POST /api/biometric-consent`). Check after deploy: `select to_regclass('biometric_consents');` returns a name. Changing the consent wording needs a new `BIOMETRIC_CONSENT_VERSION` (a test fails otherwise), which asks everyone again. Rollback: an old build ignores the table; a new build with the table dropped refuses every verification.
- 0030 (`lib/db/scripts/0030_persona_redactions.sql`, `ensurePersonaRedactionsTable`): table `persona_redactions` (Persona inquiry ids queued when an account is deleted, with attempts, the last error and when Persona confirmed). Account deletion now asks Persona to redact each of the member's inquiries (`DELETE /api/v1/inquiries/{id}`, needs `PERSONA_API_KEY` in the API deployment and in the scheduled deletion job); a failure never blocks the deletion and is retried by every live `finalizeDueDeletions` run. Check after deploy: `select to_regclass('persona_redactions');` returns a name, and later `select status, count(*) from persona_redactions group by 1;` shows no long-lived `pending` rows (their `last_error` says why).
- 0031 (`lib/db/scripts/0031_persona_redaction_caps.sql`, same ensure function): `failed_at` and `admin_notified_at` on `persona_redactions`. A redaction that fails 10 times, or fails after being queued for 7 days, is marked `failed` and every admin gets one notification (`admin_persona_redaction_failed`) telling them to redact it in the Persona dashboard and then set the row's status to `redacted`. Failed rows are not retried; to retry one: `update persona_redactions set status='pending', attempts=0, failed_at=null, created_at=now() where id=<id>`.
- 0032 (`lib/db/scripts/0032_persona_redaction_kind.sql`, same ensure function): `persona_redactions.kind` (`inquiry`, `account_lookup`, `account`). Persona also keeps an Account object per member (name, address, ID numbers, birthdate, selfie photo; [Redact an Account](https://docs.withpersona.com/api-reference/accounts/redact-an-account)), tied to us by the reference id `user_<id>` that `create-inquiry` sends. Deleting a member who started an inquiry queues a lookup (`GET /api/v1/accounts?filter[reference-id]=user_<id>`; only accounts whose reference id matches exactly are redacted) and then each account found is redacted with `DELETE /api/v1/accounts/{id}`, with the same retries, cap and admin notice as inquiries. That the filter and the reference-id link work is checked by the sandbox script (`persona:sandbox-check`, see below) — run it once before launch.

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
| **`PERSONA_API_KEY`** | **the production key (`persona_production_...`)**, in the API deployment **and** the scheduled deletion job (account deletion redacts the member's Persona inquiries with it). A `persona_sandbox_` key in production simulates every check, so the server refuses it: the boot log has an error line starting `[persona] PERSONA_API_KEY is a SANDBOX key` and `/api/persona/create-inquiry` and `/api/persona/inquiry-complete` answer 503 | existing key, new use |
| `PERSONA_TEMPLATE_ID` | the inquiry template as it exists in Persona's **Production** environment (a template id from the sandbox may not exist there) | existing |
| `TERMS_ENFORCEMENT` | unset | existing |
| `RESEND_API_KEY`, `EMAIL_FROM`, `MODERATION_EMAIL`, `BANNED_EMAIL_HASH_KEY` | set; `EMAIL_FROM` is an address on a domain verified in Resend (see Fresh start, C) | existing |
| `EMAIL_MODE` | optional. Production sends for real by default; anywhere else the default is `log` (printed, not sent). Set `EMAIL_MODE=live` explicitly in the API deployment and the Scheduled Deployment so a mis-detected environment can never silently swallow email. Tests ignore it and use a fake sender. | new |
| `MODERATION_ALERT_MINUTES` | optional, default 15: at most one report email and one blocked-deletion email per this many minutes each (keeps a burst inside the Resend daily quota). Nothing is dropped: alerts wait in `admin_alert_queue` (migration 0033, created at boot) and go out as one "N new reports since the last alert" summary when the window ends, sent by the once-a-minute `admin-alert-summary` timer, which runs only in a deployment (or with `BACKGROUND_JOBS=on`) | new |
| **`CUSTOM_DOMAIN`** | `shareswap.app`. Every link in an email is built from it in production; without it they point at a development or localhost address | existing |
| `SCHEDULED_JOBS_EXPIRY_MODE`, `SCHEDULED_JOBS_HANDOFF_MODE` | your decision (default is dry-run) | existing |

- [ ] **Persona is real, not simulated:** Persona plan active, production key (`persona_production_`) set, template confirmed in Production, 30-day auto-redaction set by Persona (**done**: Persona confirmed an organisation-wide 30-day redaction policy on Sandbox and Production, 30 days after an inquiry is Completed, Failed or Expired). Until the other three are true, do not let members verify: the consent text and Privacy Policy promise deletion 30 days after a decision. After the deploy, the boot log has no `[persona] PERSONA_API_KEY is a SANDBOX key` line. Then run section 10 (reset the verifications a sandbox key approved).
  - [ ] Once on a production plan, request the platform-improvement opt-out from Persona (so it stops using the data to improve its platform). Its own consent screen cannot be edited on the Startup or Essentials plans and keeps saying "no more than 3 years" and "improve Persona's platform"; if the opt-out is granted, change the consent text and Privacy Policy ("improve its service") and bump `BIOMETRIC_CONSENT_VERSION`.
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

## 8. Members verified before consent was required (read-only, run on production)

Members whose ID was approved before the biometric consent screen shipped have an approved verification and no `biometric_consents` row. How many (this only reads):

```sql
SELECT count(*) AS verified_without_consent
FROM users u
WHERE EXISTS (SELECT 1 FROM verifications v WHERE v.user_id = u.id AND v.status = 'approved')
  AND NOT EXISTS (SELECT 1 FROM biometric_consents c WHERE c.user_id = u.id);
```

Add `AND u.account_status IS DISTINCT FROM 'deleted'` to leave out deleted accounts. To see who (ids only, no names), replace `count(*) AS verified_without_consent` with `u.id, (SELECT min(v.created_at) FROM verifications v WHERE v.user_id = u.id AND v.status = 'approved') AS verified_at` and add `ORDER BY verified_at`. A member who agreed at an older version of the wording does have a row, so they are not counted here; to count them too, change the last line to `AND NOT EXISTS (SELECT 1 FROM biometric_consents c WHERE c.user_id = u.id AND c.version = '2026-11-09.3')` (the current `BIOMETRIC_CONSENT_VERSION`; check biometric-consent.ts, it changes whenever the wording does). Nothing is changed for these members: the consent only gates starting a new Persona inquiry. What to do about them is on the counsel list in go-live-checklist.md.

## 9. Persona sandbox check (once, before launch)

Account deletion redacts a member's Persona inquiries and accounts with `DELETE /api/v1/inquiries/{id}` and `DELETE /api/v1/accounts/{id}`, and finds the accounts by the reference id `user_<id>`. Persona's documentation does not say what a redacted object returns, so check it against the sandbox:

```
PERSONA_SANDBOX_API_KEY=persona_sandbox_... PERSONA_SANDBOX_TEMPLATE_ID=itmpl_... pnpm --filter @workspace/api-server run persona:sandbox-check
```

It creates a test inquiry (reference id `user_sandbox_<time>`), finds its account by reference id, redacts both with the same client deletion uses, fetches them again and prints PASS/FAIL per step, exiting 1 on any FAIL. It refuses any key that does not start with `persona_sandbox_`, never prints the key, and needs no database. Run it from `artifacts/api-server`.

- [x] **Done 2026-11-11: every step passed against the real Persona sandbox.** The inquiry and the account were both redacted, `redacted-at` was set on each, and the reference-id lookup (`user_<id>`) works. The 404 path (a redaction of an object already gone) was **not exercised live**; it is covered by unit tests only. **Persona sandbox access runs until 2027-01-08, and a production plan is needed before launch** (the production key and Production environment come with it; see the Persona item in section 3).
- If a step ever fails: a FAIL on "find the account by reference id" means accounts are not tied to `user_<id>` as assumed (deletion will then redact inquiries only; send the output to whoever maintains the deletion code). A FAIL after "redact the inquiry" means the endpoint or the key's permissions are wrong, and deletions will end in `failed` rows and admin notices.

## 10. Reset verifications that a sandbox key approved (production, once)

Production ran with a `persona_sandbox_` key, so every verification so far was simulated: nobody's ID was checked. After the production key is live, take those members back to "not verified" and tell them to verify again. Run it from `artifacts/api-server` with the production environment; the script is a dry run by default.

1. [ ] **Dry run:** `pnpm run persona:reset-sandbox`. It lists every member whose verification was approved through Persona (status `approved` with an inquiry id; older approvals without one are not Persona's and are never touched) and prints the `--before` value to use.
2. [ ] Decide the cutoff. `--before=<ISO time>` is the moment the production key went live: a verification created after it is real and is never reset. If you run this before any member has verified with the production key, "now" is right; otherwise use the time of the switch. `--apply` refuses without it.
3. [ ] **Apply:** `ALLOW_NON_TEST_DATABASE=<the production database name> pnpm run persona:reset-sandbox --apply --before=<ISO time>` (the override on that one command only, as in step 5). For each member it sets the verification to status `reset` with `id_number` `SANDBOX_RESET` (that is the recorded reason), clears `is_verified` and `verified_at` unless the member still has another approved ID, and adds one in-app notification ("Please verify your identity again") (see the email below). It prints the counts (including the trust points and ShareCoins taken back) and any member it failed on; running it again is safe (a reset row is no longer approved, so nobody is notified twice).
4. [ ] The script also takes back what each simulated approval granted (+50 trust, 5 ShareCoins), so verifying again does not give them twice. The dry run shows the amounts per member and in total. Each grant reversed gets its own negative row (`VERIFICATION_RESET`) in `reputation_activities` and `share_coins_transactions`. A score or balance never goes below 0: a member who has spent the coins loses less, and the apply output lists that under `shortfalls`. Achievements the approval may have unlocked are not touched.
5. [ ] Each member gets the in-app notification and, if they have an address, an email (subject "ShareSwap: please verify your identity again", sent through the normal Resend setup, so `RESEND_API_KEY` and `EMAIL_FROM` must be set in the environment you run it in). The email is sent after the member's reset is committed, to their own address only; deleted and banned accounts and members with no address get none. The dry run says how many will be emailed. If a send fails the member is still reset: the apply output lists them under `emailFailed` (a second run does not find them), so write to those by hand. No push is sent.
