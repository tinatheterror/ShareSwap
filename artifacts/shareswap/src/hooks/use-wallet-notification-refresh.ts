import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

type WalletNotification = { id: number; userId: number | null; type: string };

export async function fetchAccountNotifications<T extends WalletNotification>(
  userId: number,
  signal?: AbortSignal,
): Promise<T[]> {
  const response = await fetch("/api/notifications", { credentials: "include", signal });
  if (!response.ok) throw new Error(`Failed to fetch notifications (${response.status})`);
  const notifications: T[] = await response.json();
  return notifications.filter((notification) => notification.userId === userId);
}

/** Refetch server balances, never optimistically add coins from an alert. */
export function useWalletNotificationRefresh(
  userId: number | undefined,
  notifications: readonly WalletNotification[],
  notificationsUpdatedAt = 0,
) {
  const queryClient = useQueryClient();
  const seen = useRef<{ userId: number | undefined; ids: Set<number> }>({
    userId: undefined,
    ids: new Set(),
  });

  useEffect(() => {
    if (seen.current.userId !== userId) seen.current = { userId, ids: new Set() };
    if (!userId) return;
    const rewards = notifications.filter(
      (notification) => notification.userId === userId
        && ["badge_earned", "sharecoin_earned"].includes(notification.type),
    );
    const newRewards = rewards.filter((notification) => !seen.current.ids.has(notification.id));
    rewards.forEach((notification) => seen.current.ids.add(notification.id));
    if (!newRewards.length) return;
    const accountSeen = seen.current;
    // Also refresh on the first batch: alerts may have arrived while the navbar
    // was unmounted and the indefinitely fresh auth cache still held the old balance.
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/user"] }, { throwOnError: true }),
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] }, { throwOnError: true }),
    ]).catch(() => {
      // Let the next successful notification poll retry a temporary failure.
      // This captured account state cannot reset the next account's seen IDs.
      newRewards.forEach((notification) => accountSeen.ids.delete(notification.id));
    });
  }, [userId, notifications, notificationsUpdatedAt, queryClient]);
}