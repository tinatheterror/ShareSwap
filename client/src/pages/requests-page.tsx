import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { Clock, MapPin, User, CheckCircle, XCircle, Package, Shield, Truck, RotateCcw, HandMetal, ArrowRightLeft, CreditCard, RefreshCw, Gift } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { useState } from "react";
import { CelebrationAnimation } from "@/components/celebration-animation";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatDisplayName } from "@/lib/utils";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { TrustDepositModal } from "@/components/borrow/trust-deposit-modal";
import { CourierBookingModal } from "@/components/borrow/courier-booking-modal";
import { HandoffConfirmationModal } from "@/components/borrow/handoff-confirmation-modal";
import { ReturnConfirmationModal } from "@/components/borrow/return-confirmation-modal";
import { InsufficientShareCoinsModal } from "@/components/borrow/insufficient-sharecoins-modal";
import { useVerification } from "@/hooks/use-verification";
import { getStripePromise } from "@/lib/stripe-client";

const stripePromise = getStripePromise();

interface ItemRequest {
  id: number;
  itemId: number;
  requesterId: number;
  requestType: string;
  status: string;
  message: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  deliveryMethod: string;
  depositMethod: string;
  trustDepositAmount: string | null;
  trustDepositBaseAmount: string | null;
  trustDiscountPercentage: number | null;
  shareCoinAmount: string | null;
  depositStatus: string | null;
  courierAddress: string | null;
  courierPickupWindow: string | null;
  negotiationStatus: string | null;
  counterDeliveryMethod: string | null;
  counterDepositMethod: string | null;
  counterStartDate: string | null;
  counterEndDate: string | null;
  counterProposedBy: number | null;
  counterProposedAt: string | null;
  ownerConfirmedHandoff: boolean | null;
  borrowerConfirmedHandoff: boolean | null;
  handoffConfirmDeadline: string | null;
  ownerConfirmedReturn: boolean | null;
  borrowerConfirmedReturn: boolean | null;
  returnConditionOk: boolean | null;
  returnDisputeTriggered: boolean | null;
  item: {
    id: number;
    name: string;
    description: string;
    photos: string[];
    replacementValue: number;
    ownerId: number;
    tier: number;
    originalValue: string;
    shareCoinPrice: string;
  };
  requester: {
    id: number;
    username: string;
  };
}

function DepositPaymentForm({ 
  clientSecret, 
  onSuccess, 
  onCancel 
}: { 
  clientSecret: string; 
  onSuccess: (paymentIntentId: string) => void; 
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

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
        // Successfully authorized (payment hold created)
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
          className="flex-1 bg-primary hover:bg-primary/90"
        >
          {isProcessing ? "Processing..." : "Authorize Deposit"}
        </Button>
      </div>
    </form>
  );
}

export default function RequestsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { requireVerification, VerificationModal } = useVerification();
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [depositClientSecret, setDepositClientSecret] = useState<string | null>(null);
  const [pendingDeliveryData, setPendingDeliveryData] = useState<any>(null);
  
  const [showTrustDepositModal, setShowTrustDepositModal] = useState(false);
  const [showCourierModal, setShowCourierModal] = useState(false);
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ItemRequest | null>(null);
  
  // Counter-proposal state
  const [showCounterProposalModal, setShowCounterProposalModal] = useState(false);
  const [counterProposalRequest, setCounterProposalRequest] = useState<ItemRequest | null>(null);
  const [counterProposalRole, setCounterProposalRole] = useState<"owner" | "requester">("owner");
  const [proposedDeliveryMethod, setProposedDeliveryMethod] = useState<string>("in_person");
  const [proposedDepositMethod, setProposedDepositMethod] = useState<string>("in_app");
  const [proposedStartDate, setProposedStartDate] = useState<string>("");
  const [proposedEndDate, setProposedEndDate] = useState<string>("");

  // Extension request state
  const [showExtendDialog, setShowExtendDialog] = useState(false);
  const [extendRequest, setExtendRequest] = useState<ItemRequest | null>(null);
  const [extendDays, setExtendDays] = useState<1 | 2 | 3 | null>(null);

  // Renewal state
  const [showRenewDialog, setShowRenewDialog] = useState(false);
  const [renewRequest, setRenewRequest] = useState<ItemRequest | null>(null);
  const [showInsufficientCoins, setShowInsufficientCoins] = useState(false);

  const { data: requests = [], isLoading } = useQuery<ItemRequest[]>({
    queryKey: ["/api/requests"],
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
  });

  const { data: activeExtensions = [] } = useQuery<any[]>({
    queryKey: ["/api/extensions/active"],
    refetchInterval: 10000,
  });
  const pendingExtByRequestId = Object.fromEntries(activeExtensions.filter(e => e.status === "pending").map((e) => [e.requestId, e]));
  const acceptedExtByRequestId = Object.fromEntries(activeExtensions.filter(e => e.status === "accepted").map((e) => [e.requestId, e]));

  const requestExtensionMutation = useMutation({
    mutationFn: async ({ requestId, days }: { requestId: number; days: number }) => {
      const res = await apiRequest("POST", `/api/requests/${requestId}/extension`, { days });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/extensions/active"] });
      toast({ title: "Extension requested", description: "The owner has been notified." });
      setShowExtendDialog(false);
      setExtendDays(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message || "Could not send extension request.", variant: "destructive" });
    },
  });

  const respondExtensionMutation = useMutation({
    mutationFn: async ({ requestId, action }: { requestId: number; action: "accept" | "decline" }) => {
      const res = await apiRequest("POST", `/api/requests/${requestId}/extension/respond`, { action });
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/extensions/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({ title: vars.action === "accept" ? "Extension accepted" : "Extension declined" });
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message || "Could not respond.", variant: "destructive" });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async (requestId: number) => {
      const response = await apiRequest("PATCH", `/api/requests/${requestId}`, { status: "ACCEPTED" });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      if (acceptingGiftRequest) {
        toast({
          title: "Gift Accepted!",
          description: "Chat opened to arrange pickup or delivery.",
        });
        navigate(`/chat/${acceptingGiftRequest.requesterId}`);
        setAcceptingGiftRequest(null);
      } else {
        setShowCelebration(true);
      }
    },
    onError: (error: any) => {
      setAcceptingGiftRequest(null);
      toast({
        title: "Error",
        description: error.message || "Failed to accept request",
        variant: "destructive",
      });
    },
  });

  const declineMutation = useMutation({
    mutationFn: async (requestId: number) => {
      const response = await apiRequest("PATCH", `/api/requests/${requestId}`, { status: "DECLINED" });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({
        title: "Request Declined",
        description: "You've declined this request",
      });
    },
  });

  // Counter-proposal mutation (owner OR requester)
  const counterProposalMutation = useMutation({
    mutationFn: async ({ requestId, deliveryMethod, depositMethod, startDate, endDate, isResponse }: {
      requestId: number; deliveryMethod: string; depositMethod: string;
      startDate?: string; endDate?: string; isResponse?: boolean;
    }) => {
      const endpoint = isResponse
        ? `/api/requests/${requestId}/respond-to-counter`
        : `/api/requests/${requestId}/counter-proposal`;
      const body = isResponse
        ? { counter: { deliveryMethod, depositMethod, startDate, endDate } }
        : { deliveryMethod, depositMethod, startDate, endDate };
      const response = await apiRequest("POST", endpoint, body);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      setShowCounterProposalModal(false);
      setCounterProposalRequest(null);
      toast({
        title: "Counter Sent",
        description: "The other party will be notified of your proposed changes.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to propose changes",
        variant: "destructive",
      });
    },
  });

  // Respond to counter-proposal mutation (for requesters)
  const respondToCounterMutation = useMutation({
    mutationFn: async ({ requestId, accept }: { requestId: number; accept: boolean }) => {
      const response = await apiRequest("POST", `/api/requests/${requestId}/respond-to-counter`, { accept });
      return response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      toast({
        title: variables.accept ? "Terms Accepted" : "Request Cancelled",
        description: data.message,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to respond",
        variant: "destructive",
      });
    },
  });

  // Gift handoff confirmation mutations
  const confirmGiftReceivedMutation = useMutation({
    mutationFn: async (requestId: number) => {
      const response = await apiRequest("POST", `/api/requests/${requestId}/confirm-gift-handoff`, { role: "receiver" });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      if (data.completed) {
        setShowCelebration(true);
        toast({
          title: "Gift Complete!",
          description: "Thank you for being part of the sharing community! +1 ShareCoins",
        });
      } else {
        toast({
          title: "Receipt Confirmed",
          description: "Waiting for the giver to confirm.",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to confirm receipt",
        variant: "destructive",
      });
    },
  });

  const confirmGiftGivenMutation = useMutation({
    mutationFn: async (requestId: number) => {
      const response = await apiRequest("POST", `/api/requests/${requestId}/confirm-gift-handoff`, { role: "giver" });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      if (data.completed) {
        setShowCelebration(true);
        toast({
          title: "Gift Complete!",
          description: "Thank you for your generosity! +1 ShareCoins",
        });
      } else {
        toast({
          title: "Handoff Confirmed",
          description: "Waiting for the receiver to confirm.",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to confirm handoff",
        variant: "destructive",
      });
    },
  });

  const [acceptingGiftRequest, setAcceptingGiftRequest] = useState<ItemRequest | null>(null);

  const handleAcceptClick = (request: ItemRequest) => {
    requireVerification(async () => {
      if (request.requestType === "GIFT") {
        setAcceptingGiftRequest(request);
        acceptMutation.mutate(request.id);
      } else {
        // If a counter-proposal was accepted, use the owner's counter-proposed terms
        // otherwise fall back to the requester's original choices
        const effectiveDelivery = request.negotiationStatus === "terms_accepted" && request.counterDeliveryMethod
          ? request.counterDeliveryMethod
          : request.deliveryMethod;
        const effectiveDeposit = request.negotiationStatus === "terms_accepted" && request.counterDepositMethod
          ? request.counterDepositMethod
          : request.depositMethod;

        // Map to arrangement values
        const deliveryMethod = effectiveDelivery === "courier"
          ? "shareswap_delivery"
          : "self_arrange";
        const depositMethod = effectiveDeposit === "in_app"
          ? "shareswap_deposit"
          : "self_arrange";

        const itemValue = request.item.replacementValue || 50;

        await finalizeAcceptance(request.id, {
          deliveryMethod,
          depositMethod,
          depositAmount: depositMethod === "shareswap_deposit" ? itemValue : undefined,
          depositProcessingFee: depositMethod === "shareswap_deposit" ? itemValue * 0.05 : undefined,
        }, null);
      }
    });
  };

  const handleDepositPaymentSuccess = async (paymentIntentId: string) => {
    if (!pendingDeliveryData || !selectedRequestId) return;

    await finalizeAcceptance(
      selectedRequestId,
      pendingDeliveryData,
      paymentIntentId
    );

    setDepositClientSecret(null);
    setPendingDeliveryData(null);
  };

  const finalizeAcceptance = async (
    requestId: number,
    selections: any,
    stripePaymentIntentId: string | null
  ) => {
    try {
      // Create delivery arrangement
      await apiRequest("POST", "/api/delivery-arrangements", {
        requestId,
        deliveryMethod: selections.deliveryMethod,
        depositMethod: selections.depositMethod,
        uberQuoteFee: selections.uberQuoteFee,
        uberQuoteId: selections.uberQuoteId,
        pickupAddress: selections.pickupAddress,
        dropoffAddress: selections.dropoffAddress,
        depositAmount: selections.depositAmount,
        depositProcessingFee: selections.depositProcessingFee,
        stripePaymentIntentId,
      });

      // Accept the request
      acceptMutation.mutate(requestId);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to finalize acceptance",
        variant: "destructive",
      });
    }
  };

  const handleRequestChange = (request: ItemRequest, role: "owner" | "requester" = "owner") => {
    setCounterProposalRequest(request);
    setCounterProposalRole(role);
    // Pre-fill with current counter terms (if responding to a counter) or requester's original terms
    const src = role === "requester" && request.counterDeliveryMethod ? request : request;
    setProposedDeliveryMethod(src.counterDeliveryMethod || src.deliveryMethod || "in_person");
    setProposedDepositMethod(src.counterDepositMethod || src.depositMethod || "in_app");
    const sd = src.counterStartDate || src.startDate;
    const ed = src.counterEndDate || src.endDate;
    setProposedStartDate(sd ? sd.split("T")[0] : "");
    setProposedEndDate(ed ? ed.split("T")[0] : "");
    setShowCounterProposalModal(true);
  };

  const handleSubmitCounterProposal = () => {
    if (counterProposalRequest) {
      counterProposalMutation.mutate({
        requestId: counterProposalRequest.id,
        deliveryMethod: proposedDeliveryMethod,
        depositMethod: proposedDepositMethod,
        startDate: proposedStartDate || undefined,
        endDate: proposedEndDate || undefined,
        isResponse: counterProposalRole === "requester",
      });
    }
  };

  const incomingRequests = requests.filter(
    (r) => r.item.ownerId === user?.id && r.status === "PENDING"
  );

  const myRequests = requests.filter(
    (r) => r.requesterId === user?.id
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F3F4F6]">
        <Navbar />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">Loading requests...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <VerificationModal />
      
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6 text-teal-800">Item Requests</h1>

        {/* Incoming Requests */}
        <div className="mb-12">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <Package className="h-6 w-6 text-primary" />
            Incoming Requests ({incomingRequests.length})
          </h2>

          {incomingRequests.length === 0 ? (
            <Card className="bg-teal-50 border-teal-200">
              <CardContent className="p-8 text-center text-muted-foreground">
                No pending requests for your items
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {incomingRequests.map((request) => (
                <Card key={request.id} className="bg-teal-50 border-2 border-teal-200 transition-all">
                  <CardContent className="p-6">
                    <div className="flex gap-4">
                      <div className="w-24 h-24 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                        {request.item.photos?.[0] ? (
                          <img
                            src={request.item.photos[0]}
                            alt={request.item.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Package className="h-8 w-8 text-gray-400" />
                          </div>
                        )}
                      </div>

                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h3 className="font-semibold text-lg">{request.item.name}</h3>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                              <User className="h-4 w-4" />
                              {request.requestType === "GIFT" ? (
                                <span className="text-pink-600 font-medium">
                                  {(request.requester as any).displayName || (request.requester as any).handle || formatDisplayName(request.requester.username)} would love your {request.item.name}
                                </span>
                              ) : (
                                <span>{(request.requester as any).displayName || (request.requester as any).handle || formatDisplayName(request.requester.username)} wants to {request.requestType.toLowerCase()}</span>
                              )}
                            </div>
                          </div>
                          <Badge variant="outline" className={request.requestType === "GIFT" ? "border-pink-400 text-pink-600 bg-pink-50" : ""}>
                            {request.requestType}
                          </Badge>
                        </div>

                        {request.message && (
                          <p className="text-sm text-muted-foreground mb-2 italic">
                            "{request.message}"
                          </p>
                        )}

                        {request.startDate && request.endDate && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                            <Clock className="h-4 w-4" />
                            <span>
                              {format(new Date(request.startDate), "MMM d")} - {format(new Date(request.endDate), "MMM d, yyyy")}
                            </span>
                          </div>
                        )}

                        {/* Show proposed terms - deposit method only for BORROW, delivery for both */}
                        {(request.requestType === "BORROW" || request.requestType === "RENT") && (
                          <div className="flex flex-wrap gap-2 mb-3">
                            {request.requestType === "BORROW" && (
                              <Badge variant="secondary" className="text-xs">
                                <CreditCard className="h-3 w-3 mr-1" />
                                Deposit: {request.depositMethod === "in_app" ? "Handle Deposit In-app" : "Exchange Deposit In Person"}
                              </Badge>
                            )}
                            <Badge variant="secondary" className="text-xs">
                              <Truck className="h-3 w-3 mr-1" />
                              Delivery: {request.deliveryMethod === "courier" ? "Uber" : "Pick up"}
                            </Badge>
                          </div>
                        )}

                        {/* Show waiting status if counter-proposal is pending */}
                        {request.negotiationStatus === "counter_proposed" && (
                          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                            <p className="text-sm font-medium text-amber-800">
                              <Clock className="h-4 w-4 inline mr-1" />
                              Waiting for requester to respond to your proposed terms
                            </p>
                            <div className="flex gap-2 mt-2">
                              {request.requestType === "BORROW" && (
                                <Badge variant="outline" className="text-xs">
                                  Proposed: {request.counterDepositMethod === "in_app" ? "Handle Deposit In-app" : "Exchange Deposit In Person"}
                                </Badge>
                              )}
                              <Badge variant="outline" className="text-xs">
                                {request.counterDeliveryMethod === "courier" ? "Uber" : "Pick up"} delivery
                              </Badge>
                            </div>
                          </div>
                        )}

                        {/* Show terms accepted notification */}
                        {request.negotiationStatus === "terms_accepted" && (
                          <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                            <p className="text-sm font-medium text-green-800">
                              <CheckCircle className="h-4 w-4 inline mr-1" />
                              Requester accepted your proposed terms. You can now accept the request.
                            </p>
                          </div>
                        )}

                        <div className="flex gap-2 mt-4">
                          {request.requestType === "GIFT" ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleAcceptClick(request)}
                                className="bg-pink-500 hover:bg-pink-600"
                              >
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Accept Gift
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => declineMutation.mutate(request.id)}
                                disabled={declineMutation.isPending}
                              >
                                <XCircle className="h-4 w-4 mr-1" />
                                Decline
                              </Button>
                            </>
                          ) : (
                            <>
                              {/* Only show Accept if no counter-proposal is pending */}
                              {request.negotiationStatus !== "counter_proposed" && (
                                <Button
                                  size="sm"
                                  onClick={() => handleAcceptClick(request)}
                                  className="bg-green-600 hover:bg-green-700"
                                >
                                  <CheckCircle className="h-4 w-4 mr-1" />
                                  Accept
                                </Button>
                              )}
                              {/* Only show Counter if no counter-proposal is pending */}
                              {request.negotiationStatus !== "counter_proposed" && request.negotiationStatus !== "terms_accepted" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleRequestChange(request, "owner")}
                                  className="border-amber-500 text-amber-600 hover:bg-amber-50"
                                >
                                  <RefreshCw className="h-4 w-4 mr-1" />
                                  Counter
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => declineMutation.mutate(request.id)}
                                disabled={declineMutation.isPending}
                              >
                                <XCircle className="h-4 w-4 mr-1" />
                                Decline
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* My Requests */}
        <div>
          <h2 className="text-2xl font-semibold mb-4">My Requests ({myRequests.length})</h2>

          {myRequests.length === 0 ? (
            <Card className="bg-teal-50 border-teal-200">
              <CardContent className="p-8 text-center text-muted-foreground">
                You haven't made any requests yet
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {myRequests.map((request) => (
                <Card key={request.id} className="bg-teal-50 border-2 border-teal-200 transition-all">
                  <CardContent className="p-6">
                    <div className="flex gap-4">
                      <div className="w-24 h-24 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                        {request.item.photos?.[0] ? (
                          <img
                            src={request.item.photos[0]}
                            alt={request.item.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Package className="h-8 w-8 text-gray-400" />
                          </div>
                        )}
                      </div>

                      <div className="flex-1">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold text-lg">{request.item.name}</h3>
                            <Badge 
                              variant={request.status === "ACCEPTED" ? "default" : request.status === "DECLINED" || request.status === "CANCELLED" ? "destructive" : "secondary"}
                              className="mt-2"
                            >
                              {request.negotiationStatus === "counter_proposed" ? "NEW TERMS PROPOSED" : request.status}
                            </Badge>
                          </div>
                          <Badge variant="outline">
                            {request.requestType}
                          </Badge>
                        </div>

                        {/* Counter-proposal notification for requester */}
                        {request.negotiationStatus === "counter_proposed" && request.counterProposedBy !== user?.id && (
                          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                            <p className="text-sm font-medium text-amber-800 mb-2">
                              <RefreshCw className="h-4 w-4 inline mr-1" />
                              Owner proposed new terms
                            </p>
                            <div className="flex flex-wrap gap-2 mb-3">
                              {request.requestType === "BORROW" && (
                                <Badge variant="secondary" className="text-xs">
                                  <CreditCard className="h-3 w-3 mr-1" />
                                  Deposit: {request.counterDepositMethod === "in_app" ? "Handle Deposit In-app" : "Exchange Deposit In Person"}
                                </Badge>
                              )}
                              <Badge variant="secondary" className="text-xs">
                                <Truck className="h-3 w-3 mr-1" />
                                Delivery: {request.counterDeliveryMethod === "courier" ? "Uber" : "Pick up"}
                              </Badge>
                              {request.counterStartDate && request.counterEndDate && (
                                <Badge variant="secondary" className="text-xs">
                                  <Clock className="h-3 w-3 mr-1" />
                                  {format(new Date(request.counterStartDate), "MMM d")} – {format(new Date(request.counterEndDate), "MMM d")}
                                </Badge>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                onClick={() => respondToCounterMutation.mutate({ requestId: request.id, accept: true })}
                                disabled={respondToCounterMutation.isPending}
                                className="bg-green-600 hover:bg-green-700"
                              >
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Accept
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRequestChange(request, "requester")}
                                className="border-amber-500 text-amber-600 hover:bg-amber-50"
                              >
                                <RefreshCw className="h-4 w-4 mr-1" />
                                Counter
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => respondToCounterMutation.mutate({ requestId: request.id, accept: false })}
                                disabled={respondToCounterMutation.isPending}
                              >
                                <XCircle className="h-4 w-4 mr-1" />
                                Decline
                              </Button>
                            </div>
                          </div>
                        )}

                        {request.startDate && request.endDate && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                            <Clock className="h-4 w-4" />
                            <span>
                              {format(new Date(request.startDate), "MMM d")} - {format(new Date(request.endDate), "MMM d, yyyy")}
                            </span>
                          </div>
                        )}

                        {request.requestType === "GIFT" && request.status === "ACCEPTED" && (
                          <div className="flex gap-2 mt-3 p-3 bg-pink-50 border border-pink-200 rounded-lg">
                            <div className="flex-1">
                              <p className="text-sm text-pink-700 font-medium mb-2">
                                <Gift className="h-4 w-4 inline mr-1" />
                                Gift accepted! Arrange pickup with the giver.
                              </p>
                              {request.borrowerConfirmedHandoff ? (
                                <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                                  <Clock className="h-3 w-3 mr-1" />
                                  Waiting for giver to confirm
                                </Badge>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={() => confirmGiftReceivedMutation.mutate(request.id)}
                                  disabled={confirmGiftReceivedMutation.isPending}
                                  className="bg-pink-500 hover:bg-pink-600"
                                >
                                  <CheckCircle className="h-4 w-4 mr-1" />
                                  Confirm Received
                                </Button>
                              )}
                            </div>
                          </div>
                        )}

                        {request.requestType === "SWAP" && request.status === "ACCEPTED" && (
                          <div className="mt-3 p-3 bg-teal-50 border border-teal-200 rounded-lg">
                            <p className="text-sm text-teal-800 font-medium mb-2">
                              <CheckCircle className="h-4 w-4 inline mr-1" />
                              Swap accepted! Arrange the exchange with the owner.
                            </p>
                            <Button
                              size="sm"
                              className="bg-teal-600 hover:bg-teal-700"
                              onClick={() => navigate(`/chat/${request.item.ownerId}`)}
                            >
                              Open Chat
                            </Button>
                          </div>
                        )}

                        {(request.requestType === "BORROW" || request.requestType === "RENT") && (
                          <div className="flex gap-2 mt-3">
                            {request.status === "ACCEPTED" && (
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSelectedRequest(request);
                                  setShowTrustDepositModal(true);
                                }}
                                className="bg-teal-600 hover:bg-teal-700"
                              >
                                <Shield className="h-4 w-4 mr-1" />
                                {request.requestType === "RENT" ? "Pay Rental & Deposit" : "Pay Deposit"}
                              </Button>
                            )}

                            {request.status === "DEPOSIT_CONFIRMED" && request.deliveryMethod === "courier" && (
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSelectedRequest(request);
                                  setShowCourierModal(true);
                                }}
                                className="bg-orange-600 hover:bg-orange-700"
                              >
                                <Truck className="h-4 w-4 mr-1" />
                                Book Courier
                              </Button>
                            )}

                            {(request.status === "DEPOSIT_CONFIRMED" || request.status === "COURIER_PENDING" || request.status === "AWAITING_HANDOFF_CONFIRM") && (
                              <>
                                {/* Show waiting status if borrower already confirmed */}
                                {request.status === "AWAITING_HANDOFF_CONFIRM" && request.borrowerConfirmedHandoff && (
                                  <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                                    <Clock className="h-3 w-3 mr-1" />
                                    Waiting for owner
                                  </Badge>
                                )}
                                {/* Show confirm button if borrower hasn't confirmed yet */}
                                {!(request.status === "AWAITING_HANDOFF_CONFIRM" && request.borrowerConfirmedHandoff) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setSelectedRequest(request);
                                      setShowHandoffModal(true);
                                    }}
                                  >
                                    <HandMetal className="h-4 w-4 mr-1" />
                                    {request.deliveryMethod === "courier" 
                                      ? "Confirm Received (after delivery)" 
                                      : "Confirm Handoff (together)"}
                                  </Button>
                                )}
                              </>
                            )}

                            {request.status === "IN_PROGRESS" && (() => {
                              const isOverdue = request.endDate ? new Date() > new Date(request.endDate) : false;
                              const hasPending = !!pendingExtByRequestId[request.id];
                              const hasAccepted = !!acceptedExtByRequestId[request.id];
                              return (
                                <div className="flex flex-col gap-2 w-full">
                                  {isOverdue && (
                                    <div className="flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 font-medium">
                                      <Clock className="h-3.5 w-3.5" />
                                      This item is overdue. Return it or start a new borrow period.
                                    </div>
                                  )}
                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      size="sm"
                                      onClick={() => { setSelectedRequest(request); setShowReturnModal(true); }}
                                      className="bg-blue-600 hover:bg-blue-700"
                                    >
                                      <RotateCcw className="h-4 w-4 mr-1" />
                                      Return Item
                                    </Button>
                                    {isOverdue ? (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => { setRenewRequest(request); setShowRenewDialog(true); }}
                                      >
                                        Start new borrow period
                                      </Button>
                                    ) : hasPending ? (
                                      <Badge variant="secondary" className="bg-amber-100 text-amber-800 self-center">
                                        <Clock className="h-3 w-3 mr-1" />
                                        Extension pending owner approval
                                      </Badge>
                                    ) : hasAccepted ? (
                                      <span className="text-xs text-muted-foreground self-center">
                                        Further extensions not available. Please return the item or arrange a new request.
                                      </span>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => { setExtendRequest(request); setExtendDays(null); setShowExtendDialog(true); }}
                                      >
                                        <Clock className="h-4 w-4 mr-1" />
                                        Need a bit more time?
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}

                            {request.status === "RETURN_REQUESTED" && (
                              <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                                Awaiting lender confirmation
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Active Transactions as Owner */}
        {requests.filter(r => r.item.ownerId === user?.id && ["DEPOSIT_CONFIRMED", "COURIER_PENDING", "AWAITING_HANDOFF_CONFIRM", "IN_PROGRESS", "RETURN_REQUESTED"].includes(r.status)).length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
              <Package className="h-6 w-6 text-teal-600" />
              Active Lends
            </h2>
            <div className="space-y-4">
              {requests
                .filter(r => r.item.ownerId === user?.id && ["DEPOSIT_CONFIRMED", "COURIER_PENDING", "AWAITING_HANDOFF_CONFIRM", "IN_PROGRESS", "RETURN_REQUESTED"].includes(r.status))
                .map((request) => (
                  <Card key={request.id} className="bg-white border-2 border-teal-200">
                    <CardContent className="p-6">
                      <div className="flex gap-4">
                        <div className="w-20 h-20 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                          {request.item.photos?.[0] ? (
                            <img src={request.item.photos[0]} alt={request.item.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Package className="h-6 w-6 text-gray-400" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="font-semibold">{request.item.name}</h3>
                              <p className="text-sm text-muted-foreground">
                                Borrowed by {(request.requester as any).displayName || (request.requester as any).handle || formatDisplayName(request.requester.username)}
                              </p>
                            </div>
                            <Badge 
                              variant={request.status === "IN_PROGRESS" ? "default" : "secondary"}
                              className={request.status === "RETURN_REQUESTED" ? "bg-amber-100 text-amber-800" : ""}
                            >
                              {request.status.replace(/_/g, " ")}
                            </Badge>
                          </div>

                          <div className="flex gap-2 mt-3">
                            {(request.status === "DEPOSIT_CONFIRMED" || request.status === "COURIER_PENDING" || request.status === "AWAITING_HANDOFF_CONFIRM") && (
                              <>
                                {/* Show waiting status if owner already confirmed */}
                                {request.status === "AWAITING_HANDOFF_CONFIRM" && request.ownerConfirmedHandoff && (
                                  <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                                    <Clock className="h-3 w-3 mr-1" />
                                    Waiting for borrower
                                  </Badge>
                                )}
                                {/* Show confirm button if owner hasn't confirmed yet */}
                                {!(request.status === "AWAITING_HANDOFF_CONFIRM" && request.ownerConfirmedHandoff) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setSelectedRequest(request);
                                      setShowHandoffModal(true);
                                    }}
                                  >
                                    <HandMetal className="h-4 w-4 mr-1" />
                                    {request.deliveryMethod === "courier" 
                                      ? "Confirm Sent (via courier)" 
                                      : "Confirm Handoff (together)"}
                                  </Button>
                                )}
                              </>
                            )}

                            {request.status === "IN_PROGRESS" && (() => {
                              const isOverdue = request.endDate ? new Date() > new Date(request.endDate) : false;
                              const pendingExt = pendingExtByRequestId[request.id];
                              return (
                                <>
                                  {isOverdue && (
                                    <div className="w-full mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                                      <p className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1.5">
                                        <Clock className="h-3.5 w-3.5" /> Item is overdue
                                      </p>
                                      <div className="flex gap-2">
                                        <Button size="sm" variant="outline" className="text-xs"
                                          onClick={() => navigate(`/messages/${request.requesterId}`)}>
                                          Message borrower
                                        </Button>
                                        <Button size="sm" variant="outline" className="text-xs border-red-300 text-red-600 hover:bg-red-50"
                                          onClick={() => navigate(`/disputes/new?requestId=${request.id}`)}>
                                          Report issue
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                  {!isOverdue && pendingExt && (
                                    <div className="w-full mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                      <p className="text-sm font-medium text-amber-800 mb-1">
                                        Short extension requested: {pendingExt.message} → {format(new Date(pendingExt.requestedEndDate), "MMM d, yyyy")}
                                      </p>
                                      <div className="flex gap-2">
                                        <Button size="sm" className="bg-green-600 hover:bg-green-700"
                                          disabled={respondExtensionMutation.isPending}
                                          onClick={() => respondExtensionMutation.mutate({ requestId: request.id, action: "accept" })}>
                                          <CheckCircle className="h-3.5 w-3.5 mr-1" /> Accept
                                        </Button>
                                        <Button size="sm" variant="outline" className="border-red-300 text-red-600 hover:bg-red-50"
                                          disabled={respondExtensionMutation.isPending}
                                          onClick={() => respondExtensionMutation.mutate({ requestId: request.id, action: "decline" })}>
                                          <XCircle className="h-3.5 w-3.5 mr-1" /> Decline
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </>
                              );
                            })()}

                            {request.status === "RETURN_REQUESTED" && (
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSelectedRequest(request);
                                  setShowReturnModal(true);
                                }}
                                className="bg-green-600 hover:bg-green-700"
                              >
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Confirm Return
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          </div>
        )}

        {/* Active Gifts as Giver */}
        {requests.filter(r => r.item.ownerId === user?.id && r.requestType === "GIFT" && r.status === "ACCEPTED").length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
              <Gift className="h-6 w-6 text-pink-500" />
              Active Gifts
            </h2>
            <div className="space-y-4">
              {requests
                .filter(r => r.item.ownerId === user?.id && r.requestType === "GIFT" && r.status === "ACCEPTED")
                .map((request) => (
                  <Card key={request.id} className="bg-pink-50 border-2 border-pink-200">
                    <CardContent className="p-6">
                      <div className="flex gap-4">
                        <div className="w-20 h-20 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                          {request.item.photos?.[0] ? (
                            <img src={request.item.photos[0]} alt={request.item.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Gift className="h-6 w-6 text-pink-400" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="font-semibold">{request.item.name}</h3>
                              <p className="text-sm text-muted-foreground">
                                Gifting to {(request.requester as any).displayName || (request.requester as any).handle || formatDisplayName(request.requester.username)}
                              </p>
                            </div>
                            <Badge className="bg-pink-100 text-pink-700 border-pink-300">
                              GIFT
                            </Badge>
                          </div>

                          <div className="flex gap-2 mt-3">
                            {request.ownerConfirmedHandoff ? (
                              <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                                <Clock className="h-3 w-3 mr-1" />
                                Waiting for receiver to confirm
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => confirmGiftGivenMutation.mutate(request.id)}
                                disabled={confirmGiftGivenMutation.isPending}
                                className="bg-pink-500 hover:bg-pink-600"
                              >
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Confirm Given
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Stripe Payment Form Modal */}
      {depositClientSecret && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="max-w-md w-full">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold mb-4">Authorize Security Deposit</h3>
              <Elements stripe={stripePromise} options={{ clientSecret: depositClientSecret }}>
                <DepositPaymentForm
                  clientSecret={depositClientSecret}
                  onSuccess={handleDepositPaymentSuccess}
                  onCancel={() => {
                    setDepositClientSecret(null);
                    setPendingDeliveryData(null);
                  }}
                />
              </Elements>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Celebration Animation */}
      <CelebrationAnimation
        isVisible={showCelebration}
        onComplete={() => setShowCelebration(false)}
        message="Request accepted! Setting up exchange..."
      />

      {/* Trust Deposit Modal - For borrowers after acceptance */}
      {selectedRequest && showTrustDepositModal && (
        <TrustDepositModal
          isOpen={showTrustDepositModal}
          onClose={() => {
            setShowTrustDepositModal(false);
            setSelectedRequest(null);
          }}
          request={{
            id: selectedRequest.id,
            itemId: selectedRequest.itemId,
            deliveryMethod: selectedRequest.deliveryMethod || "in_person",
            depositMethod: selectedRequest.depositMethod || "in_app",
          }}
          item={{
            name: selectedRequest.item.name,
            tier: selectedRequest.item.tier || 2,
            originalValue: selectedRequest.item.originalValue || "$50–$150",
            shareCoinPrice: selectedRequest.item.shareCoinPrice || "5",
            photos: selectedRequest.item.photos,
          }}
          ownerId={selectedRequest.item.ownerId}
          trustScore={Math.min(100, Math.round(((user as any)?.reputationScore || 0) / 500 * 100))}
          courierFee={selectedRequest.deliveryMethod === "courier" ? 8.99 : 0}
          onSuccess={(nextStep) => {
            setShowTrustDepositModal(false);
            if (nextStep === "book_courier") {
              setShowCourierModal(true);
            } else {
              setSelectedRequest(null);
              toast({
                title: "Ready for handoff!",
                description: "Coordinate with the lender to pick up your item.",
              });
            }
          }}
        />
      )}

      {/* Courier Booking Modal - After deposit confirmed */}
      {selectedRequest && showCourierModal && (
        <CourierBookingModal
          isOpen={showCourierModal}
          onClose={() => {
            setShowCourierModal(false);
            setSelectedRequest(null);
          }}
          requestId={selectedRequest.id}
          itemName={selectedRequest.item.name}
          defaultAddress={selectedRequest.courierAddress || ""}
          onSuccess={() => {
            setShowCourierModal(false);
            setSelectedRequest(null);
            toast({
              title: "Courier booked!",
              description: "You'll receive updates when the courier picks up your item.",
            });
          }}
          onCancel={() => {
            setShowCourierModal(false);
            setSelectedRequest(null);
          }}
        />
      )}

      {/* Handoff Confirmation Modal */}
      {selectedRequest && showHandoffModal && (
        <HandoffConfirmationModal
          isOpen={showHandoffModal}
          onClose={() => {
            setShowHandoffModal(false);
            setSelectedRequest(null);
          }}
          requestId={selectedRequest.id}
          itemName={selectedRequest.item.name}
          shareCoinAmount={parseFloat(selectedRequest.item.shareCoinPrice || "5")}
          userRole={selectedRequest.requesterId === user?.id ? "borrower" : "owner"}
          deliveryMethod={selectedRequest.deliveryMethod === "courier" ? "courier" : "in_person"}
          otherPartyConfirmed={
            selectedRequest.requesterId === user?.id 
              ? !!selectedRequest.ownerConfirmedHandoff 
              : !!selectedRequest.borrowerConfirmedHandoff
          }
          requestType={selectedRequest.requestType as "BORROW" | "RENT"}
          onSuccess={() => {
            setShowHandoffModal(false);
            setSelectedRequest(null);
          }}
        />
      )}

      {/* Return Confirmation Modal */}
      {selectedRequest && showReturnModal && (
        <ReturnConfirmationModal
          isOpen={showReturnModal}
          onClose={() => {
            setShowReturnModal(false);
            setSelectedRequest(null);
          }}
          requestId={selectedRequest.id}
          itemName={selectedRequest.item.name}
          depositAmount={parseFloat(selectedRequest.trustDepositAmount || "20")}
          userRole={selectedRequest.requesterId === user?.id ? "borrower" : "owner"}
          requestType={selectedRequest.requestType as "BORROW" | "RENT"}
          endDate={selectedRequest.endDate}
          onSuccess={() => {
            setShowReturnModal(false);
            setSelectedRequest(null);
          }}
        />
      )}

      {/* Short Extension Dialog */}
      <Dialog open={showExtendDialog} onOpenChange={(open) => { setShowExtendDialog(open); if (!open) { setExtendDays(null); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-500" />
              Short extension (up to 3 days)
            </DialogTitle>
            <DialogDescription>
              Short extensions help with small delays. For a longer period, start a new borrow.
            </DialogDescription>
          </DialogHeader>

          {extendRequest && (
            <div className="space-y-4 py-2">
              {extendRequest.endDate && (
                <div className="bg-gray-50 rounded-lg p-3 text-sm">
                  <span className="text-muted-foreground">Current due date: </span>
                  <span className="font-medium">{format(new Date(extendRequest.endDate), "MMM d, yyyy")}</span>
                </div>
              )}
              <div className="space-y-2">
                <p className="text-sm font-medium">Add extra time</p>
                <div className="grid grid-cols-3 gap-2">
                  {([1, 2, 3] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setExtendDays(d)}
                      className={`py-3 rounded-lg border text-sm font-medium transition-colors ${
                        extendDays === d
                          ? "border-amber-500 bg-amber-50 text-amber-700"
                          : "border-gray-200 hover:border-gray-300 text-gray-700"
                      }`}
                    >
                      +{d} day{d > 1 ? "s" : ""}
                    </button>
                  ))}
                </div>
                {extendDays && extendRequest.endDate && (
                  <p className="text-xs text-muted-foreground pt-1">
                    New return date: <span className="font-medium text-gray-700">{format(new Date(new Date(extendRequest.endDate).getTime() + extendDays * 86400000), "MMM d, yyyy")}</span>
                  </p>
                )}
              </div>

              <div className="border-t pt-3">
                <p className="text-xs text-muted-foreground mb-1">Need more than a few days?</p>
                <button
                  className="text-sm text-teal-600 hover:text-teal-700 font-medium"
                  onClick={() => { setShowExtendDialog(false); setRenewRequest(extendRequest); setShowRenewDialog(true); }}
                >
                  Start a new borrow period →
                </button>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowExtendDialog(false)}>Cancel</Button>
            <Button
              disabled={!extendDays || requestExtensionMutation.isPending}
              onClick={() => extendRequest && extendDays && requestExtensionMutation.mutate({ requestId: extendRequest.id, days: extendDays })}
              className="bg-amber-500 hover:bg-amber-600"
            >
              {requestExtensionMutation.isPending ? "Sending…" : "Request extension"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renewal Dialog */}
      <Dialog open={showRenewDialog} onOpenChange={setShowRenewDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Start a new borrow period</DialogTitle>
            <DialogDescription>
              A new request will be sent to the owner. Your deposit will refresh and ShareCoins will apply.
            </DialogDescription>
          </DialogHeader>
          {renewRequest && (
            <div className="py-3 space-y-3">
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <p><span className="text-muted-foreground">Item: </span><span className="font-medium">{renewRequest.item.name}</span></p>
                <p><span className="text-muted-foreground">Starts: </span><span className="font-medium">{renewRequest.endDate ? format(new Date(renewRequest.endDate), "MMM d, yyyy") : "after return"}</span></p>
                <p><span className="text-muted-foreground">Cost: </span><span className="font-medium">{renewRequest.item.shareCoinPrice || "5"} ShareCoins</span></p>
              </div>
              <p className="text-xs text-muted-foreground">Renewal only starts after this borrow ends. No overlapping periods.</p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowRenewDialog(false)}>Cancel</Button>
            <Button
              className="bg-teal-600 hover:bg-teal-700"
              onClick={() => {
                if (!renewRequest) return;
                const coinBalance = (user as any)?.shareCoins ?? 0;
                const required = parseFloat(renewRequest.item.shareCoinPrice || "5");
                if (coinBalance < required) {
                  setShowRenewDialog(false);
                  setShowInsufficientCoins(true);
                } else {
                  setShowRenewDialog(false);
                  navigate(`/items/${renewRequest.item.id}`);
                }
              }}
            >
              Go to item →
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Insufficient ShareCoins Modal (renewal) */}
      <InsufficientShareCoinsModal
        isOpen={showInsufficientCoins}
        onClose={() => setShowInsufficientCoins(false)}
        currentBalance={(user as any)?.shareCoins ?? 0}
        required={parseFloat(renewRequest?.item?.shareCoinPrice || "5")}
        context="borrow"
      />

      {/* Counter-Proposal Modal (owner OR requester) */}
      <Dialog open={showCounterProposalModal} onOpenChange={setShowCounterProposalModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-amber-500" />
              Propose New Terms
            </DialogTitle>
            <DialogDescription>
              Suggest changes to delivery, deposit, or dates. The other party will review and can accept, decline, or counter again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* Their current/counter terms */}
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-2">
                {counterProposalRole === "requester" ? "Owner's proposed terms:" : "Requester's requested terms:"}
              </p>
              <div className="flex flex-wrap gap-2">
                {counterProposalRequest?.requestType === "BORROW" && (
                  <Badge variant="outline" className="text-xs">
                    Deposit: {(counterProposalRole === "requester"
                      ? counterProposalRequest?.counterDepositMethod
                      : counterProposalRequest?.depositMethod) === "in_app" ? "Handle Deposit In-app" : "Exchange Deposit In Person"}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  Delivery: {(counterProposalRole === "requester"
                    ? counterProposalRequest?.counterDeliveryMethod
                    : counterProposalRequest?.deliveryMethod) === "courier" ? "Uber" : "Pick up"}
                </Badge>
                {(() => {
                  const sd = counterProposalRole === "requester"
                    ? counterProposalRequest?.counterStartDate
                    : counterProposalRequest?.startDate;
                  const ed = counterProposalRole === "requester"
                    ? counterProposalRequest?.counterEndDate
                    : counterProposalRequest?.endDate;
                  return sd && ed ? (
                    <Badge variant="outline" className="text-xs">
                      {format(new Date(sd), "MMM d")} – {format(new Date(ed), "MMM d")}
                    </Badge>
                  ) : null;
                })()}
              </div>
            </div>

            {/* Deposit method - BORROW only */}
            {counterProposalRequest?.requestType === "BORROW" && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">Your Deposit Preference</Label>
                <RadioGroup value={proposedDepositMethod} onValueChange={setProposedDepositMethod}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="in_app" id="cp-deposit-inapp" />
                    <Label htmlFor="cp-deposit-inapp" className="font-normal cursor-pointer">In-app (secure payment hold)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="in_person" id="cp-deposit-inperson" />
                    <Label htmlFor="cp-deposit-inperson" className="font-normal cursor-pointer">In-person (cash at handoff)</Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* Delivery method */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Your Delivery Preference</Label>
              <RadioGroup value={proposedDeliveryMethod} onValueChange={setProposedDeliveryMethod}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="in_person" id="cp-delivery-pickup" />
                  <Label htmlFor="cp-delivery-pickup" className="font-normal cursor-pointer">Pick up in person</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="courier" id="cp-delivery-courier" />
                  <Label htmlFor="cp-delivery-courier" className="font-normal cursor-pointer">Uber delivery</Label>
                </div>
              </RadioGroup>
            </div>

            {/* Date range - BORROW or RENT */}
            {(counterProposalRequest?.requestType === "BORROW" || counterProposalRequest?.requestType === "RENT") && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">Date Range</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Start</Label>
                    <Input
                      type="date"
                      value={proposedStartDate}
                      onChange={(e) => setProposedStartDate(e.target.value)}
                      min={new Date().toISOString().split("T")[0]}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">End</Label>
                    <Input
                      type="date"
                      value={proposedEndDate}
                      onChange={(e) => setProposedEndDate(e.target.value)}
                      min={proposedStartDate || new Date().toISOString().split("T")[0]}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCounterProposalModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmitCounterProposal}
              disabled={counterProposalMutation.isPending}
              className="bg-amber-500 hover:bg-amber-600"
            >
              {counterProposalMutation.isPending ? "Sending..." : "Send Counter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
