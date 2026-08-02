/**
 * Expo Push Notification service
 *
 * Sends push notifications via Expo's hosted push service.
 * Tokens are stored in users.expo_push_token — registered by the mobile
 * app after login.  All failures are swallowed so a bad/expired token
 * never breaks the operation that triggered the notification.
 *
 * Pass an optional `category` to respect per-user notification preferences
 * stored in the `user_notification_prefs` table.  When no category is given,
 * the notification is always sent (useful for system/admin messages).
 */

import { db } from "@workspace/db";
import { users, notifications, userNotificationPrefs } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

export type NotificationCategory =
  | "messages"
  | "requests"
  | "payments"
  | "achievements"
  | "sharecoins";

export interface PushPayload {
  title: string;
  body: string;
  /** Deep-link data forwarded to the app when the user taps the notification */
  data?: Record<string, unknown>;
}

/**
 * Return true when the user has opted in for the given category
 * (or when no category is specified — uncategorised notifications always send).
 * Defaults to opted-in when no preference row exists yet.
 */
async function isCategoryEnabled(
  userId: number,
  category?: NotificationCategory,
): Promise<boolean> {
  if (!category) return true;
  const [prefs] = await db
    .select()
    .from(userNotificationPrefs)
    .where(eq(userNotificationPrefs.userId, userId))
    .limit(1);
  if (!prefs) return true; // no row → all enabled by default
  return prefs[category] ?? true;
}

/**
 * Send a push notification to a single user identified by their DB userId.
 * Silently no-ops when the user has no stored Expo push token or has opted
 * out of the given category.
 */
export async function sendPushToUser(
  userId: number,
  payload: PushPayload,
  category?: NotificationCategory,
): Promise<void> {
  try {
    const [row] = await db
      .select({ expoPushToken: users.expoPushToken })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row?.expoPushToken) return;

    const enabled = await isCategoryEnabled(userId, category);
    if (!enabled) return;

    await sendExpoMessages([
      { to: row.expoPushToken, ...payload },
    ]);
  } catch (err) {
    console.error("[push] sendPushToUser error:", err);
  }
}

/**
 * Send push notifications to multiple users at once.
 * Only users with a stored Expo push token AND who have opted in for the
 * given category receive a notification.
 */
export async function sendPushToUsers(
  userIds: number[],
  payload: PushPayload,
  category?: NotificationCategory,
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    // Fetch tokens
    const rows = await db
      .select({ id: users.id, expoPushToken: users.expoPushToken })
      .from(users)
      .where(inArray(users.id, userIds));

    const usersWithTokens = rows.filter((r): r is typeof r & { expoPushToken: string } =>
      !!r.expoPushToken,
    );
    if (usersWithTokens.length === 0) return;

    // Filter by preference when a category is given
    let eligible = usersWithTokens;
    if (category) {
      const eligibleIds = usersWithTokens.map((r) => r.id);
      const prefsRows = await db
        .select()
        .from(userNotificationPrefs)
        .where(inArray(userNotificationPrefs.userId, eligibleIds));

      const prefsMap = new Map(prefsRows.map((p) => [p.userId, p]));
      eligible = usersWithTokens.filter((r) => {
        const p = prefsMap.get(r.id);
        if (!p) return true; // no row → opted in by default
        return p[category] ?? true;
      });
    }

    const tokens = eligible.map((r) => r.expoPushToken);
    if (tokens.length === 0) return;

    await sendExpoMessages(tokens.map((to) => ({ to, ...payload })));
  } catch (err) {
    console.error("[push] sendPushToUsers error:", err);
  }
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default";
  badge?: number;
}

/** Low-level call to the Expo Push API (batches up to 100 messages per request). */
async function sendExpoMessages(messages: ExpoMessage[]): Promise<void> {
  // Expo allows up to 100 messages per request
  const BATCH = 100;
  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH).map((m) => ({
      ...m,
      sound: "default" as const,
    }));

    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[push] Expo API error ${res.status}: ${text}`);
    }
  }
}
