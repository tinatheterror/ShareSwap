# Store forms: draft answers

For you to enter in App Store Connect (App Privacy and the age-rating questionnaire) and Play Console (Data safety, content rating). Written 2026-11-12 from the code, `docs/legal/privacy-policy.md` (still a draft) and `docs/go-live-checklist.md`. The app was not run on a device.

**Read this first**

- The three forms must agree with each other and with the Privacy Policy. Where the Policy and these answers differ, fix the Policy (the checklist rule), then re-read this file.
- Question wording changes. I wrote category names from memory of the current forms; match each row to what the form shows on screen. Where a row says **Decide**, the code does not settle it and I give a recommendation.
- Over-declaring is cheap and under-declaring can get the app pulled, so where unsure I recommend declaring.
- **Re-check the final builds before answering "no tracking" or "no third-party SDK".** At the time of writing, the mobile app's only SDKs relevant to data are `expo-notifications` (push), `expo-apple-authentication`, `expo-image-picker` and `expo-image`. No analytics, advertising, crash-reporting or attribution SDK is installed in the mobile app, the web app or the API server (checked the three `package.json` files). Stripe's browser library (`@stripe/stripe-js`) is in the web app only; the mobile app does not embed Stripe's SDK (card entry and authentication open Stripe-hosted pages in the browser).
- **Privacy policy URL** (both stores): `https://shareswap.app/privacy`. **Account-deletion URL** (Play): `https://shareswap.app/delete-account`. **Support URL / contact**: `support@shareswap.app`.

## 1. What the code collects, and who else gets it

| Data | Where it comes from | Kept? | Goes to |
|---|---|---|---|
| Name, display name, username, email, phone number (optional), bio, profile photo | sign-up, profile | Yes, until the account is deleted | Our servers (Replit hosting, database and photo storage). Email goes to Resend to send mail. |
| Password | sign-up | Hashed | Our servers only |
| Google account ID, Apple ID (`sub`), encrypted Apple refresh token (used only to revoke the grant on deletion), Apple "Hide My Email" relay address | Google / Apple sign-in | Yes | Our servers |
| Date of birth | one-time age check at sign-up | **No.** Only the age-confirmed time and region are stored | Used in the request, then discarded |
| Postal code, city, search radius, free-text location, saved location alerts (keywords, coordinates, radius) | profile, alerts | Yes | Our servers; place text goes to OpenStreetMap Nominatim to get coordinates |
| Item addresses / coordinates (stored to 8 decimal places), pickup and drop-off addresses for deliveries | listings, delivery | Yes | Our servers; Uber Direct receives name, address and phone for a courier delivery |
| Listing photos, condition and return-evidence photos, screenshots, chat messages, reviews, wishlist posts | in-app | Yes (evidence kept on purpose after deletion; see the deletion manifest) | Our servers and storage. Photos, screenshots and the item name go to OpenAI **only after** the member consents to the AI features (`ai-consent.ts` lists the five) |
| Government ID document, selfie, ID number, name as on the ID, face-match result | Persona hosted check | Persona wipes personal data 30 days after the decision (Persona's policy, confirmed in the checklist); we keep the decision, the ID number and a consent record | Persona. Biometric consent (notice and required checkbox) comes first |
| Card brand, last four, expiry, Stripe customer and Connect IDs, wallet balance, deposits, payouts, refunds, transaction history, subscription status | payments | Yes (7-year financial records, see the manifest) | Stripe and Stripe Connect. Full card numbers never reach us |
| Expo push token, notification preferences | after the notification prompt | Yes | Expo push service, then Apple/Google push |
| User ID, trust score, activity history, last-active time, ShareCoins, achievements | use of the app | Yes | Our servers |
| IP address | every request | Server logs; a 15-minute rate-limit counter | Our servers |
| Device fingerprint (screen size, time zone, language, platform) | **web only**, to spot repeat sign-ups and referral abuse | Yes | Our servers. Not collected by the mobile app (no fingerprint code in the app) |
| Feedback board | mobile opens the public UserJot board in the browser; the web loads the UserJot widget for signed-in people when `VITE_USERJOT_PROJECT_ID` is set and sends it the internal user number only | n/a | UserJot (web widget only) |

**No data is sold, no advertising SDK, no analytics service, no cross-app or cross-site tracking.** The seeded puzzle games carry a `sponsorName` field (`init-games.ts`); the mobile app never displays it (no reference in `shareswap-mobile`), and no ad network is involved. Check whether the web games page shows it before answering "Advertising: No" for the web.

## 2. Apple: App Privacy ("nutrition label")

Answer **Yes, we collect data**. For every type below: **Linked to the user's identity: Yes. Used to track the user: No.** Purposes use Apple's list; "App Functionality" includes authentication, fraud prevention and security.

| Apple category > type | Collect? | Purposes | Notes |
|---|---|---|---|
| Contact Info > Name | Yes | App Functionality | |
| Contact Info > Email Address | Yes | App Functionality | account, receipts, deletion notices |
| Contact Info > Phone Number | Yes | App Functionality | optional field; also given to Uber Direct for deliveries |
| Contact Info > Physical Address | Yes | App Functionality | pickup and delivery addresses |
| Contact Info > Other User Contact Info | No | | |
| Health & Fitness | No | | |
| Financial Info > Payment Info | Yes | App Functionality | card brand, last four, expiry. Entered on Stripe-hosted screens; full numbers never reach us. Declare anyway |
| Financial Info > Other Financial Info | Yes | App Functionality | wallet balance, deposits, payouts, transaction history |
| Location > Coarse Location | Yes | App Functionality (nearby items, distances) | postal code, city, radius; typed by the person, not read from the device |
| Location > Precise Location | **Decide; recommend Yes** | App Functionality | item and delivery coordinates are stored to 8 decimals. They are typed or chosen addresses, not GPS, and the app never asks for the device location permission; but they locate a person's address. Confirm how precisely other members see an item's location |
| Sensitive Info | **Yes** (biometric) | App Functionality (identity verification, fraud prevention) | Persona face match, performed by Persona on our behalf. Have counsel / Persona confirm; I recommend declaring |
| Contacts | No | | the app never reads the address book |
| User Content > Emails or Text Messages | Yes | App Functionality | chat messages |
| User Content > Photos or Videos | Yes | App Functionality | listing, profile and evidence photos; ID and selfie images are captured on Persona's page |
| User Content > Audio, Gameplay Content | No | | puzzle scores only produce ShareCoins (not collected as gameplay content; **Decide** if you want to be strict) |
| User Content > Customer Support | Yes | App Functionality | emails to support@ and report/dispute text |
| User Content > Other User Content | Yes | App Functionality | reviews, bio, wishlist posts, item descriptions, location alerts |
| Browsing History | No | | |
| Search History | No | | searches are not stored; saved location alerts are listed under Other User Content |
| Identifiers > User ID | Yes | App Functionality | |
| Identifiers > Device ID | Yes | App Functionality | the push token. It is not an advertising identifier |
| Purchases > Purchase History | Yes | App Functionality | bookings, rentals, subscription |
| Usage Data > Product Interaction | Yes | App Functionality | trust score, activity history, last-active time |
| Usage Data > Advertising Data / Other Usage Data | No | | |
| Diagnostics > Crash Data, Performance Data, Other | No | | no crash or performance SDK. Server logs hold IP addresses (security) |
| Surroundings, Body, Other Data Types | No | | date of birth is used once and not stored, so it is not "collected" under Apple's definition (data used only in real time to answer the request). **Decide** if you want to declare it anyway |

**Tracking:** "No, we do not track." Data is not combined with other companies' data for advertising or measurement, and not shared with data brokers.

## 3. Google Play: Data safety

**Does the app collect or share required user data types? Yes.** **Is all of it encrypted in transit? Yes** (HTTPS only). **Can people request deletion? Yes**, in the app (Settings > Delete Account) and at `https://shareswap.app/delete-account`. **Independent security review: No. Play Families: No.**

Google's "shared" excludes transfers to a **service provider** that processes data on your behalf, user-initiated transfers with clear disclosure, and legal requests. So Stripe, Persona, Resend, Expo/Google push, OpenAI (after consent) and our host are listed as **collected, not shared**. Uber Direct (an independent courier network) and, for Google sign-in, Google are the judgement calls; I recommend **Shared** for Uber Direct on the three rows marked so.

| Play category > type | Collected | Shared | Required or optional | Purposes |
|---|---|---|---|---|
| Location > Approximate location | Yes | No | Optional | App functionality |
| Location > Precise location | **Decide; recommend Yes** (same reason as Apple) | No | Optional | App functionality |
| Personal info > Name | Yes | **Yes** (Uber Direct, courier deliveries only) | Required | App functionality, account management |
| Personal info > Email address | Yes | No | Required | App functionality, account management, communications |
| Personal info > User IDs | Yes | No | Required | App functionality, account management |
| Personal info > Address | Yes | **Yes** (Uber Direct, courier deliveries only) | Optional | App functionality |
| Personal info > Phone number | Yes | **Yes** (Uber Direct, courier deliveries only) | Optional | App functionality |
| Personal info > Other info | Yes | No | Optional | App functionality, fraud prevention: government ID number and the identity-verification result (Persona) |
| Financial info > User payment info | Yes | No | Optional | App functionality (card brand, last four, expiry) |
| Financial info > Purchase history | Yes | No | Required to transact | App functionality |
| Financial info > Other financial info | Yes | No | Required to transact | App functionality (wallet, deposits, payouts) |
| Messages > Other in-app messages | Yes | No | Optional | App functionality |
| Photos and videos > Photos | Yes | No | Optional | App functionality, fraud prevention (listing, profile, evidence, ID and selfie images) |
| App activity > Other user-generated content | Yes | No | Optional | App functionality (reviews, wishlist posts, bio) |
| App activity > App interactions | Yes | No | Required | App functionality, fraud prevention (trust score, activity history) |
| Device or other IDs | Yes | No | Optional | App functionality (push token) |
| App info and performance, Health, Audio, Contacts, Calendar, Files, Web browsing | No | | | no crash or diagnostics SDK |

Data that never leaves the person's device and is not collected: nothing extra to declare. The permission prompts are camera, photo library and notifications only.

## 4. Apple age rating questionnaire

Answer from what the app does. Do not steer to a rating; expect **18+** (the minimum age is the age of majority where the person lives, 18 to 21) and accept what the questionnaire returns. Apple's current questionnaire groups questions as below; if a question is new or renamed, answer by the same facts.

| Question area | Answer | Why |
|---|---|---|
| Parental controls | No | none built |
| Age assurance | Yes | date-of-birth check against the local age of majority (not stored) |
| Unrestricted web access | No | the app opens specific pages (Stripe, Persona, legal pages) in the system browser; there is no browser inside it |
| **User-generated content** | **Yes** | listings, photos, reviews, wishlist posts |
| **Messaging and chat** | **Yes** | chat between members who do not know each other |
| Advertising | No | no ads in the app; the games' sponsor field is not shown in the mobile app |
| Medical or treatment information; health and wellness topics | None | |
| Alcohol, tobacco or drug use or references | None | built-in content has none; the guidelines prohibit drug listings |
| Profanity or crude humor | None built in | text filter on posts; UGC is covered by the UGC answer |
| Sexual content or nudity; mature or suggestive themes | None | prohibited by the guidelines; no built-in content |
| Horror or fear themes | None | |
| Violence (cartoon, realistic, graphic) and guns or other weapons | None | weapons listings are prohibited |
| Simulated gambling | **None** | the three puzzle games (Memory Match, Number Puzzle, Word Quest) have no stakes or odds |
| Real-money gambling or contests | None | no |
| Loot boxes | None | ShareCoins cannot be bought |

Payments for physical items and deposits, and the marketplace itself, are not age-rating questions but come up in review: see `docs/app-review-notes.md`. Teen accounts (phase 2) are not built; if they ever are, answer again.

## 5. Google Play content rating (IARC questionnaire)

Category: **Social / Communication or Shopping** (marketplace). Answers: violence **No**, sexuality **No**, language **No**, controlled substances **No**, gambling **No**; **users can interact: Yes**; **users can share user-generated content: Yes**; **shares the user's location with others: Decide** (the item's location is shown to nearby members; it is a typed address or area, never live position); **digital purchases: Yes** if the questionnaire counts subscriptions (Stripe-billed Member and Pro plans), otherwise No; **unrestricted internet access: No**. Target audience: **18 and over only**, not directed at children.

## 6. Before you enter anything

- [ ] Read the final Privacy Policy and change the tables above wherever it differs.
- [ ] Decide the three **Decide** rows: Precise Location, Sensitive Info wording and the date-of-birth note.
- [ ] Ask Persona (or counsel) whether the face-match data counts as "collected by us" for Apple's Sensitive Info type; I recommend Yes.
- [ ] Confirm the web games page does not show the sponsor names as advertising.
- [ ] Inspect the built app (`npx expo config --type introspect` and the Info.plist / manifest) to confirm only camera, photo-library and notification permissions are declared and no tracking SDK slipped in.
- [ ] Re-do this file if any SDK is added later (Apple Pay / `@stripe/stripe-react-native` is a parked item that would add one).
