import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
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
  Star,
  BadgeCheck,
  Circle,
  KeyRound,
  Zap,
  Coins,
  ArrowLeftRight,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { calculateSecurityDeposit } from "@/lib/deposit-calculator";
import { getTierShareCoins, calculateMultiSwap } from "@/lib/swap-calculator";
import { TrustDepositModal } from "@/components/borrow/trust-deposit-modal";
import { RentalDepositModal } from "@/components/rental/rental-deposit-modal";
import { HandoffConfirmationModal } from "@/components/borrow/handoff-confirmation-modal";
import { ReturnConfirmationModal } from "@/components/borrow/return-confirmation-modal";
import { PostReturnReviewModal } from "@/components/borrow/post-return-review-modal";
import { CelebrationAnimation } from "@/components/celebration-animation";
import { SwapCounterModal } from "@/components/swap-counter-modal";
import { CourierHandoffModal } from "@/components/courier-handoff-modal";
import { InsufficientShareCoinsModal } from "@/components/borrow/insufficient-sharecoins-modal";
import { SiUber } from "react-icons/si";
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

type InboxItem = {
  requestId: number;
  partnerId: number;
  partnerUsername: string;
  partnerDisplayName: string | null;
  partnerPhoto: string | null;
  partnerIsVerified: boolean;
  partnerLastActiveAt: string | null;
  partnerActiveStatus: string | null;
  partnerResponseTime: string | null;
  lastActivityTime: string;
  preview: string;
  previewType: "message" | "request";
  previewSentByMe: boolean | null;
  unreadCount: number;
  requestType: string;
  requestStatus: string;
  requestNegotiationStatus: string | null;
  itemName: string;
  itemId: number;
  itemPhoto: string | null;
  iAmRequester: boolean;
  isArchived: boolean;
};

type PublicProfile = {
  id: number;
  username: string;
  handle: string | null;
  displayName: string | null;
  profilePhoto: string | null;
  isVerified: boolean;
  reputationScore: number;
  lastActiveAt: string | null;
  bio: string | null;
  location: string | null;
  reviewCount: number;
  averageRating: number | null;
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

// Parse a date-only string (YYYY-MM-DD or ISO) as local midnight to avoid UTC-shift.
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("T")[0].split("-").map(Number);
  return new Date(y, m - 1, d);
}

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
  ownerConfirmedHandoff: boolean | null;
  borrowerConfirmedHandoff: boolean | null;
  returnDisputeTriggered: boolean | null;
  negotiationStatus: string | null;
  counterDeliveryMethod: string | null;
  counterDepositMethod: string | null;
  counterStartDate: string | null;
  counterEndDate: string | null;
  counterProposedBy: number | null;
  swapOfferedItemIds: number[] | null;
  swapOfferedItems?: { id: number; name: string; photos: string[]; tier?: number | null }[];
  counterSwapOwnerItemIds: number[] | null;
  counterSwapRequesterItemIds: number[] | null;
  counterSwapOwnerItems?: { id: number; name: string; photos: string[]; tier?: number | null }[];
  counterSwapRequesterItems?: { id: number; name: string; photos: string[]; tier?: number | null }[];
  counterNote: string | null;
  counterRound: number | null;
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
  owner: {
    username: string | null;
    displayName: string | null;
  };
}

type MessageFilter =
  | "all"
  | "lending"
  | "renting"
  | "swapping"
  | "gifting"
  | "unread"
  | "archived";

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
  const [, navigate] = useLocation();

  const [isOpen, setIsOpen] = useState(false);
  const [pendingResend, setPendingResend] = useState<{
    itemId: number;
    requestType: string;
    startDate?: string | null;
    endDate?: string | null;
    deliveryMethod?: string | null;
    depositMethod?: string | null;
  } | null>(null);
  const [messageFilter, setMessageFilter] = useState<MessageFilter>("all");
  const [selectedConversation, setSelectedConversation] = useState<
    number | null
  >(null);
  const [activeConversationRequestId, setActiveConversationRequestId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const scrollToCounterRef = useRef(false);

  // Request handling state
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(
    null,
  );
  const [showCelebration, setShowCelebration] = useState(false);
  const [depositClientSecret, setDepositClientSecret] = useState<string | null>(
    null,
  );
  const [pendingDeliveryData, setPendingDeliveryData] = useState<any>(null);
  const [showTrustDepositModal, setShowTrustDepositModal] = useState(false);
  const [showRentalDepositModal, setShowRentalDepositModal] = useState(false);
  const [showCourierHandoffModal, setShowCourierHandoffModal] = useState(false);
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showReviewPrompt, setShowReviewPrompt] = useState(false);
  const [reviewForRequest, setReviewForRequest] = useState<ItemRequest | null>(null);
  const [showSwapInventoryPrompt, setShowSwapInventoryPrompt] = useState(false);
  const [swapInventoryItem, setSwapInventoryItem] = useState<ItemRequest["item"] | null>(null);
  const [showProofInput, setShowProofInput] = useState(false);
  const [proofText, setProofText] = useState("");
  const [showAutoReport, setShowAutoReport] = useState(false);
  const [autoReportText, setAutoReportText] = useState("");
  const [ownerPinRevealed, setOwnerPinRevealed] = useState(false);
  const [ownerPinValue, setOwnerPinValue] = useState<string | null>(null);
  const [ownerPinExpired, setOwnerPinExpired] = useState(false);
  const [ownerPinUsed, setOwnerPinUsed] = useState(false);
  const [ownerPinLoading, setOwnerPinLoading] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ItemRequest | null>(
    null,
  );

  // Cancel request state
  const [cancelConfirmRequest, setCancelConfirmRequest] = useState<ItemRequest | null>(null);

  // Counter-proposal state (for inline chat actions)
  const [showChatCounterModal, setShowChatCounterModal] = useState(false);
  const [chatCounterRequest, setChatCounterRequest] = useState<ItemRequest | null>(null);
  const [chatCounterRole, setChatCounterRole] = useState<"owner" | "requester">("requester");
  const [chatProposedDeposit, setChatProposedDeposit] = useState("in_app");
  const [chatProposedStart, setChatProposedStart] = useState("");
  const [chatProposedEnd, setChatProposedEnd] = useState("");

  // Insufficient ShareCoins gate (for deposit step after counter-proposal)
  const [showInsufficientCoinsModal, setShowInsufficientCoinsModal] = useState(false);
  const [insufficientCoinsRequired, setInsufficientCoinsRequired] = useState(0);

  // Swap counter modal state
  const [showSwapCounterModal, setShowSwapCounterModal] = useState(false);
  const [swapCounterRequest, setSwapCounterRequest] = useState<ItemRequest | null>(null);
  const [swapCounterIsOwner, setSwapCounterIsOwner] = useState(false);

  // Play a soft chime for incoming messages
  const playMessageSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const now = ctx.currentTime;

      const notes = [
        { freq: 880, start: 0, duration: 0.18 },
        { freq: 1108.73, start: 0.12, duration: 0.22 },
      ];

      notes.forEach(({ freq, start, duration }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + start);
        gain.gain.setValueAtTime(0, now + start);
        gain.gain.linearRampToValueAtTime(0.18, now + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
        osc.start(now + start);
        osc.stop(now + start + duration);
      });

      setTimeout(() => ctx.close(), 800);
    } catch {}
  };

  // WebSocket setup
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const wsUrl = `${protocol}//${host}/ws/chat`;

  const { isConnected, send } = useWebSocket({
    url: wsUrl,
    onMessage: (data) => {
      if (data.type === "new_message") {
        // Only play sound for messages from other users
        if (data.message?.senderId && data.message.senderId !== user?.id) {
          playMessageSound();
        }
        // Refresh inbox list
        queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
        // Refresh requests so status changes (e.g. PENDING → ACCEPTED) appear immediately
        // without the user needing to manually refresh the page.
        queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
        // Immediately refetch the currently-open thread so new message appears without refresh
        queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
        queryClient.refetchQueries({
          queryKey: ["/api/messages", selectedConversation, activeConversationRequestId],
          exact: true,
          type: "active",
        });
      }
      if (data.type === "new_notification") {
        // Immediately refresh the notification bell and list without waiting for the 30s poll
        queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      }
    },
    autoConnect: !!user,
  });

  // Fetch conversations (still needed for chat view context)
  const { data: allConversations = [] } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    enabled: !!user,
  });

  // Unified inbox — one entry per request, active threads only
  const { data: inboxItems = [], isLoading: isLoadingInbox } = useQuery<InboxItem[]>({
    queryKey: ["/api/inbox"],
    enabled: !!user,
    refetchInterval: 30_000,
  });

  // Archived inbox — completed / cancelled / declined threads
  const { data: archivedInboxItems = [], isLoading: isLoadingArchived } = useQuery<InboxItem[]>({
    queryKey: ["/api/inbox", "archived"],
    queryFn: () => fetch("/api/inbox?archived=true", { credentials: "include" }).then(r => r.json()),
    enabled: !!user && messageFilter === "archived",
    refetchInterval: 60_000,
  });

  // Partner public profile for chat header
  const { data: partnerProfile } = useQuery<PublicProfile>({
    queryKey: ["/api/users", selectedConversation, "public-profile"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${selectedConversation}/public-profile`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch profile");
      return res.json();
    },
    enabled: !!selectedConversation,
  });

  // Fetch requests — poll every 20s as a safety net for WebSocket drops
  const { data: requests = [] } = useQuery<ItemRequest[]>({
    queryKey: ["/api/requests"],
    enabled: !!user,
    refetchInterval: 20_000,
  });

  // Detect when a request transitions to COMPLETED → prompt review
  const prevReqStatusesRef = useRef<Record<number, string>>({});
  useEffect(() => {
    if (!user || !requests.length) return;
    const prev = prevReqStatusesRef.current;
    for (const req of requests) {
      const was = prev[req.id];
      const isNowDone = req.status === "COMPLETED" || req.status === "COMPLETED_EARLY";
      const wasDone = was === "COMPLETED" || was === "COMPLETED_EARLY";
      if (!was || wasDone || !isNowDone) continue;
      const isOwner     = req.item.ownerId === user.id;
      const isRequester = req.requesterId === user.id;
      const isBothSides = req.requestType === "SWAP" || req.requestType === "GIFT";
      // For BORROW/RENT the owner already rated condition in the confirm-return modal — skip the review popup for them.
      // For SWAP/GIFT there's no condition step so both sides get the review prompt.
      const shouldPrompt = isBothSides
        ? isOwner || isRequester
        : isRequester; // borrower/renter gets the prompt; lender/owner does not
      if (shouldPrompt && !showReviewPrompt) {
        setReviewForRequest(req);
        setShowReviewPrompt(true);
        // For SWAP requester: offer to add the received item to inventory
        if (req.requestType === "SWAP" && isRequester) {
          setSwapInventoryItem(req.item);
          setShowSwapInventoryPrompt(true);
        }
        break;
      }
    }
    const next: Record<number, string> = {};
    for (const req of requests) next[req.id] = req.status;
    prevReqStatusesRef.current = next;
  }, [requests]);

  // Fetch messages for selected conversation, scoped to the active request
  const { data: messages = [], isLoading: isLoadingMessages } = useQuery<
    Message[]
  >({
    queryKey: ["/api/messages", selectedConversation, activeConversationRequestId],
    queryFn: async () => {
      const url = activeConversationRequestId
        ? `/api/messages/${selectedConversation}?requestId=${activeConversationRequestId}`
        : `/api/messages/${selectedConversation}`;
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 401) return []; // session expired — silently return empty until user refreshes
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
    enabled: !!selectedConversation && !!user,
    refetchOnMount: "always",
    staleTime: 0,
    refetchInterval: 10_000, // Poll every 10s when a conversation is open as WebSocket fallback
  });

  // Request mutations
  const acceptMutation = useMutation({
    mutationFn: async (requestId: number) => {
      const response = await apiRequest("PATCH", `/api/requests/${requestId}`, {
        status: "ACCEPTED",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to accept request");
      }
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      qc.invalidateQueries({ queryKey: ["/api/inbox"] });
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
      qc.invalidateQueries({ queryKey: ["/api/inbox"] });
      qc.invalidateQueries({ queryKey: ["/api/items"] });
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
      qc.invalidateQueries({ queryKey: ["/api/inbox"] });
      qc.invalidateQueries({ queryKey: ["/api/messages", selectedConversation, activeConversationRequestId] });
      if (vars.accept && data.ownerAccepted) {
        // Owner fully accepted via counter path — anchor selectedRequestId so
        // handleScheduleClick can read the correct startDate for the auto-reply.
        setSelectedRequestId(vars.requestId);
        setShowCelebration(true);
      } else {
        toast({
          title: vars.accept ? "Terms Accepted" : "Request Cancelled",
          description: data.message,
        });
      }
    },
  });

  const confirmGiftHandoffMutation = useMutation({
    mutationFn: async ({ requestId, role }: { requestId: number; role: "giver" | "receiver" }) => {
      const res = await apiRequest("POST", `/api/requests/${requestId}/confirm-gift-handoff`, { role });
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      qc.invalidateQueries({ queryKey: ["/api/inbox"] });
      // Refresh user so coin balance updates and coin animation fires
      qc.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: data.completed ? "Gift completed! 🎁" : "Confirmed!", description: data.message || "Waiting for the other party to confirm." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Could not confirm handoff", variant: "destructive" });
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: async (requestId: number) => {
      const res = await apiRequest("POST", `/api/requests/${requestId}/withdraw`, {});
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      qc.invalidateQueries({ queryKey: ["/api/inbox"] });
      if (data.prefill) setPendingResend(data.prefill);
      toast({ title: "Offer withdrawn", description: "Fix the terms and resend whenever you're ready." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Could not withdraw offer", variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (requestId: number) => {
      const res = await apiRequest("POST", `/api/requests/${requestId}/cancel`, {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      qc.invalidateQueries({ queryKey: ["/api/inbox"] });
      qc.invalidateQueries({ queryKey: ["/api/items"] });
      setCancelConfirmRequest(null);
      toast({ title: "Request cancelled", description: "The booking has been cancelled." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Could not cancel request", variant: "destructive" });
    },
  });

  const reportAutoHandoffMutation = useMutation({
    mutationFn: async ({ requestId, description }: { requestId: number; description: string }) => {
      const res = await apiRequest("POST", `/api/requests/${requestId}/deny-handoff`, { description });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      qc.invalidateQueries({ queryKey: ["/api/inbox"] });
      qc.invalidateQueries({ queryKey: ["/api/messages", selectedConversation, activeConversationRequestId] });
      setShowAutoReport(false);
      setAutoReportText("");
      toast({ title: "Issue reported", description: "We've opened a dispute. Both parties have 24 hours to submit evidence.", variant: "destructive" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to report issue", variant: "destructive" });
    },
  });

  const submitProofMutation = useMutation({
    mutationFn: async ({ requestId, proofText }: { requestId: number; proofText: string }) => {
      const res = await apiRequest("POST", `/api/requests/${requestId}/handoff-dispute-proof`, { proofText });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      qc.invalidateQueries({ queryKey: ["/api/messages", selectedConversation, activeConversationRequestId] });
      setShowProofInput(false);
      setProofText("");
      toast({ title: "Proof submitted", description: "We'll review both sides and get back to you shortly." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to submit proof", variant: "destructive" });
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
      qc.invalidateQueries({ queryKey: ["/api/inbox"] });
      qc.invalidateQueries({ queryKey: ["/api/messages", selectedConversation, activeConversationRequestId] });
      setShowChatCounterModal(false);
      setChatCounterRequest(null);
      toast({ title: "Counter Sent", description: "The other party will be notified." });
    },
  });

  const swapCounterMutation = useMutation({
    mutationFn: async ({ requestId, swapOwnerItemIds, swapRequesterItemIds, counterNote, isResponse }: {
      requestId: number;
      swapOwnerItemIds: number[];
      swapRequesterItemIds: number[];
      counterNote: string;
      isResponse: boolean;
    }) => {
      const endpoint = isResponse
        ? `/api/requests/${requestId}/respond-to-counter`
        : `/api/requests/${requestId}/counter-proposal`;
      const body = isResponse
        ? { counter: { swapOwnerItemIds, swapRequesterItemIds, counterNote } }
        : { swapOwnerItemIds, swapRequesterItemIds, counterNote };
      const res = await apiRequest("POST", endpoint, body);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      qc.invalidateQueries({ queryKey: ["/api/inbox"] });
      qc.invalidateQueries({ queryKey: ["/api/messages", selectedConversation, activeConversationRequestId] });
      setShowSwapCounterModal(false);
      setSwapCounterRequest(null);
      toast({ title: "Swap Counter Sent", description: "The other party will be notified." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "Could not send counter", variant: "destructive" });
    },
  });

  const initiateReturnMutation = useMutation({
    mutationFn: async (requestId: number) => {
      const res = await apiRequest("POST", `/api/requests/${requestId}/return`, {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      qc.invalidateQueries({ queryKey: ["/api/messages"] });
      toast({ title: "Return confirmed", description: "Waiting for the owner to confirm the item has been received." });
    },
    onError: () => { toast({ title: "Error", description: "Could not confirm return", variant: "destructive" }); },
  });

  const handleAddSwapItemToInventory = () => {
    if (!swapInventoryItem) return;
    sessionStorage.setItem(
      "shareswap_swap_prefill",
      JSON.stringify({
        name: swapInventoryItem.name,
        description: swapInventoryItem.description || "",
        originalValue: swapInventoryItem.originalValue || "",
        condition: swapInventoryItem.condition || "",
        photos: swapInventoryItem.photos || [],
      }),
    );
    setShowSwapInventoryPrompt(false);
    navigate("/lend");
  };

  const openChatCounter = (request: ItemRequest, role: "owner" | "requester") => {
    // SWAP requests get a dedicated item-picker modal
    if (request.requestType === "SWAP") {
      setSwapCounterRequest(request);
      setSwapCounterIsOwner(role === "owner");
      setShowSwapCounterModal(true);
      return;
    }
    setChatCounterRequest(request);
    setChatCounterRole(role);
    const d = request.counterDeliveryMethod || request.deliveryMethod || "in_person";
    const dep = request.counterDepositMethod || request.depositMethod || "in_app";
    const sd = request.counterStartDate || request.startDate;
    const ed = request.counterEndDate || request.endDate;
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

  // Open directly to a specific request conversation from a notification click
  useEffect(() => {
    const handleOpenChatRequest = (e: Event) => {
      const { requestId, scrollToCounter } = (e as CustomEvent<{ requestId: number; scrollToCounter?: boolean }>).detail;
      scrollToCounterRef.current = scrollToCounter ?? false;
      setIsOpen(true);
      const found = inboxItems.find((item) => item.requestId === requestId);
      if (found) {
        setSelectedConversation(found.partnerId);
        setActiveConversationRequestId(requestId);
      } else {
        // Inbox may not have loaded yet — show the list so the user can find it
        setSelectedConversation(null);
      }
    };
    window.addEventListener("open-chat-request", handleOpenChatRequest);
    return () => window.removeEventListener("open-chat-request", handleOpenChatRequest);
  }, [inboxItems]);

  // Scroll to bottom when messages load or conversation switches.
  // If a counter-proposal notification was clicked, scroll to the last counter event instead.
  useEffect(() => {
    if (scrollToCounterRef.current && messages.length > 0) {
      scrollToCounterRef.current = false;
      const counterEls = document.querySelectorAll('[data-event-type="counter_proposed"]');
      if (counterEls.length > 0) {
        counterEls[counterEls.length - 1].scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ block: "end" });
    }
  }, [messages, selectedConversation]);

  // Early return AFTER all hooks to avoid Rules of Hooks violation
  if (!user) return null;

  // --- Helpers ---

  const getActiveStatus = (lastActiveAt: string | null): { label: string; color: string } | null => {
    if (!lastActiveAt) return null;
    const diff = Date.now() - new Date(lastActiveAt).getTime();
    const min = diff / 60_000;
    const hrs = diff / 3_600_000;
    const days = diff / 86_400_000;
    if (min < 10) return { label: "Active now", color: "text-green-600" };
    if (hrs < 24) return { label: "Active today", color: "text-green-500" };
    if (days < 7) return { label: "Active this week", color: "text-amber-600" };
    if (days < 30) return { label: "Active this month", color: "text-gray-500" };
    return { label: "Inactive", color: "text-gray-400" };
  };

  const getPartnerInitials = (displayName: string | null, username: string): string => {
    const name = displayName || username;
    return name.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  };

  const getRequestTypeLabel = (type: string | null): string => {
    switch (type?.toUpperCase()) {
      case "BORROW": return "Lending";
      case "RENT": return "Renting";
      case "SWAP": return "Swapping";
      case "GIFT": return "Gifting";
      default: return type || "";
    }
  };

  const getRequestStatusLabel = (status: string | null, negotiationStatus: string | null, iAmRequester: boolean, inboxItem: InboxItem): string => {
    if (negotiationStatus === "counter_proposed") {
      const iSent = inboxItem.requestType != null; // we check counterProposedBy server-side already
      return "Counter offer pending";
    }
    switch (status) {
      case "PENDING": return iAmRequester ? "Waiting for response" : "Needs your response";
      case "ACCEPTED": return "Accepted";
      case "DEPOSIT_CONFIRMED": return "Deposit confirmed";
      case "IN_PROGRESS": return "In progress";
      case "RETURN_REQUESTED": return "Return requested";
      case "COMPLETED": return "Completed";
      case "DECLINED": return "Declined";
      case "AWAITING_HANDOFF_CONFIRM": return "Awaiting handoff";
      case "HANDOFF_DISPUTED": return "Disputed";
      case "DISPUTED": return "Damage dispute";
      case "HANDOFF_FLAGGED": return "Flagged for review";
      default: return status || "";
    }
  };

  // Filter inbox items based on active pill
  // The source list depends on the active filter tab
  const baseInboxItems = messageFilter === "archived" ? archivedInboxItems : inboxItems;

  const filteredInboxItems = baseInboxItems.filter((item) => {
    if (messageFilter === "all" || messageFilter === "archived") return true;
    if (messageFilter === "unread") {
      const needsAction =
        item.unreadCount > 0 ||
        (item.requestStatus === "PENDING" && !item.iAmRequester) ||
        (item.requestNegotiationStatus === "counter_proposed");
      return needsAction;
    }
    if (messageFilter === "lending") return item.requestType === "BORROW";
    if (messageFilter === "renting") return item.requestType === "RENT";
    if (messageFilter === "swapping") return item.requestType === "SWAP";
    if (messageFilter === "gifting") return item.requestType === "GIFT";
    return true;
  });

  const openConversationWithPartner = (partnerId: number, requestId: number, unreadCount: number) => {
    setSelectedConversation(partnerId);
    setActiveConversationRequestId(requestId);
    if (unreadCount > 0) {
      apiRequest("POST", `/api/messages/mark-read/${partnerId}`, { requestId })
        .then(() => {
          qc.invalidateQueries({ queryKey: ["/api/conversations"] });
          qc.invalidateQueries({ queryKey: ["/api/inbox"] });
        })
        .catch(() => {});
    }
  };

  const handleSendMessage = async () => {
    if (!message.trim() || !selectedConversation) return;

    try {
      const response = await apiRequest("POST", "/api/messages", {
        receiverId: selectedConversation,
        content: message,
        requestId: activeConversationRequestId,
      });

      setMessage("");
      // Immediately update sender's view — receiver is notified by the HTTP handler via WebSocket
      queryClient.invalidateQueries({
        queryKey: ["/api/messages", selectedConversation, activeConversationRequestId],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    } catch (error: any) {
      console.error("Failed to send message:", error);
      const status = error?.status ?? 0;
      if (status === 401) {
        toast({
          title: "Session expired",
          description: "Please refresh the page to sign back in.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Couldn't send message", description: "Please try again.", variant: "destructive" });
      }
    }
  };

  const sendScheduleMessage = async (requestId: number, conversationUserId: number, convRequestId: number) => {
    const acceptedRequest = requests.find((r) => r.id === requestId);
    const isGiftRequest = acceptedRequest?.requestType === "GIFT";
    const isSwapRequest = acceptedRequest?.requestType === "SWAP";
    const startDateRaw = acceptedRequest?.startDate;
    const dateText = startDateRaw
      ? format(parseLocalDate(startDateRaw), "MMMM do")
      : format(new Date(), "MMMM do");
    const scheduleMsg = (isGiftRequest || isSwapRequest)
      ? "When and where can you meet?"
      : `When and where can you meet on ${dateText}?`;
    try {
      await apiRequest("POST", "/api/messages", {
        receiverId: conversationUserId,
        content: scheduleMsg,
        requestId: convRequestId,
      });
      qc.invalidateQueries({ queryKey: ["/api/messages", conversationUserId, convRequestId] });
      qc.invalidateQueries({ queryKey: ["/api/inbox"] });
    } catch (error) {
      console.error("Failed to send schedule message:", error);
    }
  };

  const handleScheduleClick = async () => {
    setShowCelebration(false);
    if (selectedRequestId && selectedConversation && activeConversationRequestId) {
      await sendScheduleMessage(selectedRequestId, selectedConversation, activeConversationRequestId);
    }
    setTimeout(() => messageInputRef.current?.focus(), 350);
  };

  const handleAcceptClick = async (request: ItemRequest) => {
    setSelectedRequestId(request.id);
    // Ensure conversation context is set so the celebration auto-reply works regardless
    // of whether the owner clicked Accept from the list panel or from inside a conversation.
    const partnerId = request.item.ownerId === user?.id ? request.requesterId : request.item.ownerId;
    setSelectedConversation(partnerId);
    setActiveConversationRequestId(request.id);
    // Delivery & deposit were already chosen by the requester — accept directly without re-asking.
    // For BORROW/RENT, create the delivery arrangement from the request's existing terms first.
    if (request.requestType === "BORROW" || request.requestType === "RENT") {
      try {
        await apiRequest("POST", "/api/delivery-arrangements", {
          requestId: request.id,
          deliveryMethod: request.deliveryMethod || "in_person",
          depositMethod: request.depositMethod || "in_app",
          depositAmount: request.item.replacementValue || 50,
        });
      } catch (_) {
        // Arrangement may already exist — continue to accept
      }
    }
    acceptMutation.mutate(request.id);
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


  const totalUnread = inboxItems.reduce((sum, item) => sum + item.unreadCount, 0);
  const pendingRequestCount = inboxItems.filter(
    (item) => item.requestStatus === "PENDING" && !item.iAmRequester
  ).length;
  const actionCount = inboxItems.filter((item) => {
    return (
      item.unreadCount > 0 ||
      (item.requestStatus === "PENDING" && !item.iAmRequester) ||
      item.requestNegotiationStatus === "counter_proposed"
    );
  }).length;
  const totalBadge = totalUnread + pendingRequestCount;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "PENDING":
        return "bg-amber-100 text-amber-800";
      case "ACCEPTED":
        return "bg-green-100 text-green-800";
      case "DEPOSIT_CONFIRMED":
        return "bg-teal-100 text-teal-800";
      case "IN_PROGRESS":
        return "bg-blue-100 text-blue-800";
      case "RETURN_REQUESTED":
        return "bg-purple-100 text-purple-800";
      case "DECLINED":
        return "bg-red-100 text-red-800";
      case "AWAITING_HANDOFF_CONFIRM":
        return "bg-indigo-100 text-indigo-800";
      case "HANDOFF_DISPUTED":
        return "bg-red-100 text-red-800";
      case "DISPUTED":
        return "bg-red-100 text-red-800";
      case "HANDOFF_FLAGGED":
        return "bg-orange-100 text-orange-800";
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
    // Terms accepted by requester — owner still needs to formally confirm
    const iTermsAccepted = request.negotiationStatus === "terms_accepted" && request.status === "PENDING";

    // Show the most recent counter terms when one is pending; otherwise show base request terms.
    // After acceptance the counter dates are promoted into startDate/endDate so those remain correct.
    const displayDeposit = iCounterPending
      ? (request.counterDepositMethod ?? request.depositMethod)
      : request.depositMethod;
    const displayStart = iCounterPending
      ? (request.counterStartDate ?? request.startDate)
      : request.startDate;
    const displayEnd = iCounterPending
      ? (request.counterEndDate ?? request.endDate)
      : request.endDate;

    // No field-level highlighting in the card — counter diff is shown in the chat event
    const dateChanged = false;
    const depositChanged = false;

    return (
      <div
        key={request.id}
        className={`p-3 border-b transition-colors ${iReceivedCounter ? "bg-amber-50 hover:bg-amber-100/70" : iTermsAccepted && isOwner ? "bg-green-50 hover:bg-green-100/70" : request.status === "AWAITING_HANDOFF_CONFIRM" ? "" : "hover:bg-gray-50"}`}
      >
        <button
          className="w-full text-left"
          onClick={() => { setSelectedConversation(partnerId); setActiveConversationRequestId(request.id); }}
        >
          {/* Status badge — top right only */}
          <div className="flex justify-end mb-1.5">
            {iSentCounter ? (
              <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-800 pointer-events-none">
                COUNTER SENT
              </Badge>
            ) : iReceivedCounter ? (
              <Badge className="text-[10px] px-1.5 py-0 bg-amber-500 text-white pointer-events-none">
                COUNTER RECEIVED
              </Badge>
            ) : iTermsAccepted ? (
              <Badge className="text-[10px] px-1.5 py-0 bg-green-100 text-green-800 pointer-events-none">
                TERMS AGREED
              </Badge>
            ) : (
              <Badge className={`text-[10px] px-1.5 py-0 pointer-events-none ${getStatusColor(request.status)}`}>
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
                  <span className="truncate">{requesterName} wants to {request.requestType === "GIFT" ? "claim gift" : request.requestType.toLowerCase()}</span>
                ) : (
                  <span>You requested to {request.requestType.toLowerCase()}</span>
                )}
              </div>
              {/* Swap: 3-column layout — offered | arrows | requested */}
              {request.requestType === "SWAP" && (() => {
                // Use counter items when a counter exists, otherwise originals
                const hasCounter = (request.counterSwapOwnerItemIds?.length ?? 0) > 0 || (request.counterSwapRequesterItemIds?.length ?? 0) > 0;
                // Left = requester side, Right = owner side
                const leftItems: { id: number; name: string; photos: string[]; tier?: number | null }[] = hasCounter
                  ? (request.counterSwapRequesterItems?.length ? request.counterSwapRequesterItems : (request.swapOfferedItems ?? []))
                  : (request.swapOfferedItems ?? []);
                const rightItems: { id: number; name: string; photos: string[]; tier?: number | null }[] = hasCounter && request.counterSwapOwnerItems?.length
                  ? request.counterSwapOwnerItems
                  : [{ id: request.item.id, name: request.item.name, photos: request.item.photos, tier: request.item.tier }];

                if (leftItems.length === 0 && rightItems.length === 0) return null;

                const leftSC = leftItems.reduce((s, oi) => s + getTierShareCoins(oi.tier ?? 2), 0);
                const rightSC = rightItems.reduce((s, oi) => s + getTierShareCoins(oi.tier ?? 2), 0);
                // From the requester's perspective: left=offered, right=receiving
                const result = calculateMultiSwap(leftSC, rightSC);
                const positive = result.offsetDirection === "you_receive";
                return (
                  <div className="mt-2 mb-1 flex items-start gap-2">
                    {/* Left: requester's items */}
                    <div className="flex-1 min-w-0 space-y-1">
                      {leftItems.map(oi => (
                        <div key={oi.id} className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded px-1.5 py-1">
                          {oi.photos?.[0] ? (
                            <img src={oi.photos[0]} alt={oi.name} className="w-6 h-6 rounded object-cover flex-shrink-0" />
                          ) : (
                            <Package className="h-4 w-4 text-amber-400 flex-shrink-0" />
                          )}
                          <span className="text-[10px] text-amber-900 font-medium truncate">{oi.name}</span>
                        </div>
                      ))}
                      {/* Requester pays — badge on left */}
                      {!result.isFair && !positive && (
                        <div className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-center text-amber-700 bg-amber-50 border border-amber-300">
                          {result.offset} ShareCoins
                        </div>
                      )}
                    </div>
                    {/* Center: arrows */}
                    <div className="flex-shrink-0 flex items-center justify-center mt-1.5">
                      <ArrowLeftRight className="h-5 w-5 text-teal-500" />
                    </div>
                    {/* Right: owner's items */}
                    <div className="flex-1 min-w-0 space-y-1">
                      {rightItems.map(oi => (
                        <div key={oi.id} className="flex items-center gap-1.5 bg-teal-50 border border-teal-200 rounded px-1.5 py-1">
                          {oi.photos?.[0] ? (
                            <img src={oi.photos[0]} alt={oi.name} className="w-6 h-6 rounded object-cover flex-shrink-0" />
                          ) : (
                            <Package className="h-4 w-4 text-teal-400 flex-shrink-0" />
                          )}
                          <span className="text-[10px] text-teal-900 font-medium truncate">{oi.name}</span>
                        </div>
                      ))}
                      {/* Owner pays — badge on right */}
                      {!result.isFair && positive && (
                        <div className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-center text-teal-700 bg-teal-50 border border-teal-200">
                          {result.offset} ShareCoins
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              {displayStart && displayEnd && (
                <div className={`flex items-center gap-1 text-xs mb-0.5 ${dateChanged ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
                  <Clock className="h-3 w-3 shrink-0" />
                  <span>{format(parseLocalDate(displayStart), "MMM d")} – {format(parseLocalDate(displayEnd), "MMM d")}</span>
                </div>
              )}
              {iSentCounter && (
                <p className="text-[10px] text-amber-700 mt-0.5 italic">Waiting for their response…</p>
              )}
              {iTermsAccepted && isOwner && (
                <p className="text-[10px] text-green-700 mt-0.5 font-medium">✅ Requester accepted your terms</p>
              )}
            </div>
          </div>
        </button>

        {/* Action buttons */}
        <div className="flex gap-2 flex-nowrap mt-3">
          {/* Counter received: inline Accept / Counter / Decline */}
          {iReceivedCounter && (
            <>
              <Button
                size="sm"
                className="flex-1 h-9 text-sm font-semibold bg-green-600 hover:bg-green-700"
                onClick={() => respondToCounterMutation.mutate({ requestId: request.id, accept: true })}
                disabled={respondToCounterMutation.isPending}
              >
                Accept
              </Button>
              {(request.counterRound ?? 0) < 2 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-9 text-sm font-semibold border-amber-400 text-amber-700 hover:bg-amber-50"
                  onClick={() => openChatCounter(request, isOwner ? "owner" : "requester")}
                >
                  Counter
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-9 text-sm font-semibold"
                onClick={() => respondToCounterMutation.mutate({ requestId: request.id, accept: false })}
                disabled={respondToCounterMutation.isPending}
              >
                Decline
              </Button>
              {(request.counterRound ?? 0) >= 2 && (
                <p className="text-[10px] text-muted-foreground w-full mt-0.5">
                  Counter-offer limit reached
                </p>
              )}
            </>
          )}

              {/* Owner: terms were accepted by requester — formally confirm */}
              {isOwner && iTermsAccepted && (
                <Button
                  size="sm"
                  className="flex-1 h-9 text-sm font-semibold bg-green-600 hover:bg-green-700"
                  onClick={() => handleAcceptClick(request)}
                  disabled={acceptMutation.isPending}
                >
                  {acceptMutation.isPending ? "Confirming…" : "Confirm & Accept"}
                </Button>
              )}

              {/* Owner actions for pending requests (no active counter, terms not yet agreed) */}
              {isOwner && request.status === "PENDING" && !iCounterPending && !iTermsAccepted && (
                <>
                  <Button
                    size="sm"
                    className="flex-1 h-9 text-sm font-semibold bg-green-600 hover:bg-green-700"
                    onClick={() => handleAcceptClick(request)}
                    disabled={acceptMutation.isPending}
                  >
                    {acceptMutation.isPending ? "Accepting…" : "Accept"}
                  </Button>
                  {(request.counterRound ?? 0) < 2 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 h-9 text-sm font-semibold border-amber-400 text-amber-700 hover:bg-amber-50"
                      onClick={() => openChatCounter(request, "owner")}
                    >
                      Counter
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 h-9 text-sm font-semibold"
                    onClick={() => declineMutation.mutate(request.id)}
                    disabled={declineMutation.isPending}
                  >
                    Decline
                  </Button>
                </>
              )}

              {/* Giver: cancel an accepted gift (e.g. receiver never showed up) */}
              {isOwner && request.requestType === "GIFT" && request.status === "ACCEPTED" && (
                <button
                  className="text-xs text-muted-foreground hover:text-red-500 transition-colors"
                  onClick={(e) => { e.stopPropagation(); setCancelConfirmRequest(request); }}
                  disabled={cancelMutation.isPending}
                >
                  Cancel gift
                </button>
              )}

              {/* Borrower: waiting for owner to confirm after terms agreed */}
              {isBorrower && iTermsAccepted && (
                <p className="text-[10px] text-green-700 italic">Waiting for owner to confirm…</p>
              )}

              {/* Borrower: Cancel request (PENDING = free cancel, no confirmation needed) */}
              {isBorrower && request.status === "PENDING" && !iCounterPending && !iTermsAccepted && (
                <button
                  className="text-xs text-muted-foreground hover:text-red-500 transition-colors"
                  onClick={(e) => { e.stopPropagation(); cancelMutation.mutate(request.id); }}
                  disabled={cancelMutation.isPending}
                >
                  Cancel request
                </button>
              )}

              {/* Borrower actions (ShareCoins) */}
              {isBorrower && request.requestType === "BORROW" && (
                <>
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

              {/* Borrower: discreet cancel for post-accept pre-handoff */}
              {isBorrower && ["ACCEPTED", "DEPOSIT_CONFIRMED"].includes(request.status) && (
                <button
                  className="text-xs text-muted-foreground hover:text-red-500 transition-colors"
                  onClick={(e) => { e.stopPropagation(); setCancelConfirmRequest(request); }}
                >
                  Cancel request
                </button>
              )}



        </div>
      </div>
    );
  };

  return (
    <div className={isOpen ? "fixed bottom-0 left-0 right-0 sm:bottom-4 sm:left-auto sm:right-4 z-50" : "fixed bottom-4 right-4 z-50"}>
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
        <Card className="w-full sm:w-[380px] h-[92dvh] sm:h-[600px] shadow-2xl flex flex-col rounded-b-none sm:rounded-b-lg">
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
                  { key: "archived", label: "Archive" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setMessageFilter(tab.key as MessageFilter)}
                    className={`px-2.5 py-1 rounded-full text-xs flex items-center gap-1 ${
                      messageFilter === tab.key
                        ? tab.key === "archived" ? "bg-gray-500 text-white" : "bg-gray-800 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {tab.label}
                    {tab.key === "unread" && actionCount > 0 && (
                      <span className={`inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] rounded-full ${messageFilter === "unread" ? "bg-white/20" : "bg-amber-500 text-white"}`}>
                        {actionCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Inbox list — one entry per request */}
              <ScrollArea className="flex-1">
                {(messageFilter === "archived" ? isLoadingArchived : isLoadingInbox) ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : filteredInboxItems.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">{messageFilter === "archived" ? "No archived chats" : "Nothing here yet"}</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredInboxItems.map((item) => {
                      const partnerName = formatDisplayName(item.partnerDisplayName || item.partnerUsername);
                      const initials = getPartnerInitials(item.partnerDisplayName, item.partnerUsername);
                      const activeStatus = getActiveStatus(item.partnerLastActiveAt);
                      const needsAction =
                        !item.isArchived &&
                        ((item.requestStatus === "PENDING" && !item.iAmRequester) ||
                        item.requestNegotiationStatus === "counter_proposed");
                      const isActive = activeStatus?.label === "Active now";
                      const activityTime = new Date(item.lastActivityTime);
                      const now = new Date();
                      const isToday = activityTime.toDateString() === now.toDateString();
                      const timeLabel = isToday
                        ? activityTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                        : activityTime.toLocaleDateString([], { month: "short", day: "numeric" });

                      return (
                        <button
                          key={item.requestId}
                          onClick={() => openConversationWithPartner(item.partnerId, item.requestId, item.unreadCount)}
                          className={`w-full px-3 py-2.5 text-left transition-colors ${item.requestStatus === "AWAITING_HANDOFF_CONFIRM" ? "" : "hover:bg-purple-50"} ${needsAction ? "bg-amber-50/60 hover:bg-amber-50" : ""}`}
                        >
                          <div className="flex items-start gap-2.5">
                            {/* Avatar */}
                            <div className="relative flex-shrink-0">
                              <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center text-sm font-semibold text-gray-600">
                                {item.partnerPhoto ? (
                                  <img src={item.partnerPhoto} alt={partnerName} className="w-full h-full object-cover" />
                                ) : (
                                  <span>{initials}</span>
                                )}
                              </div>
                              {isActive && (
                                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-white" />
                              )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              {/* Row 1: name + time */}
                              <div className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1 min-w-0">
                                  <span className={`text-sm font-semibold truncate ${item.unreadCount > 0 || needsAction ? "text-gray-900" : "text-gray-700"}`}>
                                    {partnerName}
                                  </span>
                                  {item.partnerIsVerified && (
                                    <BadgeCheck className="h-5 w-5 fill-[#0DCEA1] stroke-white flex-shrink-0" />
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  {(item.unreadCount > 0) && (
                                    <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] bg-red-500 text-white rounded-full font-medium">
                                      {item.unreadCount}
                                    </span>
                                  )}
                                  {needsAction && item.unreadCount === 0 && (
                                    <span className="inline-flex items-center justify-center h-4 min-w-4 px-1.5 text-[10px] bg-amber-500 text-white rounded-full font-medium">
                                      !
                                    </span>
                                  )}
                                  <span className="text-[10px] text-muted-foreground">{timeLabel}</span>
                                </div>
                              </div>

                              {/* Row 2: item photo + name */}
                              <div className="-mt-0.5 mb-0.5 flex items-center gap-1.5">
                                {item.itemPhoto ? (
                                  <img
                                    src={item.itemPhoto}
                                    alt={item.itemName}
                                    className="w-5 h-5 rounded object-cover flex-shrink-0 border border-gray-200"
                                  />
                                ) : (
                                  <div className="w-5 h-5 rounded bg-gray-200 flex-shrink-0" />
                                )}
                                <span className="text-[11px] font-semibold italic text-gray-700 truncate leading-none">{item.itemName}</span>
                              </div>

                              {/* Row 3: preview */}
                              <p className={`text-xs truncate ${item.unreadCount > 0 ? "text-gray-800 font-medium" : "text-muted-foreground"}`}>
                                {item.previewType === "request" && item.requestStatus ? (
                                  <span className={`${needsAction ? "text-amber-700" : ""}`}>
                                    {getRequestStatusLabel(item.requestStatus, item.requestNegotiationStatus, item.iAmRequester, item)}
                                  </span>
                                ) : (
                                  <>
                                    {item.previewSentByMe != null && (
                                      <span className="text-gray-500 font-normal">
                                        {item.previewSentByMe
                                          ? "You: "
                                          : `${(item.partnerDisplayName || item.partnerUsername).split(" ")[0]}: `}
                                      </span>
                                    )}
                                    {item.preview}
                                  </>
                                )}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </>
          ) : (
            <>
              {/* Chat View Header — partner profile */}
              <div className="px-3 py-2.5 border-b flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={() => setSelectedConversation(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>

                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div className="w-9 h-9 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center text-sm font-semibold text-gray-600">
                    {partnerProfile?.profilePhoto ? (
                      <img src={partnerProfile.profilePhoto} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span>
                        {getPartnerInitials(
                          partnerProfile?.displayName ?? null,
                          partnerProfile?.username ??
                            (allConversations.find(c => c.userId === selectedConversation)?.username || "?")
                        )}
                      </span>
                    )}
                  </div>
                  {(() => {
                    const s = getActiveStatus(partnerProfile?.lastActiveAt ?? null);
                    return s?.label === "Active now" ? (
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-white" />
                    ) : null;
                  })()}
                </div>

                {/* Name + meta */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <Link
                      href={`/profile/${partnerProfile?.handle || partnerProfile?.username || allConversations.find(c => c.userId === selectedConversation)?.username}`}
                      className="font-semibold text-sm truncate hover:underline cursor-pointer"
                    >
                      {formatDisplayName(
                        partnerProfile?.displayName || partnerProfile?.username ||
                        allConversations.find(c => c.userId === selectedConversation)?.username ||
                        requests.find(r => r.item.ownerId === user?.id && r.requesterId === selectedConversation)?.requester?.username
                      )}
                    </Link>
                    {partnerProfile?.isVerified && (
                      <BadgeCheck className="h-5 w-5 fill-[#0DCEA1] stroke-white flex-shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground flex-nowrap overflow-hidden">
                    {partnerProfile && partnerProfile.reviewCount > 0 && (
                      <span className="flex items-center gap-0.5 shrink-0">
                        <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                        <span className="font-medium text-gray-700">{Number(partnerProfile.averageRating).toFixed(1)}</span>
                        <span>({partnerProfile.reviewCount})</span>
                      </span>
                    )}
                    {(() => {
                      const selectedInboxItem = inboxItems.find(item => item.partnerId === selectedConversation);
                      const activeLabel = getActiveStatus(partnerProfile?.lastActiveAt ?? null)?.label || null;
                      const responseTime = selectedInboxItem?.partnerResponseTime || null;
                      if (!activeLabel && !responseTime) return null;
                      const isActiveNow = activeLabel === "Active now";
                      return (
                        <span className="flex items-center gap-1 min-w-0 overflow-hidden">
                          {activeLabel && (
                            <span className={`whitespace-nowrap shrink-0 ${isActiveNow ? "text-green-600" : "text-muted-foreground"}`}>
                              {activeLabel}
                            </span>
                          )}
                          {activeLabel && responseTime && <span className="text-muted-foreground shrink-0">·</span>}
                          {responseTime && <span className="text-muted-foreground whitespace-nowrap truncate">{responseTime}</span>}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Resend banner — shown after the requester withdraws a pending offer */}
              {pendingResend && (
                <div className="flex items-center gap-2 px-3 py-2 bg-teal-50 border-b border-teal-200">
                  <RotateCcw className="h-3.5 w-3.5 text-teal-600 flex-shrink-0" />
                  <span className="text-xs text-teal-800 flex-1">Offer withdrawn — fix the terms and resend</span>
                  <Button
                    size="sm"
                    className="h-6 text-xs px-2 bg-teal-600 hover:bg-teal-700"
                    onClick={() => {
                      sessionStorage.setItem("shareswap_resend_prefill", JSON.stringify(pendingResend));
                      setPendingResend(null);
                      setIsOpen(false);
                      navigate(`/items/${pendingResend.itemId}`);
                    }}
                  >
                    Resend offer
                  </Button>
                  <button
                    className="text-teal-500 hover:text-teal-700 ml-0.5"
                    onClick={() => setPendingResend(null)}
                    aria-label="Dismiss"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {isLoadingMessages ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <ScrollArea className="flex-1 p-3" ref={scrollRef}>
                  {/* Request card pinned at top of thread */}
                  {(() => {
                    const partnerRequest = requests.find((r) =>
                      (r.item.ownerId === user?.id && r.requesterId === selectedConversation) ||
                      (r.requesterId === user?.id && r.item.ownerId === selectedConversation)
                    );
                    if (!partnerRequest) return null;
                    return (
                      <div className="mb-3">
                        {renderRequestCard(partnerRequest)}
                      </div>
                    );
                  })()}
                  {(() => {
                    // The most recent counter_proposed event per request — only that one shows action buttons.
                    // Earlier counter events (already acted on) should be read-only history.
                    const latestCounterMsgIdByRequest = new Map<number, number>();
                    for (const m of messages) {
                      if (m.messageType === "event" && m.metadata?.eventType === "counter_proposed" && m.requestId) {
                        latestCounterMsgIdByRequest.set(m.requestId, m.id);
                      }
                    }
                    return messages.map((msg) => {
                    const borrowerTrust = Math.min(100, Math.round(((user as any)?.reputationScore || 0) / 500 * 100));

                    // System event messages — subtle centered text, no colored boxes
                    if (msg.messageType === "event") {
                      const et = msg.metadata?.eventType;
                      const relatedRequest = msg.requestId
                        ? requests.find((r) => r.id === msg.requestId)
                        : null;
                      const isCounterPending = et === "counter_proposed";
                      const isLatestCounterEvent = msg.requestId
                        ? latestCounterMsgIdByRequest.get(msg.requestId) === msg.id
                        : false;
                      const iAmResponder = relatedRequest &&
                        isCounterPending &&
                        isLatestCounterEvent &&
                        relatedRequest.counterProposedBy !== null &&
                        relatedRequest.counterProposedBy !== user.id &&
                        relatedRequest.negotiationStatus === "counter_proposed";
                      const iAmOwner = relatedRequest && relatedRequest.item.ownerId === user.id;

                      // Resolve actor name: "You" for current user, partner's display name otherwise.
                      // Use allConversations as immediate fallback while partnerProfile query loads.
                      const iActor = msg.senderId === user.id;
                      const partnerFallback = allConversations.find(c => c.userId === selectedConversation);
                      const partnerName = formatDisplayName(
                        partnerProfile?.displayName || partnerProfile?.username ||
                        (partnerFallback as any)?.displayName || (partnerFallback as any)?.username || ""
                      );
                      const actor = iActor ? "You" : partnerName;

                      const eventLabel =
                        et === "request_accepted" ? `✅ ${actor} accepted the request` :
                        et === "request_declined" ? `❌ ${actor} declined the request` :
                        et === "request_cancelled" ? `🚫 ${actor} cancelled the request` :
                        et === "terms_accepted" ? `✅ ${actor} accepted the new terms` :
                        et === "terms_declined" ? `❌ ${actor} declined the new terms` :
                        et === "handoff_confirmed" ? "🤝 Handoff confirmed" :
                        et === "deposit_confirmed" ? "🔒 Deposit secured" :
                        et === "counter_proposed" ? null :
                        msg.content;

                      return (
                        <React.Fragment key={msg.id}>
                          <div className="mb-3 flex flex-col items-center gap-1.5" data-event-type={et}>
                            {et === "counter_proposed" ? (
                              <span className="text-xs text-muted-foreground font-semibold flex items-center gap-1">
                                🔄 {actor} proposed new terms
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground font-semibold">{eventLabel}</span>
                            )}

                            {et === "counter_proposed" && msg.metadata && (() => {
                              const isSwapCounter = relatedRequest?.requestType === "SWAP";
                              if (isSwapCounter) {
                                const ownerNames = (msg.metadata.swapOwnerItemNames as string[] | undefined) ?? [];
                                const requesterNames = (msg.metadata.swapRequesterItemNames as string[] | undefined) ?? [];
                                const ownerPhotos = (msg.metadata.swapOwnerItemPhotos as (string | null)[] | undefined) ?? [];
                                const requesterPhotos = (msg.metadata.swapRequesterItemPhotos as (string | null)[] | undefined) ?? [];
                                const ownerTiers = (msg.metadata.swapOwnerItemTiers as number[] | undefined) ?? [];
                                const requesterTiers = (msg.metadata.swapRequesterItemTiers as number[] | undefined) ?? [];
                                const cnote = msg.metadata.counterNote as string | undefined;
                                // Compute coin offset (requester-first, same as main swap card)
                                const ownerSC = ownerTiers.reduce((s, t) => s + getTierShareCoins(t), 0);
                                const requesterSC = requesterTiers.reduce((s, t) => s + getTierShareCoins(t), 0);
                                const swapResult = calculateMultiSwap(requesterSC, ownerSC);
                                const ownerPays = swapResult.offsetDirection === "you_receive"; // requester receives = owner pays
                                return (
                                  <div className="w-full pl-[70px] mt-1">
                                    <div className="flex items-start gap-2">
                                      {/* Left: requester's items (amber) */}
                                      <div className="flex-1 min-w-0 space-y-1">
                                        {requesterNames.map((n, i) => (
                                          <div key={i} className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded px-1.5 py-1">
                                            {requesterPhotos[i] ? (
                                              <img src={requesterPhotos[i]!} alt={n} className="w-6 h-6 rounded object-cover flex-shrink-0" />
                                            ) : (
                                              <Package className="h-4 w-4 text-amber-400 flex-shrink-0" />
                                            )}
                                            <span className="text-[10px] text-amber-900 font-medium truncate">{n}</span>
                                          </div>
                                        ))}
                                        {/* Requester pays — badge on left */}
                                        {!swapResult.isFair && !ownerPays && (
                                          <div className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-center text-amber-700 bg-amber-50 border border-amber-300">
                                            {swapResult.offset} ShareCoins
                                          </div>
                                        )}
                                      </div>
                                      {/* Center: arrows */}
                                      <div className="flex-shrink-0 flex items-center justify-center mt-1.5">
                                        <ArrowLeftRight className="h-4 w-4 text-teal-500" />
                                      </div>
                                      {/* Right: owner's items (teal) */}
                                      <div className="flex-1 min-w-0 space-y-1">
                                        {ownerNames.map((n, i) => (
                                          <div key={i} className="flex items-center gap-1.5 bg-teal-50 border border-teal-200 rounded px-1.5 py-1">
                                            {ownerPhotos[i] ? (
                                              <img src={ownerPhotos[i]!} alt={n} className="w-6 h-6 rounded object-cover flex-shrink-0" />
                                            ) : (
                                              <Package className="h-4 w-4 text-teal-400 flex-shrink-0" />
                                            )}
                                            <span className="text-[10px] text-teal-900 font-medium truncate">{n}</span>
                                          </div>
                                        ))}
                                        {/* Owner pays — badge on right */}
                                        {!swapResult.isFair && ownerPays && (
                                          <div className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-center text-teal-700 bg-teal-50 border border-teal-200">
                                            {swapResult.offset} ShareCoins
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    {cnote && (
                                      <p className="text-[11px] text-muted-foreground italic mt-1.5">"{cnote}"</p>
                                    )}
                                  </div>
                                );
                              }
                              const mStart = msg.metadata.startDate as string | undefined;
                              const mEnd = msg.metadata.endDate as string | undefined;
                              const origStartRaw = (msg.metadata.origStartDate as string | undefined) ?? relatedRequest?.startDate;
                              const origEndRaw   = (msg.metadata.origEndDate   as string | undefined) ?? relatedRequest?.endDate;
                              const origStart = origStartRaw ? format(parseLocalDate(origStartRaw), "MMM d") : null;
                              const origEnd   = origEndRaw   ? format(parseLocalDate(origEndRaw),   "MMM d") : null;
                              const newStart = mStart ? format(parseLocalDate(mStart), "MMM d") : null;
                              const newEnd = mEnd ? format(parseLocalDate(mEnd), "MMM d") : null;
                              const dateChanged = newStart !== origStart || newEnd !== origEnd;
                              const origDeposit = msg.metadata.origDepositMethod as string | undefined;
                              const newDeposit = msg.metadata.depositMethod as string | undefined;
                              const depositChanged = origDeposit !== newDeposit;
                              const depositLabel = (m?: string) => m === "in_app" ? "Handle In-app" : m === "in_person" ? "Exchange In Person" : null;

                              return (
                                <div className="w-full pl-[70px]">
                                  <div className="flex items-stretch gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[11px]">
                                    {/* Old terms */}
                                    <div className="flex flex-col gap-1 text-muted-foreground min-w-0 flex-1">
                                      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">Previous</span>
                                      {origStart && origEnd && (
                                        <span className="flex items-center gap-1">
                                          <Clock className="h-3 w-3 shrink-0" />
                                          {origStart} – {origEnd}
                                        </span>
                                      )}
                                      {depositLabel(origDeposit) && (
                                        <span className="flex items-center gap-1">
                                          <Shield className="h-3 w-3 shrink-0" />
                                          {depositLabel(origDeposit)}
                                        </span>
                                      )}
                                    </div>
                                    {/* Arrow */}
                                    <div className="flex items-center text-gray-400 font-bold text-base px-1">→</div>
                                    {/* New terms */}
                                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                                      <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-500 mb-0.5">Proposed</span>
                                      {newStart && newEnd && (
                                        <span className={`flex items-center gap-1 ${dateChanged ? "text-amber-600 font-semibold" : "text-muted-foreground"}`}>
                                          <Clock className="h-3 w-3 shrink-0" />
                                          {newStart} – {newEnd}
                                        </span>
                                      )}
                                      {depositLabel(newDeposit) && (
                                        <span className={`flex items-center gap-1 ${depositChanged ? "text-amber-600 font-semibold" : "text-muted-foreground"}`}>
                                          <Shield className="h-3 w-3 shrink-0" />
                                          {depositLabel(newDeposit)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}

                          </div>
                        </React.Fragment>
                      );
                    }

                    // System notice — subtle muted text, no box
                    if (msg.messageType === "system") {
                      // Visibility guard: some stamps (e.g. coin charge/earn) are only for one party
                      const visibleTo = (msg.metadata as any)?.visibleToUserId;
                      if (visibleTo && visibleTo !== user.id) return null;

                      // Replace the current user's name with "You" at the start of system messages
                      const myFormattedName = formatDisplayName(user?.displayName || user?.username);
                      const personalizedContent = msg.content.replace(
                        new RegExp(`^${myFormattedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s)`),
                        "You"
                      );
                      return (
                        <div key={msg.id} className="mb-3 flex flex-col items-center gap-0.5">
                          <span className="text-xs text-muted-foreground font-semibold text-center max-w-[80%] leading-snug">
                            {personalizedContent}
                          </span>
                          <span className="text-[10px] text-muted-foreground/60">
                            {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                      );
                    }

                    // Regular text message
                    return (
                      <React.Fragment key={msg.id}>
                        <div
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
                      </React.Fragment>
                    );
                  });
                  })()}

                  <div ref={messagesEndRef} />
                </ScrollArea>
              )}

              {/* Sticky CTA — context-aware for both borrower and owner */}
              {(() => {
                const pr = requests.find((r) =>
                  (r.item.ownerId === user?.id && r.requesterId === selectedConversation) ||
                  (r.requesterId === user?.id && r.item.ownerId === selectedConversation)
                );
                if (!pr) return null;

                const isBorrower = pr.requesterId === user?.id;
                const isOwner = pr.item.ownerId === user?.id;

                // --- BORROWER CTAs ---
                if (isBorrower) {
                  const bt = Math.min(100, Math.round(((user as any)?.reputationScore || 0) / 500 * 100));

                  if (pr.status === "ACCEPTED" && pr.requestType === "GIFT") {
                    const alreadyConfirmed = pr.borrowerConfirmedHandoff;
                    return (
                      <div className="px-3 py-2 border-t border-pink-100 bg-pink-50">
                        {alreadyConfirmed ? (
                          <p className="text-xs text-pink-700 text-center font-medium py-1.5">✓ Confirmed — waiting for the giver to confirm</p>
                        ) : (
                          <Button
                            className="w-full h-10 bg-pink-500 hover:bg-pink-600 text-white text-sm font-medium rounded-xl"
                            disabled={confirmGiftHandoffMutation.isPending}
                            onClick={() => confirmGiftHandoffMutation.mutate({ requestId: pr.id, role: "receiver" })}
                          >
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Confirm received
                          </Button>
                        )}
                      </div>
                    );
                  }

                  // RENT ACCEPTED → combined rental + deposit payment
                  if (pr.status === "ACCEPTED" && pr.requestType === "RENT") {
                    return (
                      <div className="px-3 py-2 border-t border-green-100 bg-green-50">
                        <Button
                          className="w-full h-10 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl"
                          onClick={() => { setSelectedRequest(pr); setShowRentalDepositModal(true); }}
                        >
                          <CreditCard className="h-4 w-4 mr-2" />
                          Pay & Confirm Booking
                        </Button>
                      </div>
                    );
                  }

                  // BORROW + in_person deposit: skip the Pay Deposit step (backend auto-advances to DEPOSIT_CONFIRMED).
                  // Guard here handles any edge-case legacy ACCEPTED rows — drop through to the handoff PIN block below.
                  if (
                    pr.status === "ACCEPTED" &&
                    pr.requestType === "BORROW" &&
                    !(pr.depositMethod === "in_person")
                  ) {
                    const dc = calculateSecurityDeposit(pr.item.tier || 2, pr.item.originalValue || "$50–$150", bt);
                    return (
                      <div className="px-3 py-2 border-t border-teal-100 bg-teal-50">
                        <Button className="w-full h-10 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-xl"
                          onClick={() => {
                            // Check ShareCoin balance against the (possibly counter-proposed) date range
                            const rawSC = parseFloat(pr.item.shareCoinPrice || "0") || 5;
                            const coinCost = (() => {
                              if (!pr.startDate || !pr.endDate) return rawSC;
                              const s = new Date(pr.startDate.split("T")[0]);
                              const e = new Date(pr.endDate.split("T")[0]);
                              const days = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / 86_400_000));
                              return Math.max(1, Math.ceil((rawSC / 7) * days));
                            })();
                            const balance = Number((user as any)?.shareCoins ?? 0);
                            if (balance < coinCost) {
                              setInsufficientCoinsRequired(coinCost);
                              setShowInsufficientCoinsModal(true);
                              return;
                            }
                            setSelectedRequest(pr);
                            setShowTrustDepositModal(true);
                          }}>
                          <Shield className="h-4 w-4 mr-2" />
                          Pay ${dc.finalDeposit} deposit
                        </Button>
                      </div>
                    );
                  }

                  if (
                    pr.status === "DEPOSIT_CONFIRMED" ||
                    (pr.status === "AWAITING_HANDOFF_CONFIRM" && !pr.borrowerConfirmedHandoff) ||
                    (pr.status === "ACCEPTED" && pr.requestType === "SWAP") ||
                    // Legacy: BORROW + in_person deposit stuck at ACCEPTED before auto-advance existed
                    (pr.status === "ACCEPTED" && pr.requestType === "BORROW" && pr.depositMethod === "in_person")
                  ) {
                    const pinExpiresAt = (pr as any).pinExpiresAt;
                    const pinUsed = (pr as any).pinUsed;
                    const pinExpired = pinExpiresAt ? new Date(pinExpiresAt) < new Date() : false;
                    const isInPersonDeposit = pr.requestType === "BORROW" && pr.depositMethod === "in_person";

                    // For RENT: gate handoff behind the rental start date
                    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
                    const rentalStart = pr.requestType === "RENT" && pr.startDate ? parseLocalDate(pr.startDate) : null;
                    const isBeforeRentalStart = rentalStart && rentalStart > todayMidnight;
                    const isOverdue = rentalStart && rentalStart < todayMidnight && pr.requestType === "RENT";

                    if (isBeforeRentalStart) {
                      return (
                        <div className="px-3 py-2 border-t border-indigo-100 bg-indigo-50">
                          <p className="text-xs text-center text-indigo-700 font-medium">
                            📅 Pickup on {format(rentalStart, "MMMM d")} — return here then to confirm handoff
                          </p>
                        </div>
                      );
                    }

                    return (
                      <div className="px-3 py-2 border-t border-indigo-100 bg-indigo-50 space-y-1">
                        {isOverdue && (
                          <p className="text-xs text-center text-amber-700 font-medium">⚠️ Handoff overdue</p>
                        )}
                        <Button className="w-full h-10 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl"
                          onClick={() => { setSelectedRequest(pr); setShowHandoffModal(true); }}>
                          <KeyRound className="h-4 w-4 mr-2" />
                          {pinExpired || pinUsed ? "Confirm received" : "Enter handoff code"}
                        </Button>
                        {isInPersonDeposit && !pinExpired && !pinUsed && (
                          <p className="text-xs text-center text-amber-700 font-medium">💵 Remember to pay the security deposit in person before confirming</p>
                        )}
                        {!isInPersonDeposit && !pinExpired && !pinUsed && (
                          <p className="text-xs text-center text-muted-foreground">Ask the owner for the 4-digit handoff code when you meet</p>
                        )}
                        {(pr.requestType === "BORROW" || pr.requestType === "RENT") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full h-9 border-gray-200 text-gray-700 hover:bg-gray-50 text-xs font-medium gap-2"
                            onClick={() => { setSelectedRequest(pr); setShowCourierHandoffModal(true); }}
                          >
                            <Truck className="h-3.5 w-3.5 shrink-0" />
                            Can't meet up? Book a delivery
                          </Button>
                        )}
                      </div>
                    );
                  }

                  if (pr.status === "RETURN_REQUESTED") {
                    const today = new Date(); today.setHours(0, 0, 0, 0);
                    const dueDate = pr.endDate ? parseLocalDate(pr.endDate) : null;
                    const wasEarlyReturn = dueDate ? today < dueDate : false;
                    return (
                      <div className="px-3 py-2 border-t border-amber-100 bg-amber-50 space-y-2">
                        <p className="text-xs text-amber-800 font-semibold text-center">
                          {wasEarlyReturn ? "↩️ Early return initiated" : "↩️ Return requested"} — waiting for owner to confirm
                        </p>
                        <Button
                          className="w-full h-9 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl gap-2"
                          onClick={() => {
                            toast({
                              title: "Item return confirmed on your end",
                              description: "The owner will confirm receipt to complete the return.",
                            });
                          }}
                        >
                          <CheckCircle className="h-4 w-4" />
                          Confirm item returned
                        </Button>
                      </div>
                    );
                  }

                  if (pr.status === "IN_PROGRESS") {
                    const wasAutoAdvanced = (pr as any).handoffAutoAdvanced;
                    const today = new Date(); today.setHours(0, 0, 0, 0);
                    const dueDate = pr.endDate ? parseLocalDate(pr.endDate) : null;
                    const isEarlyReturn = dueDate ? today < dueDate : false;
                    return (
                      <div className="px-3 py-2 border-t border-blue-100 bg-blue-50 space-y-1">
                        <Button className="w-full h-10 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl"
                          onClick={() => { setSelectedRequest(pr); setShowReturnModal(true); }}>
                          <RotateCcw className="h-4 w-4 mr-2" />
                          {isEarlyReturn ? "Early Return" : "Return item"}
                        </Button>
                        {wasAutoAdvanced && !showAutoReport && (
                          <button
                            onClick={() => setShowAutoReport(true)}
                            className="text-xs text-muted-foreground hover:text-red-500 w-full text-center py-0.5 transition-colors"
                          >
                            Didn't receive this item?
                          </button>
                        )}
                        {wasAutoAdvanced && showAutoReport && (
                          <div className="pt-1 space-y-1.5">
                            <textarea
                              className="w-full text-sm border border-red-200 rounded-lg p-2 resize-none bg-white focus:outline-none focus:ring-1 focus:ring-red-400"
                              rows={2}
                              placeholder="Briefly describe what happened…"
                              value={autoReportText}
                              onChange={(e) => setAutoReportText(e.target.value)}
                            />
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" className="flex-1 text-xs h-8" onClick={() => { setShowAutoReport(false); setAutoReportText(""); }}>
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="flex-1 text-xs h-8 bg-red-600 hover:bg-red-700 text-white"
                                disabled={!autoReportText.trim() || reportAutoHandoffMutation.isPending}
                                onClick={() => reportAutoHandoffMutation.mutate({ requestId: pr.id, description: autoReportText })}
                              >
                                {reportAutoHandoffMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Report issue"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }
                }

                // --- OWNER CTAs ---
                if (isOwner) {
                  if (pr.status === "ACCEPTED" && pr.requestType === "GIFT") {
                    const alreadyConfirmed = pr.ownerConfirmedHandoff;
                    return (
                      <div className="px-3 py-2 border-t border-pink-100 bg-pink-50">
                        {alreadyConfirmed ? (
                          <p className="text-xs text-pink-700 text-center font-medium py-1.5">✓ Confirmed — waiting for the receiver to confirm</p>
                        ) : (
                          <Button
                            className="w-full h-10 bg-pink-500 hover:bg-pink-600 text-white text-sm font-medium rounded-xl"
                            disabled={confirmGiftHandoffMutation.isPending}
                            onClick={() => confirmGiftHandoffMutation.mutate({ requestId: pr.id, role: "giver" })}
                          >
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Confirm given
                          </Button>
                        )}
                      </div>
                    );
                  }

                  if (
                    pr.status === "DEPOSIT_CONFIRMED" ||
                    (pr.status === "AWAITING_HANDOFF_CONFIRM" && !pr.ownerConfirmedHandoff) ||
                    (pr.status === "ACCEPTED" && pr.requestType === "SWAP") ||
                    // Legacy: BORROW + in_person deposit stuck at ACCEPTED before auto-advance existed
                    (pr.status === "ACCEPTED" && pr.requestType === "BORROW" && pr.depositMethod === "in_person")
                  ) {
                    const pinExpiresAt = (pr as any).pinExpiresAt;
                    const isPinExpired = pinExpiresAt ? new Date(pinExpiresAt) < new Date() : false;
                    const isOwnerInPersonDeposit = pr.requestType === "BORROW" && pr.depositMethod === "in_person";

                    // For RENT: gate the handoff code behind the rental start date
                    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
                    const rentalStart = pr.requestType === "RENT" && pr.startDate ? parseLocalDate(pr.startDate) : null;
                    const isBeforeRentalStart = rentalStart && rentalStart > todayMidnight;
                    const isOverdue = rentalStart && rentalStart < todayMidnight && pr.requestType === "RENT";

                    if (isBeforeRentalStart) {
                      return (
                        <div className="px-3 py-2 border-t border-indigo-100 bg-indigo-50">
                          <p className="text-xs text-center text-indigo-700 font-medium">
                            📅 Handoff on {format(rentalStart, "MMMM d")} — your code will be ready then
                          </p>
                        </div>
                      );
                    }

                    return (
                      <div className="px-3 py-2 border-t border-indigo-100 bg-indigo-50 space-y-2">
                        {isOverdue && (
                          <p className="text-xs text-center text-amber-700 font-medium">⚠️ Handoff overdue</p>
                        )}
                        {/* PIN display card */}
                        <div className="rounded-xl border border-indigo-200 bg-white px-4 py-3 space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 uppercase tracking-wide">
                            <span>Your handoff code</span>
                          </div>
                          {isPinExpired ? (
                            <p className="text-xs text-amber-600 font-medium">Code expired — confirm manually below</p>
                          ) : ownerPinRevealed && ownerPinValue ? (
                            <div className="flex items-center gap-3">
                              <span className="text-3xl font-bold tracking-[0.25em] text-indigo-700 font-mono">{ownerPinValue}</span>
                              {ownerPinUsed && <span className="text-xs text-green-600 font-medium bg-green-50 border border-green-200 rounded px-1.5 py-0.5">Used</span>}
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full border-indigo-300 text-indigo-700 hover:bg-indigo-50 text-xs h-8"
                              disabled={ownerPinLoading}
                              onClick={async () => {
                                setOwnerPinLoading(true);
                                try {
                                  const res = await fetch(`/api/requests/${pr.id}/handoff-pin`, { credentials: "include" });
                                  const data = await res.json();
                                  setOwnerPinValue(data.pin);
                                  setOwnerPinExpired(data.expired);
                                  setOwnerPinUsed(data.pinUsed);
                                  setOwnerPinRevealed(true);
                                } catch (_) {}
                                setOwnerPinLoading(false);
                              }}
                            >
                              {ownerPinLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Show handoff code"}
                            </Button>
                          )}
                          {ownerPinRevealed && !isPinExpired && !ownerPinUsed && (
                            <p className="text-xs text-muted-foreground">Only share this code after both of you have checked the item and agree on the handoff.</p>
                          )}
                        </div>
                        {/* Manual confirm fallback */}
                        <button
                          onClick={() => { setSelectedRequest(pr); setShowHandoffModal(true); }}
                          className="text-xs text-muted-foreground hover:text-indigo-600 w-full text-center py-0.5 transition-colors"
                        >
                          Confirm manually instead →
                        </button>
                        {isOwnerInPersonDeposit && (
                          <p className="text-xs text-center text-amber-700 font-medium">💵 Remember to collect the security deposit in person before sharing your code</p>
                        )}
                      </div>
                    );
                  }

                  if (pr.status === "IN_PROGRESS" && (pr as any).handoffAutoAdvanced) {
                    return (
                      <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 space-y-1">
                        {!showAutoReport && (
                          <button
                            onClick={() => setShowAutoReport(true)}
                            className="text-xs text-muted-foreground hover:text-red-500 w-full text-center py-0.5 transition-colors"
                          >
                            Item was not collected?
                          </button>
                        )}
                        {showAutoReport && (
                          <div className="space-y-1.5">
                            <textarea
                              className="w-full text-sm border border-red-200 rounded-lg p-2 resize-none bg-white focus:outline-none focus:ring-1 focus:ring-red-400"
                              rows={2}
                              placeholder="Briefly describe what happened…"
                              value={autoReportText}
                              onChange={(e) => setAutoReportText(e.target.value)}
                            />
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" className="flex-1 text-xs h-8" onClick={() => { setShowAutoReport(false); setAutoReportText(""); }}>
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="flex-1 text-xs h-8 bg-red-600 hover:bg-red-700 text-white"
                                disabled={!autoReportText.trim() || reportAutoHandoffMutation.isPending}
                                onClick={() => reportAutoHandoffMutation.mutate({ requestId: pr.id, description: autoReportText })}
                              >
                                {reportAutoHandoffMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Report issue"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }

                  if (pr.status === "RETURN_REQUESTED") {
                    return (
                      <div className="px-3 py-2 border-t border-green-100 bg-green-50 space-y-1">
                        <Button className="w-full h-10 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl"
                          onClick={() => { setSelectedRequest(pr); setShowReturnModal(true); }}>
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Confirm return
                        </Button>
                        <p className="text-xs text-center text-muted-foreground">{pr.requestType === "RENT" ? "Renter" : pr.requestType === "SWAP" ? "Swapper" : pr.requestType === "GIFT" ? "Recipient" : "Borrower"} says they've returned the item</p>
                      </div>
                    );
                  }
                }

                // --- DISPUTED CTA (both parties) ---
                if (pr.status === "HANDOFF_DISPUTED") {
                  const hasSubmittedProof = isOwner
                    ? (pr as any).handoffProofOwner
                    : (pr as any).handoffProofBorrower;
                  if (hasSubmittedProof) {
                    return (
                      <div className="px-3 py-2 border-t border-red-100 bg-red-50">
                        <p className="text-xs text-red-700 text-center font-medium py-1.5">
                          ✓ Proof submitted — we're reviewing both sides.
                        </p>
                      </div>
                    );
                  }
                  return (
                    <div className="px-3 py-2 border-t border-red-100 bg-red-50 space-y-2">
                      <p className="text-xs text-red-700 font-medium">
                        There's a disagreement about this handoff. Please describe what happened.
                      </p>
                      {showProofInput ? (
                        <>
                          <textarea
                            className="w-full text-sm border border-red-200 rounded-lg p-2 resize-none bg-white focus:outline-none focus:ring-1 focus:ring-red-400"
                            rows={3}
                            placeholder="Describe the situation, any evidence, or provide a link to photos/screenshots…"
                            value={proofText}
                            onChange={(e) => setProofText(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => { setShowProofInput(false); setProofText(""); }}>
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="flex-1 text-xs bg-red-600 hover:bg-red-700 text-white"
                              disabled={!proofText.trim() || submitProofMutation.isPending}
                              onClick={() => submitProofMutation.mutate({ requestId: pr.id, proofText })}
                            >
                              {submitProofMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Submit"}
                            </Button>
                          </div>
                        </>
                      ) : (
                        <Button
                          className="w-full h-9 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-xl"
                          onClick={() => setShowProofInput(true)}
                        >
                          Submit your side
                        </Button>
                      )}
                    </div>
                  );
                }

                // --- FLAGGED CTA (informational) ---
                if (pr.status === "HANDOFF_FLAGGED") {
                  return (
                    <div className="px-3 py-2 border-t border-orange-100 bg-orange-50">
                      <p className="text-xs text-orange-800 text-center font-medium py-1.5">
                        🚩 This exchange has been flagged for admin review. We'll be in touch shortly.
                      </p>
                    </div>
                  );
                }

                return null;
              })()}

              <div className="p-3 border-t flex gap-2">
                <Input
                  ref={messageInputRef}
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
        onComplete={() => {
          setShowCelebration(false);
          setTimeout(() => messageInputRef.current?.focus(), 350);
        }}
        onSchedule={handleScheduleClick}
        message="Request accepted! Setting up exchange..."
      />

      <InsufficientShareCoinsModal
        isOpen={showInsufficientCoinsModal}
        onClose={() => setShowInsufficientCoinsModal(false)}
        currentBalance={Number((user as any)?.shareCoins ?? 0)}
        required={insufficientCoinsRequired}
        context="borrow"
      />

      {selectedRequest && showTrustDepositModal && (
        <TrustDepositModal
          isOpen={showTrustDepositModal}
          onClose={() => {
            setShowTrustDepositModal(false);
            setSelectedRequest(null);
          }}
          requestType={selectedRequest.requestType}
          request={{
            id: selectedRequest.id,
            itemId: selectedRequest.itemId,
            deliveryMethod: selectedRequest.deliveryMethod || "in_person",
            depositMethod: selectedRequest.depositMethod || "in_app",
            startDate: selectedRequest.startDate,
            endDate: selectedRequest.endDate,
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
          onSuccess={() => {
            setShowTrustDepositModal(false);
            setSelectedRequest(null);
            toast({
              title: "Ready for handoff!",
              description: "Coordinate with the owner to pick up your item.",
            });
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
            securityDeposit: (selectedRequest.item as any).securityDeposit,
            photos: selectedRequest.item.photos,
          }}
          onSuccess={() => {
            setShowRentalDepositModal(false);
            setSelectedRequest(null);
            toast({
              title: "Rental deposit secured!",
              description: "Coordinate with the owner to pick up your rental.",
            });
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
          requestType={selectedRequest.requestType as "BORROW" | "RENT" | "GIFT" | "SWAP"}
          deliveryMethod={
            (selectedRequest.deliveryMethod as "in_person" | "courier") || "in_person"
          }
          otherPartyConfirmed={
            selectedRequest.requesterId === user?.id
              ? selectedRequest.ownerConfirmedHandoff
              : selectedRequest.borrowerConfirmedHandoff
          }
          pinExpiresAt={(selectedRequest as any).pinExpiresAt}
          pinUsed={(selectedRequest as any).pinUsed}
          onSuccess={() => {
            setShowHandoffModal(false);
            setSelectedRequest(null);
          }}
        />
      )}

      {selectedRequest && showCourierHandoffModal && (
        <CourierHandoffModal
          isOpen={showCourierHandoffModal}
          onClose={() => {
            setShowCourierHandoffModal(false);
            setSelectedRequest(null);
          }}
          requestId={selectedRequest.id}
          itemName={selectedRequest.item.name}
          onSuccess={() => {
            setShowCourierHandoffModal(false);
            setSelectedRequest(null);
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
          depositMethod={selectedRequest.depositMethod}
          onSuccess={() => {
            const isOwner = selectedRequest.requesterId !== user?.id;
            setShowReturnModal(false);
            if (isOwner) {
              setReviewForRequest(selectedRequest);
              setShowReviewPrompt(true);
            }
            setSelectedRequest(null);
          }}
        />
      )}

      {reviewForRequest && (() => {
        const reviewingAsOwner = reviewForRequest.item.ownerId === user?.id;
        const reviewedUserId = reviewingAsOwner
          ? reviewForRequest.requester.id
          : reviewForRequest.item.ownerId;
        const reviewedUserName = reviewingAsOwner
          ? (reviewForRequest.requester.displayName || reviewForRequest.requester.username)
          : (reviewForRequest.owner?.displayName || reviewForRequest.owner?.username || "Item Owner");
        return (
          <PostReturnReviewModal
            isOpen={showReviewPrompt}
            onClose={() => {
              setShowReviewPrompt(false);
              setReviewForRequest(null);
            }}
            reviewedUserId={reviewedUserId}
            reviewedUserName={reviewedUserName}
            requestId={reviewForRequest.id}
            requestType={reviewForRequest.requestType as "BORROW" | "RENT" | "SWAP" | "GIFT"}
            wasDisputed={!!reviewForRequest.returnDisputeTriggered}
            wasLate={
              !!reviewForRequest.endDate &&
              new Date() > new Date(reviewForRequest.endDate)
            }
          />
        );
      })()}

      {/* Swap received-item inventory prompt */}
      {swapInventoryItem && (
        <Dialog
          open={showSwapInventoryPrompt}
          onOpenChange={(open) => { if (!open) setShowSwapInventoryPrompt(false); }}
        >
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[400px] p-0 overflow-hidden">
            <div className="bg-gradient-to-br from-[#0DCEA1] to-[#0BB88C] p-5 text-white">
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 bg-white/10 rounded-xl overflow-hidden flex-shrink-0">
                  {swapInventoryItem.photos?.[0] ? (
                    <img
                      src={swapInventoryItem.photos[0]}
                      alt={swapInventoryItem.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Package className="h-8 w-8 text-white/50 m-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-white/70 font-medium uppercase tracking-wide mb-0.5">
                    Swap complete
                  </p>
                  <h3 className="font-bold text-base leading-tight truncate">
                    {swapInventoryItem.name}
                  </h3>
                </div>
              </div>
            </div>
            <div className="p-5">
              <h4 className="font-semibold text-gray-900 mb-1">
                Add item to your inventory?
              </h4>
              <p className="text-sm text-muted-foreground mb-4">
                Review and edit item details before publishing.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowSwapInventoryPrompt(false)}
                >
                  Maybe Later
                </Button>
                <Button
                  className="flex-1 bg-[#0DCEA1] hover:bg-[#0BB88C]"
                  onClick={handleAddSwapItemToInventory}
                >
                  <Package className="h-4 w-4 mr-2" />
                  Add to Inventory
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Chat Counter-Proposal Modal */}
      {/* Swap counter modal */}
      {swapCounterRequest && (
        <SwapCounterModal
          key={swapCounterRequest.id}
          open={showSwapCounterModal}
          onClose={() => { setShowSwapCounterModal(false); setSwapCounterRequest(null); }}
          request={swapCounterRequest}
          currentUserId={user?.id ?? 0}
          isOwner={swapCounterIsOwner}
          isPending={swapCounterMutation.isPending}
          onSubmit={({ swapOwnerItemIds, swapRequesterItemIds, counterNote, isResponse }) => {
            swapCounterMutation.mutate({
              requestId: swapCounterRequest.id,
              swapOwnerItemIds,
              swapRequesterItemIds,
              counterNote,
              isResponse,
            });
          }}
        />
      )}

      <Dialog open={showChatCounterModal} onOpenChange={setShowChatCounterModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-amber-500" />
              Propose New Terms
            </DialogTitle>
            <DialogDescription>
              Suggest changes to dates or deposit handling. The other party can accept, decline, or counter again.
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
                deliveryMethod: "in_person",
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

      {/* Cancel booking confirmation dialog */}
      <Dialog open={!!cancelConfirmRequest} onOpenChange={(open) => { if (!open) setCancelConfirmRequest(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel this booking?</DialogTitle>
            <DialogDescription>
              {cancelConfirmRequest?.status === "ACCEPTED" && "The owner has already accepted your request."}
              {cancelConfirmRequest?.status === "DEPOSIT_CONFIRMED" && "Your deposit will be refunded automatically."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setCancelConfirmRequest(null)}>
              Keep booking
            </Button>
            <Button
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={() => cancelConfirmRequest && cancelMutation.mutate(cancelConfirmRequest.id)}
            >
              {cancelMutation.isPending ? "Cancelling…" : "Cancel booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
