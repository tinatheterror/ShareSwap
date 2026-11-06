# Content safeguards: design

Status: built (steps 1 to 6). It covers go-live checklist item #3 (Apple guideline 1.2). The sections below are the original design; "As built" at the end lists what differs and what is left.

## What Apple requires

An app with user-generated content needs all of these, and App Review tests them:

1. A way to **filter objectionable material** before it is shown.
2. A way for users to **report** content and users, with a **timely response** (Apple's stated bar is action within 24 hours).
3. A way to **block** abusive users, with immediate effect.
4. **Published contact information**.
5. Terms that users **agree to before** posting, saying objectionable content and abusive users are not tolerated.

## What the code does today

Checked in the repo on 2026-11-02:

- **No report or block anywhere.** No tables, no API routes, no mobile calls.
- **Anyone can message anyone.** `POST /api/messages` needs only a verified email. It does not check that the two users share a request, and does not validate `receiverId` or `content`. Block enforcement has to start here.
- **Moderator tooling is thin.** The web admin has users, items, transactions, disputes and verify-items. `POST /api/admin/users/:id/ban` sets `account_status = 'banned'`, and the auth layer rejects banned logins. There is no audit trail of who did what. There is no mobile admin, so the queue lives on web.
- **Item removal does not work as a moderation tool.** `POST /api/admin/items/:id/remove` only sets `is_available = false`. The browse query (`GET /api/items`) also shows any item with an active request, whatever its availability. So a removed item stays visible while it is out. Item visibility is not centralised: there are 27 `from(items)` queries and only 4 check `is_deleted`.
- **Only one thing is screened today:** profile photos, by a GPT-4 Vision check at upload. Text and item photos are not.
- **Terms:** the web app has a terms page. The mobile app has no terms screen, and registration does not record acceptance.
- **Account deletion constrains the schema.** `account-deletion/manifest.ts` must list every column of every table, and `manifest.test.ts` fails when a new one has no decision. Each new table or column below needs an entry.

## User-generated content surfaces

| Surface | Fields | Where it shows |
|---|---|---|
| Chat messages | `messages.content` | chat thread, push preview |
| Item listings | `items.name`, `description`, `photos` | browse, nearby, item page |
| Profiles | `users.display_name`, `bio`, `profile_photo` | cards, chat, reviews, public profile |
| Reviews | `user_reviews.comment` | public profile |
| Wishlist requests | `wishlists.item_name`, `description` | wishlist feed, offers |

## Data model

New tables (all with deletion-manifest entries):

- **`user_blocks`**: `blocker_id`, `blocked_id`, `created_at`. Unique on the pair. On deletion of either user the row is deleted.
- **`content_reports`**: `id`, `reporter_id`, `target_type` (`user | item | message | review | wishlist`), `target_id`, `target_user_id` (the author, so the queue can group by person), `reason` (`spam | harassment | hate | sexual | violence | illegal | scam | other`), `details`, `snapshot` (jsonb copy of the text or photo URLs at report time, because content can be edited or deleted afterwards), `status` (`open | actioned | dismissed`), `resolved_by`, `resolved_at`, `resolution_note`, `created_at`. One open report per reporter and target. Deletion: keep for safety, but anonymise `reporter_id` and the free text.
- **`moderation_actions`**: audit log. `admin_id`, `action` (`remove_item | hide_review | hide_message | warn_user | ban_user | unban_user | dismiss_report`), `target_type`, `target_id`, `report_id` (nullable), `note`, `created_at`. Written for every admin action, including the existing ban and unban.

New columns:

- `items.moderation_status` (`visible | removed`), `moderation_note`, `moderated_at`. Separate from `is_deleted` and `is_available`, so an owner cannot relist a removed item and the reason is kept.
- `user_reviews.hidden_at`.
- `messages.hidden_at`: hidden from the recipient's thread but kept for evidence.
- `users.terms_accepted_at`, `users.terms_version`.

## Enforcement

A single place decides what is visible, instead of 27 separate queries.

- **Items:** one `visibleItemCondition(viewerId)` helper, applied to every public item read: browse, nearby, item page, my-subscribed-items, wishlist matching, notifications. It excludes `moderation_status = 'removed'`, owners banned or deactivated, and owners who blocked the viewer or were blocked by them. Tests assert each route uses it.
- **Messages:** `POST /api/messages` rejects a send when either user has blocked the other (403, no hint of who blocked whom). It also validates `receiverId` exists and is active, and `content` is a non-empty string within a length limit. `GET /api/conversations` and `GET /api/messages/:userId` hide blocked partners. WebSocket pushes and notification pushes skip blocked senders.
- **Requests, offers, reviews:** creating a request, a wishlist offer or a review against a blocked or blocking user is refused.
- **Profiles:** `GET /api/users/:id/public-profile` and reputation return 404 when a block exists in either direction.
- **Bans:** a ban already stops logins. To verify while building: that existing sessions end at once, and that a banned user's items and reviews stop showing. If not, the ban action also sets their items to `removed` and the visibility helper excludes banned authors.

## Filtering before publish

- **Text:** one `checkText(field, text)` in a new `content-policy.ts`, run on the write paths for every text surface above. Phase 1 is a maintained blocklist (slurs, explicit terms) with normalisation for obvious evasions (spacing, leetspeak). A hit returns 422 with a plain message ("This contains language we don't allow"). It rejects; it does not silently edit.
- **Photos:** profile photos already go through the Vision check. For item photos, phase 1 relies on reporting. Phase 2 reuses the same Vision call asynchronously on new item photos and sends a flagged one to the queue instead of blocking the upload (no added latency; it costs one call per photo).
- A word filter is easy to evade and will have false positives, so it is paired with reporting and the queue, not relied on alone. That combination is what Apple is looking for.

## Reporting and the moderation queue

- **User side:** `POST /api/reports` with `{ targetType, targetId, reason, details? }`. It stores the snapshot, returns 201, and answers duplicates idempotently. Reporting also offers "Block this user" in the same sheet.
- **Admin side:** a new web page `/admin/reports`, in the style of `disputes.tsx`.
  - Open reports, oldest first, with age and a red marker past 20 hours.
  - Each shows the snapshot, reporter, author, how many other reports exist against that author, and the author's account status.
  - Actions: dismiss, remove or hide the content, warn the user (a notification), ban the user. Every action writes `moderation_actions` and resolves the report. The existing ban and unban routes get the same audit write.
- **Staying inside 24 hours:** a new report sends an email through the existing mail module (Resend) to a configured `MODERATION_EMAIL`, and the admin stats show the age of the oldest open report. Who watches that inbox is an operations decision, not code.
- **Reporter feedback:** a notification when a report is resolved ("We reviewed your report and took action" or "...found no violation"). No details about the other person.

## Terms and contact

- Registration (mobile and web) requires ticking acceptance of the Terms and Community Guidelines, with the zero-tolerance clause, and stores `terms_accepted_at` and `terms_version`.
- Existing users see a one-time blocking screen on next launch, until accepted.
- The mobile app gets a Terms screen and a Support contact (email) in Settings. The text is yours to supply; I'll only build the screens and the plumbing.

## Mobile UI

- A shared `ReportSheet` (reason list, optional details, "also block") and a `useBlock` hook.
- Entry points: chat header menu in `chat/[id].tsx`, `profile/[id].tsx`, `item/[id].tsx` (report listing / report owner), each review row on the profile, and wishlist cards.
- Settings gets a "Blocked users" screen to unblock.
- Web gets the same actions after mobile ships. Apple only reviews the iOS app, but the web app shows the same content, so it should follow.

## Build order

Each step is a separate, reviewable change with tests.

1. **Schema, deletion manifest and the visibility helper.** Tables, columns, manifest entries, and moving every item query onto the helper. This fixes the removal gap on its own.
2. **Blocks.** API, message and request enforcement, tests for both directions.
3. **Reports and the admin queue.** API, `/admin/reports`, `moderation_actions`, the email alert.
4. **Text filter** on all write paths.
5. **Terms acceptance** on register, plus the existing-user gate.
6. **Mobile UI.** Report sheet, block, blocked-users list, terms and support screens.
7. **Phase 2:** async Vision check on item photos; web parity for report and block.

## Decisions I need from you

1. **Blocking someone you have an active request with.** Proposal: the block takes effect on chat and new requests immediately, but the in-flight request keeps working through its system steps (handoff, return, deposit release), so money and items are never stranded. The blocked person's text messages stop. The alternative, cancelling the request on block, can strand a deposit hold.
2. **Item photos:** reporting only at launch (my proposal), or the async Vision check in the first release?
3. **Who is the moderator**, and which address should receive `MODERATION_EMAIL`? Someone has to read it daily.
4. **Terms and Community Guidelines text** and the support email. I can draft the guidelines section, but it needs your review, and ideally a lawyer's.
5. **Web parity** for report and block: in the first release or right after?

## As built

Decisions made, and where the build differs from the design above:

- **Blocking with a request in flight.** Text stops at once; system steps continue. Before the handoff either person may cancel with a full refund and no penalty (`cancel_reason = user_blocked`); after it, the request runs to its end and disputes go to admin.
- **Photos.** Reporting only at launch. An async Vision check on new item photos is on the "After launch" list, along with the web report and block buttons (the server-side enforcement is live for web).
- **Moderation address and support address** are configuration: `MODERATION_EMAIL` (no default) and `SUPPORT_EMAIL` (default support@shareswap.app).
- **Text filter** is built in-house (`content-policy.ts`, term list in `content-policy-terms.ts`) rather than with a library: a short list of slurs and the most explicit terms, matched whole-word where they sit inside innocent words. It is a floor, with reporting behind it.
- **One visibility rule** (`content-visibility.ts`) decides what others see: moderator removals, banned, deactivated and deleted accounts, and blocks in either direction. It covers browse, nearby, an item page, booked dates, requests, recommendations, stats, profiles and their sub-pages, and both wishlist feeds, including `/api/all-wishlists`, which is the one the apps call.
- **Bans** delete the person's session rows, close their open chat socket, drop their push tokens, and write an audit row, like every other moderator action.
- **Acceptance of the Terms** is required at sign-up on web and mobile (the server refuses an account without it) and is asked once of everyone who has not accepted the current version. It is enforced by the clients' blocking screen, not by refusing every API write.
- **Mobile**: a report sheet used from a profile, a review, a listing, a chat message and a community wishlist post; Block from the same places; Settings has Blocked users, Community Guidelines and Contact support.

Still to do before launch, all in docs/go-live-checklist.md: approve the drafts in docs/legal, replace the placeholder Terms and Privacy pages, set `MODERATION_EMAIL`, and decide who reads that inbox daily.
