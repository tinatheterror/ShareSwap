import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { fetchAccountNotifications, useWalletNotificationRefresh } from "./use-wallet-notification-refresh";

const { invalidateQueries } = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

describe("badge wallet notification refresh", () => {
  beforeEach(() => invalidateQueries.mockReset());
  afterEach(() => vi.unstubAllGlobals());
  const badge = { id: 10, userId: 2, type: "badge_earned" };

  it("filters a notification response to the account that owns its cache and supports cancellation", async () => {
    const signal = new AbortController().signal;
    const fetchNotifications = vi.fn(async () => ({
      ok: true,
      json: async () => [badge, { ...badge, id: 11, userId: 3 }],
    }));
    vi.stubGlobal("fetch", fetchNotifications);
    expect(await fetchAccountNotifications(2, signal)).toEqual([badge]);
    expect(fetchNotifications).toHaveBeenCalledWith("/api/notifications", {
      credentials: "include", signal,
    });
  });

  it("fails explicitly rather than hiding an unsuccessful notification fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    await expect(fetchAccountNotifications(2)).rejects.toThrow("Failed to fetch notifications (503)");
  });

  it("refreshes both balance and history for an existing badge on first load", () => {
    renderHook(() => useWalletNotificationRefresh(2, [badge]));
    expect(invalidateQueries.mock.calls.map(([options]) => options.queryKey)).toEqual([
      ["/api/user"], ["/api/transactions"],
    ]);
  });

  it("refreshes a new badge once without repeating for polling or read-state changes", () => {
    const { rerender } = renderHook(
      ({ notifications }) => useWalletNotificationRefresh(2, notifications),
      { initialProps: { notifications: [] as typeof badge[] } },
    );
    rerender({ notifications: [badge] });
    rerender({ notifications: [{ ...badge }] });
    rerender({ notifications: [] });
    rerender({ notifications: [badge] });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("keeps ordinary ShareCoin alerts refreshing the wallet", () => {
    renderHook(() => useWalletNotificationRefresh(2, [{ ...badge, type: "sharecoin_earned" }]));
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("does not refresh for other accounts, ordinary alerts, or signed-out state", () => {
    renderHook(() => useWalletNotificationRefresh(3, [badge]));
    renderHook(() => useWalletNotificationRefresh(2, [{ ...badge, type: "item_request" }]));
    renderHook(() => useWalletNotificationRefresh(undefined, [badge]));
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("resets its seen rewards across logout and account changes", () => {
    const { rerender } = renderHook(
      ({ userId }) => useWalletNotificationRefresh(userId, [badge]),
      { initialProps: { userId: 2 as number | undefined } },
    );
    rerender({ userId: undefined });
    rerender({ userId: 3 });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    rerender({ userId: 2 });
    expect(invalidateQueries).toHaveBeenCalledTimes(4);
  });

  it("retries failed refreshes on a later poll even if notifications are unchanged", async () => {
    invalidateQueries.mockRejectedValueOnce(new Error("Temporary network failure"));
    const notifications = [badge];
    const { rerender } = renderHook(
      ({ updatedAt }) => useWalletNotificationRefresh(2, notifications, updatedAt),
      { initialProps: { updatedAt: 1 } },
    );
    // Flush the failed Promise.all before simulating the next poll.
    await waitFor(async () => { await Promise.resolve(); });
    rerender({ updatedAt: 2 });
    expect(invalidateQueries).toHaveBeenCalledTimes(4);
    rerender({ updatedAt: 3 });
    expect(invalidateQueries).toHaveBeenCalledTimes(4);
  });
});