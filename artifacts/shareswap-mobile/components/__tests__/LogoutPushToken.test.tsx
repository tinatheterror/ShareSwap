import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { setApiSession } from "@/lib/api";
import { getPushTokenForLogout } from "@/hooks/usePushNotifications";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

jest.mock("@/hooks/usePushNotifications", () => ({
  registerPushToken: jest.fn().mockResolvedValue(undefined),
  getPushTokenForLogout: jest.fn(),
}));

const activeUser = { id: 41, username: "morgan", email: "morgan@example.com" };

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return jsonResponse(body, status);
    },
  } as Response;
}

let authState: ReturnType<typeof useAuth>;
function AuthStateProbe() {
  authState = useAuth();
  return null;
}

async function settle() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  setApiSession(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function signOutAndGetLogoutBody(token: string | null) {
  (getPushTokenForLogout as jest.Mock).mockResolvedValue(token);
  await AsyncStorage.setItem("has_session", "1");
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/csrf-token")) return jsonResponse({ csrfToken: "csrf-test" });
    if (url.includes("/api/logout")) return jsonResponse({ success: true });
    if (url.includes("/api/user")) return jsonResponse(activeUser);
    throw new Error(`Unexpected request: ${url}`);
  });
  global.fetch = fetchMock as typeof fetch;

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthStateProbe />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await settle();
  });
  expect(authState.user).toEqual(activeUser);

  await act(async () => {
    await authState.logout();
    await settle();
  });
  expect(authState.user).toBeNull();

  const call = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/logout"));
  act(() => tree.unmount());
  queryClient.clear();
  expect(call).toBeDefined();
  return JSON.parse(String((call![1] as RequestInit).body ?? "{}"));
}

describe("mobile logout and push tokens", () => {
  it("tells the server which device is signing out", async () => {
    expect(await signOutAndGetLogoutBody("ExponentPushToken[abc]")).toEqual({ token: "ExponentPushToken[abc]" });
  });

  it("still signs out when the device has no push token", async () => {
    expect(await signOutAndGetLogoutBody(null)).toEqual({});
  });

  it("still signs out when reading the token fails", async () => {
    (getPushTokenForLogout as jest.Mock).mockRejectedValue(new Error("no native module"));
    await AsyncStorage.setItem("has_session", "1");
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/csrf-token")) return jsonResponse({ csrfToken: "csrf-test" });
      if (url.includes("/api/logout")) return jsonResponse({ success: true });
      return jsonResponse(activeUser);
    });
    global.fetch = fetchMock as typeof fetch;
    const queryClient = new QueryClient();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AuthStateProbe />
          </AuthProvider>
        </QueryClientProvider>,
      );
      await settle();
    });
    await act(async () => {
      await authState.logout();
      await settle();
    });
    expect(authState.user).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/logout"))).toBe(true);
    act(() => tree.unmount());
    queryClient.clear();
  });
});
