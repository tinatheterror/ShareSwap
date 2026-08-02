import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

async function throwIfNotOk(res: Response) {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    const msg =
      (parsed?.error as string) ||
      (parsed?.message as string) ||
      `${res.status}: ${text}`;
    const err = new Error(msg) as Error & {
      status?: number;
      code?: string;
      missing?: Record<string, unknown>;
    };
    err.status = res.status;
    if (parsed?.code) err.code = parsed.code as string;
    if (parsed?.missing) err.missing = parsed.missing as Record<string, unknown>;
    throw err;
  }
}

async function getCsrfToken(): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem("csrf_token");
    return stored;
  } catch {
    return null;
  }
}

async function fetchCsrfToken(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/api/csrf-token`, {
      credentials: "include",
    });
    const body = (await res.json().catch(() => null)) as { csrfToken?: string } | null;
    if (body?.csrfToken) {
      await AsyncStorage.setItem("csrf_token", body.csrfToken);
    }
  } catch {}
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
    let token = await getCsrfToken();
    if (!token) {
      await fetchCsrfToken();
      token = await getCsrfToken();
    }
    if (token) headers["x-csrf-token"] = token;
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
      await fetchCsrfToken();
      const token2 = await getCsrfToken();
      if (token2) headers["x-csrf-token"] = token2;
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
