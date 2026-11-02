# Go-live checklist

Items parked while building on Stripe test mode. Nothing here has been done; tick each off at the switch to live keys.

## Before launch

### Config and deploy (you, not code)

- [ ] BANNED_EMAIL_HASH_KEY set in Replit Secrets (never change it once set)
- [ ] One end-to-end account deletion against Stripe test mode (Customer, subscription, Connect account removed)
- [ ] Switch account-deletion finalize job on in production
- [ ] Review handoff-deadlines dry-run output, then switch the sweep to live
- [ ] Switch Stripe to live keys (and the other Stripe live-mode items below)

### App Store / Play blockers

- [ ] Content safeguards (#3): report, block, moderation queue, zero-tolerance terms (Apple 1.2)
- [ ] Sign in with Apple (#1): required because Google sign-in is offered
- [x] Subscriptions vs In-App Purchase (#6): decided on Stripe subscriptions, not In-App Purchase. Member and Pro only change limits and fees on physical services, so the App Review notes below must say so.
- [ ] Raw server errors reaching users (#10)
- [ ] eas.json submit config and Android FCM (#11, #12)
- [ ] Icon and splash placeholders (#14)

### Product

- [ ] Audit transaction flows end to end (rent, borrow, swap, gift)

### Fixes

- [ ] Timezone: production runs tz 2026a; ship 2026e+ ICU tz files via ICU_TIMEZONE_FILES_DIR and confirm the [request-dates] boot line
  - Shipped in `artifacts/api-server/tzdata/2026e` (see its README) and set in `start` and `artifact.toml`. Still to do: publish, then check the first production log shows `tz database 2026e` and `tz files from artifacts/api-server/tzdata/2026e`. If it still says 2026a, the path is wrong.
- [ ] Healthchecks on /ws and /storage returned 500 at boot; confirm startup timing only, or add a /health endpoint
- [ ] Postgres SSL warning: set sslmode=verify-full on DATABASE_URL
- [ ] Replace url.parse() usage (DEP0169)
- [ ] Owner-return-flow e2e flake: re-run; if it fails again, register waitForResponse before the click

## After launch

- [ ] Async Vision check on new item photos: send a flagged photo to the moderation queue instead of blocking the upload. Reporting is the only photo safeguard at launch.
- [ ] Web report and block UI. The server-side enforcement (blocks, removals, bans) applies to web from day one; only the buttons are missing.

## Parked improvement: in-app card authentication

- [ ] Add `@stripe/stripe-react-native` to the mobile app and complete `requires_action` payments in-app (deposits, deposit holds and subscription upgrades). Today the app shows "authenticate your card in Payment Settings", and subscription upgrades open Stripe's hosted invoice page in the browser.
- [ ] The same package enables Apple Pay (and Google Pay).
- [ ] It needs a native rebuild (new EAS build, App Store / Play submission). It cannot ship as an over-the-air update.

## Stripe objects that do not carry over from test mode

Test-mode IDs mean nothing to live keys. Stripe answers "No such customer/payment method/account" and the app has to cope.

- [ ] **Clear test-mode Stripe IDs at the switch.** On `users`: `stripe_customer_id`, `stripe_payment_method_id`, `payment_method_last4/brand/exp_month/exp_year/added_at`, `stripe_subscription_id`, `stripe_subscription_status`, `stripe_connected_account_id`. Reset `subscription_tier` to `free` and `is_verified` to false for users whose verification depended on a test card. Review in-flight `item_requests` (`stripe_payment_intent_id`, deposit and capture IDs) first: finish or cancel them rather than orphaning a hold. Take a backup and run in a transaction.
- [ ] **Stale customer handling.** Checkout and the in-app upgrade already replace a stored customer that is missing, deleted or locked to another currency (`ensureUsableCustomer`). Check the other places that create or read a customer (`setup-intent`, `create-checkout-session`, the deposit and rental holds) behave the same with a missing customer.
- [ ] **Stale card handling.** The Payment Methods screen and the deposit/fee/hold charges clear a card that is gone or on another customer (`card-sync.ts`) and show "Please re-add your card". Confirm this on a live-mode account after the clear above, with a user who still holds a test card ID.
- [ ] **Stale Connect handling.** Owners with a stored `stripe_connected_account_id` from test mode will fail payouts and transfers on live keys. Decide whether to clear and re-onboard them, and make payout/onboarding code treat a missing connected account as "onboarding needed", not a 500.

## Stripe dashboard (live mode)

- [ ] **Live webhook endpoint and secret.** Add `https://shareswap.app/api/stripe/subscription-webhook` in live mode, subscribed to `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`. Put its signing secret in `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` (the server will not boot without it). Check any other webhook endpoints the app uses the same way. Test-mode and live-mode secrets differ.
- [ ] **Live CAD prices with metadata.** Member ($4.99/mo) and Pro ($9.99/mo) products in live mode, each with an active **CAD** Price. Products carry `metadata.tier` = `member` / `pro` and `metadata.app` = `shareswap`; the app finds prices by that metadata, in CAD only for in-app upgrades.
- [ ] **Live Connect settings.** Platform profile, branding, payout and transfer settings, onboarding requirements for Canada, and the Connect webhook if one is used.
- [ ] Live API keys (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`) in Replit Secrets. Startup logs "live keys" and the account id; check both.

## App Review

- [ ] **Review notes explaining the plans.** Member and Pro only change limits and fees on **physical services** (borrow limits, the rental service fee, courier fees). They unlock no digital content. Say this in the review notes and provide a test account, with a card that can complete a payment.

## Final check

- [ ] **Small real-money end-to-end test** on live keys with a real card, then refund it: add a card, upgrade to Member, switch to Pro (confirm proration), open the billing portal and change the card (the Payment Methods screen should pick it up), borrow with a deposit hold, rent with the platform fee, and cancel. Watch the webhook deliveries in the Stripe dashboard for each step.
