import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export interface PendingPlanChange {
  tier: "member" | "pro";
  effectiveAt: string;
}

const PLAN_NAMES = { free: "Free", member: "Member", pro: "Pro" } as const;

const defaultDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric" });

/** "Switching to Member on November 20": shown while a downgrade waits for the end of the paid period. */
export function pendingChangeLabel(pending: PendingPlanChange | null | undefined, formatDate: (iso: string) => string = defaultDate): string | null {
  if (!pending) return null;
  return `Switching to ${PLAN_NAMES[pending.tier]} on ${formatDate(pending.effectiveAt)}`;
}

/**
 * The pending plan change, with a "Keep <current plan>" action that drops it (POST /api/subscription/keep-plan).
 * Renders nothing when no change is pending.
 */
export function PendingPlanChangeNotice({ pending, currentTier }: { pending: PendingPlanChange | null | undefined; currentTier: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const keepPlan = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/subscription/keep-plan", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
      toast({ title: "Plan kept", description: "Your plan will not change." });
    },
    onError: () => toast({ title: "Couldn't keep your plan", description: "Please try again.", variant: "destructive" }),
  });

  const label = pendingChangeLabel(pending);
  if (!label) return null;
  const keepName = PLAN_NAMES[currentTier as keyof typeof PLAN_NAMES] ?? "your plan";
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="pending-plan-change">
      <Clock className="h-4 w-4 shrink-0" />
      <span className="flex-1 font-medium">{label}</span>
      <Button
        variant="outline"
        size="sm"
        className="h-7 border-amber-300 bg-white text-xs text-amber-800 hover:bg-amber-100"
        onClick={() => keepPlan.mutate()}
        disabled={keepPlan.isPending}
      >
        {keepPlan.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : `Keep ${keepName}`}
      </Button>
    </div>
  );
}
