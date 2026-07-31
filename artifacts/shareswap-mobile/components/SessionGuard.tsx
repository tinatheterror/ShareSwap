/**
 * SessionGuard
 *
 * Watches the `sessionExpired` flag from AuthContext.
 * When it fires, redirects the user to the login screen with a
 * `session_expired=1` query param so the login screen can show a
 * "Your session expired – sign in again" notice.
 */
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";

export function SessionGuard() {
  const { sessionExpired, clearSessionExpired } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (sessionExpired) {
      clearSessionExpired();
      // Replace so the user cannot navigate "back" to a broken authenticated screen.
      router.replace("/login?session_expired=1" as never);
    }
  }, [sessionExpired, clearSessionExpired, router]);

  return null;
}
