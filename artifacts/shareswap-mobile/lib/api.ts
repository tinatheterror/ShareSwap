const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

async function throwIfNotOk(res: Response) {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    const isHtml = /<!doctype html|<html[\s>]/i.test(text);
    const fallbackMessage =
      res.status === 401
        ? "Your session has expired. Please sign in again."
        : res.status === 403
        ? "Your request could not be verified. Please try again."
        : `Request failed (${res.status}). Please try again.`;
    const msg =
      (parsed?.error as string) ||
      (parsed?.message as string) ||
      (text && !isHtml ? `${res.status}: ${text}` : fallbackMessage);
    const err = new Error(msg) as Error & {
      status?: number;
      code?: string;
      required?: number;
      missing?: Record<string, unknown>;
    } & Record<string, unknown>;
    err.status = res.status;
    if (parsed?.code) err.code = parsed.code as string;
    if (parsed?.required !== undefined) err.required = parsed.required as number;
    if (parsed?.missing) err.missing = parsed.missing as Record<string, unknown>;
    // Some payment preparation responses intentionally use a non-2xx status to
    // require an explicit next step. Preserve that structured response so callers
    // can render the server-provided disclosure rather than parsing its message.
    if (parsed) Object.assign(err, parsed);
    throw err;
  }
}

let csrfToken: string | null = null;
let csrfTokenRequest: Promise<string> | null = null;

async function fetchCsrfToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && csrfToken) return csrfToken;
  if (csrfTokenRequest) return csrfTokenRequest;

  if (forceRefresh) csrfToken = null;
  csrfTokenRequest = (async () => {
    const res = await fetch(`${BASE_URL}/api/csrf-token`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error("Unable to verify this request. Please try again.");
    }
    const body = (await res.json().catch(() => null)) as { csrfToken?: string } | null;
    if (!body?.csrfToken) {
      throw new Error("Unable to verify this request. Please try again.");
    }
    csrfToken = body.csrfToken;
    return csrfToken;
  })();

  try {
    return await csrfTokenRequest;
  } finally {
    csrfTokenRequest = null;
  }
}

export async function apiRequest(
  method: string,
  path: string,
  data?: unknown,
): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  const isMutating =
    method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  const isFormData = data instanceof FormData;

  const headers: Record<string, string> = {};

  if (data && !isFormData) {
    headers["Content-Type"] = "application/json";
  }

  if (isMutating) {
    headers["x-csrf-token"] = await fetchCsrfToken();
  }

  const res = await fetch(url, {
    method,
    headers,
    body: isFormData
      ? (data as FormData)
      : data
        ? JSON.stringify(data)
        : undefined,
    credentials: "include",
  });

  if (res.status === 403 && isMutating) {
    const body = await res.clone().text();
    if (
      body.toLowerCase().includes("csrf") ||
      body.toLowerCase().includes("token")
    ) {
      headers["x-csrf-token"] = await fetchCsrfToken(true);
      const retryRes = await fetch(url, {
        method,
        headers,
        body: isFormData
          ? (data as FormData)
          : data
            ? JSON.stringify(data)
            : undefined,
        credentials: "include",
      });
      await throwIfNotOk(retryRes);
      return retryRes;
    }
  }

  await throwIfNotOk(res);
  return res;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiRequest("GET", path);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, data?: unknown): Promise<T> {
  const res = await apiRequest("POST", path, data);
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, data?: unknown): Promise<T> {
  const res = await apiRequest("PATCH", path, data);
  return res.json() as Promise<T>;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await apiRequest("DELETE", path);
  return res.json() as Promise<T>;
}

/** Ensure photo/avatar paths stored as "/storage/..." become full URLs. */
export function photoUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  return raw.startsWith("/") ? `${BASE_URL}${raw}` : raw;
}

export { BASE_URL };
