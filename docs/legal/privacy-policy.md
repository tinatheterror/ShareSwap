# ShareSwap Privacy Policy

> DRAFT for review. Not legal advice: counsel must read it before launch. It describes what the app does today, taken from the code and the account-deletion manifest. Items in [square brackets] are for you to fill in or decide.

Effective date: [date]. Last updated: [date].

ShareSwap lets neighbours lend, rent, swap and give away things they own. This policy explains what we collect, why, who we share it with, how long we keep it, and what you can do about it. It covers the ShareSwap website and mobile app. The operator is [legal entity name and address]. Questions: support@shareswap.app.

## Who can use ShareSwap

ShareSwap is for people who have reached the age of majority where they live: 19 in British Columbia, New Brunswick, Newfoundland and Labrador, Nova Scotia, the Northwest Territories, Nunavut and Yukon; 18 in the other Canadian provinces; and in the United States 18, except 19 in Alabama and Nebraska and 21 in Mississippi. We do not knowingly collect information from anyone younger. At sign-up we ask for your date of birth and your province or state. We use the date of birth once, to check your age, and do not store it. We store the province or state and the date the check passed. If you believe a minor has an account, write to support@shareswap.app and we will delete it.

## What we collect

**Account details.** Province or state and the date your age was confirmed (not your date of birth), email address, username, handle, display name, full name, password (stored only as a salted hash), phone number if you add one, a short bio, and a profile photo. If you sign in with Google we receive your Google account identifier, name and email address.

**Location.** You choose a default postal code and city and a search radius. When you list an item you can add its address or coordinates, and a pickup or drop-off address for a delivery. You can save location alerts, which store keywords, coordinates and a radius. We use location to show you things nearby and to work out distances, and to arrange delivery. The apps do not track your position in the background. We turn a postal code or city into coordinates with the OpenStreetMap Nominatim service (see below).

**Listings and photos.** Item names, descriptions, categories, condition, prices, availability and the photos you upload, including photos taken at handoff and return and photos attached to a dispute or a claim.

**Messages and activity.** Messages you send, requests you make or receive (dates, delivery and deposit choices, notes), reviews and ratings, wishlist posts and offers, ShareCoins balance and history, badges, reputation score, referral codes and referrals.

**Payments.** Payments are handled by Stripe. We store your Stripe customer identifier, the brand, last four digits and expiry of your saved card, deposit and fee records, rental payouts and your wallet balance. We never see or store your full card number. If you earn money from rentals, Stripe Connect holds your payout account and the identity and bank details Stripe collects to pay you; we store only the connected account identifier.

**Identity verification.** If you choose to verify, Persona collects your name, ID document and a selfie on our behalf. We keep your name, ID number, the Persona inquiry reference and the result.

**Devices and technical data.** Push notification tokens and your notification preferences; a session cookie that keeps you signed in; on the web, a device fingerprint built from browser characteristics (screen size, time zone, language, platform), used only to spot repeat sign-ups and referral abuse; your IP address, held in a counter for about 15 minutes to limit repeated sign-in attempts, and in our server logs. We do not use advertising trackers or third-party analytics, and we do not sell personal information.

**Reports, blocks and safety records.** Reports you make or that are made about you, the people you block, moderation decisions, and the date you accepted our Terms and the version you accepted.

## How we use it

We use your information to run your account; to show listings and wishlists near you; to carry requests from offer to return; to take deposits, fees and payments and to pay out earnings; to send emails and push notifications you need; to verify identity and prevent fraud; to review reports and enforce our Terms and Community Guidelines; to offer the optional AI features you agree to; to meet legal and accounting obligations; and to answer your questions.

## Who we share it with

- **Other members.** Your display name, profile photo, bio, ratings, reviews, listings and approximate location are visible to others. Pickup and delivery addresses are shared with the other person in a request, and with the delivery service, when needed to complete it.
- **Stripe and Stripe Connect** (payments, deposits, subscriptions and payouts).
- **Google** (sign-in with Google).
- **Persona** (identity verification).
- **Uber Direct** (delivery): the pickup and drop-off names, addresses and phone numbers, and a description of the parcel.
- **SendGrid** (email): your email address and the content of emails we send, such as verification and password reset.
- **Expo** (push notifications): your push token and the notification text, passed on to Apple or Google to reach your device.
- **OpenAI** (the AI features, only after you agree to each one): see "AI features and your consent" below.
- **OpenStreetMap Nominatim** (looking up coordinates for a postal code or city): the place text you enter.
- **Replit** (hosting, the database and object storage for photos), which stores all of the above on our behalf.
- **Authorities and advisers.** We may disclose information when the law requires it, to report content that appears to be illegal, to protect someone's safety, or to our lawyers and auditors.

These providers may process data in countries other than your own. [Counsel: add the transfer mechanism and the list of countries.]

## AI features and your consent

Five features send content to OpenAI, an AI provider, to produce their result. [Confirm: requests are routed through Replit's AI Integrations service, which forwards them to OpenAI.] Each one asks for your permission the first time you use it, names OpenAI, and says what will be shared. Nothing is sent to OpenAI before you agree to that feature, and you can say no and carry on:

- **Profile photo check.** Sends the profile photo you upload, which shows your face, so OpenAI can check that it shows a clear face. If you decline, your photo is saved without the check.
- **SmartScan.** Sends the item photos you give it, to identify the item and fill in its details. If you decline, SmartScan is unavailable and you can fill in the listing yourself.
- **Listing autofill from photos.** Sends up to 3 item photos, to suggest a title, description, condition, category, brand, model and price. If you decline, it is unavailable.
- **Import from a screenshot.** Sends the screenshots you upload (up to 5), which can show whatever the original listing showed, such as names, prices and photos. If you decline, it is unavailable.
- **Category suggestion.** Sends the item name you type, to suggest a category. If you decline, you choose the category yourself.

We never send your name, email address or account details to OpenAI. We ask OpenAI not to use this content to train its models. [Counsel and engineering: confirm the terms that apply to the AI Integrations service, including OpenAI's retention of requests, and update this sentence to match.]

We record your agreement for each feature, with the date and the wording you agreed to, and ask again if the wording changes. You can see and change each choice at any time in Settings under AI features, on the website and in the app, and when you delete your account the record is deleted with it.

## How long we keep it

While your account is open we keep what is described above. When you delete your account, the personal parts are removed after a 14-day grace period (see below). Some records must stay longer:

- **Seven years:** payments, deposits, refunds, payouts, commissions, subscriptions, the bookings they belong to, and security claims and their settlements, to meet tax, accounting and dispute obligations. They no longer carry your name, email, photos or free text.
- **Two years:** evidence of abuse between accounts and the reports, moderation notes and decision records that go with it, so a repeat offender can be recognised.
- **Until it expires:** sign-in counters (about 15 minutes), one-time sign-in tokens (5 minutes), and sessions.
- **No end date:** if you are banned and then delete your account, we keep a keyed one-way hash of your email address (never the address itself) so the ban cannot be avoided by signing up again.

Backups roll off on the hosting provider's normal schedule. [Confirm backup retention.]

## Deleting your account

You can request deletion in the app or at https://shareswap.app/delete-account after signing in. We first check that nothing is still in progress: open requests, claims, deposits or payouts must finish, and a wallet balance of $10 or more must be withdrawn. A balance from $1 to under $10 is offered as a withdrawal, and under $1 is forfeited, after you acknowledge it. Deletion then waits 14 days, during which you can cancel; after that, a job deletes the account. It removes your profile, province or state, contact details, password, photos, location, saved cards (Stripe customer and, where possible, Connect account), push tokens, wishlists, alerts, notifications, game and ShareCoin history, and verification data. Messages you wrote are replaced with "[Message removed]", your reviews show "Former member" with the comment removed, and your listings are removed from view. Other people's side of shared records stays.

## Your choices and rights

You can edit your profile and location, change notification preferences, withdraw your wallet balance, block members, and delete your account. Depending on where you live you may also have the right to ask for a copy of your information, to correct it, to object to or restrict how we use it, and to complain to your data protection authority. Write to support@shareswap.app and we will reply within 30 days. [Counsel: add the specific rights, such as GDPR, PIPEDA or CCPA, that apply to your members.]

## Security

Passwords are hashed, traffic is encrypted, and access to the database is limited. No system is perfectly secure; if a breach affects you we will tell you as the law requires.

## Changes

If we change this policy in a way that matters, we will tell you in the app or by email before it takes effect.

## Contact

support@shareswap.app. [Postal address.]
