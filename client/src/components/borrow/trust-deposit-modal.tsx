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
import { Coins, Shield, Truck, Loader2, CheckCircle2 } from "lucide-react";
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
    trustScore
  );

  // Tier-based weekly ShareCoin borrow rates (not the item's full valuation)
  const TIER_WEEKLY_RATES: Record<number, number> = {
    1: 2,   // Tier 1: Under $50 - 2 SC/week
    2: 5,   // Tier 2: $50-$150 - 5 SC/week
    3: 10,  // Tier 3: $150-$300 - 10 SC/week
    4: 20,  // Tier 4: $300+ - 20 SC/week
  };
  const shareCoinAmount = TIER_WEEKLY_RATES[item.tier || 2] || 5;
  const deliveryFee = request.deliveryMethod === "courier" ? courierFee : 0;

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
          trustScore: trustScore,
          paymentIntentId: `simulated-${Date.now()}`,
          shareCoinAmount: shareCoinAmount,
        }
      );
      return response.json();
    },
    onSuccess: (data) => {
      setIsProcessing(false);
      toast({
        title: "Deposit secured!",
        description: "Your trust deposit has been authorized.",
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-teal-600" />
            Secure Your Borrow
          </DialogTitle>
          <DialogDescription>
            Complete payment to confirm your borrow request for{" "}
            <span className="font-medium text-gray-900">{item.name}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {item.photos?.[0] && (
            <div className="flex justify-center">
              <img
                src={item.photos[0]}
                alt={item.name}
                className="w-24 h-24 object-cover rounded-lg border"
              />
            </div>
          )}

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
            <div className="text-gray-700 font-medium">Cost Breakdown</div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-gray-600 flex items-center gap-2">
                  <Coins className="h-4 w-4 text-teal-600" />
                  ShareCoins to be charged
                </span>
                <span className="font-medium">{shareCoinAmount} SC</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-gray-600 flex items-center gap-2">
                  <Shield className="h-4 w-4 text-blue-600" />
                  Trust deposit (refundable)
                </span>
                {depositCalc.discountPercentage > 0 ? (
                  <span className="font-medium flex items-center gap-1.5">
                    <span className="relative text-gray-400 text-sm">
                      <span className="absolute inset-0 flex items-center">
                        <span className="w-full h-[1px] bg-gray-400"></span>
                      </span>
                      ${depositCalc.baseDeposit}
                    </span>
                    <span className="text-teal-600">${depositCalc.finalDeposit}</span>
                  </span>
                ) : (
                  <span className="font-medium">${depositCalc.finalDeposit}</span>
                )}
              </div>

              {depositCalc.discountPercentage > 0 && (
                <div className="text-xs text-teal-600 ml-6">
                  {depositCalc.discountPercentage}% trust score discount applied
                </div>
              )}

              {deliveryFee > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 flex items-center gap-2">
                    <Truck className="h-4 w-4 text-orange-600" />
                    Courier delivery fee
                  </span>
                  <span className="font-medium">${deliveryFee.toFixed(2)}</span>
                </div>
              )}

              <div className="border-t border-gray-200 pt-2 mt-2">
                <div className="flex justify-between items-center font-medium">
                  <span className="text-gray-700">Total due now</span>
                  <span className="text-teal-600 text-lg">
                    ${(depositCalc.finalDeposit + deliveryFee).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-md p-2 text-xs text-green-700">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>
                  Deposit auto-refunded when item is returned safely
                </span>
              </div>
            </div>
          </div>

          <div className="text-xs text-gray-500 text-center">
            ShareCoins will be charged at handoff. Deposit is held securely.
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isProcessing}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={() => payDepositMutation.mutate()}
            disabled={isProcessing}
            className="flex-1 bg-teal-600 hover:bg-teal-700"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Shield className="h-4 w-4 mr-2" />
                Confirm & Secure Borrow
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
