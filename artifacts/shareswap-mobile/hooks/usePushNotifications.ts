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

import { useEffect, useRef } from "react";
import type * as NotificationsType from "expo-notifications";
import Constants from "expo-constants";
import { router } from "expo-router";
import { Platform } from "react-native";
import { apiRequest } from "@/lib/api";

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

/**
 * Mount this hook at the root layout to handle deep-links from notification taps.
 * Maps the notification data shape set by the API server to the correct route.
 */
export function usePushNotificationNavigation() {
  const notificationListener = useRef<NotificationsType.EventSubscription | null>(null);
  const responseListener = useRef<NotificationsType.EventSubscription | null>(null);

  useEffect(() => {
    // Push notification APIs are not available on web
    if (Platform.OS === "web") return;

    // Notification received while app is in the foreground (no navigation, just display)
    notificationListener.current =
      Notifications.addNotificationReceivedListener(() => {
        // The handler above already shows the alert; nothing extra to do here.
      });

    // User tapped a notification (foreground or background)
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as Record<
          string,
          unknown
        >;
        navigateFromPushData(data);
      });

    // Handle the notification that launched the app from a killed state
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response?.notification?.request?.content?.data) {
        const data = response.notification.request.content.data as Record<
          string,
          unknown
        >;
        navigateFromPushData(data);
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
 * The API server attaches `{ screen, requestId, itemId, chatUserId }` so we
 * can deep-link to the right screen.
 */
function navigateFromPushData(data: Record<string, unknown>): void {
  if (!data) return;

  const screen = data.screen as string | undefined;
  const requestId = data.requestId as number | undefined;
  const itemId = data.itemId as number | undefined;
  const chatUserId = data.chatUserId as number | undefined;

  try {
    if (screen === "chat" && chatUserId) {
      router.push(`/chat/${chatUserId}` as any);
    } else if (screen === "item" && itemId) {
      router.push(`/item/${itemId}` as any);
    } else if (screen === "notifications") {
      router.push("/notifications" as any);
    } else {
      // Fallback: open the notifications list
      router.push("/notifications" as any);
    }
  } catch (err) {
    console.error("[push] navigation error:", err);
  }
}
