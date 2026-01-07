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
import { Package, Loader2, CheckCircle2, Coins, Shield } from "lucide-react";

interface HandoffConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: number;
  itemName: string;
  shareCoinAmount: number;
  userRole: "owner" | "borrower";
  onSuccess: () => void;
}

export function HandoffConfirmationModal({
  isOpen,
  onClose,
  requestId,
  itemName,
  shareCoinAmount,
  userRole,
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
      toast({
        title: "Handoff confirmed!",
        description: "The borrow period has officially started.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-teal-600" />
            Confirm Item Handoff
          </DialogTitle>
          <DialogDescription>
            Confirm that{" "}
            <span className="font-medium text-gray-900">{itemName}</span> has
            been exchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
            <div className="text-gray-700 font-medium">What happens next:</div>
            
            <div className="space-y-2 text-sm">
              {userRole === "borrower" && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Coins className="h-4 w-4 text-teal-600" />
                  <span>
                    <span className="font-medium text-teal-600">
                      {shareCoinAmount} ShareCoins
                    </span>{" "}
                    will be charged from your balance
                  </span>
                </div>
              )}

              {userRole === "owner" && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Coins className="h-4 w-4 text-teal-600" />
                  <span>
                    You'll receive{" "}
                    <span className="font-medium text-teal-600">
                      {shareCoinAmount} ShareCoins
                    </span>
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2 text-gray-600">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>The borrow period officially starts</span>
              </div>

              <div className="flex items-center gap-2 text-gray-600">
                <Shield className="h-4 w-4 text-blue-600" />
                <span>Trust deposit status changes to "held"</span>
              </div>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-xs text-amber-700">
              <span className="font-medium">Important:</span> Only confirm once
              you've physically received or handed over the item. This action
              cannot be undone.
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
                Confirm Handoff
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
