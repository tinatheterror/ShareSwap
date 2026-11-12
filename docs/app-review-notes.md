# App Review notes (draft)

For the **App Review Information > Notes** field in App Store Connect (and the equivalent "App access" and policy notes in Play Console). Everything between the two `---` lines under "Paste into App Store Connect" is written to Apple's reviewer; the sections around it are for you. Fill every `[PLACEHOLDER]` before submitting, and delete the bracketed instructions.

Prices are in Canadian dollars at checkout (the app shows `$4.99/mo` and `$9.99/mo`).

## Decisions and risks to read first (not for Apple)

1. **Subscriptions through Stripe, not In-App Purchase.** Decided (go-live checklist #6). The argument is that Member and Pro only change limits and fees on **physical services consumed outside the app** (guideline 3.1.3(e)). The risk: a reviewer may read "Unlimited borrows" as an in-app feature unlocked by a subscription, which guideline 3.1.1 sends through In-App Purchase. The notes below say plainly what the plans do and do not unlock so the reviewer can judge it. If Apple rejects it, the fallbacks are in docs/app-store-readiness.md blocker #6 (IAP, or web-only purchase with no in-app path).
2. **The test card works only against Stripe test mode.** Stripe's test card numbers (4242 4242 4242 4242) are refused by live keys. Decided: option (b), a demo account that already has a saved card and the Member plan, so nothing needs to be paid for. The notes below say real payment is not needed. (If you later prefer a separate review environment on Stripe test mode, or a real card with a small limit, the "Payments" paragraph must change.)
3. **The demo account is made by a script, but it needs real Stripe objects.** The app re-checks the stored card and plan against Stripe: a card whose customer Stripe does not know is cleared the first time Settings > Payment Methods opens, and a Member plan with no live Member subscription is corrected to Free the first time the Subscription screen opens. So a database-only account would lose both within seconds of the reviewer's first tap. See "Create the demo account" below: you make the Stripe customer, card and a $0 Member subscription by hand, and the script links them after checking them. What it does and does not give the account:
   - Verified badge: an approved verification row marked `DEMO_ACCOUNT` with no Persona inquiry id (so `persona:reset-sandbox` never touches it). No ID was checked; the notes tell Apple it is a demo account.
   - Terms and age gate passed, email verified, location set, one completed borrow with a demo lender (a second account that cannot sign in) and one listing of that lender, "Demo camping tent". **The lender and the listing are visible to every member in production**, and the listing has no photo. Add a few more listings by hand if the reviewer should have more to browse.
   - **Not seeded: the first-visit tutorial.** It is remembered on the device (`hasSeenTutorial_<id>` in the web app's local storage; I found no equivalent for the mobile app), not in the database, so the reviewer sees it once. It will not carry over from your own test sign-in to Apple's device.
4. **Keep a second, disposable account for the reviewer to delete.** Account deletion starts a 14-day countdown, so deleting the main demo account would end the demo. Give the reviewer two accounts (below) and tell them which one to delete.
5. **Server settings the reviewer depends on** (go-live checklist): `ACCOUNT_DELETION_FINALIZE_MODE=live` (otherwise "Delete now" works but the 14-day path stays pending forever), the Sign in with Apple secrets, `MODERATION_EMAIL` and a person reading that inbox, and Resend sending from `support@shareswap.app`.

## Create the demo account (you run this, in production)

1. **In the Stripe dashboard (live mode)** make: a customer (for example "Demo Reviewer"); a card on it, your own card (it is never charged: the subscription below is $0), set as the customer's default payment method; and a subscription on the **ShareSwap Member** product's CAD price with a 100% off coupon, duration "forever", so the plan shows Member and renews at $0. (The Member product is the one whose metadata has `tier=member`; the script refuses any other.) Copy the ids `cus_...`, `pm_...`, `sub_...`.
2. **Dry run** (reads the database and Stripe, writes nothing; it lists every problem it finds):

   ```
   DEMO_EMAIL=demo@shareswap.app pnpm --filter @workspace/api-server run demo:seed-reviewer \
     --stripe-customer=cus_... --stripe-payment-method=pm_... --stripe-subscription=sub_...
   ```

   `DEMO_EMAIL` must be lowercase: it is also the sign-in name, and the app matches it exactly.
3. **Apply**, with a password of at least 12 characters in the environment (never on the command line). It is refused unless `ALLOW_NON_TEST_DATABASE` names the production database, like the other cleanup scripts:

   ```
   DEMO_EMAIL=demo@shareswap.app DEMO_PASSWORD='...' ALLOW_NON_TEST_DATABASE=<production database name> \
     pnpm --filter @workspace/api-server run demo:seed-reviewer --apply \
     --stripe-customer=cus_... --stripe-payment-method=pm_... --stripe-subscription=sub_...
   ```

   It is safe to run twice (existing rows are updated, nothing is duplicated); the password changes only when `DEMO_PASSWORD` is set. It creates nothing in Stripe.
4. Sign in on a real iPhone, open Settings > Payment Methods and the Subscription screen (this is the test that Stripe agrees with the database), then check the Verified badge and the completed transaction.
5. The disposable deletion account is still made by hand (sign up normally, accept the terms); it must have no booking, claim or wallet balance.

Tested against a local database (create, rerun, no duplicates) and with fake Stripe responses for the checks; **not** run against real Stripe or production.

## Paste into App Store Connect

---

**About ShareSwap.** ShareSwap is a community marketplace where neighbours borrow, rent, swap and give away physical items (tools, camping gear, books, kitchen equipment). It is offered in Canada and the United States. Every transaction ends with a physical item handed from one person to another.

**Test accounts.** Sign in with email and password on the first screen.

- Main demo account: `[DEMO_EMAIL]` / `[DEMO_PASSWORD]` (a demo account: its verification was set up for review, so you do not need to go through the ID check). The "Verified" badge shows, a payment card is saved, the Member plan is active, and one borrow is already completed. Use this one for everything except deleting an account.
- Disposable account for the deletion check: `[DELETE_ME_EMAIL]` / `[DELETE_ME_PASSWORD]`. It has no open bookings, no claims and no wallet balance, so deletion is allowed.
- Sign in with Apple is also offered (Apple's own sign-in sheet, "Hide My Email" supported).

**Payments.** Rentals and deposits are paid to other members for physical items and are processed by Stripe; they are not digital goods. You do not need to pay for anything to review the app: the demo account already has a saved card (`[CARD_BRAND_AND_LAST4: as shown in Settings > Payment Methods]`) and the Member plan, which is on a $0 review subscription. Please do not replace or remove the saved card.

**Subscriptions (Profile tab > your plan card > Subscription screen).** The Member plan ($4.99/month) and Pro plan ($9.99/month) are billed through Stripe, not In-App Purchase, because they only change limits and fees on **physical services used outside the app**:

- Free: 3 borrows per month, a 5% service fee on rentals.
- Member: unlimited borrows.
- Pro: unlimited borrows, a 4% rental service fee instead of 5%, and the $1.50 courier fee waived for 5 deliveries a month.

The plans unlock **no digital content, no app features, no virtual goods and no content or media**. Every screen and feature of the app is available on the Free plan; the plans change only the borrow limit and the fees above. The "ShareCoins" shown in the app are loyalty points with no cash value that cannot be bought; they are not sold in the app.

**Deleting an account (guideline 5.1.1(v)).** Sign in with the disposable account, then Settings > Delete Account. The app shows what will happen, and the account is deleted after a 14-day grace period during which it can be cancelled from the banner on Home and Settings. To skip the wait, choose "Delete now" on the confirmation screen; the account is deleted immediately, signed out, and cannot sign in again. Accounts created with Sign in with Apple also have the Apple sign-in grant revoked. Deletion is refused while the person has an open booking, an open claim or a wallet balance of $10 or more, and the app says which; the disposable account has none of these. The same flow is on the web at https://shareswap.app/delete-account.

**User-generated content (guideline 1.2).**

- Terms and Community Guidelines (zero tolerance for objectionable content and abusive users) must be accepted at sign-up and again whenever they change; the links are at sign-up, on the acceptance screen, and in Settings.
- **Report**: on a listing (item screen), a profile, a review, a wishlist post and any message in a chat (press and hold the message).
- **Block**: from a profile or the "Report or block" menu in a chat, item screen or wishlist post; blocked people can no longer see the blocker's listings or profile or contact them. Settings > Blocked users lists them and allows unblocking.
- Text is filtered on the server before it is published; reports go to a moderation queue and an inbox (`moderation@shareswap.app`), and we aim to act on every report within 24 hours (removal of the content and, for abusive users, ban).
- Published contact: `support@shareswap.app`.

**Age.** Members must be of the age of majority where they live (18 in most places, 19 in some provinces and states, 21 in Mississippi). The app asks for a date of birth once at sign-up to check this; the date of birth itself is not stored. The app is not directed at children.

**Identity verification (optional).** Members can verify their identity through Persona (a government ID and a selfie face match) and add a payment card to earn the "Verified" badge. Before it starts, the app shows a biometric-data notice and a required consent checkbox. Persona deletes the personal data 30 days after the check is decided. The demo account is already verified, so you do not need to go through it.

**Permissions.** Camera and photo library: to photograph items for listings and to record an item's condition at return. Notifications: asked after sign-in, with an explanation screen first. The app does not ask for location, contacts, microphone or tracking permission, and does not track users across other companies' apps or websites.

**Third parties that receive data:** Stripe (payments and payouts), Persona (identity verification), Resend (email), Expo and Apple (push notifications), Uber Direct (courier deliveries; name, address and phone number of a delivery), OpenAI (only after the member agrees in the app, for optional AI helpers that read item photos, screenshots and the item name) and Google (Google sign-in).

**Contact.** `[YOUR_NAME]`, `[YOUR_PHONE]`, `support@shareswap.app`. Available during review.

---

## Before you submit

- [ ] Demo account created with `demo:seed-reviewer` and the disposable account made by hand, both signed in once on a real iPhone (Payment Methods and Subscription screens opened: the card and plan must still be there afterwards).
- [ ] Every `[PLACEHOLDER]` above filled in.
- [ ] The privacy policy URL (`https://shareswap.app/privacy`) and the support URL load without signing in.
- [ ] The sign-in screen shows no "API environment" box (it only appears in development builds; see docs/app-store-readiness.md #8).
- [ ] Re-read every claim above against the final build; this draft was written from the code, and the app was not run on a device.
- [ ] Play Console: enter the account-deletion URL `https://shareswap.app/delete-account` in the Data safety form, and put the same demo accounts under App access.
