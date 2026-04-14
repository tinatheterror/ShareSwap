import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

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
  const [showDenyView, setShowDenyView] = useState(false);

  const isUberDelivery = deliveryMethod === "courier";

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
    queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
    queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
  };

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
      invalidate();
      if (data.disputeTriggered) {
        toast({ title: "Dispute opened", description: "We've paused this transaction while we review.", variant: "destructive" });
      } else if (data.bothConfirmed) {
        toast({ title: "Handoff complete", description: "Borrow period has started." });
      }
      onSuccess();
    },
    onError: (error: any) => {
      setIsProcessing(false);
      toast({ title: "Handoff failed", description: error.message || "Failed to confirm handoff", variant: "destructive" });
    },
  });

  const denyHandoffMutation = useMutation({
    mutationFn: async () => {
      setIsProcessing(true);
      const response = await apiRequest("POST", `/api/requests/${requestId}/deny-handoff`, {});
      return response.json();
    },
    onSuccess: (data) => {
      setIsProcessing(false);
      invalidate();
      if (data.disputeTriggered) {
        toast({ title: "Dispute opened", description: "We've paused this transaction while both sides are reviewed.", variant: "destructive" });
      } else {
        toast({ title: "Reported", description: "The other party has 24 hours to respond, then this will be flagged for review." });
      }
      onSuccess();
    },
    onError: (error: any) => {
      setIsProcessing(false);
      toast({ title: "Error", description: error.message || "Failed to report issue", variant: "destructive" });
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

  if (showDenyView) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Item not received?
            </DialogTitle>
            <DialogDescription>
              {otherPartyConfirmed
                ? "The other party already confirmed. Reporting this will open a dispute and pause the transaction."
                : "The other party will have 24 hours to respond. If they don't, this will be flagged for review."}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-800">
            {otherPartyConfirmed
              ? "⚠️ This will immediately open a dispute. Both parties will be asked to submit proof within 24 hours."
              : "We'll notify the other party and wait for their response before taking any action."}
          </div>

          <div className="flex gap-3 pt-1">
            <Button variant="outline" onClick={() => setShowDenyView(false)} disabled={isProcessing} className="flex-1">
              Go back
            </Button>
            <Button
              onClick={() => denyHandoffMutation.mutate()}
              disabled={isProcessing}
              variant="destructive"
              className="flex-1"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Reporting...
                </>
              ) : (
                "Report issue"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

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

          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
            <span className="text-amber-500 text-base leading-snug">⚠</span>
            <p className="text-sm text-amber-800">{warning}</p>
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

        <button
          onClick={() => setShowDenyView(true)}
          className="text-xs text-red-500 hover:text-red-600 text-center w-full mt-1 underline-offset-2 hover:underline"
        >
          Item was not {userRole === "borrower" ? "received" : "handed off"}?
        </button>

        <p className="text-xs text-muted-foreground text-center -mt-1">
          If only one person confirms, we'll complete this automatically in 24 hours.
        </p>
      </DialogContent>
    </Dialog>
  );
}
