import { useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Lock, Loader2, MessageCircle, FileText, Coins } from "lucide-react";
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
  courierFee?: number;
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
  courierFee = 0,
  onSuccess,
}: TrustDepositModalProps) {
  const isRental = requestType === "RENT";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [isProcessing, setIsProcessing] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [successData, setSuccessData] = useState<{ nextStep: string } | null>(null);

  const depositCalc = calculateSecurityDeposit(
    item.tier || 2,
    item.originalValue || "$50–$150",
    trustScore,
  );

  // Duration-based cost: ceil( (weeklyPrice / 7) × days )
  // e.g. 10 SC/week × 4 days → ceil(10/7 × 4) = ceil(5.71) = 6 SC
  const _rawSCPrice = parseFloat(item.shareCoinPrice || "0") || 5;
  const shareCoinAmount = (() => {
    if (!request.startDate || !request.endDate) return _rawSCPrice;
    const start = parseLocalDate(request.startDate);
    const end = parseLocalDate(request.endDate);
    const borrowDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1);
    return Math.max(1, Math.ceil((_rawSCPrice / 7) * borrowDays));
  })();
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
    navigate(`/chat/${ownerId}`);
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

            <div className="bg-gray-50 rounded-xl p-4 text-left mb-6 space-y-1">
              <p className="text-sm text-gray-700">
                <span className="font-medium">${totalDue.toFixed(2)}</span> deposit charged to your card
              </p>
              <p className="text-sm text-gray-400">•••• 4242</p>
              <p className="text-xs text-gray-400 whitespace-nowrap italic">Held securely and refunded after safe return</p>
            </div>

            <div className="text-left mb-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-teal-500 mb-2">
                Next step
              </p>
              <p className="text-sm text-gray-700 mb-1">Coordinate pickup with the owner</p>
              {!isRental && (
                <p className="text-xs text-gray-400">
                  {shareCoinAmount} ShareCoins will be charged at handoff
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
            <div className="text-center mb-8">
              <p className="text-xs font-semibold uppercase tracking-widest text-teal-500 mb-1">
                {isRental ? "Confirm your rental" : "Confirm your borrow"}
              </p>
              <p className="text-lg font-bold text-gray-900">{item.name}</p>
            </div>

            <div className="text-center mb-8">
              <p className="text-6xl font-bold tracking-tight text-gray-900 mb-2">
                ${totalDue.toFixed(2)}
              </p>
              <p className="text-sm text-gray-500">Fully refundable deposit</p>
            </div>

            {!isRental && (
              <p className="text-center text-xs text-gray-400 mb-6 flex items-center justify-center gap-1">
                <Coins className="h-3 w-3 flex-shrink-0 text-yellow-500" />
                {shareCoinAmount} ShareCoins charged at pickup
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
                  Processing
                </>
              ) : (
                `Pay $${totalDue.toFixed(2)} deposit`
              )}
            </Button>

            <p className="text-center text-xs text-gray-300 flex items-start justify-center gap-1 mb-2">
              <Lock className="h-3 w-3 flex-shrink-0 mt-px" />
              Deposit is securely held and refunded after return
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
