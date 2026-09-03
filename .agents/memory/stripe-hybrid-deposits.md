---
name: Hybrid Stripe deposits
description: Durable rules for choosing and settling ShareSwap security deposits.
---

Choose the deposit mechanism near handoff. Use a manual-capture authorization only when its exact Stripe `capture_before` covers the return date plus configured processing and claim buffers. Clearly long transactions go directly to refundable-deposit consent; an insufficient attempted hold is canceled before consent is requested.

**Why:** Quietly converting a temporary hold into a real charge surprises customers, while timer-based reauthorization creates fragile card activity and still cannot guarantee coverage for long rentals.

**How to apply:** Never charge the refundable deposit until the customer explicitly confirms the displayed disclosure. Keep deposit, rental fee, overdue status, and claims separate. Overdue status, authorization expiry, and timers must never capture or retain a deposit; only an approved claim or explicit settlement may do so. Extended authorization stays disabled unless Stripe confirms eligibility.