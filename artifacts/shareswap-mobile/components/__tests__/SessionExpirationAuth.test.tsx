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

let walletBalance: number | undefined;
let refreshWallet: (() => Promise<unknown>) | undefined;

function WalletPollingProbe() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["/api/user", user?.id],
    queryFn: () => apiGet<typeof activeUser & { shareCoins: number }>("/api/user"),
    enabled: !!user,
    refetchInterval: false,
  });
  walletBalance = user?.shareCoins;
  refreshWallet = query.refetch;
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
  it("reports user refresh success and synchronizes the account-scoped wallet cache", async () => {
    await AsyncStorage.setItem("has_session", "1");
    let userFetches = 0;
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes("/api/user")) {
        throw new Error(`Unexpected request: ${String(input)}`);
      }
      userFetches += 1;
      if (userFetches === 3) {
        return jsonResponse({ error: "Temporary failure" }, 503);
      }
      return jsonResponse({
        ...activeUser,
        shareCoins: userFetches === 1 ? 8 : 9,
      });
    });
    global.fetch = fetchMock as typeof fetch;

    const queryClient = createQueryClient();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderAuth(queryClient);
      await settleEffects();
    });

    expect(authState.user?.shareCoins).toBe(8);
    expect(queryClient.getQueryData(["/api/user", activeUser.id])).toMatchObject({ shareCoins: 8 });

    await act(async () => {
      await expect(authState.refetchUser()).resolves.toBe(activeUser.id);
      await settleEffects();
    });
    expect(authState.user?.shareCoins).toBe(9);
    expect(queryClient.getQueryData(["/api/user", activeUser.id])).toMatchObject({ shareCoins: 9 });

    await act(async () => {
      await expect(authState.refetchUser()).resolves.toBeNull();
      await settleEffects();
    });
    expect(authState.user?.shareCoins).toBe(9);

    act(() => tree.unmount());
    queryClient.clear();
  });

  it("shows an independently refreshed server balance to context consumers and ignores late old-account cache data", async () => {
    await AsyncStorage.setItem("has_session", "1");
    let serverUser = { ...activeUser, shareCoins: 8 };
    let deferNextUserResponse = false;
    let releaseLateResponse: (() => void) | undefined;
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes("/api/user")) {
        throw new Error(`Unexpected request: ${String(input)}`);
      }
      if (deferNextUserResponse) {
        deferNextUserResponse = false;
        const lateUser = { ...serverUser, shareCoins: 99 };
        return new Promise<Response>((resolve) => {
          releaseLateResponse = () => resolve(jsonResponse(lateUser));
        });
      }
      return jsonResponse(serverUser);
    });
    global.fetch = fetchMock as typeof fetch;

    const queryClient = createQueryClient();
    let tree!: renderer.ReactTestRenderer;
    try {
      await act(async () => {
        tree = renderer.create(
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <AuthStateProbe />
              <WalletPollingProbe />
            </AuthProvider>
          </QueryClientProvider>,
        );
        await settleEffects();
      });

      expect(authState.user?.shareCoins).toBe(8);
      expect(walletBalance).toBe(8);

      serverUser = { ...serverUser, shareCoins: 17 };
      await act(async () => {
        await refreshWallet?.();
        await settleEffects();
      });
      expect(queryClient.getQueryData(["/api/user", activeUser.id])).toMatchObject({ shareCoins: 17 });
      expect(walletBalance).toBe(17);

      const newAccount = {
        id: 42,
        username: "riley",
        email: "riley@example.com",
        shareCoins: 3,
      };
      serverUser = newAccount;
      deferNextUserResponse = true;
      let lateRefresh!: Promise<unknown>;
      act(() => {
        // Attach rejection handling immediately: switching accounts advances
        // the API session epoch, so this old request must reject on completion.
        lateRefresh = queryClient.fetchQuery({
          queryKey: ["/api/user", activeUser.id],
          queryFn: () => apiGet<typeof activeUser & { shareCoins: number }>("/api/user"),
          staleTime: 0,
        }).catch((error: unknown) => error);
      });
      await act(async () => {
        await settleEffects();
      });
      expect(releaseLateResponse).toBeDefined();

      act(() => authState.setUserData(newAccount));
      expect(walletBalance).toBe(3);

      // Resolve the previous account's actual query after switching accounts.
      await act(async () => {
        releaseLateResponse?.();
        await expect(lateRefresh).resolves.toMatchObject({ status: 401 });
        await settleEffects();
      });
      act(() => {
        queryClient.setQueryData(["/api/user", activeUser.id], {
          ...activeUser,
          shareCoins: 99,
        });
      });
      expect(authState.user).toMatchObject({ id: 42, shareCoins: 3 });
      expect(walletBalance).toBe(3);
    } finally {
      if (tree) act(() => tree.unmount());
      queryClient.clear();
    }
  });

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