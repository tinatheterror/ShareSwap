import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";

interface User {
  id: number;
  username: string;
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
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refetchUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
  refetchUser: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  const fetchUser = useCallback(async () => {
    try {
      const data = await apiGet<User>("/api/user");
      setUser(data);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = useCallback(
    async (username: string, password: string) => {
      await apiPost("/api/login", { username, password });
      await fetchUser();
    },
    [fetchUser],
  );

  const logout = useCallback(async () => {
    await apiPost("/api/logout");
    setUser(null);
    // Mirror web: clear the entire React Query cache so stale data
    // from the previous session never bleeds into the next login.
    queryClient.clear();
  }, [queryClient]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        refetchUser: fetchUser,
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
