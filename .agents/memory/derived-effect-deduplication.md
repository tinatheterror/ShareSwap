---
name: Derived-effect deduplication
description: Safety rule for uniqueness migrations when source records have already produced reputation, rewards, or notifications.
---

When adding a uniqueness constraint, do not silently delete legacy duplicate source records if each record may already have produced derived effects. Fail with actionable duplicate-key diagnostics unless the migration can reconcile every related effect transactionally.

**Why:** Keeping one source row while leaving score changes, reward transactions, penalties, or notifications from deleted rows creates an internally inconsistent history and silently destroys user content.

**How to apply:** Before a deduplicating migration, inventory all effects produced by the source operation. Use a domain-aware repair process when effects exist; otherwise make the constraint migration stop safely and identify the affected keys. If historical totals used caps, floors, or spendable rewards, do not infer the inverse adjustment from ledger rows. Require reviewed expected and target totals, lock the affected account rows, and audit before/after values.