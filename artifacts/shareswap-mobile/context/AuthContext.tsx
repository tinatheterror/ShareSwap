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
import { apiGet, apiPost } from "@/lib/api";

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
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const queryClient = useQueryClient();

  // Track whether we had a valid session before this fetch so we can
  // distinguish "first open with no session" from "session expired mid-use".
  const hadSession = useRef(false);

  const fetchUser = useCallback(async () => {
    try {
      const data = await apiGet<User>("/api/user");
      setUser(data);
      hadSession.current = true;
      // Persist the fact that the user has an active session.
      await AsyncStorage.setItem(HAS_SESSION_KEY, "1");
    } catch (err: unknown) {
      setUser(null);
      const status = (err as { status?: number })?.status;
      if (status === 401) {
        // Only flag as expired when the user had a prior session.
        // This avoids showing the banner on a fresh install / clean logout.
        const storedSession = await AsyncStorage.getItem(HAS_SESSION_KEY);
        if (hadSession.current || storedSession === "1") {
          setSessionExpired(true);
          await AsyncStorage.removeItem(HAS_SESSION_KEY);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
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
      const deviceFingerprint = await getDeviceFingerprint();
      await apiPost("/api/login", { username, password, deviceFingerprint });
      await AsyncStorage.setItem(LAST_AUTH_METHOD_KEY, "email");
      setSessionExpired(false);
      await fetchUser();
    },
    [fetchUser, getDeviceFingerprint],
  );

  const register = useCallback(
    async (opts: { email: string; password: string; fullName?: string; referralCode?: string }) => {
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
      await fetchUser();
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
      if (next === "active") fetchUser();
    });
    return () => sub.remove();
  }, [fetchUser]);

  const logout = useCallback(async () => {
    await apiPost("/api/logout");
    setUser(null);
    setSessionExpired(false);
    hadSession.current = false;
    await AsyncStorage.multiRemove([HAS_SESSION_KEY, LAST_AUTH_METHOD_KEY]);
    // Mirror web: clear the entire React Query cache so stale data
    // from the previous session never bleeds into the next login.
    queryClient.clear();
  }, [queryClient]);

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
