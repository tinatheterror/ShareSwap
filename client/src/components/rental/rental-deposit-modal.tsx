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
import { DollarSign, Shield, Truck, Loader2, CheckCircle2, CreditCard, Info } from "lucide-react";
import { calculateRentalDeposit, calculateRentalRate } from "@/lib/rental-calculator";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);

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
    estimatedValue: string;
    dollarsPrice?: string;
    photos: string[];
  };
  courierFee?: number;
  onSuccess: (nextStep: string) => void;
}

function RentalPaymentForm({
  clientSecret,
  onSuccess,
  onCancel,
  isProcessing,
  setIsProcessing,
}: {
  clientSecret: string;
  onSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();

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
          description: error.message,
          variant: "destructive",
        });
        setIsProcessing(false);
      } else if (paymentIntent && paymentIntent.status === "requires_capture") {
        onSuccess(paymentIntent.id);
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Payment processing failed",
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      <div className="flex gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isProcessing} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" disabled={!stripe || isProcessing} className="flex-1 bg-primary hover:bg-primary/90">
          {isProcessing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            "Authorize Payment"
          )}
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
  courierFee = 0,
  onSuccess,
}: RentalDepositModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [step, setStep] = useState<"summary" | "payment">("summary");

  const itemValue = parseFloat(item.estimatedValue || "100");
  const depositCalc = calculateRentalDeposit(itemValue, item.tier || 2);
  const rentalCalc = calculateRentalRate(itemValue, item.category || "Home & Kitchen");

  const days = request.startDate && request.endDate
    ? Math.ceil((new Date(request.endDate).getTime() - new Date(request.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
    : 7;

  const rentalPrice = item.dollarsPrice 
    ? parseFloat(item.dollarsPrice) 
    : rentalCalc.dailyRate * days;

  const platformFee = 0;
  const processingFee = Math.round((rentalPrice + depositCalc.deposit) * 0.03 * 100) / 100;
  const deliveryFee = request.deliveryMethod === "courier" ? courierFee : 0;
  const totalDueNow = depositCalc.deposit + processingFee + deliveryFee;

  const createPaymentHoldMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/rentals/create-payment-hold", {
        requestId: request.id,
        depositAmount: depositCalc.deposit,
        rentalAmount: rentalPrice,
        processingFee: processingFee,
        platformFee: platformFee,
        courierFee: deliveryFee,
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.clientSecret) {
        setClientSecret(data.clientSecret);
        setStep("payment");
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create payment",
        variant: "destructive",
      });
    },
  });

  const confirmPaymentMutation = useMutation({
    mutationFn: async (paymentIntentId: string) => {
      const response = await apiRequest("POST", `/api/requests/${request.id}/confirm-rental-deposit`, {
        paymentIntentId,
        depositAmount: depositCalc.deposit,
        rentalAmount: rentalPrice,
        processingFee: processingFee,
        platformFee: platformFee,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setIsProcessing(false);
      toast({
        title: "Payment authorized!",
        description: "Your rental deposit has been secured.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      onSuccess(data.nextStep || (request.deliveryMethod === "courier" ? "book_courier" : "await_handoff"));
    },
    onError: (error: any) => {
      setIsProcessing(false);
      toast({
        title: "Error",
        description: error.message || "Failed to confirm payment",
        variant: "destructive",
      });
    },
  });

  const handleProceedToPayment = () => {
    createPaymentHoldMutation.mutate();
  };

  const handlePaymentSuccess = (paymentIntentId: string) => {
    confirmPaymentMutation.mutate(paymentIntentId);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-green-600" />
            Confirm Your Rental
          </DialogTitle>
          <DialogDescription>
            Complete payment to rent{" "}
            <span className="font-medium text-gray-900">{item.name}</span>
          </DialogDescription>
        </DialogHeader>

        {step === "summary" ? (
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

            <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3">
              <div className="text-green-800 font-medium flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Rental Payment Summary
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Rental period</span>
                  <span className="font-medium">{days} day{days > 1 ? "s" : ""}</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-600 flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-green-600" />
                    Rental fee
                  </span>
                  <span className="font-medium">${rentalPrice.toFixed(2)}</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-600 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-blue-600" />
                    Security deposit (refundable)
                  </span>
                  <span className="font-medium">${depositCalc.deposit.toFixed(2)}</span>
                </div>

                <div className="text-xs text-gray-500 ml-6">
                  Tier {depositCalc.tier}: {depositCalc.depositPercentage}% of item value
                </div>

                {deliveryFee > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 flex items-center gap-2">
                      <Truck className="h-4 w-4 text-orange-600" />
                      Courier delivery
                    </span>
                    <span className="font-medium">${deliveryFee.toFixed(2)}</span>
                  </div>
                )}

                {platformFee > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Platform fee</span>
                    <span className="font-medium">${platformFee.toFixed(2)}</span>
                  </div>
                )}

                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Processing fee (3%)</span>
                  <span className="font-medium">${processingFee.toFixed(2)}</span>
                </div>

                <div className="border-t border-green-200 pt-2 mt-2">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700 font-medium">Authorized now</span>
                    <span className="text-green-700 font-semibold text-lg">
                      ${totalDueNow.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Rental fee of ${rentalPrice.toFixed(2)} charged on successful handoff
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-2">
              <Info className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-blue-700">
                <p className="font-medium mb-1">How it works:</p>
                <ul className="space-y-0.5 list-disc ml-3">
                  <li>Security deposit is held (not charged) until item return</li>
                  <li>Rental fee is charged when you receive the item</li>
                  <li>Deposit released when item returned in good condition</li>
                </ul>
              </div>
            </div>

            <Button
              onClick={handleProceedToPayment}
              disabled={createPaymentHoldMutation.isPending}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {createPaymentHoldMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Setting up payment...
                </>
              ) : (
                <>
                  <CreditCard className="h-4 w-4 mr-2" />
                  Proceed to Payment
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="py-4">
            {clientSecret ? (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <RentalPaymentForm
                  clientSecret={clientSecret}
                  onSuccess={handlePaymentSuccess}
                  onCancel={() => {
                    setStep("summary");
                    setClientSecret(null);
                  }}
                  isProcessing={isProcessing}
                  setIsProcessing={setIsProcessing}
                />
              </Elements>
            ) : (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-green-600" />
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
