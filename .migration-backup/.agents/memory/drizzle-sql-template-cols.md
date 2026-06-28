---
name: Drizzle sql template column refs
description: Using Drizzle column objects inside sql`` tagged templates for inlined expressions (not as parameters) causes Neon/Postgres SQL errors.
---

## Rule
Do NOT interpolate Drizzle Column objects (e.g. `itemRequests.updatedAt`) inside a `sql` tagged template literal when the intent is a SQL column reference used in an inlined expression (e.g. comparisons, arithmetic).

Use raw quoted SQL identifiers instead:

```ts
// BAD — Drizzle serialises the Column object in an unexpected way, producing literal < characters or wrong SQL
sql`${itemRequests.updatedAt} < ${itemRequests.createdAt} + interval '48 hours'`

// GOOD — raw SQL names, always works
sql`item_requests.updated_at < item_requests.created_at + interval '48 hours'`
```

**Why:** Drizzle's `sql` template `bindIfParam` treats Column objects as bound parameters (not identifier references) when they appear as interpolated values without a Drizzle query builder wrapper. On Neon this produces either `syntax error at or near "<"` or `operator does not exist` errors.

**How to apply:** Any time you need a column-to-column comparison (e.g. timestamp arithmetic, range checks) inside a raw `sql` template, write the column name as a plain SQL string literal — either unquoted (`table.column`) or double-quoted (`"table"."column"`).
