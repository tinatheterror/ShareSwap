---
name: Postgres contention tests
description: Reliable observation of competing database transactions in integration tests.
---

When observing blocked writers from an open transaction, refresh PostgreSQL's statistics snapshot before each poll and include indirect blocking relationships.

**Why:** An observer transaction can keep returning an earlier activity snapshot, making a real second contender invisible. Row-lock waiters can also queue behind another waiter rather than directly behind the original lock holder.

**How to apply:** Use `pg_stat_clear_snapshot()` before polling `pg_stat_activity`, and traverse `pg_blocking_pids()` recursively from the known blocker. Always release held locks and settle started writers before cleaning up fixtures.