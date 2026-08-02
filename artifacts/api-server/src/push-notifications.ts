/**
 * Expo Push Notification service
 *
 * Sends push notifications via Expo's hosted push service.
 * Tokens are stored in users.expo_push_token — registered by the mobile
 * app after login.  All failures are swallowed so a bad/expired token
 * never breaks the operation that triggered the notification.
 */

import { db } from "@workspace/db";
import { users, notifications } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

export interface PushPayload {
  title: string;
  body: string;
  /** Deep-link data forwarded to the app when the user taps the notification */
  data?: Record<string, unknown>;
}

/**
 * Send a push notification to a single user identified by their DB userId.
 * Silently no-ops when the user has no stored Expo push token.
 */
export async function sendPushToUser(
  userId: number,
  payload: PushPayload,
): Promise<void> {
  try {
    const [row] = await db
      .select({ expoPushToken: users.expoPushToken })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row?.expoPushToken) return;

    await sendExpoMessages([
      { to: row.expoPushToken, ...payload },
    ]);
  } catch (err) {
    console.error("[push] sendPushToUser error:", err);
  }
}

/**
 * Send push notifications to multiple users at once.
 * Only users with a stored Expo push token receive a notification.
 */
export async function sendPushToUsers(
  userIds: number[],
  payload: PushPayload,
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const rows = await db
      .select({ expoPushToken: users.expoPushToken })
      .from(users)
      .where(inArray(users.id, userIds));

    const tokens = rows
      .map((r) => r.expoPushToken)
      .filter((t): t is string => !!t);

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
