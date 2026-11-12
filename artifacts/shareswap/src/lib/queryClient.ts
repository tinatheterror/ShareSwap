import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { friendlyMessage, isNetworkFailure, networkError, parseErrorBody } from "./friendly-error";

/** fetch that turns "Failed to fetch" and friends into one readable message. */
async function safeFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw isNetworkFailure(error) ? networkError() : error;
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const parsed = parseErrorBody(text);
    // Never the raw body: a non-JSON or technical answer becomes plain text (and a 5xx a reference id).
    const message = friendlyMessage(res.status, parsed);
    const error = new Error(message) as Error & { code?: string; status?: number; [key: string]: any };
    error.code = parsed?.code as string | undefined;
    error.status = res.status;
    if (parsed) Object.assign(error, parsed);
    // The server's body must not overwrite the friendly text.
    error.message = message;
    // The server refuses writes until the current Terms are accepted: refetch the user so the acceptance screen opens.
    if (error.code === "TERMS_ACCEPTANCE_REQUIRED") void queryClient.invalidateQueries({ queryKey: ["/api/user"] });
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
      const eqIdx = cookie.indexOf('=');
      if (eqIdx === -1) continue;
      const name = cookie.slice(0, eqIdx).trim();
      const value = cookie.slice(eqIdx + 1).trim();
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

  // The web app ships with the server and shows the penalty modal, so it is never a legacy client.
  const headers: Record<string, string> = { "x-app-version": "web" };
  if (data && !isFormData) headers["Content-Type"] = "application/json";

  if (isMutating) {
    const token = csrfTokenManager.getToken();
    if (token) headers['x-csrf-token'] = token;
  }

  return safeFetch(url, {
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
    const res = await safeFetch(queryKey[0] as string, {
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
