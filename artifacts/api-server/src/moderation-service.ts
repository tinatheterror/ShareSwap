import { and, eq, sql } from "drizzle-orm";
import { db, items, moderationActions, pool, users } from "@workspace/db";
import { closeUserConnection } from "./ws-registry";

// Every moderator action goes through here: it changes the row, writes the audit row in the same transaction,
// and, for a ban, ends everything the person still holds. Routes only call these.

export type ModerationResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Ends every way a person is still signed in: session rows (so a stolen cookie or a reconnecting WebSocket finds
 * nothing), the open chat socket, and push tokens (so their phone stops getting notifications). HTTP requests
 * already fail at once because deserializeUser re-reads the account every time; this covers the rest.
 */
export async function endUserSessions(userId: number) {
  const hasSessions = (await pool.query("SELECT to_regclass('public.session') IS NOT NULL AS present")).rows[0]?.present === true;
  if (hasSessions) {
    await pool.query("DELETE FROM session WHERE (sess::jsonb) -> 'passport' ->> 'user' = $1", [String(userId)]);
  }
  await pool.query("DELETE FROM user_push_tokens WHERE user_id = $1", [userId]);
  closeUserConnection(userId, "Account banned");
}

export async function banUser(args: { adminId: number; userId: number; reason?: string | null }): Promise<ModerationResult> {
  if (args.adminId === args.userId) return { ok: false, status: 400, error: "You cannot ban yourself" };
  const reason = args.reason?.trim() || "Banned by admin";
  const changed = await db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ accountStatus: "banned", bannedAt: new Date(), banReason: reason })
      .where(eq(users.id, args.userId))
      .returning({ id: users.id });
    if (updated.length === 0) return false;
    await tx.insert(moderationActions).values({ adminId: args.adminId, action: "ban_user", targetType: "user", targetId: args.userId, note: reason });
    return true;
  });
  if (!changed) return { ok: false, status: 404, error: "User not found" };
  await endUserSessions(args.userId);
  return { ok: true };
}

export async function unbanUser(args: { adminId: number; userId: number }): Promise<ModerationResult> {
  const changed = await db.transaction(async (tx) => {
    // Someone who had asked to delete their account before the ban goes back to waiting for it.
    const updated = await tx
      .update(users)
      .set({
        accountStatus: sql`CASE WHEN ${users.deletionRequestedAt} IS NOT NULL THEN 'pending_deletion' ELSE 'active' END`,
        bannedAt: null,
        banReason: null,
      })
      .where(and(eq(users.id, args.userId), eq(users.accountStatus, "banned")))
      .returning({ id: users.id });
    if (updated.length === 0) return false;
    await tx.insert(moderationActions).values({ adminId: args.adminId, action: "unban_user", targetType: "user", targetId: args.userId });
    return true;
  });
  return changed ? { ok: true } : { ok: false, status: 404, error: "No banned user with that id" };
}

/** Takes a listing down. Unlike an owner's delete or unlist, the owner cannot put it back. */
export async function removeItem(args: { adminId: number; itemId: number; note?: string | null }): Promise<ModerationResult> {
  const note = args.note?.trim() || null;
  const changed = await db.transaction(async (tx) => {
    const updated = await tx
      .update(items)
      .set({ moderationStatus: "removed", moderationNote: note, moderatedAt: new Date(), isAvailable: false })
      .where(eq(items.id, args.itemId))
      .returning({ id: items.id });
    if (updated.length === 0) return false;
    await tx.insert(moderationActions).values({ adminId: args.adminId, action: "remove_item", targetType: "item", targetId: args.itemId, note });
    return true;
  });
  return changed ? { ok: true } : { ok: false, status: 404, error: "Item not found" };
}

/** Lifts a removal. The listing stays unavailable until its owner relists it. */
export async function restoreItem(args: { adminId: number; itemId: number; note?: string | null }): Promise<ModerationResult> {
  const changed = await db.transaction(async (tx) => {
    const updated = await tx
      .update(items)
      .set({ moderationStatus: "visible", moderationNote: null, moderatedAt: new Date() })
      .where(and(eq(items.id, args.itemId), eq(items.moderationStatus, "removed")))
      .returning({ id: items.id });
    if (updated.length === 0) return false;
    await tx.insert(moderationActions).values({ adminId: args.adminId, action: "restore_item", targetType: "item", targetId: args.itemId, note: args.note?.trim() || null });
    return true;
  });
  return changed ? { ok: true } : { ok: false, status: 404, error: "No removed item with that id" };
}
