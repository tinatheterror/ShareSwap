# Go-live checklist

Items parked while building on Stripe test mode. Nothing here has been done; tick each off at the switch to live keys.

## Before launch

### Config and deploy (you, not code)

- [ ] BANNED_EMAIL_HASH_KEY set in Replit Secrets (never change it once set)
- [ ] One end-to-end account deletion against Stripe test mode (Customer, subscription, Connect account removed)
- [ ] Switch account-deletion finalize job on in production
- [ ] Review handoff-deadlines dry-run output, then switch the sweep to live
- [ ] Switch Stripe to live keys (and the other Stripe live-mode items below)
- [x] EXPO_PUBLIC_FEEDBACK_URL set in the EAS build profiles (eas.json) to the public UserJot board (https://shareswap.userjot.com); without it the mobile Settings > Send feedback row is hidden
- [ ] MODERATION_EMAIL set to moderation@shareswap.app in Replit Secrets (the address is configuration, not code). Without it the boot log warns "MODERATION_EMAIL is not set" and reports are queued but nobody is emailed. After setting it, file a test report and confirm the email arrives; someone must read that inbox and work /admin/reports daily (Apple expects action within 24 hours)

### Legal text (you, with counsel)

- [ ] Approve the drafts in docs/legal (community-guidelines.md, terms-of-service.md and privacy-policy.md) with counsel, then delete the "DRAFT" note at the top of each. The entity (ShareSwap Marketplace Inc., Richmond BC), governing law (British Columbia), 7-day backup retention and the OpenAI/Replit wording are filled in. Still yours: the effective date in both documents (replace `[date]` with the date you bump TERMS_VERSION). Counsel should confirm the OpenAI/Replit retention and training paragraph in the Privacy Policy (marked for review). Counsel should also review the choices made in the draft: no arbitration clause, a liability cap of the greater of CA$100 and 12 months of fees, the data-transfer wording, and the list of privacy rights. /terms, /privacy and /community-guidelines show those files as written; the mobile app links to those pages.
- [ ] Have counsel confirm the age-of-majority table in artifacts/api-server/src/age-of-majority.ts (Canada 19 in BC, NB, NL, NS, NT, NU, YT and 18 elsewhere; US 18 except AL and NE 19, MS 21; checked against public sources on 2026-11-03, not against statutes) and the position on US territories, which are not offered. Also confirm that a birth date used once and not stored is enough for your obligations.
- [ ] **Bump TERMS_VERSION** in artifacts/api-server/src/legal-config.ts once the legal text is final, so everyone is asked to accept it. Do it after the last edit to the Terms, Privacy Policy or Community Guidelines, not before. Bump AI_CONSENT_VERSION in ai-consent.ts whenever what is sent to OpenAI changes.
- [ ] TERMS_ENFORCEMENT is unset in the production environment. If it is `off` the server logs an error-level line at every boot; treat that line as a page.
- [ ] Confirm the support address. It defaults to support@shareswap.app; set SUPPORT_EMAIL in the environment to change it without a release.

### App Store / Play blockers

- [ ] **App Store privacy nutrition label** and **Google Play Data safety form**, filled in to match docs/legal/privacy-policy.md and answered the same way in both. Re-read the Privacy Policy first; where the two disagree, fix the Policy. From the code today:
  - Collected and linked to the person: contact info (email, name, phone number), user content (item photos, profile photo, messages, reviews, wishlist posts), identifiers (user ID, push token, and on the web a device fingerprint used against repeat sign-ups), purchases and financial info (card brand, last four digits and expiry, deposits, payouts, wallet balance; card numbers are held by Stripe), location (postal code, city and radius; item addresses and coordinates; delivery addresses), sensitive/ID data (Persona identity verification: name, ID document and selfie, ID number), province or state and the date age was confirmed (not the date of birth).
  - Shared with third parties: Stripe and Stripe Connect (payments, deposits, payouts), Persona (identity), Google (sign-in), SendGrid (email), Expo and Apple/Google push (notifications), Uber Direct (delivery names, addresses, phone numbers), OpenAI (only after the in-app consent: profile photo, item photos, screenshots, item name), OpenStreetMap Nominatim (place text for geocoding), Replit (hosting, database, photo storage).
  - Tracking and analytics: no advertising SDK and no analytics service found in the code. The website loads the UserJot feedback widget for signed-in people when VITE_USERJOT_PROJECT_ID is set (web only; it is sent the internal user number and nothing else), and the mobile app opens the public board in the browser, so neither adds tracking; it is listed in the Privacy Policy draft. Re-check the final builds, including any SDK added later, before answering "no tracking".
  - Location: the app does not ask for the device's location permission; location is typed or chosen by the person. Confirm that against the final build before answering.
  - Data deletion: account deletion in the app and at https://shareswap.app/delete-account (Play requires the URL); retention exceptions are in the Privacy Policy.
  - Under 18: not offered, so answer "not directed at children". The age check is by age of majority, 18 to 21 depending on where the person lives.
- [ ] **Apple age-rating questionnaire**: answer every question honestly from what the app does, including user-generated content and messaging between strangers, in-app payments and deposits, and the marketplace for physical goods. Do not pick the rating you want; expect 18+ and accept what the questionnaire returns. ShareSwap's minimum account age (the age of majority where the person lives) is a separate decision from Apple's rating. Phase 2 teen accounts (docs/product/teen-accounts-phase-2.md) are not for launch and need a fresh answer if they are ever built.

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
- [x] Owner-return-flow e2e flake. Two causes, both fixed. The first-visit tutorial overlay could open after the spec's one-time check for it and swallow the click on "Confirm Return" (the CI page snapshot showed it); the specs now tell the page the tutorial was seen. And the specs ran in parallel against one server whose setup sweeps unregistered fixtures, one of which a spec creates on purpose, so another spec's setup could delete it before it was counted; the suite now runs on one worker.
- [ ] Switch AI features from Replit AI Integrations to a direct OpenAI API key (OPENAI_API_KEY in Secrets), so user data (incl. profile photos) goes only to OpenAI under its API policy; update the Privacy draft to name OpenAI directly. Replit Core has no model-improvement opt-out.
- [ ] store: false: add it explicitly when you switch to your own OpenAI key. It's harmless there and makes the intent clear.
- [ ] The unused OpenAI call in ai-valuation.ts: delete it during the same switch, so it can't get switched back on by accident.

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
