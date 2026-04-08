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

  const checkExpiredHandoffs = useCallback(async () => {
    if (isPolling.current || !document.hasFocus()) return;
    isPolling.current = true;

    try {
      const response = await apiRequest("POST", "/api/requests/check-handoff-deadlines", {});
      const result = await response.json();
      if (result.autoAdvancedCount > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
        const count = result.autoAdvancedCount;
        toast({
          title: count === 1 ? "Item exchange auto-confirmed" : `${count} item exchanges auto-confirmed`,
          description: count === 1
            ? "The other party didn't confirm receipt in time, so your item exchange was automatically confirmed. Check your inbox."
            : `${count} item exchanges were automatically confirmed after the confirmation window passed. Check your inbox.`,
        });
      }
    } catch (error) {
      // Silently ignore - no need to log polling failures
    } finally {
      isPolling.current = false;
    }
  }, [queryClient, toast]);

  useEffect(() => {
    if (!user) return;

    checkExpiredHandoffs();
    intervalRef.current = setInterval(checkExpiredHandoffs, 120000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkExpiredHandoffs();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [user, checkExpiredHandoffs]);

  return null;
}
