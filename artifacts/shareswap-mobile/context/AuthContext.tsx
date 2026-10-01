import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, AppStateStatus } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, onSessionExpired, setApiSession } from "@/lib/api";
import { registerPushToken } from "@/hooks/usePushNotifications";

const HAS_SESSION_KEY = "has_session";
export const LAST_AUTH_METHOD_KEY = "lastAuthMethod";

interface User {
  id: number;
  username: string;
  handle?: string;
  email: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  trustScore?: number;
  trustLevel?: string;
  shareCoins?: number;
  location?: string;
  neighbourhood?: string;
  isVerified?: boolean;
  defaultCity?: string | null;
  defaultPostalCode?: string | null;
  locationRadius?: number | null;
  emailVerified?: boolean;
  authProvider?: string;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  sessionExpired: boolean;
  clearSessionExpired: () => void;
  login: (username: string, password: string) => Promise<void>;
  register: (opts: { email: string; password: string; fullName?: string; referralCode?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refetchUser: () => Promise<void>;
  resendVerification: () => Promise<void>;
  /** Set user state directly from a response payload (e.g. after OAuth token exchange) */
  setUserData: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  sessionExpired: false,
  clearSessionExpired: () => {},
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  refetchUser: async () => {},
  resendVerification: async () => {},
  setUserData: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const queryClient = useQueryClient();

  // Track whether we had a valid session before this fetch so we can
  // distinguish "first open with no session" from "session expired mid-use".
  const hadSession = useRef(false);
  const authGeneration = useRef(0);

  const expireSession = useCallback(() => {
    if (!hadSession.current) return;
    hadSession.current = false;
    authGeneration.current++;
    setUser(null);
    setSessionExpired(true);
    // Cancel first, then remove both queries and mutations. Late responses are
    // also rejected by the API epoch, including requests without AbortSignals.
    void queryClient.cancelQueries();
    queryClient.clear();
    AsyncStorage.removeItem(HAS_SESSION_KEY).catch(() => {});
  }, [queryClient]);

  useEffect(() => onSessionExpired(expireSession), [expireSession]);

  const fetchUser = useCallback(async () => {
    const generation = authGeneration.current;
    try {
      const data = await apiGet<User>("/api/user");
      if (generation !== authGeneration.current) return;
      setUser(data);
      if (!hadSession.current) setApiSession(true);
      hadSession.current = true;
      // Persist the fact that the user has an active session.
      await AsyncStorage.setItem(HAS_SESSION_KEY, "1");
    } catch (err: unknown) {
      if (generation !== authGeneration.current) return;
      const status = (err as { status?: number })?.status;
      if (status === 401) {
        // Only flag as expired when the user had a prior session.
        // This avoids showing the banner on a fresh install / clean logout.
        expireSession();
      }
    } finally {
      setIsLoading(false);
    }
  }, [expireSession]);

  useEffect(() => {
    let mounted = true;
    const generation = authGeneration.current;
    AsyncStorage.getItem(HAS_SESSION_KEY).then((stored) => {
      if (!mounted || generation !== authGeneration.current) return;
      hadSession.current = stored === "1";
      setApiSession(hadSession.current);
      void fetchUser();
    }).catch(() => { if (mounted) void fetchUser(); });
    return () => { mounted = false; };
  }, [fetchUser]);

  const clearSessionExpired = useCallback(() => {
    setSessionExpired(false);
  }, []);

  // Stable device fingerprint stored in AsyncStorage — used for referral fraud detection
  const getDeviceFingerprint = useCallback(async (): Promise<string> => {
    const FINGERPRINT_KEY = "device_fingerprint";
    try {
      const stored = await AsyncStorage.getItem(FINGERPRINT_KEY);
      if (stored) return stored;
      // Simple UUID v4-like generator without external deps
      const id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
      await AsyncStorage.setItem(FINGERPRINT_KEY, id);
      return id;
    } catch {
      return "unknown";
    }
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      authGeneration.current++;
      const deviceFingerprint = await getDeviceFingerprint();
      await apiPost("/api/login", { username, password, deviceFingerprint });
      // A successful POST alone is not enough: the next request must be able to
      // use the session cookie. Unlike fetchUser(), do not swallow a failed check.
      const authenticatedUser = await apiGet<User>("/api/user", { sessionProbe: true });
      authGeneration.current++;
      setApiSession(true);
      setUser(authenticatedUser);
      hadSession.current = true;
      await AsyncStorage.setItem(HAS_SESSION_KEY, "1");
      await AsyncStorage.setItem(LAST_AUTH_METHOD_KEY, "email");
      setSessionExpired(false);
      // Register Expo push token with the server after successful login
      registerPushToken().catch(() => {});
    },
    [getDeviceFingerprint],
  );

  const register = useCallback(
    async (opts: { email: string; password: string; fullName?: string; referralCode?: string }) => {
      authGeneration.current++;
      const deviceFingerprint = await getDeviceFingerprint();
      await apiPost("/api/register", {
        username: opts.email,
        password: opts.password,
        fullName: opts.fullName,
        referralCode: opts.referralCode,
        deviceFingerprint,
      });
      await AsyncStorage.setItem(LAST_AUTH_METHOD_KEY, "email");
      setSessionExpired(false);
      setApiSession(false);
      await fetchUser();
      // Register Expo push token with the server after successful registration
      registerPushToken().catch(() => {});
    },
    [fetchUser, getDeviceFingerprint],
  );

  const resendVerification = useCallback(async () => {
    await apiPost("/api/auth/resend-verification", {});
  }, []);

  // Refresh user whenever the app comes back to the foreground so that
  // emailVerified changes (user clicked the link in their email) are picked up.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active" && hadSession.current) fetchUser();
    });
    return () => sub.remove();
  }, [fetchUser]);

  const logout = useCallback(async () => {
    // Always clear local state first so the user is signed out immediately
    // even if the server request fails (network error, expired CSRF, etc.).
    setUser(null);
    setSessionExpired(false);
    hadSession.current = false;
    authGeneration.current++;
    setApiSession(false);
    await AsyncStorage.multiRemove([HAS_SESSION_KEY, LAST_AUTH_METHOD_KEY]);
    queryClient.clear();
    // Best-effort server-side session teardown.
    apiPost("/api/logout").catch(() => {});
  }, [queryClient]);

  const setUserData = useCallback((data: User) => {
    authGeneration.current++;
    setApiSession(true);
    setUser(data);
    hadSession.current = true;
    setSessionExpired(false);
    AsyncStorage.setItem(HAS_SESSION_KEY, "1").catch(() => {});
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        sessionExpired,
        clearSessionExpired,
        login,
        register,
        logout,
        refetchUser: fetchUser,
        resendVerification,
        setUserData,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export type { User };
