import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface OwnerReturnRequestedCtaProps {
  status: string;
  lifecycleStage?: string | null;
  requestType: string;
  onConfirm: () => void;
}

export function OwnerReturnRequestedCta({
  status,
  lifecycleStage: _lifecycleStage,
  requestType,
  onConfirm,
}: OwnerReturnRequestedCtaProps) {
  if (status !== "RETURN_REQUESTED") return null;

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
    </div>
  );
}