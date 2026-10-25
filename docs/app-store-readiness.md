# App Store / Google Play readiness audit

Scope: `artifacts/shareswap-mobile`, plus the API and web code it depends on.
Method: static code review only. The app was not run on a device and no EAS build was made, so crash risks and the iOS permission-string finding are unverified in a real build.

## Blockers (store rejection or a broken build)

| # | Gap | Evidence | Effort |
|---|---|---|---|
| 1 | **No Sign in with Apple.** Google sign-in is offered alongside email. Apple guideline 4.8 requires an equivalent privacy-preserving option on iOS. | `app/login.tsx` has only Google, email and a phone button. | M. Needs `expo-apple-authentication`, server-side identity-token verification, account linking by email and the config plugin. |
| 2 | **No in-app account deletion.** The Settings "Delete Account" row only opens `mailto:support@shareswap.com`. Apple 5.1.1(v) and Google Play both require deletion to start in the app, and Play also wants a web deletion URL. | `app/settings.tsx:509-517`. The server has only `/api/account/deactivate`, which keeps all data. `deletionRequestedAt` is read in `routes.ts:15969` and never written. | M–L. Needs a delete endpoint, anonymising retained financial and dispute records, handling Stripe customer and Connect accounts, and blocking while a request is active. |
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

Cheap, high-impact first: #5, #7, #8, #9, #4's links, #12. Then #2, #1 and #3, which take longest. Decide #6 early, since it may change the business model on iOS.
