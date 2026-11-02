import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { items } from "@workspace/db";

// What other people may see. Everything public (browse, nearby, an item page, a profile, its reviews) goes
// through these, so a ban or a moderator's removal takes effect everywhere at once instead of query by query.

/** Accounts whose listings and profile nobody else sees. The same set as accountIsBlocked in auth.ts. */
export const HIDDEN_ACCOUNT_STATUSES = ["banned", "deactivated", "deleted"] as const;

export const accountIsPubliclyVisible = (user: { accountStatus?: string | null }) =>
  !(HIDDEN_ACCOUNT_STATUSES as readonly string[]).includes(user.accountStatus ?? "active");

const hiddenStatuses = sql.join(HIDDEN_ACCOUNT_STATUSES.map((status) => sql`${status}`), sql`, `);

/** SQL: the account whose id is `userId` may be seen by others (or does not exist, which other conditions handle). */
export const accountVisibleSql = (userId: AnyColumn | SQL): SQL =>
  sql`NOT EXISTS (SELECT 1 FROM users hidden_user WHERE hidden_user.id = ${userId} AND hidden_user.account_status IN (${hiddenStatuses}))`;

/**
 * SQL: the listing has not been removed by a moderator and its owner may be seen. Availability and the owner's own
 * soft delete stay with the callers, which differ (browse also shows items that are out on loan).
 */
export const publiclyVisibleItem = (): SQL =>
  sql`(${items.moderationStatus} = 'visible' AND ${accountVisibleSql(items.ownerId)})`;

/** The same rule for a row already in memory. */
export const itemIsPubliclyVisible = (item: { moderationStatus?: string | null }, owner: { accountStatus?: string | null }) =>
  (item.moderationStatus ?? "visible") === "visible" && accountIsPubliclyVisible(owner);
