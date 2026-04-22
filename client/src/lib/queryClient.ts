import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch {}
    const error = new Error(parsed?.error || `${res.status}: ${text}`) as Error & { code?: string; status?: number; [key: string]: any };
    error.code = parsed?.code;
    error.status = res.status;
    if (parsed && typeof parsed === "object") Object.assign(error, parsed);
    throw error;
  }
}

// Security: CSRF Token Manager
class CsrfTokenManager {
  private token: string | null = null;
  private fetching: Promise<void> | null = null;

  async ensureToken(): Promise<void> {
    if (this.token) return;
    if (this.fetching) return this.fetching;
    this.fetching = this.fetchToken();
    await this.fetching;
    this.fetching = null;
  }

  private async fetchToken(): Promise<void> {
    try {
      await fetch('/api/csrf-token', { credentials: 'include' });
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
    return this.token || this.getTokenFromCookie();
  }

  // Force a fresh token fetch (called when server rejects the current token)
  async refreshToken(): Promise<void> {
    this.token = null;
    this.fetching = null;
    await this.ensureToken();
  }
}

const csrfTokenManager = new CsrfTokenManager();

// Initialize CSRF token when the module loads
csrfTokenManager.ensureToken().catch(err => {
  console.error('Failed to initialize CSRF token:', err);
});

async function doFetch(
  method: string,
  url: string,
  data?: unknown,
): Promise<Response> {
  const isMutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  const isFormData = data instanceof FormData;

  const headers: HeadersInit = data && !isFormData
    ? { "Content-Type": "application/json" }
    : {};

  if (isMutating) {
    const token = csrfTokenManager.getToken();
    if (token) headers['x-csrf-token'] = token;
  }

  return fetch(url, {
    method,
    headers,
    body: isFormData ? data : (data ? JSON.stringify(data) : undefined),
    credentials: "include",
  });
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const isMutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

  if (isMutating) {
    await csrfTokenManager.ensureToken();
  }

  const res = await doFetch(method, url, data);

  // If the server rejected the CSRF token (403 with csrf in message), refresh
  // and retry once. This recovers automatically after a server restart where
  // the in-memory session store is wiped and old tokens become invalid.
  if (res.status === 403 && isMutating) {
    const body = await res.clone().text();
    if (body.toLowerCase().includes('csrf') || body.toLowerCase().includes('token')) {
      try {
        await csrfTokenManager.refreshToken();
        const retryRes = await doFetch(method, url, data);
        await throwIfResNotOk(retryRes);
        return retryRes;
      } catch {
        // Retry failed — fall through to throw original error
      }
    }
  }

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
