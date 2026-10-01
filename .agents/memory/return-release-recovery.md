---
name: Return release recovery
description: Safety and scope decisions for interrupted return releases and bounded recovery.
---

Persist the release operation and its ownership fence before contacting the payment provider. Resume that exact operation; never replace a terminal fence merely because it is old. Preserve the identities and independently verified modes of both current and prior payment intents.

**Why:** A payment action can succeed even when its response or the following database commit is lost. Current refundable-charge mode does not prove that an older intent was also refundable; a captured manual authorization must fail closed.

**How to apply:** Discover canceled intents and existing refunds before retrying money movement. Distinguish successful, pending, partial, and failed refunds rather than treating the existence of a refund as full release.

Use the same checked-out database connection for a session advisory lock and the short database transactions protected by it. Release that connection before invoking callbacks that use the shared pool.

**Why:** Reserving every pool connection for locks while requesting another connection for each transaction deadlocks at pool capacity. Post-completion callbacks can recreate the same deadlock if the lock connection is still held.

**How to apply:** Test saturation, not just two callers racing on one request. Provider work may retain the advisory lock, but it must not require an additional pool connection to make progress.

Bounded recovery must rotate blocked operations and back off retries; it must not always choose the oldest few unresolved records.

**Why:** Captured authorizations, pending refunds, or conflicting snapshots can remain unresolved indefinitely and otherwise prevent every newer return from recovering.

**How to apply:** Persist attempt timing and use fair candidate ordering. Fake-provider tests must explicitly scope sweeps to their own fixtures, never unrelated pending returns.

Freeze the owner-approved physical return time before payment work. Core completion and its single borrower notice are atomic; update a pending release notice in place rather than inserting another equivalent alert.

**Why:** Provider or database recovery delays are not borrower lateness. A delayed completion must not trigger additional overdue penalties or falsely tell the borrower the return has completed.

**How to apply:** Calculate return lateness from physical approval, and recheck unreturned eligibility under request locks in policy mutations, notifications, and penalties—not only during batch selection. Client recovery observes status without replaying the payment action.

Separate post-completion reward callbacks remain outside the crash-recovered core.

**Why:** The approved scope protects release, return state, and notification consistency. Some coin/referral side effects are not independently replay-safe.

**How to apply:** Invoke existing effects only for the winning completion. If reward crash recovery is later requested, add durable keyed effects rather than rerunning the whole callback on completed retries.