# ShareSwap Privacy Policy

> DRAFT for review. Not legal advice: counsel must read it before launch. It describes what the app does today, taken from the code and the account-deletion manifest. The only item still in [square brackets] is the effective date, which is set when TERMS_VERSION is bumped at launch. The AI-provider paragraph is marked for counsel review.

Effective date: [date]. Last updated: [date].

ShareSwap lets neighbours lend, rent, swap and give away things they own. This policy explains what we collect, why, who we share it with, how long we keep it, and what you can do about it. It covers the ShareSwap website and mobile app. The operator is ShareSwap Marketplace Inc., 343-13988 Cambie Rd, Richmond, British Columbia, V6V 2K4, Canada. Questions: support@shareswap.app.

## Who can use ShareSwap

ShareSwap is for people who have reached the age of majority where they live: 19 in British Columbia, New Brunswick, Newfoundland and Labrador, Nova Scotia, the Northwest Territories, Nunavut and Yukon; 18 in the other Canadian provinces; and in the United States 18, except 19 in Alabama and Nebraska and 21 in Mississippi. We do not knowingly collect information from anyone younger. At sign-up we ask for your date of birth and your province or state. We use the date of birth once, to check your age, and do not store it. We store the province or state and the date the check passed. If you believe a minor has an account, write to support@shareswap.app and we will delete it.

## What we collect

**Account details.** Province or state and the date your age was confirmed (not your date of birth), email address, username, handle, display name, full name, password (stored only as a salted hash), phone number if you add one, a short bio, and a profile photo. If you sign in with Google we receive your Google account identifier, name and email address. If you sign in with Apple we receive your Apple account identifier and, if you allow it, your name (Apple sends it once) and your email address, which may be an Apple private-relay address that forwards to you; we also keep a token from Apple, encrypted, so we can end the link when you delete your account.

**Location.** You choose a default postal code and city and a search radius. When you list an item you can add its address or coordinates, and a pickup or drop-off address for a delivery. You can save location alerts, which store keywords, coordinates and a radius. We use location to show you things nearby and to work out distances, and to arrange delivery. The apps do not track your position in the background. We turn a postal code or city into coordinates with the OpenStreetMap Nominatim service (see below).

**Listings and photos.** Item names, descriptions, categories, condition, prices, availability and the photos you upload, including photos taken at handoff and return and photos attached to a dispute or a claim.

**Messages and activity.** Messages you send, requests you make or receive (dates, delivery and deposit choices, notes), reviews and ratings, wishlist posts and offers, ShareCoins balance and history, badges, reputation score, referral codes and referrals.

**Payments.** Payments are handled by Stripe. We store your Stripe customer identifier, the brand, last four digits and expiry of your saved card, deposit and fee records, rental payouts and your wallet balance. We never see or store your full card number. If you earn money from rentals, Stripe Connect holds your payout account and the identity and bank details Stripe collects to pay you; we store only the connected account identifier.

**Identity verification.** If you choose to verify, Persona collects your ID and a selfie and we keep your name and the result. See "Identity verification and face matching" below.

**Devices and technical data.** Push notification tokens and your notification preferences; a session cookie that keeps you signed in; on the web, a device fingerprint built from browser characteristics (screen size, time zone, language, platform), used only to spot repeat sign-ups and referral abuse; your IP address, held in a counter for about 15 minutes to limit repeated sign-in attempts, and in our server logs. We do not use advertising trackers or analytics services, and we do not sell personal information.

**Reports, blocks and safety records.** Reports you make or that are made about you, the people you block, moderation decisions, and the date you accepted our Terms and the version you accepted.

## Identity verification and face matching

If you choose to verify, the check is run by Persona (Persona Identities, Inc.), our ID verification provider, in Persona's own screens. Persona collects images of your government-issued ID and a selfie, and compares your face in the selfie with the photo on the ID (face matching) to decide whether you are the person on the ID. ShareSwap does not receive or store the ID images or the selfie. What ShareSwap receives from Persona is the result (approved, declined or failed) and the name on your ID, and we keep that name, the result, the Persona inquiry reference and a note that Persona verified you. Other members see an "ID verified" badge on your profile and listings once you are approved; they do not see your name from the ID or any of the images. Persona deletes your ID images and selfie about 30 days after your verification is decided. ShareSwap keeps only the result and your name. If you close your account, we ask Persona to delete your verification data straight away (we ask it to redact each of your inquiries and your Persona account, which removes the ID images, selfie, face-match data and personal details it holds for them; if Persona cannot be reached at that moment we keep retrying until it confirms). Until they are deleted, Persona holds this data under its own privacy policy (https://withpersona.com/legal/privacy-policy), and Persona may use it to detect fraud and to improve its service. *[The 30-day period is to be confirmed with Persona and counsel.]*

Before the check starts we show you this and ask you to tick a box agreeing to it. You can decline and keep using ShareSwap, but you cannot borrow or rent without a verified ID. We record that you agreed, when, and which version of the text you agreed to.

*[For counsel review.]* Face matching creates biometric information. Counsel should settle the consent and retention wording for the laws that cover it, including Illinois (BIPA), Texas, Washington and Quebec, and whether a separate explicit consent screen, a written retention schedule and a Persona deletion request on account closure (built: account deletion asks Persona to redact each inquiry, retried until it confirms) are enough before we offer verification in those places. Today the app shows the notice above and requires a ticked box ("I agree to ShareSwap and Persona collecting and using my ID and face data for identity verification.") before Persona starts, and records who agreed, when, and to which version of that text; it has no way to withdraw that consent short of deleting the account, and a minimal record of the consent (your user id, when you agreed and which version of the text, never your name) is kept after the account is deleted, as proof that consent was asked for and given, unless we configure it to be deleted with the account (BIOMETRIC_CONSENT_RETAIN_AFTER_DELETION).

## How we use it

We use your information to run your account; to show listings and wishlists near you; to carry requests from offer to return; to take deposits, fees and payments and to pay out earnings; to send emails and push notifications you need; to verify identity and prevent fraud; to review reports and enforce our Terms and Community Guidelines; to offer the optional AI features you agree to; to meet legal and accounting obligations; and to answer your questions.

## Who we share it with

- **Other members.** Your display name, profile photo, bio, ratings, reviews, listings and approximate location are visible to others. Pickup and delivery addresses are shared with the other person in a request, and with the delivery service, when needed to complete it.
- **Stripe and Stripe Connect** (payments, deposits, subscriptions and payouts).
- **Google** (sign-in with Google).
- **Apple** (sign-in with Apple; Apple also tells us if you stop using ShareSwap with your Apple ID or delete your Apple ID, and we then sign you out or start the deletion of your ShareSwap account).
- **Persona** (identity verification): your ID images and selfie go to Persona directly, not through us; we get back the result and your name; Persona may also use the data to detect fraud and to improve its service (see "Identity verification and face matching" above).
- **Uber Direct** (delivery): the pickup and drop-off names, addresses and phone numbers, and a description of the parcel.
- **Resend** (email): your email address and the content of emails we send, such as verification and password reset.
- **Expo** (push notifications): your push token and the notification text, passed on to Apple or Google to reach your device.
- **OpenAI** (the AI features, only after you agree to each one): see "AI features and your consent" below.
- **OpenStreetMap Nominatim** (looking up coordinates for a postal code or city): the place text you enter.
- **Replit** (hosting, the database and object storage for photos), which stores all of the above on our behalf, and whose AI Integrations service carries the AI requests to OpenAI.
- **UserJot** (feedback widget, website only, and only while it is switched on): your internal user number, so feedback can be tied to your account, and whatever you write in a feedback post. Not your name, email address or the page you are on. Loading the widget also shows UserJot your IP address and browser details, as any website you load from does. The mobile app does not load it: its Send feedback row opens UserJot's public board in your browser and passes nothing about you.
- **Authorities and advisers.** We may disclose information when the law requires it, to report content that appears to be illegal, to protect someone's safety, or to our lawyers and auditors.

Most of these providers are based in the United States, and they and their own service providers may process your information there and in other countries, whose data protection laws may differ from those where you live. We share with each only what it needs for its part, and we choose providers that publish their own security and privacy commitments.

## AI features and your consent

Five features send content to OpenAI, an AI provider, to produce their result. ShareSwap does not hold its own OpenAI account: the requests are made through Replit's AI Integrations service, which forwards them to OpenAI. Each one asks for your permission the first time you use it, names OpenAI, and says what will be shared. Nothing is sent to OpenAI before you agree to that feature, and you can say no and carry on:

- **Profile photo check.** Sends the profile photo you upload, which shows your face, so OpenAI can check that it shows a clear face. If you decline, your photo is saved without the check.
- **SmartScan.** Sends the item photos you give it, to identify the item and fill in its details. If you decline, SmartScan is unavailable and you can fill in the listing yourself.
- **Listing autofill from photos.** Sends up to 3 item photos, to suggest a title, description, condition, category, brand, model and price. If you decline, it is unavailable.
- **Import from a screenshot.** Sends the screenshots you upload (up to 5), which can show whatever the original listing showed, such as names, prices and photos. If you decline, it is unavailable.
- **Category suggestion.** Sends the item name you type, to suggest a category. If you decline, you choose the category yourself.

We never send your name, email address or account details to OpenAI. 

*[For counsel review.]* When you use an AI feature, the content described in the consent prompt is sent to OpenAI through Replit's AI Integrations service. OpenAI does not use API data to train its models by default, but it may keep requests for up to 30 days for abuse monitoring, or longer where required for legal or safety reasons. Replit processes these requests as our infrastructure provider under its own terms and privacy policy. We do not ask either provider to store this content beyond processing the request.

We record your agreement for each feature, with the date and the wording you agreed to, and ask again if the wording changes. You can see and change each choice at any time in Settings under AI features, on the website and in the app, and when you delete your account the record is deleted with it.

## How long we keep it

While your account is open we keep what is described above. When you delete your account, the personal parts are removed after a 14-day grace period (see below). Some records must stay longer:

- **Seven years:** payments, deposits, refunds, payouts, commissions, subscriptions, the bookings they belong to, and security claims and their settlements, to meet tax, accounting and dispute obligations. They no longer carry your name, email, photos or free text.
- **No end date, unless we set one:** the minimal record that you agreed to ID and face data being collected for identity verification (your user id, the time and the version of the text; no name), so we can show that consent was given. *[For counsel: confirm that this record may be kept, and for how long.]*
- **Two years:** evidence of abuse between accounts and the reports, moderation notes and decision records that go with it, so a repeat offender can be recognised.
- **Until it expires:** sign-in counters (about 15 minutes), one-time sign-in tokens (5 minutes), and sessions.
- **No end date:** if you are banned and then delete your account, we keep a keyed one-way hash of your email address (never the address itself) so the ban cannot be avoided by signing up again.

Deleted data may remain in our database backups for up to 7 days before it is permanently overwritten.

## Deleting your account

You can request deletion in the app or at https://shareswap.app/delete-account after signing in. We first check that nothing is still in progress: open requests, claims, deposits or payouts must finish, and a wallet balance of $10 or more must be withdrawn. A balance from $1 to under $10 is offered as a withdrawal, and under $1 is forfeited, after you acknowledge it. Deletion then waits 14 days, during which you can cancel; after that, a job deletes the account. If you signed in with Apple, we first tell Apple to end the link between your Apple ID and ShareSwap (if Apple cannot be reached, the deletion waits and is retried). It removes your profile, province or state, contact details, password, photos, location, saved cards (Stripe customer and, where possible, Connect account), push tokens, wishlists, alerts, notifications, game and ShareCoin history, and verification data. Messages you wrote are replaced with "[Message removed]", your reviews show "Former member" with the comment removed, and your listings are removed from view. Other people's side of shared records stays.

## Your choices and rights

You can edit your profile and location, change notification preferences, withdraw your wallet balance, block members, and delete your account. Under the privacy laws that apply in Canada (such as PIPEDA, and the provincial laws of British Columbia, Alberta and Quebec) and in many US states (such as the California Consumer Privacy Act), you may also have the right to ask for a copy of your information, to have it corrected or deleted, to withdraw a consent you gave, to object to or limit some uses, and not to be treated worse for using these rights. We do not sell your personal information or share it for advertising. Write to support@shareswap.app and we will reply within 30 days; you can also ask us to treat a request from someone acting for you. If you are not satisfied, you may complain to the Office of the Privacy Commissioner of Canada, your provincial or state regulator, or your state attorney general.

## Security

Passwords are hashed, traffic is encrypted, and access to the database is limited. No system is perfectly secure; if a breach affects you we will tell you as the law requires.

## Changes

If we change this policy in a way that matters, we will tell you in the app or by email before it takes effect.

## Contact

support@shareswap.app. Post: ShareSwap Marketplace Inc., 343-13988 Cambie Rd, Richmond, British Columbia, V6V 2K4, Canada.
