import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { apiGet, apiPost, apiRequest } from "@/lib/api";

export interface Notification {
  id: number;
  userId: number;
  type: string;
  title?: string | null;
  message: string;
  itemId?: number | null;
  requestId?: number | null;
  isRead: boolean;
  createdAt: string;
}

interface BadgeRefreshState {
  refreshedIds: Set<number>;
  inFlightIds: Set<number>;
}

// Notifications are observed by both the always-mounted bell and the screen.
// Share per-account state so both observers only refresh once. Failed refreshes
// are removed from inFlightIds and retried when polling updates dataUpdatedAt.
const badgeRefreshStateByClient = new WeakMap<object, Map<number, BadgeRefreshState>>();

export function useNotifications() {
  const { user, refetchUser } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const { data, dataUpdatedAt } = useQuery<Notification[]>({
    queryKey: ["/api/notifications", userId],
    queryFn: () => apiGet<Notification[]>("/api/notifications"),
    enabled: userId !== undefined,
    refetchInterval: 30_000, // poll every 30s — same cadence as web
    staleTime: 15_000,
  });
  const notifications = data ?? [];

  useEffect(() => {
    if (userId === undefined) return;

    let accountRefreshStates = badgeRefreshStateByClient.get(queryClient);
    if (!accountRefreshStates) {
      accountRefreshStates = new Map<number, BadgeRefreshState>();
      badgeRefreshStateByClient.set(queryClient, accountRefreshStates);
    }
    let refreshState = accountRefreshStates.get(userId);
    if (!refreshState) {
      refreshState = { refreshedIds: new Set<number>(), inFlightIds: new Set<number>() };
      accountRefreshStates.set(userId, refreshState);
    }

    const idsToRefresh: number[] = [];
    for (const notification of notifications) {
      if (
        notification.type !== "badge_earned" ||
        notification.userId !== userId ||
        refreshState.refreshedIds.has(notification.id) ||
        refreshState.inFlightIds.has(notification.id)
      ) continue;
      refreshState.inFlightIds.add(notification.id);
      idsToRefresh.push(notification.id);
    }

    // AuthContext owns user state; refreshing it also writes the response into
    // the account-scoped /api/user query cache used by wallet screens.
    if (idsToRefresh.length > 0) {
      void Promise.resolve()
        .then(refetchUser)
        .then((refreshedUserId) => {
          if (refreshedUserId === userId) {
            idsToRefresh.forEach((id) => refreshState.refreshedIds.add(id));
            void queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
          }
        })
        .catch(() => {})
        .finally(() => {
          idsToRefresh.forEach((id) => refreshState.inFlightIds.delete(id));
        });
    }
  }, [dataUpdatedAt, notifications, queryClient, refetchUser, userId]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const markAllReadMutation = useMutation({
    mutationFn: () => apiPost("/api/notifications/read-all", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("PATCH", `/api/notifications/${id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  return {
    notifications,
    unreadCount,
    markAllRead: () => markAllReadMutation.mutate(),
    markRead: (id: number) => markReadMutation.mutate(id),
  };
}
