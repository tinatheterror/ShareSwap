import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { loadStripe, Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Navbar } from "@/components/shared/navbar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Shield,
  Loader2,
} from "lucide-react";

let stripePromiseCache: Promise<Stripe | null> | null = null;

function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromiseCache) {
    stripePromiseCache = fetch("/api/stripe/publishable-key")
      .then((res) => res.json())
      .then(({ publishableKey }) => {
        console.log("[Stripe] Got publishable key:", publishableKey ? "yes" : "no");
        if (!publishableKey) return null;
        return loadStripe(publishableKey);
      })
      .catch((err) => {
        console.error("[Stripe] Error loading:", err);
        return null;
      });
  }
  return stripePromiseCache;
}

interface PaymentMethodData {
  hasPaymentMethod: boolean;
  status: "verified" | "expired" | "missing";
  paymentMethod: {
    last4: string;
    brand: string;
    expMonth: number;
    expYear: number;
    addedAt: string;
  } | null;
}

function PaymentForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async (paymentMethodId: string) => {
      const res = await apiRequest("POST", "/api/payment-method/save", {
        paymentMethodId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payment-method"] });
      toast({
        title: "Payment method saved",
        description: "Your card has been securely added to your account.",
      });
      onSuccess();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save",
        description: error.message || "Could not save your payment method.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      const { error, setupIntent } = await stripe.confirmSetup({
        elements,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: "if_required",
      });

      if (error) {
        throw new Error(error.message);
      }

      if (setupIntent?.payment_method) {
        await saveMutation.mutateAsync(setupIntent.payment_method as string);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add payment method.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />

      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isProcessing}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!stripe || isProcessing}
          className="flex-1"
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            "Save Card"
          )}
        </Button>
      </div>
    </form>
  );
}

function StatusIndicator({
  status,
}: {
  status: "verified" | "expired" | "missing";
}) {
  if (status === "verified") {
    return (
      <div className="flex items-center gap-2 text-green-700 bg-green-50 px-3 py-1.5 rounded-full text-sm font-medium">
        <CheckCircle2 className="h-4 w-4" />
        On file
      </div>
    );
  }

  if (status === "expired") {
    return (
      <div className="flex items-center gap-2 text-amber-700 bg-amber-50 px-3 py-1.5 rounded-full text-sm font-medium">
        <AlertTriangle className="h-4 w-4" />
        Needs update
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full text-sm font-medium">
      <XCircle className="h-4 w-4" />
      Required
    </div>
  );
}

function formatBrand(brand: string): string {
  const brandMap: Record<string, string> = {
    visa: "Visa",
    mastercard: "Mastercard",
    amex: "American Express",
    discover: "Discover",
    diners: "Diners Club",
    jcb: "JCB",
    unionpay: "UnionPay",
  };
  return brandMap[brand.toLowerCase()] || brand;
}

function AddCardWrapper({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const fetchSetupIntent = async () => {
      try {
        const res = await apiRequest("POST", "/api/payment-method/setup-intent");
        const data = await res.json();
        if (data.clientSecret) {
          setClientSecret(data.clientSecret);
        } else {
          throw new Error("Failed to create setup intent");
        }
      } catch (err: any) {
        setError(err.message || "Failed to initialize payment form");
        toast({
          title: "Error",
          description: err.message || "Failed to initialize payment form",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchSetupIntent();
  }, [toast]);

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Initializing secure payment form...</span>
        </div>
      </div>
    );
  }

  if (error || !clientSecret) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertDescription>
            {error || "Unable to load payment form. Please try again."}
          </AlertDescription>
        </Alert>
        <div className="mt-4">
          <Button variant="outline" onClick={onCancel} className="w-full">
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  const stripePromise = getStripePromise();

  return (
    <Elements 
      stripe={stripePromise} 
      options={{ 
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#0D9488',
          },
        },
      }}
    >
      <PaymentForm onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  );
}

export default function PaymentMethodsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddingCard, setIsAddingCard] = useState(false);
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);

  const { data, isLoading } = useQuery<PaymentMethodData>({
    queryKey: ["/api/payment-method"],
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/payment-method");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payment-method"] });
      setIsRemoveDialogOpen(false);
      toast({
        title: "Card removed",
        description: "Your payment method has been removed.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Cannot remove card",
        description: error.message || "Failed to remove payment method.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <Button
          variant="ghost"
          onClick={() => navigate("/profile")}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-gray-100 rounded-lg">
            <CreditCard className="h-6 w-6 text-gray-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Payment Methods
            </h1>
            <p className="text-gray-500">For deposits and paid activity</p>
          </div>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="p-6">
              <Skeleton className="h-6 w-48 mb-4" />
              <Skeleton className="h-4 w-64" />
            </CardContent>
          </Card>
        ) : isAddingCard ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Add Payment Method</CardTitle>
              <CardDescription>
                Add a card via our secure payment provider
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AddCardWrapper
                onSuccess={() => setIsAddingCard(false)}
                onCancel={() => setIsAddingCard(false)}
              />
            </CardContent>
          </Card>
        ) : data?.hasPaymentMethod ? (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gray-50 rounded-lg">
                    <CreditCard className="h-5 w-5 text-gray-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">
                      {formatBrand(data.paymentMethod?.brand || "")} ••••{" "}
                      {data.paymentMethod?.last4}
                    </p>
                    <p className="text-sm text-gray-500">
                      Expires {data.paymentMethod?.expMonth}/
                      {data.paymentMethod?.expYear}
                    </p>
                  </div>
                </div>
                <StatusIndicator status={data.status} />
              </div>

              <p className="text-sm text-gray-600 mb-6">
                Used for refundable security deposits and damage reimbursements
                only
              </p>

              <Separator className="my-4" />

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setIsAddingCard(true)}
                  className="flex-1"
                >
                  Update payment method
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setIsRemoveDialogOpen(true)}
                  className="text-gray-500 hover:text-red-600"
                >
                  Remove
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="p-2 bg-gray-50 rounded-lg">
                  <CreditCard className="h-5 w-5 text-gray-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-gray-700">No card on file</p>
                    <StatusIndicator status="missing" />
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    A payment method is required for borrowing and renting items
                  </p>
                </div>
              </div>

              <Alert className="mb-6 bg-white border-blue-100">
                <Shield className="h-4 w-4 text-blue-500" />
                <AlertDescription className="text-blue-600 text-xs">
                  Your card is primarily used for refundable security deposits
                  when borrowing or renting items. It may also be used for other
                  paid activity when applicable.
                </AlertDescription>
              </Alert>

              <Button onClick={() => setIsAddingCard(true)} className="w-full">
                Add payment method
              </Button>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-gray-400 text-center mt-6">
          Your card is securely handled by our payment provider. It may be used
          for refundable deposits, paid transactions, subscriptions, or
          reimbursements when applicable. You’re only charged when a payment is
          required.
        </p>

        <Dialog open={isRemoveDialogOpen} onOpenChange={setIsRemoveDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove payment method?</DialogTitle>
              <DialogDescription>
                This will remove your card from your account. You may need to
                add a new payment method to use certain features.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsRemoveDialogOpen(false)}
                disabled={removeMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => removeMutation.mutate()}
                disabled={removeMutation.isPending}
              >
                {removeMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Removing...
                  </>
                ) : (
                  "Remove card"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
