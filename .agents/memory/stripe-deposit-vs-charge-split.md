---
name: Stripe deposit-hold vs immediate-charge PaymentIntent split
description: Durable design constraints for combining a refundable deposit hold with an immediate charge in one checkout flow using Stripe.
---

When a single checkout needs to both hold a refundable deposit and charge a non-refundable amount, use **two separate PaymentIntents** (one manual-capture hold, one automatic-capture charge), not one PI with partial capture.

**Why:** Stripe partial capture cannot "charge part now, hold the rest" — capturing less than the authorized amount releases the uncaptured remainder immediately. A single PI is inherently all-hold or all-charge.

**Design constraints that matter beyond the basic split:**
- If the second PI's charge fails or doesn't reach a genuinely completed state, release the first PI's hold rather than leaving it dangling or treating the booking as paid — an off-session confirmation can return without throwing yet still not have actually collected the money, so check for the definitive success state before any downstream bookkeeping.
- Never trust client-submitted dollar amounts at either step of a multi-call payment flow — compute the authoritative amounts server-side from data the server already owns, and use only those computed values everywhere (PI amounts, metadata, DB/payout records). A later call in the flow can re-anchor to the immutable data recorded by an earlier step, but only if that earlier step was itself authoritative.
- Wrap a confirmation/charge sequence in a row-locked transaction with a deterministic idempotency key so retries and concurrent duplicate calls can't double-charge or double-record.
- A deterministic idempotency key must be scoped to a specific attempt, not just to the business entity being paid for. If an attempt can end in a terminal dead state (e.g. the hold gets cancelled after the second charge fails), the same key would otherwise make Stripe hand back that same dead object forever, permanently blocking any future retry. Track which attempt is currently "live" and roll the key forward once the previous attempt is confirmed dead.
