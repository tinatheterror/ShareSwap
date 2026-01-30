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
import { Package, Loader2, CheckCircle2, Coins, Shield, Clock, Truck, Users } from "lucide-react";

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

  const confirmHandoffMutation = useMutation({
    mutationFn: async () => {
      setIsProcessing(true);
      
      const response = await apiRequest(
        "POST",
        `/api/requests/${requestId}/handoff`,
        {
          confirmedBy: userRole,
        }
      );
      return response.json();
    },
    onSuccess: (data) => {
      setIsProcessing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      
      if (data.bothConfirmed) {
        toast({
          title: "Handoff Complete!",
          description: "Both parties confirmed. The borrow period has started.",
        });
      } else {
        toast({
          title: "Confirmation Recorded",
          description: data.waitingMessage || "Waiting for the other party to confirm.",
        });
      }
      onSuccess();
    },
    onError: (error: any) => {
      setIsProcessing(false);
      toast({
        title: "Handoff failed",
        description: error.message || "Failed to confirm handoff",
        variant: "destructive",
      });
    },
  });

  const isUberDelivery = deliveryMethod === "courier";
  const isBorrow = requestType === "BORROW";

  const getButtonText = () => {
    if (isProcessing) return "Confirming...";
    
    if (isUberDelivery) {
      return userRole === "borrower" 
        ? "Confirm Received (after delivery)" 
        : "Confirm Sent (via courier)";
    } else {
      return "Confirm Handoff (together)";
    }
  };

  const getDialogTitle = () => {
    if (isUberDelivery) {
      return userRole === "borrower" ? "Confirm Item Received" : "Confirm Item Sent";
    }
    return "Confirm Item Handoff";
  };

  const getDialogDescription = () => {
    if (isUberDelivery) {
      return userRole === "borrower"
        ? `Confirm that you have received "${itemName}" via courier delivery.`
        : `Confirm that you have handed "${itemName}" to the courier for delivery.`;
    }
    return `Confirm that "${itemName}" has been exchanged in person.`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isUberDelivery ? (
              <Truck className="h-5 w-5 text-teal-600" />
            ) : (
              <Users className="h-5 w-5 text-teal-600" />
            )}
            {getDialogTitle()}
          </DialogTitle>
          <DialogDescription>
            {getDialogDescription()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {otherPartyConfirmed && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-sm text-green-700 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  {userRole === "borrower" 
                    ? "Owner has already confirmed. Your confirmation will complete the handoff."
                    : "Borrower has already confirmed. Your confirmation will complete the handoff."}
                </span>
              </p>
            </div>
          )}

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
            <div className="text-gray-700 font-medium">What happens next:</div>
            
            <div className="space-y-2 text-sm">
              {!otherPartyConfirmed && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Clock className="h-4 w-4 text-amber-600" />
                  <span>
                    The other party will have <span className="font-medium">24 hours</span> to confirm
                  </span>
                </div>
              )}

              {isBorrow && userRole === "borrower" && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Coins className="h-4 w-4 text-teal-600" />
                  <span>
                    <span className="font-medium text-teal-600">
                      {shareCoinAmount} ShareCoins
                    </span>{" "}
                    will be charged when both confirm
                  </span>
                </div>
              )}

              {isBorrow && userRole === "owner" && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Coins className="h-4 w-4 text-teal-600" />
                  <span>
                    You'll receive{" "}
                    <span className="font-medium text-teal-600">
                      {shareCoinAmount} ShareCoins
                    </span>{" "}
                    when both confirm
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2 text-gray-600">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>The {isBorrow ? "borrow" : "rental"} period officially starts</span>
              </div>

              <div className="flex items-center gap-2 text-gray-600">
                <Shield className="h-4 w-4 text-blue-600" />
                <span>Security deposit status changes to "held"</span>
              </div>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-xs text-amber-700">
              <span className="font-medium">Important:</span>{" "}
              {isUberDelivery 
                ? userRole === "borrower"
                  ? "Only confirm once you've received the item from the courier."
                  : "Only confirm once you've handed the item to the courier."
                : "Only confirm once you've physically exchanged the item in person."
              }
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isProcessing}
            className="flex-1"
          >
            Not Yet
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
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {getButtonText()}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
