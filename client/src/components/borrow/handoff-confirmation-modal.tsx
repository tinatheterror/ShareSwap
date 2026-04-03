import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, CheckCircle2 } from "lucide-react";

interface HandoffConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: number;
  itemName: string;
  shareCoinAmount: number;
  userRole: "owner" | "borrower";
  deliveryMethod: "in_person" | "courier";
  otherPartyConfirmed?: boolean;
  requestType?: "BORROW" | "RENT";
  onSuccess: () => void;
}

export function HandoffConfirmationModal({
  isOpen,
  onClose,
  requestId,
  itemName,
  shareCoinAmount,
  userRole,
  deliveryMethod,
  otherPartyConfirmed = false,
  requestType = "BORROW",
  onSuccess,
}: HandoffConfirmationModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);

  const isUberDelivery = deliveryMethod === "courier";

  const confirmHandoffMutation = useMutation({
    mutationFn: async () => {
      setIsProcessing(true);
      const response = await apiRequest("POST", `/api/requests/${requestId}/handoff`, {
        confirmedBy: userRole,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setIsProcessing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      if (data.bothConfirmed) {
        toast({ title: "Handoff complete", description: "Borrow period has started." });
      } else {
        toast({ title: "Confirmed", description: data.waitingMessage || "Waiting for the other party to confirm." });
      }
      onSuccess();
    },
    onError: (error: any) => {
      setIsProcessing(false);
      toast({ title: "Handoff failed", description: error.message || "Failed to confirm handoff", variant: "destructive" });
    },
  });

  const title = isUberDelivery
    ? userRole === "borrower" ? "Confirm Item Received" : "Confirm Item Sent"
    : "Confirm Item Handoff";

  const description = isUberDelivery
    ? userRole === "borrower"
      ? `Confirm that you've received "${itemName}" via courier.`
      : `Confirm that you've handed "${itemName}" to the courier.`
    : `Confirm that ${itemName} has been exchanged in person`;

  const warning = isUberDelivery
    ? userRole === "borrower"
      ? "Only confirm once you've received the item from the courier."
      : "Only confirm once you've handed the item to the courier."
    : "Only confirm once you've physically exchanged the item";

  const buttonLabel = isUberDelivery
    ? userRole === "borrower" ? "Confirm received" : "Confirm sent"
    : "Confirm handoff";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {otherPartyConfirmed && (
            <div className="flex items-start gap-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                {userRole === "borrower"
                  ? "Owner has already confirmed. Your confirmation will complete the handoff."
                  : "Borrower has already confirmed. Your confirmation will complete the handoff."}
              </span>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg bg-teal-50 border border-teal-200 px-3 py-2.5">
            <span className="text-teal-500 text-base leading-snug">⚠</span>
            <p className="text-sm text-teal-800">{warning}</p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose} disabled={isProcessing} className="flex-1">
            Not yet
          </Button>
          <Button
            onClick={() => confirmHandoffMutation.mutate()}
            disabled={isProcessing}
            className="flex-1 bg-teal-600 hover:bg-teal-700"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Confirming...
              </>
            ) : (
              buttonLabel
            )}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Both of you need to confirm to complete the handoff
        </p>
      </DialogContent>
    </Dialog>
  );
}
