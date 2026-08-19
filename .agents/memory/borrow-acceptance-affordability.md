---
name: Borrow acceptance affordability
description: Rules for ShareCoin checks and cancellation during borrow negotiation.
---

Final BORROW terms must not be accepted unless the requester has enough ShareCoins for the prorated full date range, regardless of whether the requester or the owner taps Accept.

**Why:** Client-only checks can be bypassed and an owner should not be charged or shown an earn-coins prompt for the borrower's balance.

**How to apply:** Validate at date-changing proposals for immediate feedback and enforce again at every final acceptance endpoint. Let the requester cancel an accepted request through the pre-handoff stage, including after a deposit is confirmed; show the owner an explanatory shortage message instead of a balance-earning flow.

Cancellation notifications must be sent to the other party and the canceled thread must remain visible in the active inbox until its unread cancellation event is opened.

**Why:** A status change alone archives the conversation, which can hide a material cancellation from the person who did not initiate it.

**How to apply:** Create one lifecycle event, one notification/push alert, and temporarily unarchive the thread when a cancellation succeeds. Let normal read-state logic archive it again.