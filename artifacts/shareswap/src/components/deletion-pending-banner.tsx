import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { isDeletionPending, pendingBannerText, type AccountStatus } from "@/lib/account-deletion";

/**
 * Across the top of every page while a deletion is waiting out its 14 days: the date, a Cancel button, and a link to
 * the deletion page. Renders nothing for an account that is not pending deletion.
 */
export function DeletionPendingBanner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: status } = useQuery<AccountStatus>({ queryKey: ["/api/account/status"], enabled: !!user, staleTime: 30_000 });

  const cancel = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/account/deletion/cancel", {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/account/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/account/deletion-eligibility"] });
      toast({ title: "Deletion cancelled", description: "Your account stays open and your listings are visible again." });
    },
    onError: (error: Error) => toast({ title: "Couldn't cancel", description: error.message, variant: "destructive" }),
  });

  if (!user || !isDeletionPending(status)) return null;
  return (
    <div className="bg-red-50 border-b border-red-200 px-4 py-2" data-testid="deletion-pending-banner" role="status">
      <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-x-4 gap-y-2">
        <Trash2 className="h-4 w-4 text-red-700 shrink-0" aria-hidden />
        <p className="text-sm font-medium text-red-800 flex-1 min-w-[12rem]">{pendingBannerText(status.deletionScheduledFor)}</p>
        <Link href="/delete-account" className="text-sm text-red-800 underline">Details</Link>
        <Button size="sm" variant="outline" data-testid="deletion-banner-cancel" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
          {cancel.isPending ? "Cancelling..." : "Cancel deletion"}
        </Button>
      </div>
    </div>
  );
}
