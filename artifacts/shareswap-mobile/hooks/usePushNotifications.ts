/**
 * usePushNotifications
 *
 * Registers for Expo push notifications, stores the token on the server, and
 * sets up deep-link navigation when the user taps a notification while the app
 * is foregrounded or in the background.
 *
 * Usage: call `useRegisterPushToken()` once inside an authenticated component
 * (AuthContext calls it after login).  Mount `usePushNotificationNavigation()`
 * at the root layout level to handle taps.
 */

import React, { useEffect, useRef } from "react";
import type * as NotificationsType from "expo-notifications";
import Constants from "expo-constants";
import { router } from "expo-router";
import { Platform } from "react-native";
import { apiRequest, apiGet } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

// expo-notifications throws on web during module init — load it only on native.
// We keep `import type` above for TypeScript types, and use require() at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Notifications = (Platform.OS !== "web" ? require("expo-notifications") : {}) as typeof NotificationsType;

// ── Notification presentation behaviour while the app is in the foreground ──
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/** Registers for push and POSTs the Expo token to the server. Fire-and-forget. */
export async function registerPushToken(): Promise<void> {
  // Push notifications are not supported on web
  if (Platform.OS === "web") return;

  try {
    // Android requires a notification channel
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#0D9488",
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingPerms = (await Notifications.getPermissionsAsync()) as any;
    let granted: boolean = existingPerms.granted ?? existingPerms.status === "granted";

    if (!granted) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newPerms = (await Notifications.requestPermissionsAsync()) as any;
      granted = newPerms.granted ?? newPerms.status === "granted";
    }

    if (!granted) {
      console.log("[push] Permission not granted — skipping token registration");
      return;
    }

    // Resolve the EAS project ID — required by Expo Push v57+.
    // Set expo.extra.eas.projectId in app.json (run `eas init` to generate one).
    const projectId: string | undefined =
      (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
      (Constants.easConfig?.projectId as string | undefined);

    if (!projectId) {
      console.warn(
        "[push] No EAS project ID found. Set expo.extra.eas.projectId in app.json " +
        "to enable Expo Push Notifications. Skipping token registration."
      );
      return;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });

    const token = tokenData.data;
    if (!token) return;

    // Send to API server
    await apiRequest("PATCH", "/api/user/push-token", { token });
    console.log("[push] Token registered:", token);
  } catch (err) {
    // Non-fatal — the app still works via polling fallback
    console.error("[push] registerPushToken error:", err);
  }
}

// Module-level flag: fire at most once per process lifetime (i.e. per app launch).
// Using a module variable (not a ref) means it survives component remounts but
// resets when the OS kills and relaunches the app — exactly the desired behaviour.
let _registeredThisLaunch = false;

/**
 * Call once at the root layout level (inside AuthProvider).
 *
 * Registers the Expo push token with the server on every app launch when the
 * user already has an active session.  This catches two cases that
 * `registerPushToken()` inside `login()` misses:
 *   1. The user denied notifications on first install, later granted them in
 *      Settings, then reopened the app without logging in again.
 *   2. Expo issued a new token after an app update.
 *
 * Throttled to fire at most once per process lifetime via `_registeredThisLaunch`
 * so it never spams the server on re-renders.
 *
 * @param isAuthenticated - pass `!!user` from `useAuth()`.
 */
export function useRegisterPushToken(isAuthenticated: boolean): void {
  useEffect(() => {
    if (!isAuthenticated) return;
    if (_registeredThisLaunch) return;
    _registeredThisLaunch = true;
    registerPushToken().catch(() => {});
  }, [isAuthenticated]);
}

/**
 * Mount this hook at the root layout to handle deep-links from notification taps.
 * Maps the notification data shape set by the API server to the correct route.
 */
export function usePushNotificationNavigation() {
  const notificationListener = useRef<NotificationsType.EventSubscription | null>(null);
  const responseListener = useRef<NotificationsType.EventSubscription | null>(null);
  // Keep a stable ref to the current user so the async navigate helper can
  // read it without needing to be re-registered on every user change.
  const { user } = useAuth();
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  useEffect(() => {
    // Push notification APIs are not available on web
    if (Platform.OS === "web") return;

    const handle = (data: Record<string, unknown>) =>
      navigateFromPushData(data, userRef).catch(() => {});

    // Notification received while app is in the foreground (no navigation, just display)
    notificationListener.current =
      Notifications.addNotificationReceivedListener(() => {
        // The handler above already shows the alert; nothing extra to do here.
      });

    // User tapped a notification (foreground or background)
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as Record<string, unknown>;
        handle(data);
      });

    // Handle the notification that launched the app from a killed state
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response?.notification?.request?.content?.data) {
        const data = response.notification.request.content.data as Record<string, unknown>;
        handle(data);
      }
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, []);
}

/**
 * Derive the correct in-app route from the push notification data payload.
 *
 * Priority:
 *  1. `chatUserId` present → go straight to /chat/:chatUserId  (new notifications)
 *  2. `requestId` present  → look up the request on the API to find the partner
 *     and navigate to their chat thread  (works for old notifications too)
 *  3. `itemId` present     → open the item detail page
 *  4. Fallback             → open the notifications list
 */
async function navigateFromPushData(
  data: Record<string, unknown>,
  userRef: React.MutableRefObject<{ id: number } | null | undefined>,
): Promise<void> {
  if (!data) return;

  const screen = data.screen as string | undefined;
  const requestId = data.requestId as number | undefined;
  const itemId = data.itemId as number | undefined;
  const chatUserId = data.chatUserId as number | undefined;

  try {
    // ── 1. Direct chat deep-link (new notifications have chatUserId set) ──
    if (chatUserId) {
      router.push(`/chat/${chatUserId}` as any);
      return;
    }

    // ── 2. Request notification — resolve partner via API ──
    if (requestId) {
      try {
        const requests = await apiGet<any[]>("/api/requests");
        const req = requests.find((r: any) => r.id === requestId);
        if (req) {
          const userId = userRef.current?.id;
          const partnerId =
            userId && req.requesterId === userId
              ? req.item?.ownerId
              : req.requesterId;
          if (partnerId) {
            router.push(`/chat/${partnerId}?requestId=${requestId}` as any);
            return;
          }
        }
      } catch {
        // API unavailable (e.g. app just cold-started) — fall through
      }
    }

    // ── 3. Item page ──
    if (screen === "item" && itemId) {
      router.push(`/item/${itemId}` as any);
      return;
    }

    // ── 4. Fallback ──
    router.push("/notifications" as any);
  } catch (err) {
    console.error("[push] navigation error:", err);
  }
}
