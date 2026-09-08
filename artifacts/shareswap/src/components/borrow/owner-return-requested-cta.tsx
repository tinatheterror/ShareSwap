import { useQuery } from "@tanstack/react-query";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface OwnerReturnRequestedCtaProps {
  requestId: number;
  status: string;
  requestType: string;
  onConfirm: () => void;
}

export function OwnerReturnRequestedCta({
  requestId,
  status,
  requestType,
  onConfirm,
}: OwnerReturnRequestedCtaProps) {
  const lifecycleQuery = useQuery<{ lifecycle: { actions: string[] } }>({
    queryKey: ["/api/requests", requestId, "lifecycle"],
    queryFn: async () => {
      const response = await fetch(`/api/requests/${requestId}/lifecycle`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Could not load return permissions");
      return response.json();
    },
    refetchInterval: 20_000,
  });
  const fallbackCanConfirm = status === "RETURN_REQUESTED";
  const canConfirm = lifecycleQuery.isSuccess
    ? lifecycleQuery.data.lifecycle.actions.includes("confirm_return")
    : fallbackCanConfirm;

  if (!canConfirm) return null;

  const requesterLabel =
    requestType === "RENT"
      ? "Renter"
      : requestType === "SWAP"
        ? "Swapper"
        : requestType === "GIFT"
          ? "Recipient"
          : "Borrower";

  return (
    <div className="px-3 py-2 border-t border-green-100 bg-green-50 space-y-1">
      <Button
        className="w-full h-10 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl"
        onClick={onConfirm}
      >
        <CheckCircle className="h-4 w-4 mr-2" />
        Confirm return
      </Button>
      <p className="text-xs text-center text-muted-foreground">
        {requesterLabel} says they've returned the item
      </p>
      {lifecycleQuery.isLoading && (
        <p className="text-xs text-center text-muted-foreground">
          Checking the latest return permissions…
        </p>
      )}
      {lifecycleQuery.isError && (
        <p role="status" className="text-xs text-center text-amber-700">
          Couldn’t refresh return permissions. The server will verify before confirming.
        </p>
      )}
    </div>
  );
}