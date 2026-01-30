import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export function BackgroundPolling() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isPolling = useRef(false);

  useEffect(() => {
    if (!user) return;

    const checkExpiredHandoffs = async () => {
      if (isPolling.current) return;
      isPolling.current = true;
      
      try {
        const response = await apiRequest("POST", "/api/requests/process-expired-handoffs", {});
        const result = await response.json();
        if (result.advanced > 0) {
          queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
          toast({
            title: "Handoff completed",
            description: `${result.advanced} handoff(s) auto-completed after deadline.`,
          });
        }
      } catch (error) {
        console.log("Background handoff check:", error);
      } finally {
        isPolling.current = false;
      }
    };

    checkExpiredHandoffs();
    const interval = setInterval(checkExpiredHandoffs, 60000);
    return () => clearInterval(interval);
  }, [user, queryClient, toast]);

  return null;
}
