# App Store / Google Play readiness audit

Scope: `artifacts/shareswap-mobile`, plus the API and web code it depends on.
Method: static code review only. The app was not run on a device and no EAS build was made, so crash risks and the iOS permission-string finding are unverified in a real build.

## Blockers (store rejection or a broken build)

| # | Gap | Evidence | Effort |
|---|---|---|---|
| 1 | **No Sign in with Apple.** Google sign-in is offered alongside email. Apple guideline 4.8 requires an equivalent privacy-preserving option on iOS. | `app/login.tsx` has only Google, email and a phone button. | M. Needs `expo-apple-authentication`, server-side identity-token verification, account linking by email and the config plugin. |
| 2 | **In-app account deletion: built, not yet live.** Settings > Delete Account (and the web page `https://shareswap.app/delete-account`) starts a 14-day grace period, then the account is deleted. See [Account deletion](#account-deletion) for what shipped and the steps that must be done before submission. | Was: the row only opened `mailto:support@shareswap.com` and `deletionRequestedAt` was never written. Now: `account-deletion/` in the API server, `components/AccountDeletionSheet.tsx` and `DeletionPendingBanner.tsx` in the app, `pages/delete-account-page.tsx` on the web. | Done in code. **Open: turn the finalize job on (it ships off), set `BANNED_EMAIL_HASH_KEY`, enter the web URL in Play Console.** |
| 3 | **No user-generated-content safeguards.** Apple 1.2 requires a report mechanism, user blocking, filtering and published contact details. The app has none of them. | The schema has no reports or blocks table. There is no report control on item, profile or chat screens. The "Report an issue" in `ClaimSheet` and `HandoffSheet` is a transaction dispute, not a content report. Chat has no filtering. Admin ban exists (`bannedAt`) but nothing feeds it. | L. Needs report and block tables, endpoints, buttons on listing, chat and profile, hiding blocked users' content, an admin review queue, and a commitment to act within 24 hours. |
| 4 | **No privacy policy or terms anywhere.** Both stores require a privacy policy URL and a link inside the app. Sign-up has no consent step. | A search of the mobile app finds no links. `register.tsx` has no terms or age text. The web app has no `/privacy` or `/terms` route. | S for the links and consent checkbox, plus the legal text itself. |
| 5 | **API address is never set for EAS builds.** `BASE_URL` is `https://${process.env.EXPO_PUBLIC_DOMAIN}`. `eas.json` has no `env`, so a production build would call `https://undefined`. | `lib/api.ts:3`, `eas.json`. | S. Set `EXPO_PUBLIC_DOMAIN=shareswap.app` per build profile. The code treats `shareswap.app` as the verified production host. |
| 6 | **Subscriptions are sold through Stripe in the app.** Apple 3.1.1 requires In-App Purchase for digital subscriptions and features. Paid tiers at $4.99 and $9.99 a month unlock perks. Google Play has similar rules. | `app/subscription.tsx:549` and `:235`. Rentals, deposits and payouts for physical items are generally exempt. No way to buy ShareCoins was found in the mobile code. | L. Choices: IAP (for example RevenueCat), selling subscriptions on web only with no in-app purchase path, or taking the review risk. |
| 7 | **Camera and photo permission strings are probably missing.** `app.json` has no `expo-image-picker` plugin, so iOS purpose strings would be absent. | `ReturnConfirmationSheet.tsx:141-146` launches the camera. The library picker is used in five places. Missing strings usually mean an ITMS-90683 rejection or a crash when the camera opens. | S. Add the plugin with `cameraPermission` and `photosPermission` text. Confirm with `npx expo config --type introspect`. |

## High

| # | Gap | Evidence | Effort |
|---|---|---|---|
| 8 | **Test and dev text shown to users.** Login and Settings show a box reading "API environment: Production / Live accounts and data / API server: <host>". A missing config shows "Check the API configuration". | `ApiEnvironmentLabel` in `login.tsx:154`, `settings.tsx:256` and `:312`. | S. Hide it unless `__DEV__`. |
| 9 | **A placeholder button that doesn't work.** "Continue with Phone Number" opens an alert saying "coming soon". | `login.tsx:128-200`. | S. Remove it. |
| 10 | **Raw server errors reach users.** For non-JSON error bodies the message is `"<status>: <raw body text>"`, and server `message` or `error` strings are shown directly in about 53 places. | `lib/api.ts:69-86`. | M. Map unknown responses to friendly text and keep the raw detail in logs. |
| 11 | **No store listing or release setup.** | `eas.json` has `"submit": {"production": {}}`: no Apple ID, App Store Connect app ID or Play service account. `owner` is `"sharewap"`, which may be a typo. `expo-router` `origin` is `https://replit.com/`. | S–M |
| 12 | **Android push isn't configured for release builds.** There is no `google-services.json` or `android.googleServicesFile`. | `app.json` | S. Upload FCM credentials through EAS. |

## Medium

| # | Gap | Evidence | Effort |
|---|---|---|---|
| 13 | **Notification permission is requested immediately after sign-in, with no explanation first.** | `usePushNotifications.ts:81-90`. A pre-prompt screen would raise acceptance and give the "clear reason" the stores expect. | S |
| 14 | **Icon and splash are placeholders.** The splash and the Android adaptive-icon foreground both reuse the 1024×1024 `icon.png`. The adaptive foreground needs safe-zone padding or it will be cropped, and Android also needs a monochrome icon. The iOS icon is RGB with no alpha, which is fine. | `app.json` | S–M. Needs a design pass. |
| 15 | **Unused location package.** `expo-location` is installed but never imported, so no location prompt exists. "Location" is a free-text field and a postal code. It could confuse the privacy labels if left in. | `package.json` | S. Remove it. |
| 16 | **Dev-only package ships in the release build.** `expo-dev-client` is in `dependencies`. Most Expo runtime packages are in `devDependencies`, which EAS installs, so they work. | `package.json` | S |
| 17 | **Push token logged to console.** | `usePushNotifications.ts:119` | S |

## Already fine

- **Bundle ID and package:** `com.shareswap.mobile` on both platforms.
- **Version numbers:** `appVersionSource` is `remote` with `autoIncrement` on the production profile, so build numbers are handled. Version is `1.0.0`.
- **Encryption declaration:** `ITSAppUsesNonExemptEncryption` is `false`.
- **Error screen:** the crash fallback hides stack traces outside `__DEV__`, and an `ErrorBoundary` wraps the app.
- **Splash and fonts:** the splash hides after fonts load, with a 3-second timeout so it can't hang.
- **Empty states:** the home tab has a "No items yet" state, and queries are gated on `!!user`.
- **Android notifications:** the notification channel is created.

## Data collected (for the privacy labels and Play Data safety)

Read from the `users` table and the API.

- **Contact and identity:** name, display name, email, phone number, username, profile photo, bio. Persona ID verification returns a legal full name and ID/selfie checks, which are likely biometric or government-ID data. Declare it and confirm with Persona's terms.
- **Location:** default postal code, city, radius and a free-text location. This is coarse and user-entered, with no GPS.
- **Financial:** Stripe customer ID, card brand, last 4 digits and expiry, Connect account, balances, transaction history. Card numbers are held by Stripe.
- **User content:** listing photos, chat messages, reviews, claim evidence photos. Listing photos can also be sent to the server's AI valuation, which should be disclosed.
- **Identifiers and usage:** user ID, Expo push token, device fingerprint, last-active time, trust score and activity history.
- **Auth:** Google account ID, hashed password.
- **Tracking:** no ad SDKs, analytics SDKs or cross-app tracking were seen in the mobile code. That points to "Data not used for tracking", but check the web and server for third-party scripts.

## Suggested order

Cheap, high-impact first: #5, #7, #8, #9, #4's links, #12. Then #1 and #3, which take longest (#2 is built; finish its submission steps below). Decide #6 early, since it may change the business model on iOS.

## Account deletion

Blocker #2. The flow, as built:

1. **Request.** Settings > Delete Account (mobile) or `/delete-account` (web, public; it asks for a sign-in first, Google included). The server re-checks eligibility (`GET /api/account/deletion-eligibility`): open bookings that moved money or an item, open claims, deposit settlements in flight, a wallet of $10 or more, money held, or a payout in progress each block it. A balance that would be forfeited needs an acknowledgement. `POST /api/account/deletion/request` then writes `deletionRequestedAt`, sets the account to `pending_deletion`, hides its listings and emails the person's own address with the date and how to cancel.
2. **Grace period, 14 days.** The account stays usable. A banner on Home and Settings (mobile) and on every page (web) shows the date with a Cancel button. A balance of $1 up to $10 can be withdrawn in full with the $10 minimum waived. `POST /api/account/deletion/cancel` undoes it. **Delete now** (`/confirm`) skips the wait.
3. **Finalize.** The job `account-deletion-finalize` (or Delete now) deletes the account: Stripe subscription, Customer and Connect account first, then one transaction that removes the user's own rows, scrubs their side of shared bookings, anonymises the `users` row (`deleted-<id>` placeholders, display name "Former member"), cancels open bookings nothing has moved for, and tells the other side. Running it twice changes nothing. The deleted account cannot sign in, by password or Google, and its sessions end. A completion email goes out.

Kept after deletion (see `account-deletion/manifest.ts` for every column): payment, payout, refund, commission, subscription and deposit records and the bookings they belong to, without free text; claims; reviews the person wrote (author shown as "Former member", comment removed). Handoff PINs and proof, the return-dispute photo and reason, and a rental's return notes stay when the booking has a claim or dispute. Reviews about the person are deleted. A banned person's email is kept only as a keyed hash so they cannot sign up again.

### Before store submission

- [ ] **Turn the finalize job on.** It ships **off**: with `ACCOUNT_DELETION_FINALIZE_MODE` unset, or no `job_switches` row, nothing deletes accounts when the 14 days end. Accounts that asked to be deleted would then stay pending forever, and a reviewer who tests deletion would see exactly that, which fails review. Set `ACCOUNT_DELETION_FINALIZE_MODE=live`, or insert a `job_switches` row named `account-deletion-finalize` (mode `live`, with `updated_by` and `note`). Run it in `dry-run` first: the job's run record in `scheduled_job_runs` (`timer:account-deletion-finalize`) then lists how many accounts are due, would be deleted and are blocked. The background jobs themselves must be running (`REPLIT_DEPLOYMENT` set, or `BACKGROUND_JOBS=on`).
- [ ] **Set `BANNED_EMAIL_HASH_KEY`** in Replit Secrets (see `.env.example`). Without it, deleting a banned account fails on purpose, and sign-up is not checked against banned emails. Never change it after accounts have been deleted, or the stored hashes stop matching.
- [ ] **Enter `https://shareswap.app/delete-account`** as the account-deletion URL in the Play Console (Data safety). Apple needs nothing beyond the in-app path.
- [ ] **Check SendGrid sends the two emails** (deletion requested, deletion done). A failed email is logged and never blocks a deletion.
- [ ] **Run one deletion end to end on a test-mode Stripe account** and check the Customer and Connect account are gone. (A rerun after a failed database step is covered by a test: Stripe's `resource_missing` counts as done.) All automated tests use fake Stripe clients; nothing here has been run against Stripe.
- [ ] **Add the deletion path to the review notes:** Settings > Delete Account, the 14-day grace period, and Delete now.
- [ ] If Sign in with Apple (#1) is added, deletion must also revoke the Apple token; it does not yet.

### Known gaps

- **No retention purge.** The manifest names 7-year (financial, claims) and 2-year (abuse signals) windows, but nothing deletes records when a window ends. Needs its own job before the first window runs out.
- **Connect accounts with a balance.** Stripe refuses to delete a live Connect account that still holds a balance. The deletion goes on, and the refusal is recorded in `connect_cleanup_failures` (user id, account id, Stripe's reason, attempts). The admin dashboard lists the unresolved ones, and every live run of the finalize job retries them until Stripe lets go, so the job must be on for the retries (a dry run retries nothing). Staff may need to settle the balance in the Stripe dashboard. The account id stays on the `users` row.
- **A blocked account waits.** If a booking or claim blocks the deletion when the 14 days end, the account stays pending and the job counts it as `blocked`. The person sees the blocker only if they open Delete now; there is no reminder or admin list yet.
- **Uploaded files** are removed from the server's uploads folder after the transaction, best effort. Backups and any copy elsewhere are not covered, and evidence photos are kept on purpose.
- **Free text** in message metadata and in claim records is not scrubbed. Message text the person wrote is.
- **Placeholders** are `deleted-<id>`. Someone could in theory register that exact username; nothing reserves it.
