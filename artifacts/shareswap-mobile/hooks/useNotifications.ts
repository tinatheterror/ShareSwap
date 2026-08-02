import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useNotifications() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    queryFn: () => apiGet<Notification[]>("/api/notifications"),
    enabled: !!user,
    refetchInterval: 30_000, // poll every 30s — same cadence as web
    staleTime: 15_000,
  });

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
