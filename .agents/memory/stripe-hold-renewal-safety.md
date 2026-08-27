---
name: Stripe hold renewal safety
description: Durable concurrency and cleanup rules for renewing expiring manual-capture deposit authorizations.
---

Claim each renewal under a database row lock before any Stripe network work. Only a failed renewal may be forced manually, and both old and replacement holds must expose Stripe's exact `capture_before` deadline.

**Why:** Concurrent workers or lifecycle transitions can otherwise create unnecessary authorizations or swap a new hold onto an ineligible request. Guessing expiration times risks renewing too early or too late.

**How to apply:** Recheck the current PaymentIntent and full request/deposit eligibility under the final row lock before swapping. Authorize the replacement before changing the stored reference. Keep every failed old-hold cancellation durably referenced, and defer later renewals until that cleanup succeeds so no live authorization becomes orphaned.

Terminal deposit actions (cancel, release, capture, dispute resolution, and administrative completion) must use the same mutually exclusive request claim before reading or acting on a PaymentIntent. Resolve both the current hold and any pending prior hold, then condition the final state change on the claim and unchanged current PaymentIntent.

Persist an opaque fencing token and operation type for terminal claims. Stale recovery may replace only the same operation type; opposite release/capture actions stay blocked. Verify token ownership before Stripe calls and reconcile Stripe's current status before deciding whether a hold was released or captured.