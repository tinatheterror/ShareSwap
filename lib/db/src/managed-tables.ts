import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

// The tables this package's schema declares, by name. drizzle.config.ts hands this list to
// drizzle-kit as `tablesFilter`, so `drizzle-kit push` manages exactly these tables and leaves every
// other table in the database alone.
//
// That matters because the app creates some tables for itself at runtime (job_switches,
// scheduled_job_runs, rate_limit_store, native_oauth_tokens, and the session table that
// connect-pg-simple creates). They are not in the schema, so without a filter `push --force` (which
// scripts/post-merge.sh runs) DROPS them, and a plain `push` drops the empty ones without asking.
//
// Computed from the schema's exports rather than written out, so a new schema table is managed
// automatically and a table created at runtime later is never touched.

export function managedTableNames(schemaModule: Record<string, unknown>): string[] {
  const names = new Set<string>();
  for (const value of Object.values(schemaModule)) {
    if (is(value, PgTable)) names.add(getTableName(value));
  }
  // An empty filter would mean "no filter" to drizzle-kit, i.e. manage (and drop) everything. If the
  // schema failed to load, stop instead.
  if (names.size === 0) {
    throw new Error("managedTableNames: the schema exported no tables; refusing to build an empty tablesFilter");
  }
  return [...names].sort();
}
