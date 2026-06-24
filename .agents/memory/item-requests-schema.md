---
name: item_requests schema notes
description: Key column availability gotchas in the item_requests table.
---

## Rule
The `item_requests` table has **no `updated_at` column**. Queries using `item_requests.updated_at` will error with `column does not exist`.

**Substitutions to use:**
- Weekly activity window → `item_requests.created_at >= $date`
- Fast Responder (owner accepted within 48h) → `item_requests.accepted_at < item_requests.created_at + interval '48 hours'`

**Why:** The table tracks state via explicit timestamped columns (`accepted_at`, `handoff_confirmed_at`, `return_confirmed_at`, etc.) rather than a generic `updated_at`. Drizzle schema may declare `updatedAt` but the column was never migrated to the actual DB.

**How to apply:** Any time you write a query against `item_requests` that needs a "last modified" time, pick the most specific completion timestamp column instead.
