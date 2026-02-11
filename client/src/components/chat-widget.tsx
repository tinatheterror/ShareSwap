import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWebSocket } from "@/hooks/use-websocket";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { formatDisplayName } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  MessageCircle,
  Send,
  ChevronDown,
  Loader2,
  Package,
  CheckCircle,
  XCircle,
  Clock,
  User,
  Shield,
  Truck,
  HandMetal,
  RotateCcw,
  ArrowLeft,
  Inbox,
} from "lucide-react";
import { format } from "date-fns";
import { DeliveryDepositModal } from "@/components/delivery-deposit-modal";
import { TrustDepositModal } from "@/components/borrow/trust-deposit-modal";
import { RentalDepositModal } from "@/components/rental/rental-deposit-modal";
import { CourierBookingModal } from "@/components/borrow/courier-booking-modal";
import { HandoffConfirmationModal } from "@/components/borrow/handoff-confirmation-modal";
import { ReturnConfirmationModal } from "@/components/borrow/return-confirmation-modal";
import { CelebrationAnimation } from "@/components/celebration-animation";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { getStripePromise } from "@/lib/stripe-client";

const stripePromise = getStripePromise();

type Conversation = {
  userId: number;
  username: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  transactionType: string | null;
  itemName: string | null;
};

type Message = {
  id: number;
  content: string;
  senderId: number;
  receiverId: number;
  createdAt: string;
};

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

type MainTab = "messages" | "requests";
type MessageFilter =
  | "all"
  | "lending"
  | "renting"
  | "swapping"
  | "gifting"
  | "unread";
type RequestFilter = "incoming" | "outgoing" | "active";

function DepositPaymentForm({
  clientSecret,
  onSuccess,
  onCancel,
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

export function ChatWidget() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [isOpen, setIsOpen] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>("messages");
  const [messageFilter, setMessageFilter] = useState<MessageFilter>("all");
  const [requestFilter, setRequestFilter] = useState<RequestFilter>("incoming");
  const [selectedConversation, setSelectedConversation] = useState<
    number | null
  >(null);
  const [message, setMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Request handling state
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(
    null,
  );
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [depositClientSecret, setDepositClientSecret] = useState<string | null>(
    null,
  );
  const [pendingDeliveryData, setPendingDeliveryData] = useState<any>(null);
  const [showTrustDepositModal, setShowTrustDepositModal] = useState(false);
  const [showRentalDepositModal, setShowRentalDepositModal] = useState(false);
  const [showCourierModal, setShowCourierModal] = useState(false);
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ItemRequest | null>(
    null,
  );

  // WebSocket setup
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const wsUrl = `${protocol}//${host}/ws/chat`;

  const { isConnected, send } = useWebSocket({
    url: wsUrl,
    onMessage: (data) => {
      const message = JSON.parse(data);
      if (message.receiverId === user?.id || message.senderId === user?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
        if (selectedConversation) {
          queryClient.invalidateQueries({
            queryKey: ["/api/messages", selectedConversation],
          });
        }
      }
    },
    onConnect: () => {
      if (user) {
        send({
          type: "authenticate",
          payload: { userId: user.id },
        });
      }
    },
    autoConnect: !!user,
  });

  // Fetch conversations
  const { data: allConversations = [] } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    enabled: !!user,
  });

  // Fetch requests
  const { data: requests = [], isLoading: isLoadingRequests } = useQuery<
    ItemRequest[]
  >({
    queryKey: ["/api/requests"],
    enabled: !!user,
  });

  // Filter conversations based on active tab
  const filteredConversations = allConversations.filter((conv) => {
    if (messageFilter === "all") return true;
    if (messageFilter === "unread") return conv.unreadCount > 0;
    if (messageFilter === "lending")
      return conv.transactionType?.toUpperCase() === "BORROW";
    if (messageFilter === "renting")
      return conv.transactionType?.toUpperCase() === "RENT";
    if (messageFilter === "swapping")
      return conv.transactionType?.toUpperCase() === "SWAP";
    if (messageFilter === "gifting")
      return conv.transactionType?.toUpperCase() === "GIFT";
    return true;
  });

  // Fetch messages for selected conversation
  const { data: messages = [], isLoading: isLoadingMessages } = useQuery<
    Message[]
  >({
    queryKey: ["/api/messages", selectedConversation],
    enabled: !!selectedConversation && !!user,
  });

  // Request mutations
  const acceptMutation = useMutation({
    mutationFn: async (requestId: number) => {
      const response = await apiRequest("PATCH", `/api/requests/${requestId}`, {
        status: "ACCEPTED",
      });
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/requests"] });
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
      const response = await apiRequest("PATCH", `/api/requests/${requestId}`, {
        status: "DECLINED",
      });
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({
        title: "Request Declined",
        description: "You've declined this request",
      });
    },
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Early return AFTER all hooks to avoid Rules of Hooks violation
  if (!user) return null;

  const handleSendMessage = async () => {
    if (!message.trim() || !selectedConversation) return;

    try {
      const response = await apiRequest("POST", "/api/messages", {
        receiverId: selectedConversation,
        content: message,
      });

      setMessage("");
      if (isConnected) {
        send({
          type: "new_message",
          payload: {
            senderId: user.id,
            receiverId: selectedConversation,
            content: message,
          },
        });
      }
      queryClient.invalidateQueries({
        queryKey: ["/api/messages", selectedConversation],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  const handleAcceptClick = (request: ItemRequest) => {
    setSelectedRequestId(request.id);
    // Swaps and gifts don't require delivery/deposit setup - accept directly
    if (request.requestType === "SWAP" || request.requestType === "GIFT") {
      acceptMutation.mutate(request.id);
    } else {
      setShowDeliveryModal(true);
    }
  };

  const handleDeliveryDepositComplete = async (selections: any) => {
    setShowDeliveryModal(false);
    if (!selectedRequestId) return;

    const request = requests.find((r) => r.id === selectedRequestId);
    if (!request) return;

    const itemValue = request.item.replacementValue || parseFloat(request.item.estimatedValue || "50");

    if (selections.depositMethod === "shareswap_deposit") {
      try {
        const response = await apiRequest(
          "POST",
          "/api/stripe/create-deposit-hold",
          {
            depositAmount: itemValue,
            requestId: selectedRequestId,
          },
        );
        const data = await response.json();

        if (data.clientSecret) {
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
      await finalizeAcceptance(selectedRequestId, selections, null);
    }
  };

  const handleDepositPaymentSuccess = async (paymentIntentId: string) => {
    if (!pendingDeliveryData || !selectedRequestId) return;
    await finalizeAcceptance(
      selectedRequestId,
      pendingDeliveryData,
      paymentIntentId,
    );
    setDepositClientSecret(null);
    setPendingDeliveryData(null);
  };

  const finalizeAcceptance = async (
    requestId: number,
    selections: any,
    stripePaymentIntentId: string | null,
  ) => {
    try {
      await apiRequest("POST", "/api/delivery-arrangements", {
        requestId,
        deliveryMethod: selections.deliveryMethod,
        depositMethod: selections.depositMethod,
        uberQuoteFee: selections.uberQuoteFee,
        depositAmount: selections.depositAmount,
        depositProcessingFee: selections.depositProcessingFee,
        stripePaymentIntentId,
      });
      acceptMutation.mutate(requestId);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to finalize acceptance",
        variant: "destructive",
      });
    }
  };

  // Filter requests
  const incomingRequests = requests.filter(
    (r) => r.item.ownerId === user?.id && r.status === "PENDING",
  );
  const myRequests = requests.filter((r) => r.requesterId === user?.id);
  const activeTransactions = requests.filter(
    (r) =>
      (r.item.ownerId === user?.id || r.requesterId === user?.id) &&
      [
        "ACCEPTED",
        "DEPOSIT_CONFIRMED",
        "COURIER_PENDING",
        "IN_PROGRESS",
        "RETURN_REQUESTED",
      ].includes(r.status),
  );

  const getFilteredRequests = () => {
    if (requestFilter === "incoming") return incomingRequests;
    if (requestFilter === "outgoing") return myRequests;
    if (requestFilter === "active") return activeTransactions;
    return [];
  };

  const totalUnread = allConversations.reduce(
    (sum, conv) => sum + conv.unreadCount,
    0,
  );
  const pendingRequestCount = incomingRequests.length;
  const totalBadge = totalUnread + pendingRequestCount;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "PENDING":
        return "bg-amber-100 text-amber-800";
      case "ACCEPTED":
        return "bg-blue-100 text-blue-800";
      case "DEPOSIT_CONFIRMED":
        return "bg-teal-100 text-teal-800";
      case "IN_PROGRESS":
        return "bg-green-100 text-green-800";
      case "RETURN_REQUESTED":
        return "bg-purple-100 text-purple-800";
      case "DECLINED":
        return "bg-red-100 text-red-800";
      case "COMPLETED":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-600";
    }
  };

  const renderRequestCard = (request: ItemRequest) => {
    const isOwner = request.item.ownerId === user?.id;
    const isBorrower = request.requesterId === user?.id;

    return (
      <div
        key={request.id}
        className="p-3 border-b hover:bg-gray-50 transition-colors"
      >
        <div className="flex gap-3">
          <div className="w-14 h-14 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
            {request.item.photos?.[0] ? (
              <img
                src={request.item.photos[0]}
                alt={request.item.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Package className="h-5 w-5 text-gray-400" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <h4 className="font-medium text-sm truncate">
                {request.item.name}
              </h4>
              <Badge
                className={`text-[10px] px-1.5 py-0 shrink-0 ${getStatusColor(request.status)}`}
              >
                {request.status.replace(/_/g, " ")}
              </Badge>
            </div>

            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <User className="h-3 w-3" />
              {isOwner ? (
                <span>
                  {formatDisplayName(request.requester.username)} wants to{" "}
                  {request.requestType.toLowerCase()}
                </span>
              ) : (
                <span>
                  You requested to {request.requestType.toLowerCase()}
                </span>
              )}
            </div>

            {request.startDate && request.endDate && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                <Clock className="h-3 w-3" />
                <span>
                  {format(new Date(request.startDate), "MMM d")} -{" "}
                  {format(new Date(request.endDate), "MMM d")}
                </span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-1.5 flex-wrap">
              {/* Owner actions for pending requests */}
              {isOwner && request.status === "PENDING" && (
                <>
                  <Button
                    size="sm"
                    className="h-7 text-xs bg-green-600"
                    onClick={() => handleAcceptClick(request)}
                  >
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => declineMutation.mutate(request.id)}
                    disabled={declineMutation.isPending}
                  >
                    <XCircle className="h-3 w-3 mr-1" />
                    Decline
                  </Button>
                </>
              )}

              {/* Borrower actions (ShareCoins) */}
              {isBorrower && request.requestType === "BORROW" && (
                <>
                  {request.status === "ACCEPTED" && (
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-teal-600 hover:bg-teal-700"
                      onClick={() => {
                        setSelectedRequest(request);
                        setShowTrustDepositModal(true);
                      }}
                    >
                      <Shield className="h-3 w-3 mr-1" />
                      Pay Deposit
                    </Button>
                  )}

                  {request.status === "DEPOSIT_CONFIRMED" &&
                    request.deliveryMethod === "courier" && (
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-orange-600 hover:bg-orange-700"
                        onClick={() => {
                          setSelectedRequest(request);
                          setShowCourierModal(true);
                        }}
                      >
                        <Truck className="h-3 w-3 mr-1" />
                        Book Courier
                      </Button>
                    )}

                  {(request.status === "DEPOSIT_CONFIRMED" ||
                    request.status === "COURIER_PENDING") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        setSelectedRequest(request);
                        setShowHandoffModal(true);
                      }}
                    >
                      <HandMetal className="h-3 w-3 mr-1" />
                      Confirm Received
                    </Button>
                  )}

                  {request.status === "IN_PROGRESS" && (
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                      onClick={() => {
                        setSelectedRequest(request);
                        setShowReturnModal(true);
                      }}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Return Item
                    </Button>
                  )}

                  {request.status === "RETURN_REQUESTED" && (
                    <Badge
                      variant="secondary"
                      className="bg-amber-100 text-amber-800 text-[10px]"
                    >
                      Awaiting confirmation
                    </Badge>
                  )}
                </>
              )}

              {/* Renter actions (Cash payment) */}
              {isBorrower && request.requestType === "RENT" && (
                <>
                  {request.status === "ACCEPTED" && (
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-green-600 hover:bg-green-700"
                      onClick={() => {
                        setSelectedRequest(request);
                        setShowRentalDepositModal(true);
                      }}
                    >
                      <Shield className="h-3 w-3 mr-1" />
                      Pay Rental Deposit
                    </Button>
                  )}

                  {request.status === "DEPOSIT_CONFIRMED" &&
                    request.deliveryMethod === "courier" && (
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-orange-600 hover:bg-orange-700"
                        onClick={() => {
                          setSelectedRequest(request);
                          setShowCourierModal(true);
                        }}
                      >
                        <Truck className="h-3 w-3 mr-1" />
                        Book Courier
                      </Button>
                    )}

                  {(request.status === "DEPOSIT_CONFIRMED" ||
                    request.status === "COURIER_PENDING") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        setSelectedRequest(request);
                        setShowHandoffModal(true);
                      }}
                    >
                      <HandMetal className="h-3 w-3 mr-1" />
                      Confirm Received
                    </Button>
                  )}

                  {request.status === "IN_PROGRESS" && (
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                      onClick={() => {
                        setSelectedRequest(request);
                        setShowReturnModal(true);
                      }}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Return Item
                    </Button>
                  )}

                  {request.status === "RETURN_REQUESTED" && (
                    <Badge
                      variant="secondary"
                      className="bg-amber-100 text-amber-800 text-[10px]"
                    >
                      Awaiting confirmation
                    </Badge>
                  )}
                </>
              )}

              {/* Owner actions for active transactions */}
              {isOwner &&
                (request.status === "DEPOSIT_CONFIRMED" ||
                  request.status === "COURIER_PENDING") && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      setSelectedRequest(request);
                      setShowHandoffModal(true);
                    }}
                  >
                    <HandMetal className="h-3 w-3 mr-1" />
                    Confirm Handoff
                  </Button>
                )}

              {isOwner && request.status === "RETURN_REQUESTED" && (
                <Button
                  size="sm"
                  className="h-7 text-xs bg-green-600 hover:bg-green-700"
                  onClick={() => {
                    setSelectedRequest(request);
                    setShowReturnModal(true);
                  }}
                >
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Confirm Return
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!isOpen ? (
        <Button
          onClick={() => setIsOpen(true)}
          className="rounded-full h-14 w-14 shadow-lg relative"
          size="icon"
        >
          <Inbox className="h-6 w-6" />
          {totalBadge > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 rounded-full bg-red-500 text-xs">
              {totalBadge > 99 ? "99+" : totalBadge}
            </Badge>
          )}
        </Button>
      ) : (
        <Card className="w-[380px] h-[600px] shadow-2xl flex flex-col">
          {/* Header with main tabs */}
          <div className="border-b">
            <div className="flex items-center justify-between px-4 py-3">
              <h3 className="font-semibold">Inbox</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsOpen(false);
                  setSelectedConversation(null);
                }}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>

            {/* Main tabs: Messages | Requests */}
            {!selectedConversation && (
              <div className="flex border-t">
                <button
                  onClick={() => setMainTab("messages")}
                  className={`flex-1 py-2.5 text-sm font-medium transition-colors relative ${
                    mainTab === "messages"
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Messages
                  {totalUnread > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] bg-red-500 text-white rounded-full">
                      {totalUnread}
                    </span>
                  )}
                  {mainTab === "messages" && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                  )}
                </button>
                <button
                  onClick={() => setMainTab("requests")}
                  className={`flex-1 py-2.5 text-sm font-medium transition-colors relative ${
                    mainTab === "requests"
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Requests
                  {pendingRequestCount > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] bg-amber-500 text-white rounded-full">
                      {pendingRequestCount}
                    </span>
                  )}
                  {mainTab === "requests" && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                  )}
                </button>
              </div>
            )}
          </div>

          {!selectedConversation ? (
            mainTab === "messages" ? (
              <>
                {/* Message filter tabs */}
                <div className="flex gap-1 p-2 border-b overflow-x-auto">
                  {[
                    { key: "all", label: "All" },
                    { key: "lending", label: "Lend" },
                    { key: "renting", label: "Rent" },
                    { key: "swapping", label: "Swap" },
                    { key: "gifting", label: "Gift" },
                    { key: "unread", label: "Unread" },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setMessageFilter(tab.key as MessageFilter)}
                      className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap ${
                        messageFilter === tab.key
                          ? "bg-gray-800 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Conversation List */}
                <ScrollArea className="flex-1">
                  {filteredConversations.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      <MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No conversations yet</p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {filteredConversations.map((conv) => (
                        <button
                          key={conv.userId}
                          onClick={() => setSelectedConversation(conv.userId)}
                          className="w-full p-3 hover:bg-gray-50 text-left transition-colors"
                        >
                          <div className="flex items-start justify-between mb-1">
                            <span className="font-medium text-sm">
                              {formatDisplayName(conv.username)}
                            </span>
                            {conv.unreadCount > 0 && (
                              <Badge className="bg-red-500 text-xs h-5 min-w-5 flex items-center justify-center">
                                {conv.unreadCount}
                              </Badge>
                            )}
                          </div>
                          {conv.itemName && (
                            <div className="text-xs text-muted-foreground mb-1">
                              {conv.transactionType?.toUpperCase() ===
                                "BORROW" && "Lending"}
                              {conv.transactionType?.toUpperCase() === "RENT" &&
                                "Renting"}
                              {conv.transactionType?.toUpperCase() === "SWAP" &&
                                "Swapping"}
                              {conv.transactionType?.toUpperCase() === "GIFT" &&
                                "Gifting"}
                              : {conv.itemName}
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground truncate">
                            {conv.lastMessage}
                          </p>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(conv.lastMessageTime).toLocaleString()}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </>
            ) : (
              <>
                {/* Request filter tabs */}
                <div className="flex gap-1 p-2 border-b overflow-x-auto">
                  <button
                    onClick={() => setRequestFilter("incoming")}
                    className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap flex items-center gap-1 ${
                      requestFilter === "incoming"
                        ? "bg-gray-800 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    Incoming
                    {incomingRequests.length > 0 && (
                      <span
                        className={`inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] rounded-full ${
                          requestFilter === "incoming"
                            ? "bg-white/20"
                            : "bg-amber-500 text-white"
                        }`}
                      >
                        {incomingRequests.length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setRequestFilter("outgoing")}
                    className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap ${
                      requestFilter === "outgoing"
                        ? "bg-gray-800 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    My Requests
                  </button>
                  <button
                    onClick={() => setRequestFilter("active")}
                    className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap ${
                      requestFilter === "active"
                        ? "bg-gray-800 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    Active
                  </button>
                </div>

                {/* Request List */}
                <ScrollArea className="flex-1">
                  {isLoadingRequests ? (
                    <div className="flex-1 flex items-center justify-center p-8">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : getFilteredRequests().length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">
                        {requestFilter === "incoming" && "No pending requests"}
                        {requestFilter === "outgoing" &&
                          "You haven't made any requests"}
                        {requestFilter === "active" && "No active transactions"}
                      </p>
                    </div>
                  ) : (
                    <div>{getFilteredRequests().map(renderRequestCard)}</div>
                  )}
                </ScrollArea>
              </>
            )
          ) : (
            <>
              {/* Chat View */}
              <div className="p-3 border-b flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedConversation(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <span className="font-medium text-sm">
                  {formatDisplayName(
                    allConversations.find(
                      (c) => c.userId === selectedConversation,
                    )?.username,
                  )}
                </span>
              </div>

              {isLoadingMessages ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <ScrollArea className="flex-1 p-3" ref={scrollRef}>
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`mb-2 flex ${
                        msg.senderId === user.id
                          ? "justify-end"
                          : "justify-start"
                      }`}
                    >
                      <div
                        className={`rounded-lg px-3 py-2 max-w-[75%] ${
                          msg.senderId === user.id
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        <p className="text-sm">{msg.content}</p>
                        <span className="text-[10px] opacity-70">
                          {new Date(msg.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </ScrollArea>
              )}

              <div className="p-3 border-t flex gap-2">
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="text-sm"
                  onKeyPress={(e) => {
                    if (e.key === "Enter" && message.trim()) {
                      handleSendMessage();
                    }
                  }}
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={!message.trim()}
                  size="icon"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {/* Modals */}
      {selectedRequestId && (
        <DeliveryDepositModal
          isOpen={showDeliveryModal}
          onClose={() => {
            setShowDeliveryModal(false);
            setSelectedRequestId(null);
          }}
          onComplete={handleDeliveryDepositComplete}
          itemValue={requests.find((r) => r.id === selectedRequestId)?.item.replacementValue || parseFloat(
            requests.find((r) => r.id === selectedRequestId)?.item
              .estimatedValue || "50",
          )}
        />
      )}

      {depositClientSecret && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <Card className="max-w-md w-full">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold mb-4">
                Authorize Security Deposit
              </h3>
              <Elements
                stripe={stripePromise}
                options={{ clientSecret: depositClientSecret }}
              >
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

      <CelebrationAnimation
        isVisible={showCelebration}
        onComplete={() => setShowCelebration(false)}
        message="Request accepted! Setting up exchange..."
      />

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

      {selectedRequest && showRentalDepositModal && (
        <RentalDepositModal
          isOpen={showRentalDepositModal}
          onClose={() => {
            setShowRentalDepositModal(false);
            setSelectedRequest(null);
          }}
          request={{
            id: selectedRequest.id,
            itemId: selectedRequest.itemId,
            deliveryMethod: selectedRequest.deliveryMethod || "in_person",
            startDate: selectedRequest.startDate,
            endDate: selectedRequest.endDate,
          }}
          item={{
            name: selectedRequest.item.name,
            tier: selectedRequest.item.tier || 2,
            category:
              (selectedRequest.item as any).category || "Home & Kitchen",
            estimatedValue: String(selectedRequest.item.replacementValue || selectedRequest.item.estimatedValue || "100"),
            dollarsPrice: (selectedRequest.item as any).dollarsPrice,
            photos: selectedRequest.item.photos,
          }}
          courierFee={selectedRequest.deliveryMethod === "courier" ? 8.99 : 0}
          onSuccess={(nextStep) => {
            setShowRentalDepositModal(false);
            if (nextStep === "book_courier") {
              setShowCourierModal(true);
            } else {
              setSelectedRequest(null);
              toast({
                title: "Rental deposit secured!",
                description:
                  "Coordinate with the owner to pick up your rental.",
              });
            }
          }}
        />
      )}

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
              description:
                "You'll receive updates when the courier picks up your item.",
            });
          }}
          onCancel={() => {
            setShowCourierModal(false);
            setSelectedRequest(null);
          }}
        />
      )}

      {selectedRequest && showHandoffModal && (
        <HandoffConfirmationModal
          isOpen={showHandoffModal}
          onClose={() => {
            setShowHandoffModal(false);
            setSelectedRequest(null);
          }}
          requestId={selectedRequest.id}
          itemName={selectedRequest.item.name}
          shareCoinAmount={parseFloat(
            selectedRequest.item.shareCoinPrice || "5",
          )}
          userRole={
            selectedRequest.requesterId === user?.id ? "borrower" : "owner"
          }
          deliveryMethod={
            (selectedRequest.deliveryMethod === "courier"
              ? "courier"
              : "in_person") as "in_person" | "courier"
          }
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
          userRole={
            selectedRequest.requesterId === user?.id ? "borrower" : "owner"
          }
          requestType={selectedRequest.requestType as "BORROW" | "RENT"}
          endDate={selectedRequest.endDate}
          onSuccess={() => {
            setShowReturnModal(false);
            setSelectedRequest(null);
          }}
        />
      )}
    </div>
  );
}
