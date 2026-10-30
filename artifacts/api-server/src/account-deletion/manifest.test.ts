import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db";
import { pool } from "@workspace/db";
import { MIN_PAYOUT } from "../rental-payout-service.js";
import { DELETION_MANIFEST, RUNTIME_TABLE_MANIFEST, type TableManifest } from "./manifest.js";
import { scrubbedColumns } from "./anonymize.js";
import { RETENTION_YEARS, WALLET_LIMITS, minimumWaiverApplies, walletTier } from "./retention.js";

after(() => pool.end());

type SchemaTable = { columns: string[]; userForeignKeys: string[] };
const schemaTables = new Map<string, SchemaTable>();
for (const value of Object.values(schema)) {
  if (!is(value as object, PgTable)) continue;
  const config = getTableConfig(value as PgTable);
  const userForeignKeys = config.foreignKeys.flatMap((fk) => {
    const ref = fk.reference();
    return getTableConfig(ref.foreignTable).name === "users" ? ref.columns.map((c) => c.name) : [];
  });
  schemaTables.set(config.name, { columns: config.columns.map((c) => c.name), userForeignKeys });
}

const classified = (entry: TableManifest) => [...entry.keep, ...entry.anonymize, ...entry.delete];
const sorted = (xs: string[]) => [...xs].sort();

test("every schema table has a manifest entry, and every entry is a schema table or a runtime table", () => {
  assert.deepEqual(sorted([...schemaTables.keys()]), sorted(Object.keys(DELETION_MANIFEST)), "tables missing from the manifest, or entries for tables that no longer exist");
  for (const name of Object.keys(RUNTIME_TABLE_MANIFEST)) assert.ok(!schemaTables.has(name), `${name} is declared in the schema, so it belongs in DELETION_MANIFEST`);
});

test("every column of every table is classified exactly once", () => {
  for (const [table, { columns }] of schemaTables) {
    const entry = DELETION_MANIFEST[table];
    const listed = classified(entry);
    assert.equal(new Set(listed).size, listed.length, `${table}: a column is classified twice`);
    assert.deepEqual(sorted(listed), sorted(columns), `${table}: columns not classified (or classified but not in the schema)`);
  }
});

test("userColumns name real columns, and cover every foreign key to users", () => {
  for (const [table, { columns, userForeignKeys }] of schemaTables) {
    const entry = DELETION_MANIFEST[table];
    for (const column of entry.userColumns) assert.ok(columns.includes(column), `${table}.${column} is not a column`);
    for (const column of userForeignKeys) assert.ok(entry.userColumns.includes(column), `${table}.${column} points at users but is not in userColumns`);
  }
});

test("a table whose rows are deleted deletes every column", () => {
  for (const [table, entry] of Object.entries(DELETION_MANIFEST)) {
    if (entry.rows !== "delete") continue;
    assert.deepEqual([...entry.keep, ...entry.anonymize], [], `${table}: rows are deleted but some columns are marked keep or anonymize`);
  }
});

test("a column whose name says it is personal is never kept as it is", () => {
  const personal = /email|phone|password|address|photo|latitude|longitude|full_name|id_number|fingerprint|postal|(^|_)pin$/;
  // Columns that match by name but are not personal data. Add one only with the reason.
  const allowed = new Set<string>([
    // A keyed HMAC-SHA256 of the email, not the address; the key lives in the environment, so the hash cannot be reversed from the database.
    "banned_email_hashes.email_hash",
  ]);
  for (const [table, entry] of Object.entries(DELETION_MANIFEST)) {
    for (const column of entry.keep) {
      if (personal.test(column)) assert.ok(allowed.has(`${table}.${column}`), `${table}.${column} looks personal but is kept`);
    }
  }
});

test("the identity columns of a user are never kept", () => {
  const users = DELETION_MANIFEST.users;
  for (const column of ["username", "handle", "display_name", "email", "password", "google_id", "phone_number", "phone", "full_name", "profile_photo", "stripe_customer_id", "device_fingerprint"]) {
    assert.ok(!users.keep.includes(column), `users.${column} must not be kept`);
  }
  assert.ok(users.keep.includes("id"), "the users row stays, so its id is kept");
});

test("retention windows named in the manifest exist", () => {
  for (const [table, entry] of [...Object.entries(DELETION_MANIFEST), ...Object.entries(RUNTIME_TABLE_MANIFEST)]) {
    if (entry.retention !== null) assert.ok(entry.retention in RETENTION_YEARS, `${table}: unknown retention window ${entry.retention}`);
  }
});

test("every table the app creates at runtime is in the manifest", () => {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
        for (const m of readFileSync(full, "utf8").matchAll(/CREATE TABLE IF NOT EXISTS\s+"?(\w+)/gi)) found.add(m[1]);
      }
    }
  };
  walk(path.resolve(import.meta.dirname, ".."));
  // The two repair scripts' audit tables are declared in the schema as well.
  for (const table of found) {
    assert.ok(schemaTables.has(table) || table in RUNTIME_TABLE_MANIFEST, `${table} is created at runtime but is not in either manifest`);
  }
  // connect-pg-simple creates the session table itself.
  assert.ok("session" in RUNTIME_TABLE_MANIFEST);
});

test("the wallet limit for withdrawing first is the platform's minimum payout", () => {
  assert.equal(WALLET_LIMITS.availableBlocksAtOrAbove, MIN_PAYOUT);
});

test("wallet tiers: $10 blocks, $1 to $10 is offered, under $1 is forfeited, nothing is nothing", () => {
  assert.equal(walletTier(0), "none");
  assert.equal(walletTier(1), "forfeit");
  assert.equal(walletTier(99), "forfeit");
  assert.equal(walletTier(100), "offer_withdrawal");
  assert.equal(walletTier(999), "offer_withdrawal");
  assert.equal(walletTier(1000), "blocks");
  assert.equal(walletTier(250_000), "blocks");
});

test("the minimum payout is waived only for the whole of a balance in the offer band", () => {
  assert.equal(minimumWaiverApplies(500, 500), true);
  assert.equal(minimumWaiverApplies(100, 100), true);
  assert.equal(minimumWaiverApplies(999, 999), true);
  assert.equal(minimumWaiverApplies(300, 500), false, "a slice of the balance");
  assert.equal(minimumWaiverApplies(99, 99), false, "under $1 is forfeited, not withdrawn");
  assert.equal(minimumWaiverApplies(1000, 1000), false, "$10 needs no waiver");
  assert.equal(minimumWaiverApplies(500, 400), false, "more than the balance");
});

test("evidence columns are delete columns, and deleteRowsWhere names user columns", () => {
  for (const [table, entry] of Object.entries(DELETION_MANIFEST)) {
    for (const column of entry.evidence ?? []) assert.ok(entry.delete.includes(column), `${table}.${column} is evidence but is not a delete column`);
    for (const column of entry.deleteRowsWhere ?? []) assert.ok(entry.userColumns.includes(column), `${table}.${column} removes rows but is not a user column`);
    if (entry.evidence?.length) assert.ok(entry.retention !== null, `${table} keeps evidence, so it needs a retention window`);
  }
});

test("the anonymizer scrubs every delete column of a table whose rows stay, and handles every anonymize column", () => {
  const scrubbed = scrubbedColumns();
  for (const [table, entry] of Object.entries(DELETION_MANIFEST)) {
    if (entry.rows !== "retain" || table === "users") continue;
    for (const column of entry.delete) assert.ok(scrubbed.get(table)?.has(column), `${table}.${column} is marked delete but no scrub step clears it`);
  }
  // The anonymize columns are handled by hand in anonymizeUser; adding one means adding its handling there.
  const handled: Record<string, string[]> = {
    messages: ["content"], request_lifecycle_events: ["details"], user_reviews: ["comment"],
    users: ["username", "handle", "display_name", "referral_code", "account_status"],
  };
  for (const [table, entry] of Object.entries(DELETION_MANIFEST)) assert.deepEqual(sorted(entry.anonymize), sorted(handled[table] ?? []), `${table}: anonymize columns without handling`);
});
