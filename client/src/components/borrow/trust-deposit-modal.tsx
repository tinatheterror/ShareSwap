import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Lock, Loader2 } from "lucide-react";
import { calculateSecurityDeposit } from "@/lib/deposit-calculator";

interface TrustDepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: {
    id: number;
    itemId: number;
    deliveryMethod: string;
    depositMethod: string;
  };
  item: {
    name: string;
    tier: number;
    originalValue: string;
    shareCoinPrice: string;
    photos: string[];
  };
  trustScore: number;
  courierFee?: number;
  onSuccess: (nextStep: string) => void;
}

export function TrustDepositModal({
  isOpen,
  onClose,
  request,
  item,
  trustScore,
  courierFee = 0,
  onSuccess,
}: TrustDepositModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);

  const depositCalc = calculateSecurityDeposit(
    item.tier || 2,
    item.originalValue || "$50–$150",
    trustScore,
  );

  const TIER_WEEKLY_RATES: Record<number, number> = {
    1: 2,
    2: 5,
    3: 10,
    4: 20,
  };
  const shareCoinAmount = TIER_WEEKLY_RATES[item.tier || 2] || 5;
  const deliveryFee = request.deliveryMethod === "courier" ? courierFee : 0;
  const totalDue = depositCalc.finalDeposit + deliveryFee;

  const payDepositMutation = useMutation({
    mutationFn: async () => {
      setIsProcessing(true);
      const response = await apiRequest(
        "POST",
        `/api/requests/${request.id}/pay-deposit`,
        {
          depositAmount: depositCalc.finalDeposit,
          baseDepositAmount: depositCalc.baseDeposit,
          discountPercentage: depositCalc.discountPercentage,
          trustScore,
          paymentIntentId: `simulated-${Date.now()}`,
          shareCoinAmount,
        },
      );
      return response.json();
    },
    onSuccess: (data) => {
      setIsProcessing(false);
      toast({
        title: "Deposit secured",
        description: "Your borrow request is confirmed.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      onSuccess(data.nextStep);
    },
    onError: (error: any) => {
      setIsProcessing(false);
      toast({
        title: "Payment failed",
        description: error.message || "Failed to process deposit",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xs p-0 rounded-2xl overflow-hidden">
        <VisuallyHidden>
          <DialogTitle>Confirm your borrow</DialogTitle>
        </VisuallyHidden>
        <div className="flex flex-col px-7 pt-8 pb-7">

          {/* Title + item name */}
          <div className="text-center mb-8">
            <p className="text-base font-semibold text-gray-900 mb-1">
              Confirm your borrow
            </p>
            <p className="text-sm text-gray-400">{item.name}</p>
          </div>

          {/* Amount — focal point */}
          <div className="text-center mb-8">
            <p className="text-6xl font-bold tracking-tight text-gray-900 mb-2">
              ${totalDue.toFixed(2)}
            </p>
            <p className="text-sm text-gray-500">Fully refundable deposit</p>
          </div>

          {/* Secondary info */}
          <p className="text-center text-sm text-gray-400 mb-6">
            {shareCoinAmount} ShareCoins charged at pickup
          </p>

          {/* Trust line */}
          <p className="text-center text-xs text-gray-300 flex items-center justify-center gap-1 mb-8">
            <Lock className="h-3 w-3 flex-shrink-0" />
            Deposit is securely held and refunded after return
          </p>

          {/* Actions */}
          <Button
            onClick={() => payDepositMutation.mutate()}
            disabled={isProcessing}
            className="w-full h-12 bg-teal-600 hover:bg-teal-700 text-white text-base font-medium rounded-xl mb-2"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing
              </>
            ) : (
              `Pay $${totalDue.toFixed(2)} deposit`
            )}
          </Button>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isProcessing}
            className="w-full text-sm text-gray-400 hover:text-gray-600"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
