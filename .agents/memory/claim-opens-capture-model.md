---
name: Claim opens capture model
description: A security deposit is a temporary hold until a claim is opened; opening the claim charges it and resolution refunds.
---

Only opening a claim converts an authorization into a charge (full capture, ledger key `claim-capture-{claimId}`, request fence type `capture`). Return confirmation without a claim cancels the hold. Overdue, expiry, and timers must never capture. Approval and rejection REFUND a charged deposit (`deposit - approved`, or everything) instead of partially capturing.

**Why:** Users must always tell a temporary hold (not charged) from a real charge, and admin review should not be bounded by the card authorization window.

**How to apply:**
- Call `ensureClaimDepositCaptured` (never throws for payment problems) after the claim row commits; a failed or indeterminate capture leaves the claim open and uncharged, and settle/approve paths call it again first.
- `depositStatus` is `captured` only after Stripe confirms; `settled` after a charged claim resolves (with refunded/retained amounts); `released` only when a hold was never charged.
- `refundable_charge` is always a real charge: no capture call, but it is recorded as charged when a claim opens.
- All user-facing wording comes from `api-server/src/deposit-copy.ts`; deposit bodies bypass the 54-character notification compaction.
- Default claim-review buffer is 0 (hold covers return date plus one day).
