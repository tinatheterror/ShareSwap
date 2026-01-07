import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { Clock, MapPin, User, CheckCircle, XCircle, Package, Shield, Truck, RotateCcw, HandMetal } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { DeliveryDepositModal } from "@/components/delivery-deposit-modal";
import { CelebrationAnimation } from "@/components/celebration-animation";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { TrustDepositModal } from "@/components/borrow/trust-deposit-modal";
import { CourierBookingModal } from "@/components/borrow/courier-booking-modal";
import { HandoffConfirmationModal } from "@/components/borrow/handoff-confirmation-modal";
import { ReturnConfirmationModal } from "@/components/borrow/return-confirmation-modal";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);

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
  item: {
    id: number;
    name: string;
    description: string;
    photos: string[];
    estimatedValue: string;
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
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [depositClientSecret, setDepositClientSecret] = useState<string | null>(null);
  const [pendingDeliveryData, setPendingDeliveryData] = useState<any>(null);
  
  const [showTrustDepositModal, setShowTrustDepositModal] = useState(false);
  const [showCourierModal, setShowCourierModal] = useState(false);
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ItemRequest | null>(null);

  const { data: requests = [], isLoading } = useQuery<ItemRequest[]>({
    queryKey: ["/api/requests"],
  });

  const acceptMutation = useMutation({
    mutationFn: async (requestId: number) => {
      const response = await apiRequest("PATCH", `/api/requests/${requestId}`, { status: "ACCEPTED" });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      setShowCelebration(true);
    },
    onError: (error: any) => {
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

  const handleAcceptClick = (request: ItemRequest) => {
    setSelectedRequestId(request.id);
    setShowDeliveryModal(true);
  };

  const handleDeliveryDepositComplete = async (selections: any) => {
    setShowDeliveryModal(false);

    if (!selectedRequestId) return;

    const request = requests.find(r => r.id === selectedRequestId);
    if (!request) return;

    const itemValue = parseFloat(request.item.estimatedValue || "50");

    // If ShareSwap Deposit is selected, create Stripe payment hold first
    if (selections.depositMethod === 'shareswap_deposit') {
      try {
        const response = await apiRequest("POST", "/api/stripe/create-deposit-hold", {
          depositAmount: itemValue,
          requestId: selectedRequestId,
        });
        const data = await response.json();

        if (data.clientSecret) {
          // Store pending delivery data and show payment form
          setPendingDeliveryData({
            ...selections,
            requestId: selectedRequestId,
          });
          setDepositClientSecret(data.clientSecret);
        }
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.message || "Failed to create deposit hold",
          variant: "destructive",
        });
      }
    } else {
      // No deposit or self-arranged deposit - proceed directly
      await finalizeAcceptance(selectedRequestId, selections, null);
    }
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
                <Card key={request.id} className="bg-teal-50 border-2 border-teal-200 hover:bg-teal-100 hover:shadow-lg transition-all">
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
                              <span>{request.requester.username} wants to {request.requestType.toLowerCase()}</span>
                            </div>
                          </div>
                          <Badge variant="outline">
                            {request.requestType}
                          </Badge>
                        </div>

                        {request.message && (
                          <p className="text-sm text-muted-foreground mb-2 italic">
                            "{request.message}"
                          </p>
                        )}

                        {request.startDate && request.endDate && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                            <Clock className="h-4 w-4" />
                            <span>
                              {format(new Date(request.startDate), "MMM d")} - {format(new Date(request.endDate), "MMM d, yyyy")}
                            </span>
                          </div>
                        )}

                        <div className="flex gap-2 mt-4">
                          <Button
                            size="sm"
                            onClick={() => handleAcceptClick(request)}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Accept
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
                <Card key={request.id} className="bg-teal-50 border-2 border-teal-200 hover:bg-teal-100 hover:shadow-md transition-all">
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
                              variant={request.status === "ACCEPTED" ? "default" : request.status === "DECLINED" ? "destructive" : "secondary"}
                              className="mt-2"
                            >
                              {request.status}
                            </Badge>
                          </div>
                          <Badge variant="outline">
                            {request.requestType}
                          </Badge>
                        </div>

                        {request.startDate && request.endDate && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                            <Clock className="h-4 w-4" />
                            <span>
                              {format(new Date(request.startDate), "MMM d")} - {format(new Date(request.endDate), "MMM d, yyyy")}
                            </span>
                          </div>
                        )}

                        {request.requestType === "BORROW" && (
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
                                Pay Deposit
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

                            {(request.status === "DEPOSIT_CONFIRMED" || request.status === "COURIER_PENDING") && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedRequest(request);
                                  setShowHandoffModal(true);
                                }}
                              >
                                <HandMetal className="h-4 w-4 mr-1" />
                                Confirm Received
                              </Button>
                            )}

                            {request.status === "IN_PROGRESS" && (
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSelectedRequest(request);
                                  setShowReturnModal(true);
                                }}
                                className="bg-blue-600 hover:bg-blue-700"
                              >
                                <RotateCcw className="h-4 w-4 mr-1" />
                                Return Item
                              </Button>
                            )}

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
        {requests.filter(r => r.item.ownerId === user?.id && ["DEPOSIT_CONFIRMED", "COURIER_PENDING", "IN_PROGRESS", "RETURN_REQUESTED"].includes(r.status)).length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
              <Package className="h-6 w-6 text-teal-600" />
              Active Lends
            </h2>
            <div className="space-y-4">
              {requests
                .filter(r => r.item.ownerId === user?.id && ["DEPOSIT_CONFIRMED", "COURIER_PENDING", "IN_PROGRESS", "RETURN_REQUESTED"].includes(r.status))
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
                                Borrowed by {request.requester.username}
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
                            {(request.status === "DEPOSIT_CONFIRMED" || request.status === "COURIER_PENDING") && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedRequest(request);
                                  setShowHandoffModal(true);
                                }}
                              >
                                <HandMetal className="h-4 w-4 mr-1" />
                                Confirm Handoff
                              </Button>
                            )}

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
      </div>

      {/* Delivery & Deposit Modal */}
      {selectedRequestId && (
        <DeliveryDepositModal
          isOpen={showDeliveryModal}
          onClose={() => {
            setShowDeliveryModal(false);
            setSelectedRequestId(null);
          }}
          onComplete={handleDeliveryDepositComplete}
          itemValue={parseFloat(requests.find(r => r.id === selectedRequestId)?.item.estimatedValue || "50")}
        />
      )}

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
          trustScore={50}
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
          onSuccess={() => {
            setShowHandoffModal(false);
            setSelectedRequest(null);
            toast({
              title: "Handoff confirmed!",
              description: "The borrow period has officially started.",
            });
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
          onSuccess={() => {
            setShowReturnModal(false);
            setSelectedRequest(null);
          }}
        />
      )}
    </div>
  );
}
