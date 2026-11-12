import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { setApiSession } from "@/lib/api";
import { appleCredentialRevoked } from "@/lib/appleSignIn";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("@/hooks/usePushNotifications", () => ({
  registerPushToken: jest.fn().mockResolvedValue(undefined),
  getPushTokenForLogout: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/appleSignIn", () => ({ appleCredentialRevoked: jest.fn() }));

const revoked = appleCredentialRevoked as jest.Mock;
const activeUser = { id: 7, username: "ana", email: "ana@example.com" };

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 300, status, statusText: "", json: async () => body, text: async () => JSON.stringify(body), clone() { return jsonResponse(body, status); } } as Response;
}

let authState: ReturnType<typeof useAuth>;
function Probe() {
  authState = useAuth();
  return null;
}
async function settle() {
  // The check imports the Apple module lazily, which takes a few real ticks, not only microtasks.
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

let appStateListener: ((state: string) => void) | undefined;
async function openApp(stored: Record<string, string>) {
  await AsyncStorage.clear();
  for (const [k, v] of Object.entries(stored)) await AsyncStorage.setItem(k, v);
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/csrf-token")) return jsonResponse({ csrfToken: "t" });
    if (url.includes("/api/user")) return jsonResponse(activeUser);
    return jsonResponse({ success: true });
  }) as unknown as typeof fetch;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    renderer.create(<QueryClientProvider client={queryClient}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>);
    await settle();
  });
}

beforeAll(() => jest.useRealTimers());

beforeEach(() => {
  setApiSession(false);
  revoked.mockReset();
  appStateListener = undefined;
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, listener: (s: string) => void) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  }) as never);
});
afterEach(() => jest.restoreAllMocks());

const appleSession = { has_session: "1", lastAuthMethod: "apple", appleUserId: "001.apple.user" };

test("opening the app signs out an Apple session that Apple says was revoked", async () => {
  revoked.mockResolvedValue(true);
  await openApp(appleSession);
  expect(revoked).toHaveBeenCalledWith("001.apple.user");
  expect(authState.user).toBeNull();
  expect(await AsyncStorage.getItem("appleUserId")).toBeNull();
});

test("an authorized Apple session stays signed in, also after coming back to the foreground", async () => {
  revoked.mockResolvedValue(false);
  await openApp(appleSession);
  expect(authState.user).toEqual(activeUser);
  revoked.mockResolvedValue(true);
  await act(async () => { appStateListener?.("active"); await settle(); });
  expect(authState.user).toBeNull();
});

test("sessions that did not sign in with Apple on this device are never asked", async () => {
  revoked.mockResolvedValue(true);
  await openApp({ has_session: "1", lastAuthMethod: "email", appleUserId: "001.apple.user" });
  expect(authState.user).toEqual(activeUser);
  await openApp({ has_session: "1", lastAuthMethod: "apple" });
  expect(authState.user).toEqual(activeUser);
  expect(revoked).not.toHaveBeenCalled();
});
