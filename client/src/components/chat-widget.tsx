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
  RefreshCw,
  CreditCard,
  MapPin,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
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
  messageType?: string; // 'text' | 'event'
  metadata?: {
    eventType?: string;
    deliveryMethod?: string;
    depositMethod?: string;
    startDate?: string;
    endDate?: string;
    proposedByRole?: string;
    acceptedByRole?: string;
    declinedByRole?: string;
    requestType?: string;
    itemName?: string;
  };
  requestId?: number;
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
  negotiationStatus: string | null;
  counterDeliveryMethod: string | null;
  counterDepositMethod: string | null;
  counterStartDate: string | null;
  counterEndDate: string | null;
  counterProposedBy: number | null;
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
    displayName: string | null;
  };
}

type MessageFilter =
  | "all"
  | "lending"
  | "renting"
  | "swapping"
  | "gifting"
  | "unread";

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
  const [messageFilter, setMessageFilter] = useState<MessageFilter>("all");
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

  // Counter-proposal state (for inline chat actions)
  const [showChatCounterModal, setShowChatCounterModal] = useState(false);
  const [chatCounterRequest, setChatCounterRequest] = useState<ItemRequest | null>(null);
  const [chatCounterRole, setChatCounterRole] = useState<"owner" | "requester">("requester");
  const [chatProposedDelivery, setChatProposedDelivery] = useState("in_person");
  const [chatProposedDeposit, setChatProposedDeposit] = useState("in_app");
  const [chatProposedStart, setChatProposedStart] = useState("");
  const [chatProposedEnd, setChatProposedEnd] = useState("");

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
    queryFn: async () => {
      const res = await fetch(`/api/messages/${selectedConversation}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
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

  const respondToCounterMutation = useMutation({
    mutationFn: async ({ requestId, accept }: { requestId: number; accept: boolean }) => {
      const res = await apiRequest("POST", `/api/requests/${requestId}/respond-to-counter`, { accept });
      return res.json();
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      qc.invalidateQueries({ queryKey: ["/api/messages", selectedConversation] });
      if (vars.accept && data.ownerAccepted) {
        // Owner fully accepted via counter path — show celebration
        setShowCelebration(true);
      } else {
        toast({
          title: vars.accept ? "Terms Accepted" : "Request Cancelled",
          description: data.message,
        });
      }
    },
  });

  const chatCounterMutation = useMutation({
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
      const res = await apiRequest("POST", endpoint, body);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      qc.invalidateQueries({ queryKey: ["/api/messages", selectedConversation] });
      setShowChatCounterModal(false);
      setChatCounterRequest(null);
      toast({ title: "Counter Sent", description: "The other party will be notified." });
    },
  });

  const openChatCounter = (request: ItemRequest, role: "owner" | "requester") => {
    setChatCounterRequest(request);
    setChatCounterRole(role);
    const d = request.counterDeliveryMethod || request.deliveryMethod || "in_person";
    const dep = request.counterDepositMethod || request.depositMethod || "in_app";
    const sd = request.counterStartDate || request.startDate;
    const ed = request.counterEndDate || request.endDate;
    setChatProposedDelivery(d);
    setChatProposedDeposit(dep);
    setChatProposedStart(sd ? sd.split("T")[0] : "");
    setChatProposedEnd(ed ? ed.split("T")[0] : "");
    setShowChatCounterModal(true);
  };

  useEffect(() => {
    const handleOpenRequests = () => {
      setIsOpen(true);
      setSelectedConversation(null);
    };
    window.addEventListener("open-chat-requests", handleOpenRequests);
    return () => window.removeEventListener("open-chat-requests", handleOpenRequests);
  }, []);

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

    const itemValue = request.item.replacementValue || 50;

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

  // Requests that need the current user's action (highlighted at top)
  const needsActionRequests = requests.filter((r) => {
    const isOwner = r.item.ownerId === user?.id;
    const isRequester = r.requesterId === user?.id;
    if (isOwner && r.status === "PENDING") return true;
    if (r.negotiationStatus === "counter_proposed" && r.counterProposedBy !== user?.id) return true;
    if (isRequester && r.status === "ACCEPTED") return true;
    if (r.status === "RETURN_REQUESTED") return true;
    return false;
  });

  // All requests sorted: needs-action first, then others by recency
  const allRequestsSorted = [
    ...needsActionRequests,
    ...requests.filter((r) => !needsActionRequests.includes(r)),
  ];

  // Filter requests for the unified inbox list
  const filteredRequestItems = allRequestsSorted.filter((r) => {
    if (messageFilter === "all") return true;
    if (messageFilter === "unread") return needsActionRequests.includes(r);
    if (messageFilter === "lending") return r.requestType === "BORROW";
    if (messageFilter === "renting") return r.requestType === "RENT";
    if (messageFilter === "swapping") return r.requestType === "SWAP";
    if (messageFilter === "gifting") return r.requestType === "GIFT";
    return true;
  });

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
    const partnerId = isOwner ? request.requesterId : request.item.ownerId;
    const requesterName = formatDisplayName(request.requester.displayName || request.requester.username);

    // Counter-proposal state
    const iCounterPending = request.negotiationStatus === "counter_proposed";
    const iSentCounter = iCounterPending && request.counterProposedBy === user?.id;
    const iReceivedCounter = iCounterPending && request.counterProposedBy !== user?.id;

    // Effective terms to display (counter terms if pending, else original)
    const displayDelivery = iCounterPending
      ? (request.counterDeliveryMethod || request.deliveryMethod)
      : request.deliveryMethod;
    const displayDeposit = iCounterPending
      ? (request.counterDepositMethod || request.depositMethod)
      : request.depositMethod;
    const displayStart = iCounterPending ? request.counterStartDate : request.startDate;
    const displayEnd = iCounterPending ? request.counterEndDate : request.endDate;

    return (
      <div
        key={request.id}
        className={`p-3 border-b transition-colors ${iReceivedCounter ? "bg-amber-50 hover:bg-amber-100/70" : "hover:bg-gray-50"}`}
      >
        <button
          className="w-full text-left"
          onClick={() => setSelectedConversation(partnerId)}
        >
          {/* Status badge — top right only */}
          <div className="flex justify-end mb-1.5">
            {iSentCounter ? (
              <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-800">
                COUNTER SENT
              </Badge>
            ) : iReceivedCounter ? (
              <Badge className="text-[10px] px-1.5 py-0 bg-amber-500 text-white">
                COUNTER RECEIVED
              </Badge>
            ) : (
              <Badge className={`text-[10px] px-1.5 py-0 ${getStatusColor(request.status)}`}>
                {request.status.replace(/_/g, " ")}
              </Badge>
            )}
          </div>

          {/* Content: photo + info */}
          <div className="flex gap-2.5">
            <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
              {request.item.photos?.[0] ? (
                <img
                  src={request.item.photos[0]}
                  alt={request.item.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Package className="h-4 w-4 text-gray-400" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-sm truncate mb-0.5">{request.item.name}</h4>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                <User className="h-3 w-3 shrink-0" />
                {isOwner ? (
                  <span className="truncate">{requesterName} wants to {request.requestType.toLowerCase()}</span>
                ) : (
                  <span>You requested to {request.requestType.toLowerCase()}</span>
                )}
              </div>
              {displayStart && displayEnd && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span>{format(new Date(displayStart), "MMM d")} – {format(new Date(displayEnd), "MMM d")}</span>
                </div>
              )}
              {/* Delivery & deposit — below the date */}
              <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground mt-0.5">
                <span className={`flex items-center gap-0.5 ${iCounterPending ? "text-amber-700 font-medium" : ""}`}>
                  {displayDelivery === "courier"
                    ? <Truck className="h-3 w-3 text-blue-600" />
                    : <MapPin className="h-3 w-3 text-gray-500" />}
                  {displayDelivery === "courier" ? "Uber Direct" : "Exchange Item In Person"}
                </span>
                <span className={`flex items-center gap-0.5 ${iCounterPending ? "text-amber-700 font-medium" : ""}`}>
                  {displayDeposit === "in_app"
                    ? <Shield className="h-3 w-3 text-gray-500" />
                    : <MapPin className="h-3 w-3 text-gray-500" />}
                  {displayDeposit === "in_app" ? "Handle Deposit In-app" : "Exchange Deposit In Person"}
                </span>
              </div>
              {iSentCounter && (
                <p className="text-[10px] text-amber-700 mt-0.5 italic">Waiting for their response…</p>
              )}
            </div>
          </div>
        </button>

        {/* Action buttons */}
        <div className="flex gap-1.5 flex-wrap mt-2 pl-[58px]">
          {/* Counter received: inline Accept / Counter / Decline */}
          {iReceivedCounter && (
            <>
              <Button
                size="sm"
                className="h-7 text-xs bg-green-600 hover:bg-green-700"
                onClick={() => respondToCounterMutation.mutate({ requestId: request.id, accept: true })}
                disabled={respondToCounterMutation.isPending}
              >
                <CheckCircle className="h-3 w-3 mr-1" />
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-50"
                onClick={() => openChatCounter(request, isOwner ? "owner" : "requester")}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Counter
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => respondToCounterMutation.mutate({ requestId: request.id, accept: false })}
                disabled={respondToCounterMutation.isPending}
              >
                <XCircle className="h-3 w-3 mr-1" />
                Decline
              </Button>
            </>
          )}

              {/* Owner actions for pending requests (no active counter) */}
              {isOwner && request.status === "PENDING" && !iCounterPending && (
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
                    className="h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-50"
                    onClick={() => openChatCounter(request, "owner")}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Counter
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

              {/* Message button — always visible on active (post-PENDING) requests */}
              {!["PENDING", "DECLINED", "CANCELLED", "COMPLETED"].includes(request.status) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground hover:text-foreground ml-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedConversation(partnerId);
                  }}
                >
                  <MessageCircle className="h-3 w-3 mr-1" />
                  Message
                </Button>
              )}
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

          </div>

          {!selectedConversation ? (
            <>
              {/* Filter pills */}
              <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b">
                {[
                  { key: "all", label: "All" },
                  { key: "lending", label: "Lend" },
                  { key: "renting", label: "Rent" },
                  { key: "swapping", label: "Swap" },
                  { key: "gifting", label: "Gift" },
                  { key: "unread", label: "Action" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setMessageFilter(tab.key as MessageFilter)}
                    className={`px-2.5 py-1 rounded-full text-xs flex items-center gap-1 ${
                      messageFilter === tab.key
                        ? "bg-gray-800 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {tab.label}
                    {tab.key === "unread" && pendingRequestCount + totalUnread > 0 && (
                      <span className={`inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] rounded-full ${messageFilter === "unread" ? "bg-white/20" : "bg-amber-500 text-white"}`}>
                        {pendingRequestCount + totalUnread}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Unified inbox list */}
              <ScrollArea className="flex-1">
                {isLoadingRequests && filteredRequestItems.length === 0 && filteredConversations.length === 0 ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : filteredRequestItems.length === 0 && filteredConversations.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Nothing here yet</p>
                  </div>
                ) : (
                  <div>
                    {/* Requests section */}
                    {filteredRequestItems.length > 0 && (
                      <div>
                        <div className="px-3 py-1.5 bg-gray-50 border-b flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Requests</span>
                          {pendingRequestCount > 0 && (
                            <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] bg-amber-500 text-white rounded-full">
                              {pendingRequestCount} pending
                            </span>
                          )}
                        </div>
                        {filteredRequestItems.map(renderRequestCard)}
                      </div>
                    )}

                    {/* Conversations section */}
                    {filteredConversations.length > 0 && (
                      <div>
                        {filteredRequestItems.length > 0 && (
                          <div className="px-3 py-1.5 bg-gray-50 border-b">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Messages</span>
                          </div>
                        )}
                        <div className="divide-y">
                          {filteredConversations.map((conv) => (
                            <button
                              key={conv.userId}
                              onClick={() => {
                                setSelectedConversation(conv.userId);
                                if (conv.unreadCount > 0) {
                                  apiRequest("POST", `/api/messages/mark-read/${conv.userId}`)
                                    .then(() => {
                                      qc.invalidateQueries({ queryKey: ["/api/conversations"] });
                                    })
                                    .catch(() => {});
                                }
                              }}
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
                                  {conv.transactionType?.toUpperCase() === "BORROW" && "Lending"}
                                  {conv.transactionType?.toUpperCase() === "RENT" && "Renting"}
                                  {conv.transactionType?.toUpperCase() === "SWAP" && "Swapping"}
                                  {conv.transactionType?.toUpperCase() === "GIFT" && "Gifting"}
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
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>
            </>
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
                    )?.username ??
                    requests.find(
                      (r) =>
                        r.item.ownerId === user?.id &&
                        r.requesterId === selectedConversation,
                    )?.requester?.username
                  )}
                </span>
              </div>

              {isLoadingMessages ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <ScrollArea className="flex-1 p-3" ref={scrollRef}>
                  {messages.map((msg) => {
                    // System event messages render as centered cards
                    if (msg.messageType === "event") {
                      const et = msg.metadata?.eventType;
                      const isCounterPending = et === "counter_proposed";
                      // Find the related request so we can show inline actions
                      const relatedRequest = msg.requestId
                        ? requests.find((r) => r.id === msg.requestId)
                        : null;
                      // Who needs to respond? The counterProposedBy will be the sender;
                      // the receiver is the responder. If current user is the receiver, show buttons.
                      const iAmResponder = relatedRequest &&
                        isCounterPending &&
                        relatedRequest.counterProposedBy !== null &&
                        relatedRequest.counterProposedBy !== user.id &&
                        relatedRequest.negotiationStatus === "counter_proposed";
                      const iAmOwner = relatedRequest && relatedRequest.item.ownerId === user.id;

                      return (
                        <div key={msg.id} className="mb-3 flex justify-center">
                          <div className={`w-full max-w-[90%] rounded-xl border px-4 py-3 text-sm ${
                            et === "counter_proposed" ? "bg-amber-50 border-amber-200" :
                            et === "terms_accepted" ? "bg-green-50 border-green-200" :
                            et === "request_accepted" ? "bg-green-50 border-green-200" :
                            et === "terms_declined" || et === "request_declined" ? "bg-red-50 border-red-200" :
                            "bg-gray-50 border-gray-200"
                          }`}>
                            <div className="flex items-center gap-2 mb-1">
                              {et === "counter_proposed" && <RefreshCw className="h-3.5 w-3.5 text-amber-600" />}
                              {(et === "terms_accepted" || et === "request_accepted") && <CheckCircle className="h-3.5 w-3.5 text-green-600" />}
                              {(et === "terms_declined" || et === "request_declined") && <XCircle className="h-3.5 w-3.5 text-red-600" />}
                              <span className={`font-medium text-xs ${
                                et === "counter_proposed" ? "text-amber-800" :
                                et === "terms_accepted" || et === "request_accepted" ? "text-green-800" :
                                "text-red-800"
                              }`}>
                                {et === "counter_proposed" && (msg.senderId === user.id ? "You proposed new terms" : "New terms proposed")}
                                {et === "terms_accepted" && (msg.senderId === user.id ? "You accepted the terms" : "Terms accepted")}
                                {et === "terms_declined" && (msg.senderId === user.id ? "You declined the terms" : "Terms declined")}
                                {et === "request_accepted" && (msg.senderId === user.id ? "You accepted the request" : "Request accepted")}
                                {et === "request_declined" && (msg.senderId === user.id ? "You declined the request" : "Request declined")}
                              </span>
                              <span className="ml-auto text-[10px] text-muted-foreground">
                                {new Date(msg.createdAt).toLocaleTimeString()}
                              </span>
                            </div>

                            {et === "counter_proposed" && (
                              <div className="flex flex-wrap gap-1.5 mt-1.5 mb-2">
                                {msg.metadata?.deliveryMethod && (
                                  <Badge variant="outline" className="text-xs border-amber-300">
                                    <Truck className="h-3 w-3 mr-1" />
                                    {msg.metadata.deliveryMethod === "courier" ? "Uber delivery" : "In-person pickup"}
                                  </Badge>
                                )}
                                {msg.metadata?.depositMethod && (
                                  <Badge variant="outline" className="text-xs border-amber-300">
                                    <CreditCard className="h-3 w-3 mr-1" />
                                    {msg.metadata.depositMethod === "in_app" ? "Handle Deposit In-app" : "Exchange Deposit In Person"}
                                  </Badge>
                                )}
                                {msg.metadata?.startDate && msg.metadata?.endDate && (
                                  <Badge variant="outline" className="text-xs border-amber-300">
                                    <Clock className="h-3 w-3 mr-1" />
                                    {format(new Date(msg.metadata.startDate), "MMM d")} – {format(new Date(msg.metadata.endDate), "MMM d")}
                                  </Badge>
                                )}
                              </div>
                            )}

                            {iAmResponder && relatedRequest && (
                              <div className="flex gap-2 mt-2 flex-wrap">
                                <Button
                                  size="sm"
                                  className="h-7 text-xs bg-green-600 hover:bg-green-700"
                                  onClick={() => respondToCounterMutation.mutate({ requestId: relatedRequest.id, accept: true })}
                                  disabled={respondToCounterMutation.isPending}
                                >
                                  <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                  Accept
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs border-amber-400 text-amber-700"
                                  onClick={() => openChatCounter(relatedRequest, iAmOwner ? "owner" : "requester")}
                                >
                                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                                  Counter
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => respondToCounterMutation.mutate({ requestId: relatedRequest.id, accept: false })}
                                  disabled={respondToCounterMutation.isPending}
                                >
                                  <XCircle className="h-3.5 w-3.5 mr-1" />
                                  Decline
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // System notice (e.g. post-acceptance coordination prompt)
                    if (msg.messageType === "system") {
                      return (
                        <div key={msg.id} className="mb-3 flex justify-center">
                          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-xs text-blue-800 text-center max-w-[90%] leading-snug">
                            {msg.content}
                          </div>
                        </div>
                      );
                    }

                    // Regular text message
                    return (
                      <div
                        key={msg.id}
                        className={`mb-2 flex ${
                          msg.senderId === user.id ? "justify-end" : "justify-start"
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
                    );
                  })}
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
          itemValue={requests.find((r) => r.id === selectedRequestId)?.item.replacementValue || 50}
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
            replacementValue: selectedRequest.item.replacementValue || 100,
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

      {/* Chat Counter-Proposal Modal */}
      <Dialog open={showChatCounterModal} onOpenChange={setShowChatCounterModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-amber-500" />
              Propose New Terms
            </DialogTitle>
            <DialogDescription>
              Suggest changes to delivery, deposit, or dates. The other party can accept, decline, or counter again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-4">
            {chatCounterRequest?.requestType === "BORROW" && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">Deposit Preference</Label>
                <RadioGroup value={chatProposedDeposit} onValueChange={setChatProposedDeposit}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="in_app" id="cc-deposit-inapp" />
                    <Label htmlFor="cc-deposit-inapp" className="font-normal cursor-pointer">Handle Deposit In-app</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="in_person" id="cc-deposit-inperson" />
                    <Label htmlFor="cc-deposit-inperson" className="font-normal cursor-pointer">Exchange Deposit In Person</Label>
                  </div>
                </RadioGroup>
              </div>
            )}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Delivery Preference</Label>
              <RadioGroup value={chatProposedDelivery} onValueChange={setChatProposedDelivery}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="in_person" id="cc-delivery-pickup" />
                  <Label htmlFor="cc-delivery-pickup" className="font-normal cursor-pointer">Exchange Item In Person</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="courier" id="cc-delivery-courier" />
                  <Label htmlFor="cc-delivery-courier" className="font-normal cursor-pointer">Uber Direct</Label>
                </div>
              </RadioGroup>
            </div>
            {(chatCounterRequest?.requestType === "BORROW" || chatCounterRequest?.requestType === "RENT") && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">Date Range</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Start</Label>
                    <Input type="date" value={chatProposedStart} onChange={(e) => setChatProposedStart(e.target.value)} min={new Date().toISOString().split("T")[0]} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">End</Label>
                    <Input type="date" value={chatProposedEnd} onChange={(e) => setChatProposedEnd(e.target.value)} min={chatProposedStart || new Date().toISOString().split("T")[0]} />
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowChatCounterModal(false)}>Cancel</Button>
            <Button
              onClick={() => chatCounterRequest && chatCounterMutation.mutate({
                requestId: chatCounterRequest.id,
                deliveryMethod: chatProposedDelivery,
                depositMethod: chatProposedDeposit,
                startDate: chatProposedStart || undefined,
                endDate: chatProposedEnd || undefined,
                isResponse: chatCounterRole === "requester",
              })}
              disabled={chatCounterMutation.isPending}
              className="bg-amber-500 hover:bg-amber-600"
            >
              {chatCounterMutation.isPending ? "Sending..." : "Send Counter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
