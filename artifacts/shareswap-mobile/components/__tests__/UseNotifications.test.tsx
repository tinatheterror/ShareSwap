import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { apiGet } from "@/lib/api";
import { useNotifications } from "@/hooks/useNotifications";

jest.mock("@/context/AuthContext", () => ({ useAuth: jest.fn() }));
jest.mock("@/lib/api", () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  apiRequest: jest.fn(),
}));

function NotificationsProbe() {
  useNotifications();
  return null;
}

function renderProbe(queryClient: QueryClient) {
  return renderer.create(
    <QueryClientProvider client={queryClient}>
      <NotificationsProbe />
      <NotificationsProbe />
    </QueryClientProvider>,
  );
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

const mountedTrees: renderer.ReactTestRenderer[] = [];
const queryClients: QueryClient[] = [];

afterEach(() => {
  mountedTrees.forEach((tree) => act(() => tree.unmount()));
  queryClients.forEach((queryClient) => queryClient.clear());
  mountedTrees.length = 0;
  queryClients.length = 0;
});

function badgeNotification(id: number, userId: number) {
  return {
    id,
    userId,
    type: "badge_earned",
    message: "You earned a badge!",
    isRead: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

async function settleEffects() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("badge notification balance refresh", () => {
  it("refreshes AuthContext once per newly observed badge, even with multiple notification observers", async () => {
    const firstBadge = badgeNotification(101, 7);
    const queryClient = createQueryClient();
    queryClients.push(queryClient);
    const refetchUser = jest.fn().mockResolvedValue(7);
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 7 }, refetchUser });
    (apiGet as jest.Mock).mockResolvedValue([]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderProbe(queryClient);
      mountedTrees.push(tree);
      await settleEffects();
    });

    await act(async () => {
      queryClient.setQueryData(["/api/notifications", 7], [firstBadge]);
      await settleEffects();
    });
    expect(refetchUser).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      queryClient.setQueryData(
        ["/api/notifications", 7],
        [badgeNotification(102, 7), firstBadge],
      );
      await settleEffects();
    });
    expect(refetchUser).toHaveBeenCalledTimes(2);

  });

  it("retries a badge refresh after a transient failure when a later poll succeeds", async () => {
    const notifications = [badgeNotification(151, 7)];
    const queryClient = createQueryClient();
    queryClients.push(queryClient);
    const refetchUser = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(7);
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 7 }, refetchUser });
    (apiGet as jest.Mock).mockResolvedValue([]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderProbe(queryClient);
      mountedTrees.push(tree);
      await settleEffects();
    });
    await act(async () => {
      queryClient.setQueryData(["/api/notifications", 7], notifications);
      await settleEffects();
    });
    expect(refetchUser).toHaveBeenCalledTimes(1);

    (apiGet as jest.Mock).mockResolvedValue(notifications);
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ["/api/notifications", 7],
        exact: true,
      });
      await settleEffects();
    });

    // The successful poll may return the very same structurally shared array.
    expect(refetchUser).toHaveBeenCalledTimes(2);
  });

  it("does not let an old account's late notification response refresh the newly signed-in account", async () => {
    let resolveOldNotifications!: (notifications: ReturnType<typeof badgeNotification>[]) => void;
    const oldNotifications = new Promise<ReturnType<typeof badgeNotification>[]>((resolve) => {
      resolveOldNotifications = resolve;
    });
    const queryClient = createQueryClient();
    queryClients.push(queryClient);
    const oldAccountRefresh = jest.fn().mockResolvedValue(7);
    const newAccountRefresh = jest.fn().mockResolvedValue(8);
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 7 }, refetchUser: oldAccountRefresh });
    (apiGet as jest.Mock)
      .mockReturnValueOnce(oldNotifications)
      .mockResolvedValueOnce([]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderProbe(queryClient);
      mountedTrees.push(tree);
      await settleEffects();
    });
    expect(apiGet).toHaveBeenCalledTimes(1);

    (useAuth as jest.Mock).mockReturnValue({ user: { id: 8 }, refetchUser: newAccountRefresh });
    await act(async () => {
      tree.update(
        <QueryClientProvider client={queryClient}>
          <NotificationsProbe />
          <NotificationsProbe />
        </QueryClientProvider>,
      );
      await settleEffects();
    });
    expect(apiGet).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveOldNotifications([badgeNotification(201, 7)]);
      await settleEffects();
    });

    expect(oldAccountRefresh).not.toHaveBeenCalled();
    expect(newAccountRefresh).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(["/api/notifications", 8])).toEqual([]);

  });
});