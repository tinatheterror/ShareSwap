import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
      <DialogContent className="sm:max-w-xs p-8 rounded-2xl">
        <div className="flex flex-col items-center text-center space-y-6">
          {/* Title & subtitle */}
          <div className="space-y-1">
            <p className="text-base font-medium text-gray-900">Confirm your borrow</p>
            <p className="text-sm text-gray-400">{item.name}</p>
          </div>

          {/* Main amount */}
          <div className="space-y-1">
            <p className="text-5xl font-bold tracking-tight text-gray-900">
              ${totalDue.toFixed(2)}
            </p>
            <p className="text-sm text-gray-400">Refundable deposit</p>
          </div>

          {/* Secondary charge */}
          <p className="text-sm text-gray-400">
            {shareCoinAmount} ShareCoins charged at pickup
          </p>

          {/* Trust line */}
          <p className="text-xs text-gray-300 flex items-center gap-1">
            <Lock className="h-3 w-3" />
            Deposit is held securely and refunded after return
          </p>

          {/* CTA */}
          <div className="w-full space-y-2 pt-2">
            <Button
              onClick={() => payDepositMutation.mutate()}
              disabled={isProcessing}
              className="w-full h-12 bg-teal-600 hover:bg-teal-700 text-white text-base font-medium rounded-xl"
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
              className="w-full text-gray-400 hover:text-gray-600 text-sm"
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
