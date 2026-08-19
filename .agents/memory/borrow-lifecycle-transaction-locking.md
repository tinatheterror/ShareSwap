---
name: Borrow lifecycle transaction locking
description: Concurrency rule for extension, return-delay, and return-request state changes.
---

Extension requests, extension responses, and post-extension delay notices must
lock the corresponding borrow request row for their full database transition.
Any conditional failure after a write must throw so the transaction rolls back,
rather than returning an error object that can commit partial state.

**Why:** These actions update a shared lifecycle: the active due date, the
single advance-communication credit, and owner-facing notifications. Parallel
taps or an overlapping return can otherwise accept conflicting extensions or
create duplicate delay notices.

**How to apply:** When adding a new mutation that changes an in-progress borrow
or its extension/return-delay state, perform validation and related writes in
one transaction after locking the request row. Emit WebSocket or push delivery
only after the transaction commits.