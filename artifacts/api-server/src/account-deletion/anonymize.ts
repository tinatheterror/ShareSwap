import { is, sql, type SQL } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db";
import { db } from "@workspace/db";
import { DELETED_DISPLAY_NAME, REMOVED_MESSAGE_TEXT } from "./retention";
import { DELETION_MANIFEST, RUNTIME_TABLE_MANIFEST } from "./manifest";

// Applies DELETION_MANIFEST to one user. Everything here runs in the caller's transaction, so a failure leaves the
// account exactly as it was. The manifest decides what happens to each column; this file decides which rows are the
// deleting user's, because a booking is shared with a counterparty and only the deleting user's side is scrubbed.

export type DeletionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type ColumnInfo = { notNull: boolean; hasDefault: boolean; dataType: string; columnType: string };
const COLUMN_INFO = new Map<string, Map<string, ColumnInfo>>();
for (const value of Object.values(schema)) {
  if (!is(value as object, PgTable)) continue;
  const config = getTableConfig(value as PgTable);
  COLUMN_INFO.set(
    config.name,
    new Map(config.columns.map((c) => [c.name, { notNull: c.notNull, hasDefault: c.hasDefault, dataType: c.dataType, columnType: c.columnType }])),
  );
}

/** What a scrubbed column holds: its default, else NULL, else an empty value of its type. */
function emptyValue(table: string, column: string): SQL {
  const info = COLUMN_INFO.get(table)?.get(column);
  if (!info) throw new Error(`${table}.${column} is not a schema column`);
  if (info.hasDefault) return sql`DEFAULT`;
  if (!info.notNull) return sql`NULL`;
  if (info.columnType === "PgArray") return sql`'{}'`;
  switch (info.dataType) {
    case "string": return sql`''`;
    case "number": return sql`0`;
    case "boolean": return sql`false`;
    case "json": return sql`'{}'::jsonb`;
    default: throw new Error(`${table}.${column} is NOT NULL with no default, so it cannot be emptied`);
  }
}

const assignments = (table: string, columns: string[]) =>
  sql.join(columns.map((c) => sql`${sql.identifier(c)} = ${emptyValue(table, c)}`), sql`, `);

/** A booking is evidence when it has a security claim or a handoff or return dispute was raised on it. */
const evidenceOf = (alias: string) => {
  const a = sql.raw(alias);
  return sql`(COALESCE(${a}.handoff_dispute_triggered, false) OR COALESCE(${a}.return_dispute_triggered, false) OR EXISTS (SELECT 1 FROM security_claims c WHERE c.request_id = ${a}.id))`;
};

export type ScrubStep = {
  table: string;
  /** Columns emptied by this step. */
  columns: string[];
  /** Extra assignments that are not manifest columns (soft-delete flags). */
  extraSet?: SQL;
  /** FROM list; the target is aliased `t`. */
  from?: SQL;
  where: SQL;
};

/**
 * The scrubs of the delete-treatment columns of tables whose rows stay. A column appears in the step for the side of
 * the booking it belongs to, so the counterparty keeps their own text. The evidence columns of item_requests are
 * skipped when the booking has a claim or a dispute, because they are kept for the claim window.
 */
export function scrubSteps(userId: number): ScrubStep[] {
  const U = sql`${userId}`;
  const REQ = sql`t.requester_id = ${U}`;
  const OWN = sql`i.owner_id = ${U}`;
  const EVIDENCE = evidenceOf("t");
  const request = (columns: string[], condition: SQL): ScrubStep => ({
    table: "item_requests",
    columns,
    from: sql`items i`,
    where: sql`i.id = t.item_id AND (${condition})`,
  });
  const delivery = (columns: string[], condition: SQL): ScrubStep => ({
    table: "delivery_arrangements",
    columns,
    from: sql`item_requests r, items i`,
    where: sql`r.id = t.request_id AND i.id = r.item_id AND (${condition})`,
  });
  return [
    // item_requests: the requester wrote the message and any delay reason; the owner wrote the return notes.
    request(["message", "return_delay_reason"], REQ),
    request(["counter_note"], sql`t.counter_proposed_by = ${U}`),
    // The cancellation the deletion itself makes carries a system code, not free text, and stays.
    request(["cancel_reason"], sql`t.cancelled_by = ${U} AND t.cancel_reason IS DISTINCT FROM 'account_deleted'`),
    request(["return_condition_notes"], OWN),
    // Evidence: kept when the booking has a claim or a dispute.
    request(["handoff_pin"], sql`(${REQ} OR ${OWN}) AND NOT ${EVIDENCE}`),
    request(["handoff_proof_borrower"], sql`${REQ} AND NOT ${EVIDENCE}`),
    request(["handoff_proof_owner", "return_dispute_photo_url", "return_dispute_reason"], sql`${OWN} AND NOT ${EVIDENCE}`),
    // delivery_arrangements: the requester's address, the owner's pickup address, and what no one needs once it is over.
    delivery(["delivery_address"], sql`r.requester_id = ${U}`),
    delivery(["pickup_address"], sql`i.owner_id = ${U}`),
    delivery(["special_instructions", "qr_code_data", "uber_tracking_url"], sql`r.requester_id = ${U} OR i.owner_id = ${U}`),
    { table: "extension_requests", columns: ["message"], where: sql`t.borrower_id = ${U}` },
    { table: "item_condition_verifications", columns: ["notes", "photos"], where: sql`t.verifier_id = ${U}` },
    {
      table: "items",
      columns: ["description", "photos", "latitude", "longitude", "address", "swap_desired_item"],
      extraSet: sql`is_deleted = true, is_available = false`,
      where: sql`t.owner_id = ${U}`,
    },
    // The notes of a return do not say who wrote them, so either party's deletion clears them, unless the rental has a
    // claim or a dispute: then they are evidence.
    {
      table: "rental_returns",
      columns: ["notes"],
      where: sql`(t.renter_id = ${U} OR t.owner_id = ${U}) AND NOT EXISTS (SELECT 1 FROM item_requests e WHERE e.id = t.request_id AND ${evidenceOf("e")})`,
    },
    { table: "referrals", columns: ["referrer_device_fingerprint"], where: sql`t.referrer_id = ${U}` },
    { table: "referrals", columns: ["referred_device_fingerprint"], where: sql`t.referred_user_id = ${U}` },
  ];
}

/** The `delete` columns of retained tables that a step scrubs, per table; the test compares it with the manifest. */
export function scrubbedColumns(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const step of scrubSteps(0)) {
    const set = out.get(step.table) ?? new Set<string>();
    for (const c of step.columns) set.add(c);
    out.set(step.table, set);
  }
  return out;
}

/** Free-text keys of the JSON a lifecycle event keeps. */
const FREE_TEXT_KEY = /message|note|reason|comment|text|description|address|instruction|body|content/i;
export function scrubDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubDetails);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !FREE_TEXT_KEY.test(k)).map(([k, v]) => [k, scrubDetails(v)]));
  }
  return value;
}

/** Rows deleted from a table besides the ones that name the user directly. */
const ALSO_DELETE_WHERE = (userId: number): Record<string, SQL> => ({
  wishlist_offers: sql`wishlist_id IN (SELECT id FROM wishlists WHERE user_id = ${userId})`,
});

export type AnonymizeResult = {
  /** "/uploads/..." paths whose files should be removed once the transaction has committed. */
  uploads: string[];
};

const uploadPaths = (values: unknown[]): string[] =>
  values.flat().filter((v): v is string => typeof v === "string" && v.startsWith("/uploads/"));

export async function anonymizeUser(tx: DeletionTx, userId: number): Promise<AnonymizeResult> {
  const U = sql`${userId}`;

  // Uploaded files of the rows about to be scrubbed (the evidence ones are not scrubbed, so they are not listed).
  const profile = await tx.execute(sql`SELECT profile_photo AS p FROM users WHERE id = ${U}`);
  const itemPhotos = await tx.execute(sql`SELECT unnest(photos) AS p FROM items WHERE owner_id = ${U}`);
  const verifierPhotos = await tx.execute(sql`SELECT unnest(photos) AS p FROM item_condition_verifications WHERE verifier_id = ${U}`);
  const disputePhotos = await tx.execute(sql`
    SELECT t.return_dispute_photo_url AS p FROM item_requests t JOIN items i ON i.id = t.item_id
    WHERE i.owner_id = ${U} AND t.return_dispute_photo_url IS NOT NULL
      AND NOT (COALESCE(t.handoff_dispute_triggered, false) OR COALESCE(t.return_dispute_triggered, false)
               OR EXISTS (SELECT 1 FROM security_claims c WHERE c.request_id = t.id))`);
  const uploads = uploadPaths([profile, itemPhotos, verifierPhotos, disputePhotos].flatMap((r) => r.rows.map((row) => (row as { p: unknown }).p)));

  // 1. Rows that belong to the user alone.
  const also = ALSO_DELETE_WHERE(userId);
  for (const [table, entry] of Object.entries(DELETION_MANIFEST)) {
    if (entry.rows !== "delete") continue;
    const conditions = entry.userColumns.map((c) => sql`${sql.identifier(c)} = ${U}`);
    if (also[table]) conditions.push(also[table]);
    await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${sql.join(conditions, sql` OR `)}`);
  }
  // Tables the app creates for itself on first use may not exist yet.
  const exists = async (table: string) => !!((await tx.execute(sql`SELECT to_regclass(${`public.${table}`}) AS t`)).rows[0] as { t: unknown } | undefined)?.t;
  if (await exists("native_oauth_tokens")) await tx.execute(sql`DELETE FROM native_oauth_tokens WHERE user_id = ${U}`);
  if (await exists("session")) await tx.execute(sql`DELETE FROM session WHERE (sess::jsonb) -> 'passport' ->> 'user' = ${String(userId)}`);

  // 2. Rows of retained tables that are removed when they name the user in a deleteRowsWhere column.
  for (const [table, entry] of Object.entries(DELETION_MANIFEST)) {
    for (const column of entry.deleteRowsWhere ?? []) {
      await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${U}`);
    }
  }

  // 3. The deleting user's side of retained rows.
  for (const step of scrubSteps(userId)) {
    await tx.execute(sql`
      UPDATE ${sql.identifier(step.table)} AS t SET ${assignments(step.table, step.columns)}${step.extraSet ? sql`, ${step.extraSet}` : sql``}
      ${step.from ? sql`FROM ${step.from}` : sql``} WHERE ${step.where}`);
  }
  await tx.execute(sql`UPDATE messages SET content = ${REMOVED_MESSAGE_TEXT} WHERE sender_id = ${U} AND message_type = 'text'`);
  await tx.execute(sql`UPDATE user_reviews SET comment = NULL WHERE reviewer_id = ${U}`);
  const events = await tx.execute(sql`SELECT id, details FROM request_lifecycle_events WHERE actor_id = ${U} AND details IS NOT NULL`);
  for (const row of events.rows as { id: number; details: unknown }[]) {
    await tx.execute(sql`UPDATE request_lifecycle_events SET details = ${JSON.stringify(scrubDetails(row.details))}::jsonb WHERE id = ${row.id}`);
  }

  // 4. The subscription ends with the account.
  await tx.execute(sql`UPDATE user_subscriptions SET status = 'cancelled', auto_renew = false WHERE user_id = ${U} AND status = 'active'`);

  // 5. The user row stays so every ledger keeps a valid id; every identifying column is replaced or emptied. The
  // placeholders are unique per id, because username, handle and referral_code are unique columns.
  const placeholder = `deleted-${userId}`;
  await tx.execute(sql`
    UPDATE users SET ${assignments("users", DELETION_MANIFEST.users.delete)},
      username = ${placeholder}, handle = ${placeholder}, referral_code = ${placeholder},
      display_name = ${DELETED_DISPLAY_NAME}, account_status = 'deleted',
      subscription_tier = 'free', stripe_subscription_status = CASE WHEN stripe_subscription_id IS NULL THEN stripe_subscription_status ELSE 'canceled' END
    WHERE id = ${U}`);

  return { uploads };
}

/** For the manifest test: the runtime tables the anonymizer clears by hand. */
export const RUNTIME_TABLES_CLEARED = Object.keys(RUNTIME_TABLE_MANIFEST).filter((t) => RUNTIME_TABLE_MANIFEST[t].rows === "delete");
