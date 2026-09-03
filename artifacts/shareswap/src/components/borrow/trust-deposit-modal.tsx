import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Lock, Loader2, MessageCircle, Coins } from "lucide-react";
import { calculateSecurityDeposit } from "@/lib/deposit-calculator";
import { format } from "date-fns";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { getStripePromise } from "@/lib/stripe-client";

const stripePromise = getStripePromise();

type DepositConsent = { consentMessage: string; depositAmount: number; consentEndpoint: string };

function RefundablePaymentAuthentication({ clientSecret, onAuthenticated, onCancel }: { clientSecret: string; onAuthenticated: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements) return;
    setIsProcessing(true);
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error || !paymentIntent || paymentIntent.status !== "succeeded") {
      toast({ title: "Authentication required", description: error?.message || "The refundable payment was not completed.", variant: "destructive" });
      setIsProcessing(false);
      return;
    }
    onAuthenticated();
  };
  return <form onSubmit={confirm} className="space-y-4" data-testid="form-refundable-payment-authentication">
    <PaymentElement />
    <div className="flex gap-2">
      <Button type="button" variant="outline" className="flex-1" onClick={onCancel} disabled={isProcessing} data-testid="button-cancel-refundable-authentication">Cancel</Button>
      <Button type="submit" className="flex-1 bg-teal-600 hover:bg-teal-700" disabled={!stripe || isProcessing} data-testid="button-authenticate-refundable-payment">
        {isProcessing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Confirming…</> : "Confirm refundable payment"}
      </Button>
    </div>
  </form>;
}

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
  const [consent, setConsent] = useState<DepositConsent | null>(null);
  const [authenticationClientSecret, setAuthenticationClientSecret] = useState<string | null>(null);

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

  const { data: feeWaiverData } = useQuery<{
    feeWaived: boolean;
    completedCount: number;
    remainingFree: number;
    totalFree: number;
  }>({ queryKey: ["/api/user/fee-waiver-status"] });

  const STRIPE_MIN_CHARGE = 0.50;
  const rawFee = Math.round(depositAmount * 0.03 * 100) / 100;
  const atMinimum = rawFee < STRIPE_MIN_CHARGE;
  const platformFeeDisplay = Math.max(STRIPE_MIN_CHARGE, rawFee); // shown for reference even when waived
  const platformFeeLabel = atMinimum ? "Platform fee (min. $0.50)" : "Platform fee (3%)";
  const PLATFORM_FEE_WAIVED = feeWaiverData?.feeWaived ?? true; // default to waived while loading
  const platformFee = PLATFORM_FEE_WAIVED ? 0 : platformFeeDisplay;
  const feeWaiverLabel = feeWaiverData
    ? `Transaction ${feeWaiverData.completedCount + 1} of ${feeWaiverData.totalFree} free`
    : "Free";

  const payDepositMutation = useMutation({
    mutationFn: async () => {
      setIsProcessing(true);
      // Establish the deposit mode first. A 409 requires visible consent before
      // any fee endpoint is called.
      const holdRes = await apiRequest("POST", "/api/stripe/create-deposit-hold", {
        requestId: request.id,
      });
      const holdData = await holdRes.json();
      if (!holdData.paymentIntentId) throw new Error(holdData.error || "Failed to create deposit hold");
      let feeData: { chargeId?: string | null; waived?: boolean } = { waived: true };
      if (platformFee > 0) {
        const feeRes = await apiRequest("POST", "/api/stripe/charge-platform-fee", { platformFeeAmount: platformFee, requestId: request.id });
        feeData = await feeRes.json();
        if (!feeData.chargeId && !feeData.waived) throw new Error("Failed to charge platform fee");
      }
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
      if (error?.status === 409 && error?.consentRequired && error?.consentEndpoint) {
        setConsent({ consentMessage: error.consentMessage, depositAmount: Number(error.depositAmount), consentEndpoint: error.consentEndpoint });
        return;
      }
      toast({
        title: "Payment failed",
        description: error.message || "Failed to process deposit",
        variant: "destructive",
      });
    },
  });

  const confirmRefundableMutation = useMutation({
    mutationFn: async () => {
      if (!consent) throw new Error("Refundable payment consent is unavailable.");
      setIsProcessing(true);
      return (await apiRequest("POST", consent.consentEndpoint, {})).json();
    },
    onSuccess: (data) => {
      setIsProcessing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      setSuccessData({ nextStep: data.nextStep || "await_handoff" });
      setSucceeded(true);
    },
    onError: (error: any) => {
      setIsProcessing(false);
      if (error?.status === 402 && error?.requiresAction && error?.clientSecret) {
        setAuthenticationClientSecret(error.clientSecret);
        return;
      }
      toast({ title: "Refundable payment failed", description: error.message || "Unable to complete the refundable payment.", variant: "destructive" });
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
            <p className="text-lg font-bold text-gray-900 mb-1" data-testid="text-deposit-success">Deposit secured</p>
            <p className="text-sm text-gray-400 mb-6">{isRental ? "Your rental is confirmed for" : "Your borrow is confirmed for"}</p>

            <p className={`text-base font-semibold text-gray-900 ${request.startDate && request.endDate ? "mb-1" : "mb-6"}`}>{item.name}</p>
            {request.startDate && request.endDate && (
              <p className="text-xs italic text-teal-500 mb-6">
                {format(parseLocalDate(request.startDate), "MMM d")} – {format(parseLocalDate(request.endDate), "MMM d")}
              </p>
            )}

            <div className="bg-gray-50 rounded-xl p-4 text-left mb-6 space-y-1.5" data-testid="breakdown-deposit-success">
              <div className="flex justify-between text-sm text-gray-500">
                <span>{platformFeeLabel}</span>
                {PLATFORM_FEE_WAIVED
                  ? <span className="font-medium text-green-600">{feeWaiverLabel} <span className="line-through text-gray-400">${platformFeeDisplay.toFixed(2)}</span></span>
                  : <span className="font-medium text-gray-800">${platformFee.toFixed(2)} <span className="text-xs font-normal text-green-600">charged</span></span>
                }
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>{isRental ? "Security deposit" : "Trust deposit"}</span>
                <span className="font-medium text-gray-800">${depositAmount.toFixed(2)} <span className="text-xs font-normal text-blue-500">{consent ? "refundable payment" : "authorization hold"}</span></span>
              </div>
              <p className="text-xs text-gray-400 italic pt-1 border-t border-gray-200">{consent ? "Refundable payment returned after a safe return" : "Authorization hold lifted automatically on safe return"}</p>
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
              data-testid="button-message-owner"
              className="w-full h-12 bg-teal-600 hover:bg-teal-700 text-white text-base font-medium rounded-xl mb-3"
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              Message owner
            </Button>
            <button
              onClick={handleViewRequest}
              data-testid="button-view-request"
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              View request
            </button>
          </div>
        ) : consent ? (
          <div className="flex flex-col px-7 pt-8 pb-7" data-testid="screen-refundable-deposit-consent">
            <div className="text-center mb-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-teal-500 mb-1">Refundable deposit required</p>
              <p className="text-lg font-bold text-gray-900">{item.name}</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 mb-4" data-testid="text-refundable-consent-message">{consent.consentMessage}</div>
            <div className="bg-gray-50 rounded-xl p-4 mb-4 flex justify-between text-sm">
              <span className="text-gray-600">Refundable deposit payment</span><span className="font-semibold">${consent.depositAmount.toFixed(2)}</span>
            </div>
            <p className="text-xs text-gray-500 text-center mb-4">This is a payment, not an authorization hold. It is refundable after the item is returned safely.</p>
            {authenticationClientSecret ? (
              <Elements stripe={stripePromise} options={{ clientSecret: authenticationClientSecret }}>
                <RefundablePaymentAuthentication clientSecret={authenticationClientSecret} onAuthenticated={() => confirmRefundableMutation.mutate()} onCancel={onClose} />
              </Elements>
            ) : <>
              <Button onClick={() => confirmRefundableMutation.mutate()} disabled={isProcessing} className="w-full h-12 bg-teal-600 hover:bg-teal-700 rounded-xl" data-testid="button-confirm-refundable-payment">
                {isProcessing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing…</> : `Confirm refundable payment of $${consent.depositAmount.toFixed(2)}`}
              </Button>
              <Button variant="ghost" onClick={onClose} disabled={isProcessing} className="mt-2" data-testid="button-cancel-refundable-payment">Cancel</Button>
            </>}
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
                  <p className="text-gray-700 font-medium">{platformFeeLabel}</p>
                  {PLATFORM_FEE_WAIVED
                    ? <p className="text-xs text-green-600">{feeWaiverLabel} 🎉</p>
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
                  <p className="text-gray-700 font-medium">{isRental ? "Security deposit" : "Trust deposit"}</p>
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
              data-testid="button-authorize-deposit"
              className="w-full h-12 bg-teal-600 hover:bg-teal-700 text-white text-base font-medium rounded-xl mb-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing…
                </>
              ) : PLATFORM_FEE_WAIVED ? (
                `Authorise hold — ${feeWaiverLabel.toLowerCase()}`
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
              data-testid="button-cancel-deposit"
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
