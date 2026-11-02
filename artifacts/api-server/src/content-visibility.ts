import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db, items, userBlocks } from "@workspace/db";
import { and, eq, or } from "drizzle-orm";

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
 * SQL: a block exists between the two accounts, in either direction. A block hides each from the other, so every
 * public read takes the same answer whoever pressed the button.
 */
export const blockedBetweenSql = (a: AnyColumn | SQL | number, b: AnyColumn | SQL | number): SQL =>
  sql`EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = ${a} AND ub.blocked_id = ${b}) OR (ub.blocker_id = ${b} AND ub.blocked_id = ${a}))`;

/** SQL: a listing is hidden from this viewer because they and its owner have blocked each other. */
export const notBlockedFromViewerSql = (viewerId: number, otherUserId: AnyColumn | SQL): SQL =>
  sql`NOT ${blockedBetweenSql(viewerId, otherUserId)}`;

/**
 * SQL: the listing has not been removed by a moderator, its owner may be seen, and, when the reader is known, no
 * block lies between them and the owner. Availability and the owner's own soft delete stay with the callers, which
 * differ (browse also shows items that are out on loan).
 */
export const publiclyVisibleItem = (viewerId?: number | null): SQL =>
  viewerId
    ? sql`(${items.moderationStatus} = 'visible' AND ${accountVisibleSql(items.ownerId)} AND ${notBlockedFromViewerSql(viewerId, items.ownerId)})`
    : sql`(${items.moderationStatus} = 'visible' AND ${accountVisibleSql(items.ownerId)})`;

/** Whether either of the two has blocked the other. */
export async function usersAreBlocked(a: number, b: number): Promise<boolean> {
  const [row] = await db
    .select({ id: userBlocks.id })
    .from(userBlocks)
    .where(or(and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)), and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a))))
    .limit(1);
  return !!row;
}

/** The same rule for a row already in memory. */
export const itemIsPubliclyVisible = (item: { moderationStatus?: string | null }, owner: { accountStatus?: string | null }) =>
  (item.moderationStatus ?? "visible") === "visible" && accountIsPubliclyVisible(owner);
