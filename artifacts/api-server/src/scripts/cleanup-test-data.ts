import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";

// One-off cleanup of leftover test fixtures. DRY RUN unless --apply is passed.
//
// Matches users by fixture username prefix and the items, requests, notifications and
// messages that belong to them. Never calls Stripe (requests holding the fake intent
// pi_test_1 are simply deleted), never touches PROTECTED_REQUEST_IDS, and refuses to
// apply if any row is linked to a user outside the prefixes or if rows in some other
// table still reference what would be deleted.
//
//   pnpm --filter @workspace/api-server exec tsx src/scripts/cleanup-test-data.ts          (dry run)
//   pnpm --filter @workspace/api-server exec tsx src/scripts/cleanup-test-data.ts --apply  (deletes)

export const FIXTURE_PREFIXES = [
  "test-rental-deposit-split-",
  "request-expiry-",
  "review-route-concurrency-",
  "review-concurrency-",
] as const;
export const PROTECTED_REQUEST_IDS = [2468, 4275, 4276] as const;

const ACTIVE_HANDOFF_STATUSES = [
  "ACCEPTED", "IN_PROGRESS", "HANDOFF_CONFIRMED", "DEPOSIT_CONFIRMED",
  "AWAITING_HANDOFF_CONFIRM", "HANDOFF_DISPUTED", "DISPUTED",
];

type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> };

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const USERNAME_REGEX = `^(${FIXTURE_PREFIXES.map(escapeRegex).join("|")})`;

export interface Plan {
  users: number[];
  items: number[];
  requests: number[];
  notifications: number[];
  messages: number[];
  /** user_reviews where BOTH ends are fixture users (and at least one is being deleted). */
  reviews: number[];
  /** Matched by prefix but kept because a protected request depends on them. */
  keptUsers: number[];
  keptItems: number[];
  keptRequests: number[];
  keptNotifications: number[];
  keptMessages: number[];
  /** Both-ends-fixture reviews that stay: tied to a protected request, or only among kept users. */
  keptReviews: number[];
  /** Reviews where EXACTLY ONE end is a fixture user. Never deleted; blocks --apply. */
  mixedReviews: { id: number; reviewerId: number | null; reviewedUserId: number | null }[];
  /** Rows tied to a fixture user but also to someone outside the prefixes. */
  violations: string[];
  /** Rows in other tables that reference rows being deleted. */
  dependents: { table: string; column: string; parent: string; onDelete: string; count: number; sample: string[] }[];
  visibleInFeed: { id: number; name: string; why: string }[];
}

const ints = (rows: any[], key = "id"): number[] => rows.map((r) => Number(r[key]));
const uniq = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);
const minus = (xs: number[], remove: number[]) => {
  const drop = new Set(remove);
  return xs.filter((x) => !drop.has(x));
};

export async function buildPlan(db: Queryable): Promise<Plan> {
  const prefixUsers = ints((await db.query(`select id from users where username ~ $1 order by id`, [USERNAME_REGEX])).rows);
  const prot = [...PROTECTED_REQUEST_IDS];

  // Everything a protected request depends on stays, even when it matched a prefix.
  const protectedRows = (
    await db.query(
      `select ir.id, ir.requester_id, ir.item_id, i.owner_id
         from item_requests ir join items i on i.id = ir.item_id where ir.id = any($1::int[])`,
      [prot],
    )
  ).rows;
  const protectedUsers = uniq(protectedRows.flatMap((r) => [r.requester_id, r.owner_id].filter((x) => x != null).map(Number)));
  const protectedItems = uniq(protectedRows.map((r) => Number(r.item_id)));

  const users = minus(prefixUsers, protectedUsers);
  const keptUsers = prefixUsers.filter((id) => protectedUsers.includes(id));

  const prefixItems = ints((await db.query(`select id from items where owner_id = any($1::int[]) order by id`, [prefixUsers])).rows);
  const items = minus(prefixItems, protectedItems);
  const keptItems = prefixItems.filter((id) => protectedItems.includes(id));

  const prefixRequests = ints(
    (
      await db.query(
        `select ir.id from item_requests ir join items i on i.id = ir.item_id
          where ir.requester_id = any($1::int[]) or i.owner_id = any($1::int[]) order by ir.id`,
        [prefixUsers],
      )
    ).rows,
  );
  const requests = minus(prefixRequests, prot);
  const keptRequests = prefixRequests.filter((id) => prot.includes(id));

  // Notifications and messages that belong to the fixture users or the requests being deleted.
  const noteRows = (
    await db.query(
      `select id, user_id, request_id from notifications
        where user_id = any($1::int[]) or request_id = any($2::int[]) order by id`,
      [prefixUsers, prefixRequests],
    )
  ).rows;
  const msgRows = (
    await db.query(
      `select id, sender_id, receiver_id, request_id from messages
        where sender_id = any($1::int[]) or receiver_id = any($1::int[]) or request_id = any($2::int[]) order by id`,
      [prefixUsers, prefixRequests],
    )
  ).rows;
  const touchesProtected = (r: any) => r.request_id != null && prot.includes(Number(r.request_id));
  const notifications = ints(noteRows.filter((r) => !touchesProtected(r)));
  const keptNotifications = ints(noteRows.filter(touchesProtected));
  const messages = ints(msgRows.filter((r) => !touchesProtected(r)));
  const keptMessages = ints(msgRows.filter(touchesProtected));

  // Reviews: delete only where BOTH ends are fixture users. Exactly one fixture end is never deleted.
  const reviewRows = (
    await db.query(
      `select id, reviewer_id, reviewed_user_id, transaction_id from user_reviews
        where reviewer_id = any($1::int[]) or reviewed_user_id = any($1::int[]) order by id`,
      [prefixUsers],
    )
  ).rows;
  const isFixture = (id: unknown) => id != null && prefixUsers.includes(Number(id));
  const bothEnds = reviewRows.filter((r) => isFixture(r.reviewer_id) && isFixture(r.reviewed_user_id));
  const mixedReviews = reviewRows
    .filter((r) => isFixture(r.reviewer_id) !== isFixture(r.reviewed_user_id))
    .map((r) => ({
      id: Number(r.id),
      reviewerId: r.reviewer_id == null ? null : Number(r.reviewer_id),
      reviewedUserId: r.reviewed_user_id == null ? null : Number(r.reviewed_user_id),
    }));
  const reviewDeletable = (r: any) =>
    (users.includes(Number(r.reviewer_id)) || users.includes(Number(r.reviewed_user_id))) &&
    !(r.transaction_id != null && prot.includes(Number(r.transaction_id)));
  const reviews = ints(bothEnds.filter(reviewDeletable));
  const keptReviews = ints(bothEnds.filter((r) => !reviewDeletable(r)));

  // Linked-to-outsider checks, on exactly the rows that would be deleted.
  const inPrefix = new Set(prefixUsers);
  const violations: string[] = [];
  const reqRows = (
    await db.query(
      `select ir.id, ir.requester_id, i.owner_id from item_requests ir join items i on i.id = ir.item_id where ir.id = any($1::int[])`,
      [requests],
    )
  ).rows;
  for (const r of reqRows) {
    if (r.requester_id == null || !inPrefix.has(Number(r.requester_id))) violations.push(`request ${r.id}: requester ${r.requester_id} is outside the prefixes`);
    if (r.owner_id == null || !inPrefix.has(Number(r.owner_id))) violations.push(`request ${r.id}: item owner ${r.owner_id} is outside the prefixes`);
  }
  const outsideRequestsOnTestItems = (
    await db.query(
      `select id, requester_id from item_requests where item_id = any($1::int[]) and not (id = any($2::int[])) and id <> all($3::int[])`,
      [items, requests, prot],
    )
  ).rows;
  for (const r of outsideRequestsOnTestItems) violations.push(`request ${r.id} (not selected) is on a fixture item`);
  for (const n of noteRows.filter((r) => !touchesProtected(r))) {
    if (n.user_id == null || !inPrefix.has(Number(n.user_id))) violations.push(`notification ${n.id}: belongs to user ${n.user_id}, outside the prefixes`);
  }
  for (const m of msgRows.filter((r) => !touchesProtected(r))) {
    for (const [side, uid] of [["sender", m.sender_id], ["receiver", m.receiver_id]] as const) {
      if (uid == null || !inPrefix.has(Number(uid))) violations.push(`message ${m.id}: ${side} ${uid} is outside the prefixes`);
    }
  }
  const namedButOutside = (
    await db.query(
      `select id, owner_id from items where name ~ $1 and not (owner_id = any($2::int[]))`,
      [USERNAME_REGEX, prefixUsers],
    )
  ).rows;
  for (const i of namedButOutside) violations.push(`item ${i.id}: fixture-style name but owned by user ${i.owner_id} outside the prefixes`);

  // Rows elsewhere that point at what we would delete (discovered from the foreign keys).
  const sets: Record<string, number[]> = { users, items, item_requests: requests, notifications, messages, user_reviews: reviews };
  const fks = (
    await db.query(
      `select ch.relname as child, a.attname as col, pa.relname as parent,
              case con.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
                                   when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as on_delete
         from pg_constraint con
         join pg_class ch on ch.oid = con.conrelid
         join pg_class pa on pa.oid = con.confrelid
         join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
        where con.contype = 'f' and pa.relname = any($1::text[])
        order by pa.relname, ch.relname, a.attname`,
      [Object.keys(sets)],
    )
  ).rows;
  const dependents: Plan["dependents"] = [];
  for (const fk of fks) {
    const parentIds = sets[fk.parent];
    if (!parentIds.length) continue;
    const childIsInScope = fk.child in sets;
    const exclude = childIsInScope ? `and not ((to_jsonb(t)->>'id')::int = any($2::int[]))` : "";
    const params: unknown[] = [parentIds];
    if (childIsInScope) params.push(sets[fk.child]);
    const rows = (
      await db.query(
        `select to_jsonb(t)->>'id' as id from "${fk.child}" t where t."${fk.col}" = any($1::int[]) ${exclude} limit 10`,
        params,
      )
    ).rows;
    const count = Number(
      (await db.query(`select count(*)::int as n from "${fk.child}" t where t."${fk.col}" = any($1::int[]) ${exclude}`, params)).rows[0].n,
    );
    if (count > 0) {
      dependents.push({ table: fk.child, column: fk.col, parent: fk.parent, onDelete: fk.on_delete, count, sample: rows.map((r) => String(r.id)) });
    }
  }

  // Which of the fixture items does the browse feed (GET /api/items) show right now?
  const visible = (
    await db.query(
      `select i.id, i.name, i.is_available,
              exists (select 1 from item_requests ir where ir.item_id = i.id and ir.status = any($2::text[])) as out_with_request
         from items i left join users u on u.id = i.owner_id
        where i.id = any($1::int[]) and i.is_deleted = false and i.is_swapped = false
          and (i.listing_expires_at is null or i.listing_expires_at >= now())
          and coalesce(u.account_status, '') <> 'deactivated'
          and (i.is_available = true
               or exists (select 1 from item_requests ir where ir.item_id = i.id and ir.status = any($2::text[])))
        order by i.id`,
      [prefixItems, ACTIVE_HANDOFF_STATUSES],
    )
  ).rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    why: r.is_available ? "listed as available" : "shown as currently out (active request)",
  }));

  return {
    users, items, requests, notifications, messages, reviews,
    keptUsers, keptItems, keptRequests, keptNotifications, keptMessages, keptReviews, mixedReviews,
    violations, dependents, visibleInFeed: visible,
  };
}

export function blockers(plan: Plan): string[] {
  const out: string[] = [];
  if (plan.mixedReviews.length) out.push(`${plan.mixedReviews.length} review(s) have exactly one fixture user (ids ${plan.mixedReviews.map((r) => r.id).join(", ")}); they are not deleted`);
  if (plan.violations.length) out.push(`${plan.violations.length} row(s) are linked to users outside the prefixes`);
  for (const d of plan.dependents) {
    if (d.onDelete === "NO ACTION" || d.onDelete === "RESTRICT") {
      out.push(`${d.count} row(s) in ${d.table}.${d.column} reference ${d.parent} being deleted (ON DELETE ${d.onDelete})`);
    }
  }
  const protectedInSet = (PROTECTED_REQUEST_IDS as readonly number[]).filter((id) => plan.requests.includes(id));
  if (protectedInSet.length) out.push(`protected request(s) ${protectedInSet.join(",")} are in the delete set`);
  return out;
}

function printIds(label: string, ids: number[]) {
  console.log(`  ${label.padEnd(15)} ${String(ids.length).padStart(4)}  ${ids.length ? ids.join(", ") : "-"}`);
}

export function printPlan(plan: Plan) {
  console.log("Would delete (in this order; reviews go before requests because user_reviews.transaction_id references them):");
  printIds("messages", plan.messages);
  printIds("notifications", plan.notifications);
  printIds("user_reviews", plan.reviews);
  printIds("item_requests", plan.requests);
  printIds("items", plan.items);
  printIds("users", plan.users);
  console.log("\nMatched a prefix but KEPT because a protected request depends on them:");
  printIds("users", plan.keptUsers);
  printIds("items", plan.keptItems);
  printIds("item_requests", plan.keptRequests);
  printIds("notifications", plan.keptNotifications);
  printIds("messages", plan.keptMessages);
  printIds("user_reviews", plan.keptReviews);
  console.log(`  protected requests (never touched): ${PROTECTED_REQUEST_IDS.join(", ")}`);

  console.log("\nReviews with EXACTLY ONE fixture user (must be zero; never deleted):");
  console.log(
    plan.mixedReviews.length
      ? plan.mixedReviews.map((r) => `  ! review ${r.id}: reviewer ${r.reviewerId ?? "null"} -> reviewed ${r.reviewedUserId ?? "null"}`).join("\n")
      : "  0",
  );

  console.log("\nLinked to a user outside the prefixes:");
  console.log(plan.violations.length ? plan.violations.map((v) => `  ! ${v}`).join("\n") : "  none: every selected row belongs only to fixture users");

  console.log("\nRows in other tables that reference what would be deleted:");
  if (!plan.dependents.length) console.log("  none");
  for (const d of plan.dependents) {
    console.log(`  ${d.onDelete === "CASCADE" || d.onDelete.startsWith("SET") ? " " : "!"} ${d.table}.${d.column} -> ${d.parent}: ${d.count} row(s) [ON DELETE ${d.onDelete}] ids ${d.sample.join(", ")}${d.count > d.sample.length ? ", ..." : ""}`);
  }

  console.log("\nFixture items currently visible in the browse feed (GET /api/items rules):");
  if (!plan.visibleInFeed.length) console.log("  none");
  for (const v of plan.visibleInFeed) console.log(`  item ${v.id} "${v.name}": ${v.why}`);
}

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  const client = await pool.connect();
  try {
    if (!apply) {
      await client.query("BEGIN READ ONLY");
      const plan = await buildPlan(client);
      await client.query("ROLLBACK");
      console.log("DRY RUN: nothing is changed, no Stripe calls. Pass --apply to delete.\n");
      printPlan(plan);
      const stop = blockers(plan);
      console.log(stop.length ? `\n--apply would REFUSE:\n${stop.map((s) => `  - ${s}`).join("\n")}` : "\n--apply would proceed (no blockers).");
      return;
    }

    // One transaction: re-plan inside it, refuse on any blocker, delete in dependency order,
    // and roll back unless every count matches the plan exactly.
    await client.query("BEGIN");
    try {
      const plan = await buildPlan(client);
      printPlan(plan);
      const stop = blockers(plan);
      if (stop.length) throw new Error(`Refusing to delete:\n${stop.map((s) => `  - ${s}`).join("\n")}`);

      const steps: [string, string, number[]][] = [
        ["messages", "messages", plan.messages],
        ["notifications", "notifications", plan.notifications],
        ["user_reviews", "user_reviews", plan.reviews],
        ["item_requests", "item_requests", plan.requests],
        ["items", "items", plan.items],
        ["users", "users", plan.users],
      ];
      for (const [label, table, ids] of steps) {
        const res = await client.query(`delete from ${table} where id = any($1::int[])`, [ids]);
        if ((res.rowCount ?? 0) !== ids.length) throw new Error(`${label}: deleted ${res.rowCount} rows, expected ${ids.length}`);
        console.log(`deleted ${res.rowCount} from ${label}`);
      }
      await client.query("COMMIT");
      console.log("\nCommitted.");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
