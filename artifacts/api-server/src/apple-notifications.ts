import { eq, sql } from "drizzle-orm";
import { appleLinks, db, pool, users } from "@workspace/db";
import { DeletionError, requestDeletion, type DeletionDeps } from "./account-deletion/service";
import { getDeletionEligibility, type DeletionBlocker } from "./account-deletion/eligibility";
import { moderationEmail } from "./moderation-config";
import { sendDeletionBlockedAlertEmail } from "./sendgrid";
import type { AppleNotification } from "./apple-auth";
export { APPLE_NOTIFICATIONS_PATH } from "./server-to-server-routes";


export type AppleNotificationResult =
  | "unknown_account"
  | "sessions_ended"
  | "deletion_requested"
  | "deletion_already_pending"
  /** Recorded as pending although something is still open; admins were alerted and the finalize job waits for the blockers. */
  | "deletion_requested_blocked"
  | "deletion_not_possible"
  | "email_forwarding_set";

/** Signs the person out everywhere: their server-side sessions and any unused one-time native tokens. */
async function endSessions(userId: number) {
  const { rows } = await pool.query(`SELECT to_regclass('session') IS NOT NULL AS session, to_regclass('native_oauth_tokens') IS NOT NULL AS tokens`);
  if (rows[0]?.session) await pool.query(`DELETE FROM session WHERE (sess::jsonb) -> 'passport' ->> 'user' = $1`, [String(userId)]);
  if (rows[0]?.tokens) await pool.query(`DELETE FROM native_oauth_tokens WHERE user_id = $1`, [userId]);
}

export type DeletionBlockedAlert = { userId: number; cause: string; blockers: DeletionBlocker[] };

/** Tells the admin inbox (MODERATION_EMAIL) which blockers hold up a deletion. Logs loudly when nobody is configured. */
export async function alertAdminsOfBlockedDeletion(alert: DeletionBlockedAlert): Promise<void> {
  const summary = alert.blockers.map((b) => b.code).join(", ");
  console.warn("[apple] deletion of user " + alert.userId + " (" + alert.cause + ") is recorded but blocked by: " + summary);
  const to = moderationEmail();
  if (!to) {
    console.warn("[apple] MODERATION_EMAIL is not set, so nobody was emailed about the blocked deletion");
    return;
  }
  await sendDeletionBlockedAlertEmail(to, alert);
}

export type AppleNotificationOptions = { deletion?: DeletionDeps; alertAdmins?: (alert: DeletionBlockedAlert) => Promise<unknown> };

/**
 * Acts on a verified Apple notification.
 *  consent-revoked  the person removed ShareSwap in their Apple settings: end their sessions and drop the refresh token
 *                   (Apple has already invalidated it).
 *  account-delete   the Apple ID itself was deleted: record the ordinary deletion request (grace period and all). The person
 *                   may no longer be able to sign in, so a request that something still blocks (open bookings, a balance
 *                   to withdraw) is recorded anyway, admins are alerted with the blockers, and the finalize job erases the
 *                   account only once they clear. A deactivated account is recorded too.
 *  email-disabled / email-enabled  Apple stopped / resumed forwarding to the private-relay address: recorded.
 * Unknown Apple IDs are ignored, and every handler is safe to run twice (Apple may deliver an event more than once).
 */
export async function handleAppleNotification(event: AppleNotification, options: AppleNotificationOptions = {}): Promise<AppleNotificationResult> {
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
    const eligibility = await getDeletionEligibility(user.id);
    await requestDeletion(user.id, { acknowledgeForfeit: false, bypassEligibility: true }, options.deletion);
    if (eligibility.eligible) return "deletion_requested";
    try {
      await (options.alertAdmins ?? alertAdminsOfBlockedDeletion)({ userId: user.id, cause: "the person deleted their Apple ID", blockers: eligibility.blockers });
    } catch (error) {
      console.error("[apple] could not alert the admins about a blocked deletion:", error instanceof Error ? error.message : error);
    }
    return "deletion_requested_blocked";
  } catch (error) {
    if (error instanceof DeletionError) {
      console.warn("[apple] the Apple ID of user " + user.id + " was deleted but the account cannot start its deletion (" + error.code + ")");
      return "deletion_not_possible";
    }
    throw error;
  }
}
