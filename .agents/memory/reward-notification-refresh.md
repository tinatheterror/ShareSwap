---
name: Reward notification refresh
description: Balance and notification-copy safety when earned rewards are observed asynchronously.
---

Treat a reward notification as a signal to fetch the authoritative account balance, never as an instruction to add coins locally.

**Why:** The credit is already committed on the server. Notifications can appear again after reconnecting or remounting, while a separately cached balance can remain stale. Adding the advertised amount locally can double-count a real reward.

**How to apply:** Refresh both wallet balance and transaction history for badge rewards as well as ordinary coin rewards. Keep account boundaries intact, deduplicate successful refresh signals, and allow later polling to retry a failed refresh.

Put confirmed reward wording before the badge description in compact notifications. Do not invent a reward for historical messages without an explicit credit.

**Why:** Truncating a long badge description can hide a reward appended at the end, making an existing credit look missing. Historical badge data may predate reliable atomic awards.

**How to apply:** Normalize explicit older reward wording for display without re-awarding money or changing historical financial records.

Check saved wording, server-side shortening, and client rendering separately when correcting historical reward notices.

**Why:** The API and push delivery shorten messages before clients receive them. A historical reward suffix can disappear at that stage, leaving no explicit reward evidence for a client formatter to normalize. Formatter-only tests missed this boundary.

**How to apply:** Normalize explicit reward wording before server-side truncation, and verify the actual API response plus rendered notification. Historical message repairs must preserve notification identity and financial history. Seeing an old award again must not issue another coin.