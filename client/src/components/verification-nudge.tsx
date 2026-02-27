import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { X, Shield, ArrowRight, BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

export function VerificationNudge() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [isVisible, setIsVisible] = useState(false);

  const { data: nudgeStatus } = useQuery<{
    hasSeenNudge: boolean;
    isVerified: boolean;
  }>({
    queryKey: ["/api/verification-nudge-status"],
    enabled: !!user,
  });

  const dismissMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/verification-nudge-dismiss");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/verification-nudge-status"],
      });
      setIsVisible(false);
    },
  });

  useEffect(() => {
    if (!nudgeStatus || nudgeStatus.hasSeenNudge || nudgeStatus.isVerified || !user) return;

    const tutorialKey = `hasSeenTutorial_${user.id}`;
    const tutorialDone = localStorage.getItem(tutorialKey);

    if (tutorialDone) {
      // Tutorial already completed — show after short delay
      const timer = setTimeout(() => setIsVisible(true), 1500);
      return () => clearTimeout(timer);
    } else {
      // Tutorial not yet completed — wait for it to finish
      const handleTutorialComplete = () => {
        setTimeout(() => setIsVisible(true), 800);
      };
      window.addEventListener("tutorial-complete", handleTutorialComplete);
      return () => window.removeEventListener("tutorial-complete", handleTutorialComplete);
    }
  }, [nudgeStatus, user]);

  if (
    !isVisible ||
    !nudgeStatus ||
    nudgeStatus.hasSeenNudge ||
    nudgeStatus.isVerified
  ) {
    return null;
  }

  const handleVerifyNow = () => {
    dismissMutation.mutate();
    navigate("/profile#verification-status");
  };

  const handleDismiss = () => {
    dismissMutation.mutate();
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-white border border-gray-200 rounded-lg shadow-lg z-50 animate-in slide-in-from-bottom-5">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <BadgeCheck
            className="h-5 w-5 flex-shrink-0"
            fill="#0DCEA1"
            stroke="white"
          />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 text-sm">
              Get verified for better deals
            </p>
            <p className="text-xs text-gray-600 mt-1">
              Verified members get lower trust deposits and faster approvals.
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            onClick={handleVerifyNow}
            className="flex-1 bg-[#0BB88C] hover:bg-[#0BB88C]/90 text-white text-xs"
          >
            Verify now
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
