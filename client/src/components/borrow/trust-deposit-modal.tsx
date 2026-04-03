import { useState } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Coins, Shield, Loader2, CheckCircle, Lock } from "lucide-react";
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
          trustScore: trustScore,
          paymentIntentId: `simulated-${Date.now()}`,
          shareCoinAmount: shareCoinAmount,
        },
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
      <DialogContent className="sm:max-w-sm p-0 overflow-hidden rounded-2xl">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <p className="text-xs font-semibold uppercase tracking-widest text-teal-600 mb-0.5">
            Confirm your borrow
          </p>
          <h2 className="text-lg font-semibold text-gray-900 leading-snug">
            Reserve {item.name}
          </h2>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Due now */}
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
            <p className="text-xs text-teal-700 font-medium uppercase tracking-wide mb-1">
              Due now
            </p>
            <p className="text-3xl font-bold text-gray-900">
              ${totalDue.toFixed(2)}
            </p>
            <p className="text-sm text-teal-700 mt-0.5 flex items-center gap-1">
              <Shield className="h-3.5 w-3.5" />
              Refundable deposit
              {depositCalc.discountPercentage > 0 && (
                <span className="ml-1 text-xs text-teal-600">
                  ({depositCalc.discountPercentage}% trust discount applied)
                </span>
              )}
            </p>
          </div>

          {/* Later at pickup */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">
              Later at pickup
            </p>
            <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
              <Coins className="h-4 w-4 text-teal-600" />
              {shareCoinAmount} ShareCoins will be charged
            </p>
          </div>

          {/* What happens next */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              What happens next
            </p>
            <ul className="space-y-2">
              {[
                "Your deposit is held securely",
                `You'll pay ${shareCoinAmount} ShareCoins when you receive the item`,
                "Your deposit is automatically refunded after safe return",
              ].map((step) => (
                <li key={step} className="flex items-start gap-2 text-sm text-gray-700">
                  <CheckCircle className="h-4 w-4 text-teal-500 flex-shrink-0 mt-0.5" />
                  {step}
                </li>
              ))}
            </ul>
          </div>

          {/* Protection footer */}
          <p className="text-xs text-gray-400 text-center flex items-center justify-center gap-1">
            <Lock className="h-3 w-3" />
            Protected by ShareSwap — your deposit is secure
          </p>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex gap-3">
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
            className="flex-1 bg-teal-600 hover:bg-teal-700 text-white"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing…
              </>
            ) : (
              `Pay $${totalDue.toFixed(2)} deposit`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
