import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Lock, Loader2, MessageCircle, Coins } from "lucide-react";
import { calculateSecurityDeposit } from "@/lib/deposit-calculator";
import { format } from "date-fns";

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("T")[0].split("-").map(Number);
  return new Date(y, m - 1, d);
}

interface TrustDepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestType?: string;
  request: {
    id: number;
    itemId: number;
    deliveryMethod: string;
    depositMethod: string;
    startDate?: string | null;
    endDate?: string | null;
  };
  item: {
    name: string;
    tier: number;
    originalValue: string;
    shareCoinPrice: string;
    photos: string[];
  };
  ownerId: number;
  trustScore: number;
  onSuccess: (nextStep: string) => void;
}

export function TrustDepositModal({
  isOpen,
  onClose,
  requestType,
  request,
  item,
  ownerId,
  trustScore,
  onSuccess,
}: TrustDepositModalProps) {
  const isRental = requestType === "RENT";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [successData, setSuccessData] = useState<{ nextStep: string } | null>(null);

  const depositCalc = calculateSecurityDeposit(
    item.tier || 2,
    item.originalValue || "$50–$150",
    trustScore,
  );

  const _rawSCPrice = parseFloat(item.shareCoinPrice || "0") || 5;
  const shareCoinAmount = (() => {
    if (!request.startDate || !request.endDate) return _rawSCPrice;
    const start = parseLocalDate(request.startDate);
    const end = parseLocalDate(request.endDate);
    const borrowDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
    return Math.max(1, Math.ceil((_rawSCPrice / 7) * borrowDays));
  })();

  const depositAmount = depositCalc.finalDeposit;
  const PLATFORM_FEE_WAIVED = new Date().getFullYear() <= 2026;
  const platformFee = PLATFORM_FEE_WAIVED ? 0 : Math.round(depositAmount * 0.03 * 100) / 100;
  const platformFeeDisplay = Math.round(depositAmount * 0.03 * 100) / 100; // shown for reference even when waived

  const payDepositMutation = useMutation({
    mutationFn: async () => {
      setIsProcessing(true);

      // Step 1: Charge the platform fee immediately (real charge)
      const feeRes = await apiRequest("POST", "/api/stripe/charge-platform-fee", {
        platformFeeAmount: platformFee,
        requestId: request.id,
      });
      const feeData = await feeRes.json();
      if (!feeData.chargeId) throw new Error(feeData.error || "Failed to charge platform fee");

      // Step 2: Create the authorization hold using saved card (off-session)
      const holdRes = await apiRequest("POST", "/api/stripe/create-deposit-hold", {
        depositAmount,
        requestId: request.id,
      });
      const holdData = await holdRes.json();
      if (!holdData.paymentIntentId) throw new Error(holdData.error || "Failed to create deposit hold");

      // Step 3: Record everything in the database
      const response = await apiRequest(
        "POST",
        `/api/requests/${request.id}/pay-deposit`,
        {
          depositAmount,
          processingFee: platformFee,
          totalAmount: depositAmount + platformFee,
          baseDepositAmount: depositCalc.baseDeposit,
          discountPercentage: depositCalc.discountPercentage,
          trustScore,
          paymentIntentId: holdData.paymentIntentId,
          platformFeeChargeId: feeData.chargeId,
          shareCoinAmount,
        },
      );
      return response.json();
    },
    onSuccess: (data) => {
      setIsProcessing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      setSuccessData({ nextStep: data.nextStep });
      setSucceeded(true);
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

  const handleMessageLender = () => {
    onClose();
    window.dispatchEvent(
      new CustomEvent("open-chat-request", {
        detail: { requestId: request.id },
      })
    );
  };

  const handleViewRequest = () => {
    if (successData) onSuccess(successData.nextStep);
    else onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !succeeded && onClose()}>
      <DialogContent className="sm:max-w-xs p-0 rounded-2xl overflow-hidden">
        <VisuallyHidden>
          <DialogTitle>{succeeded ? "Deposit secured" : isRental ? "Confirm your rental" : "Confirm your borrow"}</DialogTitle>
        </VisuallyHidden>

        {succeeded ? (
          /* ── Success screen ── */
          <div className="flex flex-col px-7 pt-8 pb-7 text-center">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-lg font-bold text-gray-900 mb-1">Deposit secured</p>
            <p className="text-sm text-gray-400 mb-6">{isRental ? "Your rental is confirmed for" : "Your borrow is confirmed for"}</p>

            <p className={`text-base font-semibold text-gray-900 ${request.startDate && request.endDate ? "mb-1" : "mb-6"}`}>{item.name}</p>
            {request.startDate && request.endDate && (
              <p className="text-xs italic text-teal-500 mb-6">
                {format(parseLocalDate(request.startDate), "MMM d")} – {format(parseLocalDate(request.endDate), "MMM d")}
              </p>
            )}

            <div className="bg-gray-50 rounded-xl p-4 text-left mb-6 space-y-1.5">
              <div className="flex justify-between text-sm text-gray-500">
                <span>Platform fee (3%)</span>
                {PLATFORM_FEE_WAIVED
                  ? <span className="font-medium text-green-600">Free through 2026 <span className="line-through text-gray-400">${platformFeeDisplay.toFixed(2)}</span></span>
                  : <span className="font-medium text-gray-800">${platformFee.toFixed(2)} <span className="text-xs font-normal text-green-600">charged</span></span>
                }
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>Security deposit</span>
                <span className="font-medium text-gray-800">${depositAmount.toFixed(2)} <span className="text-xs font-normal text-blue-500">hold</span></span>
              </div>
              <p className="text-xs text-gray-400 italic pt-1 border-t border-gray-200">Deposit hold lifted automatically on safe return</p>
            </div>

            <div className="text-left mb-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-teal-500 mb-2">
                Next step
              </p>
              <p className="text-sm text-gray-700 mb-1">Coordinate pickup with the owner</p>
              {!isRental && (
                <p className="text-xs text-gray-400">
                  {Math.round(shareCoinAmount)} ShareCoins will be charged at handoff
                </p>
              )}
            </div>

            <Button
              onClick={handleMessageLender}
              className="w-full h-12 bg-teal-600 hover:bg-teal-700 text-white text-base font-medium rounded-xl mb-3"
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              Message owner
            </Button>
            <button
              onClick={handleViewRequest}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              View request
            </button>
          </div>
        ) : (
          /* ── Payment screen ── */
          <div className="flex flex-col px-7 pt-8 pb-7">
            <div className="text-center mb-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-teal-500 mb-1">
                {isRental ? "Confirm your rental" : "Confirm your borrow"}
              </p>
              <p className="text-lg font-bold text-gray-900">{item.name}</p>
            </div>

            {/* Breakdown */}
            <div className="bg-gray-50 rounded-xl p-3 mb-4 space-y-2 text-sm">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-gray-700 font-medium">Platform fee (3%)</p>
                  {PLATFORM_FEE_WAIVED
                    ? <p className="text-xs text-green-600">Free through 2026 🎉</p>
                    : <p className="text-xs text-green-600">Charged now</p>
                  }
                </div>
                {PLATFORM_FEE_WAIVED
                  ? <span className="font-semibold text-green-600">$0.00</span>
                  : <span className="font-semibold text-gray-900">${platformFeeDisplay.toFixed(2)}</span>
                }
              </div>
              <div className="border-t border-gray-200" />
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-gray-700 font-medium">Security deposit</p>
                  <p className="text-xs text-blue-500">Authorization hold only</p>
                </div>
                <span className="font-semibold text-gray-900">${depositAmount.toFixed(2)}</span>
              </div>
            </div>

            <p className="text-center text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2 mb-3">
              The deposit is an <span className="font-medium">authorization hold</span> — not charged. Lifted automatically on safe return.
            </p>

            {!isRental && (
              <p className="text-center text-xs text-gray-400 mb-4 flex items-center justify-center gap-1">
                <Coins className="h-3 w-3 flex-shrink-0 text-yellow-500" />
                {Math.round(shareCoinAmount)} ShareCoins charged at pickup
              </p>
            )}

            <Button
              onClick={() => payDepositMutation.mutate()}
              disabled={isProcessing}
              className="w-full h-12 bg-teal-600 hover:bg-teal-700 text-white text-base font-medium rounded-xl mb-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing…
                </>
              ) : PLATFORM_FEE_WAIVED ? (
                `Authorise hold — free through 2026`
              ) : (
                `Pay $${platformFee.toFixed(2)} + authorise hold`
              )}
            </Button>

            <p className="text-center text-xs text-gray-300 flex items-start justify-center gap-1 mb-2">
              <Lock className="h-3 w-3 flex-shrink-0 mt-px" />
              Deposit hold lifted on safe return — nothing extra charged
            </p>

            <Button
              variant="ghost"
              onClick={onClose}
              disabled={isProcessing}
              className="w-full text-sm text-gray-400 hover:text-gray-600"
            >
              Cancel
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
