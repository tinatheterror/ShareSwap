import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { apiGet, setApiSession } from "@/lib/api";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

jest.mock("@/hooks/usePushNotifications", () => ({
  registerPushToken: jest.fn().mockResolvedValue(undefined),
}));

const activeUser = {
  id: 41,
  username: "morgan",
  email: "morgan@example.com",
};

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

function ChatPollingProbe() {
  const { user } = useAuth();
  useQuery({
    queryKey: ["/api/messages/2", null],
    queryFn: () => apiGet("/api/messages/2"),
    enabled: !!user,
    refetchInterval: user ? 5_000 : false,
  });
  useQuery({
    queryKey: ["/api/requests"],
    queryFn: () => apiGet("/api/requests"),
    enabled: !!user,
    refetchInterval: user ? 8_000 : false,
  });
  return null;
}

function renderAuth(queryClient: QueryClient) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthStateProbe />
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  return tree;
}

async function settleEffects() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  setApiSession(false);
  authState = undefined as unknown as ReturnType<typeof useAuth>;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("mobile session expiration", () => {
  it("does not treat a fresh signed-out 401 as an expired session", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ error: "Unauthorized" }, 401));
    global.fetch = fetchMock as typeof fetch;
    const queryClient = createQueryClient();
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderAuth(queryClient);
      await settleEffects();
    });

    expect(authState.user).toBeNull();
    expect(authState.sessionExpired).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/user");

    act(() => tree.unmount());
    queryClient.clear();
  });

  it("clears the signed-in user and query cache once, then rejects repeated calls without fetching", async () => {
    await AsyncStorage.setItem("has_session", "1");
    let privateCallCount = 0;
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/user")) return jsonResponse(activeUser);
      if (url.includes("/api/private")) {
        privateCallCount += 1;
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const queryClient = createQueryClient();
    queryClient.setQueryData(["private", "profile"], { secret: "cached" });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderAuth(queryClient);
      await settleEffects();
    });
    expect(authState.user).toEqual(activeUser);
    expect(authState.sessionExpired).toBe(false);

    await act(async () => {
      await expect(apiGet("/api/private")).rejects.toMatchObject({ status: 401 });
      await settleEffects();
    });

    expect(authState.user).toBeNull();
    expect(authState.sessionExpired).toBe(true);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(AsyncStorage.removeItem).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("has_session");

    await act(async () => {
      await expect(apiGet("/api/private")).rejects.toMatchObject({ status: 401 });
      await expect(apiGet("/api/private")).rejects.toMatchObject({ status: 401 });
      await settleEffects();
    });
    expect(privateCallCount).toBe(1);
    expect(AsyncStorage.removeItem).toHaveBeenCalledTimes(1);
    expect(authState.user).toBeNull();
    expect(authState.sessionExpired).toBe(true);

    act(() => tree.unmount());
    queryClient.clear();
  });

  it("accepts a fresh login after expiration and permits authenticated requests again", async () => {
    await AsyncStorage.setItem("has_session", "1");
    let privateCallCount = 0;
    let initialUserFetches = 0;
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/csrf-token")) return jsonResponse({ csrfToken: "csrf-test" });
      if (url.includes("/api/login")) return jsonResponse({ ok: true });
      if (url.includes("/api/user")) {
        initialUserFetches += 1;
        return jsonResponse(activeUser);
      }
      if (url.includes("/api/private")) {
        privateCallCount += 1;
        return privateCallCount === 1
          ? jsonResponse({ error: "Unauthorized" }, 401)
          : jsonResponse({ value: "available after login" });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const queryClient = createQueryClient();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderAuth(queryClient);
      await settleEffects();
    });
    expect(authState.user).toEqual(activeUser);

    await act(async () => {
      await expect(apiGet("/api/private")).rejects.toMatchObject({ status: 401 });
      await settleEffects();
    });
    expect(authState.sessionExpired).toBe(true);

    await act(async () => {
      await authState.login("morgan@example.com", "password");
      await settleEffects();
    });
    expect(authState.user).toEqual(activeUser);
    expect(authState.sessionExpired).toBe(false);
    expect(initialUserFetches).toBe(2);

    await expect(apiGet<{ value: string }>("/api/private")).resolves.toEqual({
      value: "available after login",
    });
    expect(privateCallCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/login"),
      expect.objectContaining({ method: "POST" }),
    );

    act(() => tree.unmount());
    queryClient.clear();
  });

  it("stops chat-shaped 5s and 8s polling after expiration while the chat remains mounted", async () => {
    jest.useFakeTimers();
    await AsyncStorage.setItem("has_session", "1");
    let messageCallCount = 0;
    let requestCallCount = 0;
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/user")) return jsonResponse(activeUser);
      if (url.includes("/api/messages/2")) {
        messageCallCount += 1;
        return messageCallCount === 1
          ? jsonResponse([])
          : jsonResponse({ error: "Unauthorized" }, 401);
      }
      if (url.endsWith("/api/requests")) {
        requestCallCount += 1;
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false },
      },
    });
    let tree!: renderer.ReactTestRenderer;

    try {
      await act(async () => {
        tree = renderer.create(
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <AuthStateProbe />
              <ChatPollingProbe />
            </AuthProvider>
          </QueryClientProvider>,
        );
        await settleEffects();
      });

      expect(authState.user).toEqual(activeUser);
      expect(messageCallCount).toBe(1);
      expect(requestCallCount).toBe(1);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5_000);
        await settleEffects();
      });

      expect(authState.user).toBeNull();
      expect(authState.sessionExpired).toBe(true);
      expect(messageCallCount).toBe(2);
      expect(requestCallCount).toBe(1);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(32_000);
        await settleEffects();
      });

      expect(messageCallCount).toBe(2);
      expect(requestCallCount).toBe(1);
      expect(
        queryClient.getQueryCache().getAll().every((query) => query.state.data === undefined),
      ).toBe(true);
    } finally {
      if (tree) act(() => tree.unmount());
      queryClient.clear();
      jest.useRealTimers();
    }
  });
});