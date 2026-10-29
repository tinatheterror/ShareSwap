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
import AsyncStorage from "@react-native-async-storage/async-storage";
import type * as NotificationsType from "expo-notifications";
import Constants from "expo-constants";
import { router } from "expo-router";
import { AppState, AppStateStatus, Platform } from "react-native";
import { apiRequest } from "@/lib/api";
import { buildNotificationChatPath, resolveNotificationChatPath } from "@/lib/notificationChat";

/** Set by RootLayoutNav to avoid an AuthContext ↔ usePushNotifications cycle. */
let _currentUser: { id: number } | null | undefined = null;
export function setCurrentUser(u: { id: number } | null | undefined) {
  _currentUser = u;
  if (u && _killedStatePending) {
    const data = _killedStatePending;
    _killedStatePending = null;
    setTimeout(() => navigateFromPushData(data).catch((error) => {
      console.warn("[push] Could not open pending notification:", error);
    }), 350);
  }
}

// expo-notifications throws on web during module init — load it only on native.
// We keep `import type` above for TypeScript types, and use require() at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notifications: typeof NotificationsType | Record<string, never> = {};
if (Platform.OS !== "web") {
  try {
    Notifications = require("expo-notifications");
  } catch (err) {
    console.warn(
      "[push] expo-notifications native module unavailable — push disabled for this build:",
      err,
    );
  }
}
const isPushAvailable =
  Platform.OS !== "web" && Object.keys(Notifications).length > 0;

// ── Notification presentation behaviour while the app is in the foreground ──
if (isPushAvailable) {
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

const PRE_PROMPT_SEEN_KEY = "pushPrePromptSeen";
let _prePromptPending = false;
const _prePromptListeners = new Set<(pending: boolean) => void>();

function setPrePromptPending(pending: boolean) {
  _prePromptPending = pending;
  _prePromptListeners.forEach((listener) => listener(pending));
}

/** Subscribe to the "explain notifications before the system prompt" request. */
export function subscribePushPrePrompt(listener: (pending: boolean) => void): () => void {
  _prePromptListeners.add(listener);
  listener(_prePromptPending);
  return () => { _prePromptListeners.delete(listener); };
}

/** The user dismissed the explanation screen: don't show it again automatically. */
export async function dismissPushPrePrompt(): Promise<void> {
  setPrePromptPending(false);
  try {
    await AsyncStorage.setItem(PRE_PROMPT_SEEN_KEY, "1");
  } catch {
    // Best effort: worst case the explanation is shown again next launch.
  }
}

/** The user accepted the explanation: show the system prompt, then register. */
export async function acceptPushPrePrompt(): Promise<void> {
  await dismissPushPrePrompt();
  if (!isPushAvailable) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const perms = (await Notifications.requestPermissionsAsync()) as any;
    if (perms.granted ?? perms.status === "granted") await registerExpoPushToken();
  } catch (err) {
    console.error("[push] permission request error:", err);
  }
}

/**
 * Registers for push and POSTs the Expo token to the server. Fire-and-forget.
 * If permission hasn't been asked yet, this doesn't show the system prompt:
 * it asks the root layout to show an explanation screen first.
 */
export async function registerPushToken(): Promise<void> {
  // Push notifications are not supported on web, or not linked into this build
  if (!isPushAvailable) return;

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
    const granted: boolean =
      existingPerms.granted ?? existingPerms.status === "granted";

    if (!granted) {
      // The OS won't show its prompt again, and we only explain once.
      if (existingPerms.canAskAgain === false) return;
      if ((await AsyncStorage.getItem(PRE_PROMPT_SEEN_KEY)) === "1") return;
      setPrePromptPending(true);
      return;
    }

    await registerExpoPushToken();
  } catch (err) {
    // Non-fatal — the app still works via polling fallback
    console.error("[push] registerPushToken error:", err);
  }
}

/**
 * The EAS project ID, required by Expo Push v57+.
 * Set expo.extra.eas.projectId in app.json (run `eas init` to generate one).
 */
function expoProjectId(): string | undefined {
  return (
    (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
    (Constants.easConfig?.projectId as string | undefined)
  );
}

/** How long signing out waits for the device's token before it signs out without naming a device. */
const LOGOUT_TOKEN_TIMEOUT_MS = 3000;

/**
 * This device's Expo push token, so the server can stop pushing to it when the user signs out. It never
 * prompts: null when push is unavailable, not granted, or the token can't be read in time.
 */
export async function getPushTokenForLogout(): Promise<string | null> {
  if (!isPushAvailable) return null;
  const read = (async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const perms = (await Notifications.getPermissionsAsync()) as any;
    if (!(perms.granted ?? perms.status === "granted")) return null;
    const projectId = expoProjectId();
    if (!projectId) return null;
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data || null;
  })();
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), LOGOUT_TOKEN_TIMEOUT_MS));
  try {
    return await Promise.race([read, timeout]);
  } catch {
    return null;
  }
}

async function registerExpoPushToken(): Promise<void> {
  const projectId = expoProjectId();

  if (!projectId) {
    console.warn(
      "[push] No EAS project ID found. Set expo.extra.eas.projectId in app.json " +
        "to enable Expo Push Notifications. Skipping token registration.",
    );
    return;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });

  const token = tokenData.data;
  if (!token) return;

  // Send to API server
  await apiRequest("PATCH", "/api/user/push-token", { token });
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
 * Run the server-side return reminder check while the native app is active.
 *
 * The API creates the in-app notification and sends the registered Expo push
 * notification. Running this on launch/resume keeps native clients from
 * depending on the web notification bell to trigger reminders.
 */
export function useReturnReminderCheck(isAuthenticated: boolean): void {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (Platform.OS === "web" || !isAuthenticated) return;

    let isCancelled = false;
    const checkReminders = async () => {
      if (isCancelled || appStateRef.current !== "active") return;
      try {
        await apiRequest(
          "POST",
          "/api/notifications/check-return-reminders",
          {},
        );
      } catch (err) {
        // Reminder generation is best-effort and must not interrupt the app.
        console.error("[notifications] return reminder check failed:", err);
      }
    };

    const initialTimer = setTimeout(checkReminders, 5000);
    const interval = setInterval(checkReminders, 15 * 60 * 1000);
    const subscription = AppState.addEventListener("change", (nextState) => {
      appStateRef.current = nextState;
      if (nextState === "active") {
        checkReminders();
      }
    });

    return () => {
      isCancelled = true;
      clearTimeout(initialTimer);
      clearInterval(interval);
      subscription.remove();
    };
  }, [isAuthenticated]);
}

/**
 * Mount this hook at the root layout to handle deep-links from notification taps.
 * Maps the notification data shape set by the API server to the correct route.
 */
/**
 * Holds notification data that arrived while the app was killed (before the
 * router and session are ready). Cleared once navigation is attempted.
 */
let _killedStatePending: Record<string, unknown> | null = null;

export function usePushNotificationNavigation() {
  const notificationListener =
    useRef<NotificationsType.EventSubscription | null>(null);
  const responseListener = useRef<NotificationsType.EventSubscription | null>(
    null,
  );

  useEffect(() => {
    // Push notification APIs are not available on web, or not linked into this build
    if (!isPushAvailable) return;

    // Foreground/background tap: router + session are already up, navigate immediately
    const handle = (data: Record<string, unknown>) => {
      if (!_currentUser) {
        _killedStatePending = data;
        return;
      }
      navigateFromPushData(data).catch((error) => {
        console.warn("[push] Could not open notification:", error);
      });
    };

    // Notification received while app is in the foreground (no navigation, just display)
    notificationListener.current =
      Notifications.addNotificationReceivedListener(() => {});

    // User tapped a notification (foreground or background)
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as Record<
          string,
          unknown
        >;
        handle(data);
      });

    // Notification that cold-launched the app: router isn't mounted yet.
    // If we already have chatUserId we can navigate after a short delay for
    // router init; otherwise hold the data and let the user-loaded effect above
    // retry with a live session.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response?.notification?.request?.content?.data) return;
      const data = response.notification.request.content.data as Record<
        string,
        unknown
      >;
      if (_currentUser) {
        // Router needs ~300ms to mount after a cold start.
        setTimeout(() => handle(data), 350);
      } else {
        // Need the session — setCurrentUser flushes once it is available.
        _killedStatePending = data;
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
 *  1. `chatUserId` present → go to /chat/:chatUserId with requestId if available
 *  2. `requestId` present  → look up the request on the API to find the partner
 *     and navigate to their chat thread  (works for old notifications too)
 *  3. `itemId` present     → open the item detail page
 *  4. Fallback             → open the notifications list
 */
async function navigateFromPushData(
  data: Record<string, unknown>,
): Promise<void> {
  if (!data) return;

  const screen = data.screen as string | undefined;
  const requestId = data.requestId as number | undefined;
  const itemId = data.itemId as number | undefined;
  const chatUserId = data.chatUserId as string | number | undefined;

  try {
    // ── 1. Direct chat deep-link (new notifications have chatUserId set) ──
    if (chatUserId) {
      const chatPath = buildNotificationChatPath(chatUserId, requestId);
      if (chatPath) {
        router.push(chatPath as any);
        return;
      }
    }

    // ── 2. Request notification — resolve partner via API ──
    if (requestId) {
      try {
        const chatPath = await resolveNotificationChatPath(requestId, itemId);
        if (chatPath) {
          router.push(chatPath as any);
          return;
        }
      } catch (error) {
        console.warn("[push] Could not resolve request chat:", error);
      }
    }

    // ── 3. Achievements / trust score page ──
    if (screen === "achievements") {
      router.push("/achievements" as any);
      return;
    }

    // ── 4. Item page ──
    if (screen === "item" && itemId) {
      router.push(`/item/${itemId}` as any);
      return;
    }

    // ── 5. Fallback ──
    router.push("/notifications" as any);
  } catch (err) {
    console.error("[push] navigation error:", err);
  }
}
