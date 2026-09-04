---
name: Hybrid Stripe deposits
description: Durable rules for choosing and settling ShareSwap security deposits.
---

Choose the deposit mechanism near handoff. Use a manual-capture authorization only when its exact Stripe `capture_before` covers the return date plus configured processing and claim buffers. Clearly long transactions go directly to refundable-deposit consent; an insufficient attempted hold is canceled before consent is requested.

**Why:** Quietly converting a temporary hold into a real charge surprises customers, while timer-based reauthorization creates fragile card activity and still cannot guarantee coverage for long rentals.

**How to apply:** Never charge the refundable deposit until the customer explicitly confirms the displayed disclosure. Keep deposit, rental fee, overdue status, and claims separate. Overdue status, authorization expiry, and timers must never capture or retain a deposit; only an approved claim or explicit settlement may do so. Extended authorization stays disabled unless Stripe confirms eligibility.

All capture, cancel, and refund paths must share a non-age-reclaimable request fence and a durable settlement operation. Treat a lost/timeout/5xx response after calling Stripe as indeterminate: retain the fence, inspect live Stripe state, and retry only with the original idempotency key. A successful ledger transition is mandatory before clearing the fence.

**Why:** Stripe can complete a financial action even when the client never receives the response. Releasing or replacing the fence then permits duplicate actions or leaves Stripe and the local claim ledger inconsistent.