---
name: Hybrid Stripe deposits
description: Durable rules for choosing and settling ShareSwap security deposits.
---

Choose the deposit mechanism near handoff. Use a manual-capture authorization only when its exact Stripe `capture_before` covers the return date plus configured processing and claim buffers. Clearly long transactions go directly to refundable-deposit consent; an insufficient attempted hold is canceled before consent is requested.

**Why:** Quietly converting a temporary hold into a real charge surprises customers, while timer-based reauthorization creates fragile card activity and still cannot guarantee coverage for long rentals.

**How to apply:** Never charge the refundable deposit until the customer explicitly confirms the displayed disclosure. Keep deposit, rental fee, overdue status, and claims separate. Overdue status, authorization expiry, and timers must never capture or retain a deposit; only an approved claim or explicit settlement may do so. Extended authorization stays disabled unless Stripe confirms eligibility.

All capture, cancel, and refund paths must share a non-age-reclaimable request fence and a durable settlement operation. Treat a lost/timeout/5xx response after calling Stripe as indeterminate: retain the fence, inspect live Stripe state, and retry only with the original idempotency key. A successful ledger transition is mandatory before clearing the fence.

**Why:** Stripe can complete a financial action even when the client never receives the response. Releasing or replacing the fence then permits duplicate actions or leaves Stripe and the local claim ledger inconsistent.

Keep idempotent payment-creation parameters unchanged across backend updates; obtain expanded charge details with a separate read. Inspect live payment state before replacing an attempt, even when a cached creation response still describes an active hold.

**Why:** Stripe fingerprints response-expansion parameters too. Adding expansion to an already-used creation key rejects retries; cached creation responses can also predate a later cancellation.

**How to apply:** Compatibility retries must retain the original key and exact earlier parameters. Only verified cancellation permits a new attempt; failed or timed-out lookups do not establish cancellation.

Use controlled, plain-language payment errors on mobile and web. Provider diagnostics and internal payment keys belong in server logs, not customer-facing messages.

**Why:** The user approved replacing the raw Stripe retry error shown in the payment sheet; instructions to change an idempotency key are not actionable for customers.

**How to apply:** Map recognized failures to card, authentication, pending-payment, or ShareCoin guidance. Unknown failures get safe generic wording, never the provider message. Do not claim no funds were reserved when the payment state is indeterminate.