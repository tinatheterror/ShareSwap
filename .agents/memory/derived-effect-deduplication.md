---
name: Derived-effect deduplication
description: Safety rule for uniqueness migrations when source records have already produced reputation, rewards, or notifications.
---

When adding a uniqueness constraint, do not silently delete legacy duplicate source records if each record may already have produced derived effects. Fail with actionable duplicate-key diagnostics unless the migration can reconcile every related effect transactionally.

**Why:** Keeping one source row while leaving score changes, reward transactions, penalties, or notifications from deleted rows creates an internally inconsistent history and silently destroys user content.

**How to apply:** Before a deduplicating migration, inventory all effects produced by the source operation. Use a domain-aware repair process when effects exist; otherwise make the constraint migration stop safely and identify the affected keys. If historical totals used caps, floors, or spendable rewards, do not infer the inverse adjustment from ledger rows. Require reviewed expected and target totals, lock the affected account rows, and audit before/after values.

For badge awards, keep the original reward ledger and notification rows even when archiving a duplicate badge. If the reviewed account balance must change, record a separate signed adjustment rather than deleting the old credit. **Why:** Rewards may have been spent, and the ledger does not have a badge-row ID; title or review matches alone cannot prove which duplicate caused each effect. **How to apply:** Have an operator review candidate effects and both account totals, then archive redundant badge snapshots and the review decision atomically with the unique index.

Locking source records does not freeze attribution on independently mutable effect rows. Preserve the reviewed attribution at the destructive statement, including a NULL attribution for legacy candidates, or lock the effects before reading them.

**Why:** A separate connection can reassign an effect while the source lock is held; deleting by a previously validated ID alone can remove another source's effect.

**How to apply:** Treat attribution changes as a stale repair plan and roll back the entire repair, not just the affected group.