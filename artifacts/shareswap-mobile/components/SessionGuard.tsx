/**
 * SessionGuard
 *
 * Watches the `sessionExpired` flag from AuthContext.
 * When it fires, redirects the user to the login screen with a
 * `session_expired=1` query param so the login screen can show a
 * "Your session expired – sign in again" notice.
 */
import { useRouter, usePathname, useGlobalSearchParams, useRootNavigationState } from "expo-router";
import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { requiresSignIn } from "@/lib/sessionNavigation";

export function SessionGuard() {
  const { user, isLoading, sessionExpired, clearSessionExpired } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ requestId?: string }>();
  const navigation = useRootNavigationState();
  const previousUserId = useRef<number | null>(null);
  const hasExpired = useRef(false);
  if (user) previousUserId.current = user.id;

  useEffect(() => {
    if (user) hasExpired.current = false;
    if (sessionExpired) hasExpired.current = true;
    // Also guard older stack entries if the sign-in modal is dismissed.
    // A normal guest visit offers sign-in without claiming their session expired.
    if (navigation?.key && (sessionExpired || (!user && !isLoading && requiresSignIn(pathname)))) {
      clearSessionExpired();
      // Replace so the user cannot navigate "back" to a broken authenticated screen.
      const returnTo = pathname.startsWith("/chat/") && /^\d+$/.test(params.requestId ?? "")
        ? `${pathname}?requestId=${params.requestId}` : pathname;
      router.replace({
        pathname: "/login",
        params: {
          session_expired: hasExpired.current ? "1" : "0",
          returnTo,
          returnUserId: previousUserId.current?.toString() ?? "",
        },
      } as never);
    }
  }, [user, isLoading, sessionExpired, clearSessionExpired, router, pathname, params.requestId, navigation?.key]);

  return null;
}
