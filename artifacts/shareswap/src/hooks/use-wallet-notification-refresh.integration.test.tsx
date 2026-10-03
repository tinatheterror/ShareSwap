import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useWalletNotificationRefresh } from "./use-wallet-notification-refresh";

describe("server-authoritative badge balance refresh", () => {
  it("updates a cached balance and ledger once, without adding the reward again on repeated polls", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    let serverBalance = 43;
    let serverHistory: { amount: number }[] = [];
    const fetchBalance = vi.fn(async () => ({ id: 2, shareCoins: serverBalance }));
    const fetchHistory = vi.fn(async () => serverHistory);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const badge = { id: 10, userId: 2, type: "badge_earned" };
    const { result, rerender, unmount } = renderHook(({ notifications }) => {
      const account = useQuery({ queryKey: ["/api/user"], queryFn: fetchBalance });
      const history = useQuery({ queryKey: ["/api/transactions"], queryFn: fetchHistory });
      useWalletNotificationRefresh(account.data?.id, notifications);
      return { balance: account.data?.shareCoins, history: history.data };
    }, { initialProps: { notifications: [] as typeof badge[] }, wrapper });
    try {
      await waitFor(() => expect(result.current.balance).toBe(43));
      serverBalance = 44;
      serverHistory = [{ amount: 1 }];
      rerender({ notifications: [badge] });
      await waitFor(() => {
        expect(result.current.balance).toBe(44);
        expect(result.current.history).toEqual([{ amount: 1 }]);
      });
      rerender({ notifications: [{ ...badge }] });
      expect(result.current.balance).toBe(44);
      expect(fetchBalance).toHaveBeenCalledTimes(2);
      expect(fetchHistory).toHaveBeenCalledTimes(2);
    } finally {
      unmount();
      queryClient.clear();
    }
  });
});