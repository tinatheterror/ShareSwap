import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export function BackgroundPolling() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isPolling = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenLevelUpIds = useRef<Set<number>>(new Set());
  const levelUpInitialized = useRef(false);

  const checkExpiredHandoffs = useCallback(async () => {
    if (isPolling.current || !document.hasFocus()) return;
    isPolling.current = true;

    try {
      const response = await apiRequest("POST", "/api/requests/check-handoff-deadlines", {});
      const result = await response.json();
      if (result.autoAdvancedCount > 0 || result.flaggedCount > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
        queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      }
      if (result.autoAdvancedCount > 0) {
        const count = result.autoAdvancedCount;
        toast({
          title: count === 1 ? "Exchange auto-confirmed" : `${count} exchanges auto-confirmed`,
          description: count === 1
            ? "The other party didn't confirm receipt in time, so your exchange was automatically confirmed. Check your inbox."
            : `${count} exchanges were automatically confirmed after the confirmation window passed. Check your inbox.`,
        });
      }
      if (result.flaggedCount > 0) {
        const count = result.flaggedCount;
        toast({
          title: count === 1 ? "Exchange flagged for review" : `${count} exchanges flagged for review`,
          description: "One party reported the item was not handed off and no response was received. An admin will review shortly.",
          variant: "destructive",
        });
      }
    } catch (error) {
      // Silently ignore - no need to log polling failures
    } finally {
      isPolling.current = false;
    }
  }, [queryClient, toast]);

  const checkLevelUp = useCallback(async () => {
    try {
      const response = await apiRequest("GET", "/api/notifications");
      const notifications: any[] = await response.json();
      const levelUpNotifs = notifications.filter(
        (n: any) => n.type === "level_up" && !n.isRead
      );

      if (!levelUpInitialized.current) {
        // First run: seed seen IDs so we don't toast existing unread level-ups
        levelUpNotifs.forEach((n: any) => seenLevelUpIds.current.add(n.id));
        levelUpInitialized.current = true;
        return;
      }

      const newLevelUps = levelUpNotifs.filter(
        (n: any) => !seenLevelUpIds.current.has(n.id)
      );
      for (const notif of newLevelUps) {
        seenLevelUpIds.current.add(notif.id);
        toast({
          title: `🎉 ${notif.title}`,
          description: notif.message,
          duration: 8000,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/user"] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      }
    } catch {
      // Silently ignore
    }
  }, [queryClient, toast]);

  useEffect(() => {
    if (!user) return;

    checkExpiredHandoffs();
    checkLevelUp();

    intervalRef.current = setInterval(() => {
      checkExpiredHandoffs();
      checkLevelUp();
    }, 120000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkExpiredHandoffs();
        checkLevelUp();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [user, checkExpiredHandoffs, checkLevelUp]);

  return null;
}
