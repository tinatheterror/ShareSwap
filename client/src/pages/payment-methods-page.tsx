import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  ExternalLink,
  Info,
} from "lucide-react";

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

export default function PaymentMethodsPage() {
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);
  const [removeBlockReason, setRemoveBlockReason] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<PaymentMethodData>({
    queryKey: ["/api/payment-method"],
  });

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const setupSuccess = urlParams.get("setup_success");
    const sessionId = urlParams.get("session_id");
    
    if (setupSuccess === "true" && sessionId) {
      apiRequest("POST", "/api/payment-method/complete-setup", { sessionId })
        .then((res) => res.json())
        .then((result) => {
          if (result.success) {
            toast({
              title: "Payment method added",
              description: "Your card has been securely saved to your account.",
            });
            queryClient.invalidateQueries({ queryKey: ["/api/payment-method"] });
            queryClient.invalidateQueries({ queryKey: ["/api/user"] });
            queryClient.invalidateQueries({ queryKey: ["/api/user-profile"] });
          }
        })
        .catch((err) => {
          console.error("Error completing setup:", err);
        })
        .finally(() => {
          window.history.replaceState({}, "", "/payment-methods");
        });
    } else if (setupSuccess === "false") {
      toast({
        title: "Setup cancelled",
        description: "Payment method setup was cancelled.",
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/payment-methods");
    }
  }, [toast, queryClient]);

  const addCardMutation = useMutation({
    mutationFn: async () => {
      console.log("[PaymentMethods] Starting checkout session request...");
      const res = await apiRequest("POST", "/api/payment-method/create-checkout-session");
      const data = await res.json();
      console.log("[PaymentMethods] Checkout session response:", data);
      return data;
    },
    onSuccess: (data) => {
      console.log("[PaymentMethods] Success, redirecting to:", data.url);
      if (data.url) {
        setIsRedirecting(true);
        window.location.href = data.url;
      } else {
        toast({
          title: "Error",
          description: "No redirect URL received from payment provider.",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      console.error("[PaymentMethods] Error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to start payment setup. Please make sure you're logged in.",
        variant: "destructive",
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/payment-method");
      const body = await res.json();
      if (!res.ok) throw Object.assign(new Error(body.error || "Failed to remove payment method"), { code: body.code });
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payment-method"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-profile"] });
      setIsRemoveDialogOpen(false);
      setRemoveBlockReason(null);
      toast({
        title: "Card removed",
        description: "Your payment method has been removed.",
      });
    },
    onError: (error: any) => {
      setRemoveBlockReason(error.message);
    },
  });

  const handleAddCard = () => {
    console.log("[PaymentMethods] handleAddCard clicked - triggering mutation");
    addCardMutation.mutate();
  };

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
            <p className="text-gray-500">For deposits and rentals</p>
          </div>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="p-6">
              <Skeleton className="h-6 w-48 mb-4" />
              <Skeleton className="h-4 w-64" />
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
                Used for rental payments, security deposits, and damage
                reimbursements
              </p>

              <Separator className="my-4" />

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={handleAddCard}
                  disabled={addCardMutation.isPending || isRedirecting}
                  className="flex-1"
                >
                  {addCardMutation.isPending || isRedirecting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Redirecting...
                    </>
                  ) : (
                    <>
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Update payment method
                    </>
                  )}
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
                  Your card is used for rental payments, security deposits when
                  borrowing items, and any damage reimbursements if applicable.
                </AlertDescription>
              </Alert>

              <Button 
                onClick={handleAddCard} 
                disabled={addCardMutation.isPending || isRedirecting}
                className="w-full"
              >
                {addCardMutation.isPending || isRedirecting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Redirecting to secure payment page...
                  </>
                ) : (
                  <>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Add payment method
                  </>
                )}
              </Button>

              <p className="text-xs text-gray-400 text-center mt-3">
                You'll be redirected to a secure page to enter your card details
              </p>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-gray-400 text-center mt-6">
          Your card is securely handled by our payment provider. It may be used
          for refundable deposits, paid transactions, subscriptions, or
          reimbursements when applicable. You're only charged when a payment is
          required.
        </p>

        <Dialog
          open={isRemoveDialogOpen}
          onOpenChange={(open) => {
            setIsRemoveDialogOpen(open);
            if (!open) setRemoveBlockReason(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove payment method?</DialogTitle>
            </DialogHeader>

            <Alert className="bg-amber-50 border-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800 text-sm">
                Removing your payment method will disable borrowing and renting until another card is added.
              </AlertDescription>
            </Alert>

            {removeBlockReason ? (
              <Alert className="bg-red-50 border-red-200">
                <XCircle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800 text-sm">
                  {removeBlockReason}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  Your card can only be removed if you have no active borrows or rentals, pending returns, damage claims, or unpaid balances.
                </p>
                <Alert className="bg-blue-50 border-blue-200">
                  <Info className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-blue-800 text-sm">
                    To switch to a different card, use <strong>Update payment method</strong> above — your old card will be replaced automatically without leaving your account unprotected.
                  </AlertDescription>
                </Alert>
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsRemoveDialogOpen(false);
                  setRemoveBlockReason(null);
                }}
                disabled={removeMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => removeMutation.mutate()}
                disabled={removeMutation.isPending || !!removeBlockReason}
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
