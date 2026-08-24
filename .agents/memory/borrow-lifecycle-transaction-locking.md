---
name: Borrow lifecycle transaction locking
description: Concurrency rule for extensions, returns, and active-borrow policy actions.
---

Extension requests, extension responses, post-extension delay notices, final
returns, and any policy action that changes trust while a borrow is active must
share the corresponding borrow request-row lock. Re-check the lifecycle status
after acquiring that lock. Any conditional failure after a write must throw so
the transaction rolls back, rather than returning an error object that can
commit partial state.

**Why:** These actions update a shared lifecycle: the active due date, the
single advance-communication credit, owner-facing notifications, and
return-related trust penalties. Parallel taps, a policy sweep, or an overlapping
return can otherwise accept conflicting extensions, create duplicate delay
notices, or charge separate penalties for the same late borrow.

**How to apply:** When adding a mutation or scheduled policy evaluator for an
in-progress borrow, perform validation and related writes in one transaction
after locking the request row; only act if the re-read status still qualifies.
Emit WebSocket or push delivery only after the transaction commits.