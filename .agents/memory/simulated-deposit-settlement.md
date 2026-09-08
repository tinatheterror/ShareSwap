---
name: Simulated deposit settlement
description: How seeded simulated deposit identifiers should behave in terminal deposit workflows.
---

PaymentIntent identifiers prefixed with `simulated-` represent seeded/demo authorization state and must not be retrieved, canceled, captured, or refunded through Stripe. Treat the external operation as an idempotent no-op, then continue the normal internal settlement workflow.

**Why:** Stripe correctly returns `resource_missing` for these identifiers. Treating that as a fatal release failure blocks return completion even though no real authorization or money exists.

**How to apply:** In terminal return, cancellation, or claim settlement paths, bypass only the external Stripe operation for a clearly prefixed simulated identifier. Still record the internal settlement, clear operation locks, update deposit state, and run normal notifications and lifecycle side effects. Failed terminal operations must clear their operation token/type so retries remain possible.