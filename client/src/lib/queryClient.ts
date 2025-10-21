import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Security: CSRF Token Manager
class CsrfTokenManager {
  private token: string | null = null;
  private fetching: Promise<void> | null = null;

  async ensureToken(): Promise<void> {
    // If already have a token, return
    if (this.token) return;

    // If already fetching, wait for that to complete
    if (this.fetching) return this.fetching;

    // Fetch the token
    this.fetching = this.fetchToken();
    await this.fetching;
    this.fetching = null;
  }

  private async fetchToken(): Promise<void> {
    try {
      // Call the CSRF token endpoint to set the cookie
      await fetch('/api/csrf-token', {
        credentials: 'include',
      });
      // Read the token from the cookie
      this.token = this.getTokenFromCookie();
    } catch (error) {
      console.error('Failed to fetch CSRF token:', error);
      throw error;
    }
  }

  private getTokenFromCookie(): string | null {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'x-csrf-token') {
        return decodeURIComponent(value);
      }
    }
    return null;
  }

  getToken(): string | null {
    // Try to get from memory first, then from cookie
    return this.token || this.getTokenFromCookie();
  }

  clearToken(): void {
    this.token = null;
  }
}

const csrfTokenManager = new CsrfTokenManager();

// Initialize CSRF token when the module loads
csrfTokenManager.ensureToken().catch(err => {
  console.error('Failed to initialize CSRF token:', err);
});

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // Security: Ensure CSRF token is available for mutating requests
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    await csrfTokenManager.ensureToken();
  }

  // Check if data is FormData - if so, let browser set Content-Type automatically
  const isFormData = data instanceof FormData;
  
  const headers: HeadersInit = data && !isFormData ? { "Content-Type": "application/json" } : {};
  
  // Security: Include CSRF token in header for mutating requests
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const token = csrfTokenManager.getToken();
    if (token) {
      headers['x-csrf-token'] = token;
    }
  }
  
  const res = await fetch(url, {
    method,
    headers,
    body: isFormData ? data : (data ? JSON.stringify(data) : undefined),
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
