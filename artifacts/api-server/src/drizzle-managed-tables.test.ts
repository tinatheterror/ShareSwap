import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { managedTableNames } from "@workspace/db/managed-tables";
import * as schema from "@workspace/db/schema";

// drizzle.config.ts passes managedTableNames(schema) to drizzle-kit as `tablesFilter`, so `push --force`
// (scripts/post-merge.sh) manages the schema's tables and leaves the rest of the database alone.

const RUNTIME_TABLES = ["job_switches", "scheduled_job_runs", "rate_limit_store", "native_oauth_tokens", "session"];

test("the filter is exactly the schema's tables: nothing missing, nothing extra", () => {
  const names = managedTableNames(schema);
  const sourceDir = path.resolve(process.cwd(), "../../lib/db/src/schema");
  const declared = new Set<string>();
  for (const file of readdirSync(sourceDir).filter((f) => f.endsWith(".ts"))) {
    // Comment lines are skipped: schema/index.ts carries a commented-out example table.
    const code = readFileSync(path.join(sourceDir, file), "utf8").split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    for (const match of code.matchAll(/pgTable\(\s*"(\w+)"/g)) declared.add(match[1]);
  }
  assert.deepEqual(names, [...declared].sort());
  assert.ok(names.length > 30, `only ${names.length} tables`);
  for (const core of ["users", "items", "item_requests", "notifications", "messages", "reputation_activities"]) {
    assert.ok(names.includes(core), `${core} is managed`);
  }
});

test("tables the app creates for itself are never in the filter, so push cannot drop them", () => {
  const names = managedTableNames(schema);
  for (const table of RUNTIME_TABLES) assert.ok(!names.includes(table), `${table} must not be managed by drizzle-kit`);
});

test("an empty filter is refused: drizzle-kit would read it as 'manage everything'", () => {
  assert.throws(() => managedTableNames({}), /refusing to build an empty tablesFilter/);
  assert.throws(() => managedTableNames({ notATable: 1, alsoNot: "x" }), /refusing/);
});

test("a table the app creates at runtime must not use a serial or identity column", () => {
  // drizzle-kit's tablesFilter covers tables, not sequences. A serial/identity id on an unmanaged
  // table leaves a sequence drizzle cannot account for, and every push then ends in an error
  // (the table and its data survive, but the push stops and drizzle-kit still exits 0).
  const managed = new Set(managedTableNames(schema));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full); continue; }
      if (!entry.name.endsWith(".ts") || entry.name.includes(".test.")) continue;
      const text = readFileSync(full, "utf8");
      for (const match of text.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)`/g)) {
        const [, table, body] = match;
        if (managed.has(table)) continue;
        if (/\b(big|small)?serial\b/i.test(body) || /GENERATED\s+(ALWAYS|BY DEFAULT)\s+AS\s+IDENTITY/i.test(body)) {
          offenders.push(`${path.relative(process.cwd(), full)}: ${table}`);
        }
      }
    }
  };
  walk(path.resolve(process.cwd(), "src"));
  assert.deepEqual(offenders, []);
});
