import { eq, sql } from "drizzle-orm";
import { appleLinks, db, pool, users } from "@workspace/db";
import { DeletionError, requestDeletion, type DeletionDeps } from "./account-deletion/service";
import type { AppleNotification } from "./apple-auth";
export { APPLE_NOTIFICATIONS_PATH } from "./server-to-server-routes";


export type AppleNotificationResult =
  | "unknown_account"
  | "sessions_ended"
  | "deletion_requested"
  | "deletion_already_pending"
  | "deletion_blocked"
  | "email_forwarding_set";

/** Signs the person out everywhere: their server-side sessions and any unused one-time native tokens. */
async function endSessions(userId: number) {
  const { rows } = await pool.query(`SELECT to_regclass('session') IS NOT NULL AS session, to_regclass('native_oauth_tokens') IS NOT NULL AS tokens`);
  if (rows[0]?.session) await pool.query(`DELETE FROM session WHERE (sess::jsonb) -> 'passport' ->> 'user' = $1`, [String(userId)]);
  if (rows[0]?.tokens) await pool.query(`DELETE FROM native_oauth_tokens WHERE user_id = $1`, [userId]);
}

/**
 * Acts on a verified Apple notification.
 *  consent-revoked  the person removed ShareSwap in their Apple settings: end their sessions and drop the refresh token
 *                   (Apple has already invalidated it).
 *  account-delete   the Apple ID itself was deleted: start the ordinary deletion request (grace period and all). If the
 *                   account cannot be deleted yet (open bookings, a balance to withdraw) nothing is forced; it is
 *                   logged for staff and the person finishes it in the app.
 *  email-disabled / email-enabled  Apple stopped / resumed forwarding to the private-relay address: recorded.
 * Unknown Apple IDs are ignored, and every handler is safe to run twice (Apple may deliver an event more than once).
 */
export async function handleAppleNotification(event: AppleNotification, deps: DeletionDeps = {}): Promise<AppleNotificationResult> {
  const [user] = await db.select({ id: users.id, accountStatus: users.accountStatus }).from(users).where(eq(users.appleId, event.sub)).limit(1);
  if (!user) return "unknown_account";

  if (event.type === "email-disabled" || event.type === "email-enabled") {
    await db
      .insert(appleLinks)
      .values({ userId: user.id, emailForwardingEnabled: event.type === "email-enabled" })
      .onConflictDoUpdate({ target: appleLinks.userId, set: { emailForwardingEnabled: event.type === "email-enabled", updatedAt: new Date() } });
    return "email_forwarding_set";
  }

  // Both remaining events leave Apple's refresh token useless, so there is nothing left to revoke on deletion.
  await db.update(appleLinks).set({ refreshTokenEnc: null, updatedAt: new Date() }).where(eq(appleLinks.userId, user.id));

  if (event.type === "consent-revoked") {
    await endSessions(user.id);
    return "sessions_ended";
  }

  if (user.accountStatus === "pending_deletion") return "deletion_already_pending";
  try {
    await requestDeletion(user.id, { acknowledgeForfeit: false }, deps);
    return "deletion_requested";
  } catch (error) {
    if (error instanceof DeletionError) {
      console.warn(`[apple] the Apple ID of user ${user.id} was deleted but the account cannot start its deletion yet (${error.code}); the person finishes it in the app`);
      return "deletion_blocked";
    }
    throw error;
  }
}
