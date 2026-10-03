import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { paymentErrorMessage } from "@/lib/payment-error";
import { Tag, Shield, Truck, Loader2, CreditCard, Info, RefreshCw } from "lucide-react";
import { calculateRentalDeposit, calculateRentalRate, calculateRentalPrice, getDiscountLabel } from "@/lib/rental-calculator";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { getStripePromise } from "@/lib/stripe-client";
import { HOLD_COVERAGE_NOTE, NOT_CHARGED_UNLESS_CLAIM, formatMoney, holdPendingNotice, holdReleaseExplainer, temporaryHoldLabel } from "@/lib/deposit-copy";

const stripePromise = getStripePromise();
type DepositConsent = { consentMessage: string; depositAmount: number; consentEndpoint: string };

interface RentalDepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: {
    id: number;
    itemId: number;
    deliveryMethod: string;
    startDate: string | null;
    endDate: string | null;
  };
  item: {
    name: string;
    tier: number;
    category: string;
    replacementValue: number;
    dollarsPrice?: string;
    securityDeposit?: number | string;
    photos: string[];
  };
  onSuccess: (nextStep: string) => void;
}

interface FormProps {
  clientSecret: string;
  onSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
  rentalPrice: number;
  rentalSubtotal: number;
  discountPct: number;
  discountAmount: number;
  depositAmount: number;
  processingFee: number;
  deliveryFee: number;
  days: number;
}

function RefundablePaymentAuthentication({ clientSecret, onAuthenticated, onCancel }: { clientSecret: string; onAuthenticated: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements) return;
    setIsProcessing(true);
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error || paymentIntent?.status !== "succeeded") {
      toast({ title: "Authentication required", description: paymentErrorMessage(error ?? { requiresAction: true }), variant: "destructive" });
      setIsProcessing(false);
      return;
    }
    onAuthenticated();
  };
  return <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-rental-refundable-authentication">
    <PaymentElement />
    <div className="flex gap-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={isProcessing} className="flex-1" data-testid="button-cancel-rental-refundable-authentication">Cancel</Button>
      <Button type="submit" disabled={!stripe || isProcessing} className="flex-1 bg-green-600 hover:bg-green-700" data-testid="button-authenticate-rental-refundable-payment">
        {isProcessing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Confirming…</> : "Confirm refundable payment"}
      </Button>
    </div>
  </form>;
}

// Form shown when user has a saved card on file — no card input needed
function SavedCardConfirmForm(props: FormProps) {
  const stripe = useStripe();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const { clientSecret, onSuccess, onCancel, rentalPrice, depositAmount, processingFee, deliveryFee, rentalSubtotal, discountPct, discountAmount, days } = props;
  const totalChargedToday = rentalPrice + processingFee + deliveryFee;

  const handleConfirm = async () => {
    if (!stripe) return;
    setIsProcessing(true);
    try {
      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret);
      if (error) {
        toast({ title: "Payment Failed", description: paymentErrorMessage(error), variant: "destructive" });
        setIsProcessing(false);
      } else if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "requires_capture")) {
        onSuccess(paymentIntent.id);
      }
    } catch (err: any) {
      toast({ title: "Error", description: paymentErrorMessage(err), variant: "destructive" });
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <BreakdownRows rentalPrice={rentalPrice} rentalSubtotal={rentalSubtotal} discountPct={discountPct} discountAmount={discountAmount} depositAmount={depositAmount} processingFee={processingFee} deliveryFee={deliveryFee} days={days} />
      <div className="flex items-center gap-2 rounded-md bg-blue-50 border border-blue-100 px-3 py-2.5 text-xs text-blue-700">
        <Info className="h-3.5 w-3.5 shrink-0 text-blue-500" />
        <span>
          <span className="block mb-1"><span className="font-medium">{temporaryHoldLabel(depositAmount)}.</span> {holdPendingNotice(depositAmount)} {holdReleaseExplainer(depositAmount)}</span>
          <span className="block mb-1">{HOLD_COVERAGE_NOTE}</span>
          The <span className="font-medium">${totalChargedToday.toFixed(2)} rental and fee total</span> is charged today.
        </span>
      </div>
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isProcessing} className="flex-1" data-testid="button-cancel-rental-payment">Cancel</Button>
        <Button onClick={handleConfirm} disabled={isProcessing} className="flex-1 bg-green-600 hover:bg-green-700 text-white flex-col h-auto py-2" data-testid="button-confirm-rental-authorization">
          {isProcessing ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing…</>
          ) : (
            <>
              <span className="flex items-center gap-1.5 leading-none"><CreditCard className="h-4 w-4" />Pay ${totalChargedToday.toFixed(2)}</span>
              <span className="text-[10px] opacity-75 font-normal leading-none -mt-0.5">Plus a separate {formatMoney(depositAmount)} temporary hold</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// Shared breakdown rows used by both form variants
function BreakdownRows({ rentalPrice, rentalSubtotal, discountPct, discountAmount, depositAmount, processingFee, deliveryFee, days }: {
  rentalPrice: number; rentalSubtotal: number; discountPct: number; discountAmount: number;
  depositAmount: number; processingFee: number; deliveryFee: number; days: number;
}) {
  const dailyRate = days > 0 ? rentalSubtotal / days : 0;
  const discountLabel = getDiscountLabel(days);
  const totalChargedToday = rentalPrice + processingFee + deliveryFee;
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1.5 text-sm">
      {/* Rental line with daily rate */}
      <div className="flex justify-between">
        <span className="text-gray-600">
          Rental ({days} day{days !== 1 ? "s" : ""} × ${dailyRate.toFixed(2)}/day)
        </span>
        <span className="font-medium">${rentalSubtotal.toFixed(2)}</span>
      </div>

      {/* Discount */}
      {discountPct > 0 && (
        <div className="flex justify-between text-teal-700">
          <span className="flex items-center gap-1">
            <Tag className="h-3 w-3" />
            {discountLabel}
          </span>
          <span className="font-medium">−${discountAmount.toFixed(2)}</span>
        </div>
      )}

      {/* Rental total */}
      <div className="flex justify-between font-semibold border-t border-gray-200 pt-1.5 mt-0.5">
        <span>Rental total</span>
        <span className="text-teal-700">${rentalPrice.toFixed(2)}</span>
      </div>

      {/* Platform fee */}
      <div className="flex justify-between text-gray-500">
        <span>{rentalPrice * 0.03 < 0.50 ? "Platform fee (min. $0.50)" : "Platform fee (3%)"}</span>
        <span>${processingFee.toFixed(2)}</span>
      </div>

      {/* Delivery fee */}
      {deliveryFee > 0 && (
        <div className="flex justify-between border-t border-gray-200 pt-1.5 mt-0.5">
          <span className="text-gray-600 flex items-center gap-1">
            <Truck className="h-3 w-3 text-orange-500" />
            Courier delivery
          </span>
          <span className="font-medium">${deliveryFee.toFixed(2)}</span>
        </div>
      )}

      {/* Security deposit */}
      <div className="border-t border-gray-200 pt-1.5 mt-0.5">
        <div className="flex justify-between">
          <span className="text-gray-600 flex items-center gap-1">
            <Shield className="h-3 w-3" />
            Security deposit
          </span>
          <span className="font-medium">${depositAmount.toFixed(2)}</span>
        </div>
        <p className="text-[10px] text-gray-400 mt-0.5">Temporary hold only — {NOT_CHARGED_UNLESS_CLAIM}</p>
      </div>

      {/* Total */}
      <div className="flex justify-between font-semibold border-t border-gray-200 pt-1.5 mt-0.5">
        <span className="text-gray-900">Charged today</span>
        <span className="text-gray-900 text-base font-bold">${totalChargedToday.toFixed(2)}</span>
      </div>
    </div>
  );
}

// Full form shown when no saved card — user enters card details
function PayAndConfirmForm({
  clientSecret,
  onSuccess,
  onCancel,
  rentalPrice,
  rentalSubtotal,
  discountPct,
  discountAmount,
  depositAmount,
  processingFee,
  deliveryFee,
  days,
}: FormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
      });

      if (error) {
        toast({
          title: "Payment Failed",
          description: paymentErrorMessage(error),
          variant: "destructive",
        });
        setIsProcessing(false);
      } else if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "requires_capture")) {
        onSuccess(paymentIntent.id);
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: paymentErrorMessage(err),
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <BreakdownRows rentalPrice={rentalPrice} rentalSubtotal={rentalSubtotal} discountPct={discountPct} discountAmount={discountAmount} depositAmount={depositAmount} processingFee={processingFee} deliveryFee={deliveryFee} days={days} />
      <div className="flex gap-2 rounded-md bg-blue-50 border border-blue-100 px-3 py-2.5 text-xs text-blue-700">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-500" />
        <span>
          <span className="block mb-1"><span className="font-medium">{temporaryHoldLabel(depositAmount)}.</span> {holdPendingNotice(depositAmount)} {holdReleaseExplainer(depositAmount)}</span>
          <span className="block mb-1">{HOLD_COVERAGE_NOTE}</span>
          The <span className="font-medium">${(rentalPrice + processingFee + deliveryFee).toFixed(2)} rental and fee total</span> is charged today.
        </span>
      </div>
      <PaymentElement />
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isProcessing} className="flex-1" data-testid="button-cancel-rental-payment">Cancel</Button>
        <Button type="submit" disabled={!stripe || isProcessing} className="flex-1 bg-green-600 hover:bg-green-700 text-white" data-testid="button-pay-rental-and-authorize-deposit">
          {isProcessing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing…</> : <><CreditCard className="h-4 w-4 mr-2" />Pay rental & place deposit hold</>}
        </Button>
      </div>
    </form>
  );
}

export function RentalDepositModal({
  isOpen,
  onClose,
  request,
  item,
  onSuccess,
}: RentalDepositModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [hasSavedCard, setHasSavedCard] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [consent, setConsent] = useState<DepositConsent | null>(null);
  const [authenticationClientSecret, setAuthenticationClientSecret] = useState<string | null>(null);

  const itemValue = item.replacementValue || 100;
  const depositCalc = calculateRentalDeposit(itemValue, item.tier || 2);
  const rentalCalc = calculateRentalRate(itemValue, item.category || "Home & Kitchen");
  // Use lender's set deposit if available, fall back to tier-formula default
  const lenderDeposit = item.securityDeposit ? Number(item.securityDeposit) : null;

  const days = request.startDate && request.endDate
    ? Math.ceil((new Date(request.endDate).getTime() - new Date(request.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
    : 7;

  const weeklyRate = item.dollarsPrice
    ? parseFloat(item.dollarsPrice)
    : rentalCalc.weeklyRate;
  const pricing = calculateRentalPrice(weeklyRate, days);
  const rentalPrice = pricing.total;
  const rentalSubtotal = pricing.subtotal;
  const discountPct = pricing.discountPct;
  const discountAmount = pricing.discountAmount;

  const depositAmount = lenderDeposit && lenderDeposit > 0 ? lenderDeposit : depositCalc.deposit;
  const processingFee = Math.round((rentalPrice + depositAmount) * 0.03 * 100) / 100;
  const deliveryFee = 0;

  const createPaymentHoldMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/rentals/create-payment-hold", {
        requestId: request.id,
        depositAmount,
        rentalAmount: rentalPrice,
        processingFee,
        platformFee: 0,
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.clientSecret) {
        setClientSecret(data.clientSecret);
        setHasSavedCard(!!data.hasSavedCard);
        setInitError(null);
      }
    },
    onError: (error: any) => {
      if (error?.status === 409 && error?.consentRequired && error?.consentEndpoint) {
        setConsent({ consentMessage: error.consentMessage, depositAmount: Number(error.depositAmount), consentEndpoint: error.consentEndpoint });
        setInitError(null);
        return;
      }
      setInitError(paymentErrorMessage(error));
    },
  });

  const confirmRefundableMutation = useMutation({
    mutationFn: async () => {
      if (!consent) throw new Error("Refundable payment consent is unavailable.");
      return (await apiRequest("POST", consent.consentEndpoint, {})).json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({ title: "Booking confirmed!", description: "Your rental is confirmed and your refundable deposit was charged. It is refunded after a safe return unless a claim is opened." });
      onSuccess(data.nextStep || "await_handoff");
    },
    onError: (error: any) => {
      if (error?.status === 402 && error?.requiresAction && error?.clientSecret) {
        setAuthenticationClientSecret(error.clientSecret);
        return;
      }
      toast({ title: "Refundable payment failed", description: paymentErrorMessage(error), variant: "destructive" });
    },
  });

  const confirmPaymentMutation = useMutation({
    mutationFn: async (paymentIntentId: string) => {
      const response = await apiRequest("POST", `/api/requests/${request.id}/confirm-rental-deposit`, {
        paymentIntentId,
        depositAmount,
        rentalAmount: rentalPrice,
        processingFee,
        platformFee: 0,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Booking confirmed!",
        description: `Your rental payment is confirmed and a ${temporaryHoldLabel(depositAmount)} was placed. You were not charged for the deposit.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      onSuccess(data.nextStep || "await_handoff");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: paymentErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (isOpen && !clientSecret && !consent && !createPaymentHoldMutation.isPending) {
      createPaymentHoldMutation.mutate();
    }
  }, [isOpen]);

  const handleClose = () => {
    setClientSecret(null);
    setHasSavedCard(false);
    setInitError(null);
    setConsent(null);
    setAuthenticationClientSecret(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-green-600" />
            Confirm Your Rental
          </DialogTitle>
          <DialogDescription>
            Renting <span className="font-medium text-gray-900">{item.name}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {consent ? (
            <div data-testid="screen-rental-refundable-deposit-consent">
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 mb-4" data-testid="text-rental-refundable-consent-message">{consent.consentMessage}</div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3 flex justify-between text-sm">
                <span className="text-gray-600">Refundable deposit payment</span>
                <span className="font-semibold">${consent.depositAmount.toFixed(2)}</span>
              </div>
              <p className="text-xs text-gray-500 mb-4">This is a real, refundable charge — not a temporary hold. It is refunded after a safe return unless a claim is opened.</p>
              {authenticationClientSecret ? (
                <Elements stripe={stripePromise} options={{ clientSecret: authenticationClientSecret }}>
                  <RefundablePaymentAuthentication clientSecret={authenticationClientSecret} onAuthenticated={() => confirmRefundableMutation.mutate()} onCancel={handleClose} />
                </Elements>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={handleClose} disabled={confirmRefundableMutation.isPending} data-testid="button-cancel-rental-refundable-payment">Cancel</Button>
                  <Button className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => confirmRefundableMutation.mutate()} disabled={confirmRefundableMutation.isPending} data-testid="button-confirm-rental-refundable-payment">
                    {confirmRefundableMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing…</> : `Confirm refundable payment of $${consent.depositAmount.toFixed(2)}`}
                  </Button>
                </div>
              )}
            </div>
          ) : createPaymentHoldMutation.isPending || (!clientSecret && !initError) ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-green-600" />
              <span className="text-sm">Setting up payment…</span>
            </div>
          ) : initError ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-sm text-destructive text-center">{initError}</p>
              <Button variant="outline" size="sm" onClick={() => createPaymentHoldMutation.mutate()} data-testid="button-retry-rental-payment-setup">
                <RefreshCw className="h-3.5 w-3.5 mr-2" />
                Try again
              </Button>
            </div>
          ) : clientSecret ? (
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              {hasSavedCard ? (
                <SavedCardConfirmForm
                  clientSecret={clientSecret}
                  onSuccess={(paymentIntentId) => confirmPaymentMutation.mutate(paymentIntentId)}
                  onCancel={handleClose}
                  rentalPrice={rentalPrice}
                  rentalSubtotal={rentalSubtotal}
                  discountPct={discountPct}
                  discountAmount={discountAmount}
                  depositAmount={depositAmount}
                  processingFee={processingFee}
                  deliveryFee={deliveryFee}
                  days={days}
                />
              ) : (
                <PayAndConfirmForm
                  clientSecret={clientSecret}
                  onSuccess={(paymentIntentId) => confirmPaymentMutation.mutate(paymentIntentId)}
                  onCancel={handleClose}
                  rentalPrice={rentalPrice}
                  rentalSubtotal={rentalSubtotal}
                  discountPct={discountPct}
                  discountAmount={discountAmount}
                  depositAmount={depositAmount}
                  processingFee={processingFee}
                  deliveryFee={deliveryFee}
                  days={days}
                />
              )}
            </Elements>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
