/**
 * Expo Push Notification service
 *
 * Sends push notifications via Expo's hosted push service.
 * Tokens are stored in user_push_tokens — one row per device, registered by
 * the mobile app after login.  This allows a single user to receive
 * notifications on multiple devices simultaneously.
 *
 * When Expo returns a DeviceNotRegistered error for a token, that token is
 * automatically removed from the database so it never accumulates stale entries.
 *
 * All failures are swallowed so a bad/expired token never breaks the operation
 * that triggered the notification.
 *
 * Pass an optional `category` to respect per-user notification preferences
 * stored in the `user_notification_prefs` table.  When no category is given,
 * the notification is always sent (useful for system/admin messages).
 */

import { db } from "@workspace/db";
import { users, notifications, userNotificationPrefs, userPushTokens } from "@workspace/db";
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
    const tokenRows = await db
      .select({ token: userPushTokens.token })
      .from(userPushTokens)
      .where(eq(userPushTokens.userId, userId));

    if (tokenRows.length === 0) return;

    const enabled = await isCategoryEnabled(userId, category);
    if (!enabled) return;

    await sendExpoMessages(
      tokenRows.map(({ token }) => ({ to: token, ...payload })),
    );
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
    // Fetch all tokens for these users
    const tokenRows = await db
      .select({ userId: userPushTokens.userId, token: userPushTokens.token })
      .from(userPushTokens)
      .where(inArray(userPushTokens.userId, userIds));

    if (tokenRows.length === 0) return;

    // Filter by preference when a category is given
    let eligibleRows = tokenRows;
    if (category) {
      const uniqueUserIds = [...new Set(tokenRows.map((r) => r.userId))];
      const prefsRows = await db
        .select()
        .from(userNotificationPrefs)
        .where(inArray(userNotificationPrefs.userId, uniqueUserIds));

      const prefsMap = new Map(prefsRows.map((p) => [p.userId, p]));
      eligibleRows = tokenRows.filter((r) => {
        const p = prefsMap.get(r.userId);
        if (!p) return true; // no row → opted in by default
        return p[category] ?? true;
      });
    }

    if (eligibleRows.length === 0) return;

    await sendExpoMessages(
      eligibleRows.map(({ token }) => ({ to: token, ...payload })),
    );
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

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Low-level call to the Expo Push API (batches up to 100 messages per request).
 * Handles DeviceNotRegistered receipts by removing the offending token from the DB.
 */
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
      continue;
    }

    // Parse per-message tickets and handle DeviceNotRegistered errors
    try {
      const json = (await res.json()) as { data?: ExpoTicket[] };
      const tickets: ExpoTicket[] = json.data ?? [];
      for (let j = 0; j < tickets.length; j++) {
        const ticket = tickets[j];
        if (
          ticket.status === "error" &&
          ticket.details?.error === "DeviceNotRegistered"
        ) {
          const staleToken = batch[j]?.to;
          if (staleToken) {
            console.log(`[push] Removing stale token: ${staleToken}`);
            await db
              .delete(userPushTokens)
              .where(eq(userPushTokens.token, staleToken));
          }
        }
      }
    } catch (parseErr) {
      // Non-fatal — ticket parsing is best-effort
      console.warn("[push] Failed to parse Expo tickets:", parseErr);
    }
  }
}
