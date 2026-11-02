import { and, desc, eq } from "drizzle-orm";
import { db, userBlocks, users } from "@workspace/db";
import { HIDDEN_ACCOUNT_STATUSES } from "./content-visibility";

export type BlockResult = { ok: true; alreadyBlocked?: boolean } | { ok: false; status: number; error: string };

/** Blocks `blockedId` for `blockerId`. Idempotent; a repeat is not an error. */
export async function blockUser(blockerId: number, blockedId: number): Promise<BlockResult> {
  if (!Number.isSafeInteger(blockedId) || blockedId <= 0) return { ok: false, status: 400, error: "Invalid user id" };
  if (blockerId === blockedId) return { ok: false, status: 400, error: "You cannot block yourself" };

  const [target] = await db.select({ id: users.id, accountStatus: users.accountStatus }).from(users).where(eq(users.id, blockedId)).limit(1);
  // A banned or deleted account is already out of sight; reporting someone is how it got there. Treat it as missing.
  if (!target || (HIDDEN_ACCOUNT_STATUSES as readonly string[]).includes(target.accountStatus ?? "active")) {
    return { ok: false, status: 404, error: "User not found" };
  }

  const inserted = await db.insert(userBlocks).values({ blockerId, blockedId }).onConflictDoNothing().returning({ id: userBlocks.id });
  return { ok: true, alreadyBlocked: inserted.length === 0 };
}

export async function unblockUser(blockerId: number, blockedId: number): Promise<BlockResult> {
  if (!Number.isSafeInteger(blockedId) || blockedId <= 0) return { ok: false, status: 400, error: "Invalid user id" };
  const removed = await db
    .delete(userBlocks)
    .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)))
    .returning({ id: userBlocks.id });
  return { ok: true, alreadyBlocked: removed.length === 0 };
}

/** The people this user blocked, newest first. Only what the "Blocked users" screen needs. */
export async function listBlockedUsers(blockerId: number) {
  return db
    .select({
      id: users.id,
      username: users.username,
      handle: users.handle,
      displayName: users.displayName,
      authProvider: users.authProvider,
      profilePhoto: users.profilePhoto,
      blockedAt: userBlocks.createdAt,
    })
    .from(userBlocks)
    .innerJoin(users, eq(users.id, userBlocks.blockedId))
    .where(eq(userBlocks.blockerId, blockerId))
    .orderBy(desc(userBlocks.createdAt));
}
