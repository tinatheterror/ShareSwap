import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState, useRef, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Shield, Coins, Calendar, CreditCard } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost, apiPatch, photoUrl } from "@/lib/api";
import { fmtDate as fmtDateUtil, safeDate } from "@/lib/dateUtils";
import { useAuth } from "@/context/AuthContext";
import { InsufficientShareCoinsModal } from "@/components/InsufficientShareCoinsModal";
import { PayDepositSheet } from "@/components/PayDepositSheet";
import { PayRentalSheet } from "@/components/PayRentalSheet";
import { HandoffSheet } from "@/components/HandoffSheet";
import { ReturnConfirmationSheet } from "@/components/ReturnConfirmationSheet";
import { PostReturnReviewSheet } from "@/components/PostReturnReviewSheet";
import CounterProposalSheet, { type CounterPayload } from "@/components/CounterProposalSheet";
import ExtensionSheet from "@/components/ExtensionSheet";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Message {
  id: number;
  content: string;
  senderId: number | null;
  createdAt: string;
  messageType?: string;
  requestId?: number | null;
  metadata?: Record<string, unknown>;
}

interface PublicProfile {
  id: number;
  username: string;
  displayName: string | null;
  profilePhoto: string | null;
  isVerified: boolean;
  reputationScore: number;
  lastActiveAt: string | null;
  reviewCount: number;
  averageRating: number | null;
  responseTime: string | null;
}

interface RequestItem {
  id: number;
  name: string | null;
  photos: string[] | null;
  ownerId: number | null;
  shareCoinPrice: number | null;
  tier: number | null;
  replacementValue: number | null;
  originalValue: string | null;
  category: string | null;
  dollarsPrice: string | null;
  securityDeposit: number | null;
}

interface ItemRequest {
  id: number;
  requestType: string;
  status: string;
  requesterId: number;
  startDate: string | null;
  endDate: string | null;
  depositMethod: string | null;
  deliveryMethod: string | null;
  message: string | null;
  negotiationStatus: string | null;
  counterProposedBy: number | null;
  counterStartDate: string | null;
  counterEndDate: string | null;
  counterDepositMethod: string | null;
  counterRound: number | null;
  swapOfferedItemIds: number[] | null;
  swapOfferedItems?: { id: number; name: string; photos: string[] | null; tier?: number | null }[];
  counterSwapOwnerItemIds: number[] | null;
  counterSwapRequesterItemIds: number[] | null;
  counterNote: string | null;
  trustDepositAmount: number | null;
  trustDepositBaseAmount: number | null;
  trustDiscountPercentage: number | null;
  shareCoinAmount: number | null;
  depositStatus: string | null;
  actualHandoffAt: string | null;
  returnDelayNotifiedAt: string | null;
  // Co-confirmation fields returned by GET /api/requests (routes.ts:5173-5174)
  ownerConfirmedHandoff: boolean | null;
  borrowerConfirmedHandoff: boolean | null;
  item: RequestItem | null;
}

interface ExtensionRequest {
  id: number;
  requestId: number;
  borrowerId: number;
  ownerId: number;
  requestedEndDate: string;
  status: string;
  message: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getActiveStatus(lastActiveAt: string | null): { label: string; isNow: boolean } | null {
  if (!lastActiveAt) return null;
  const diff = Date.now() - safeDate(lastActiveAt).getTime();
  const min = diff / 60_000;
  const hrs = diff / 3_600_000;
  const days = diff / 86_400_000;
  if (min < 10) return { label: "Active now", isNow: true };
  if (hrs < 24) return { label: "Active today", isNow: false };
  if (days < 7) return { label: "Active this week", isNow: false };
  if (days < 30) return { label: "Active this month", isNow: false };
  return null;
}

function getInitials(displayName: string | null, username: string): string {
  const name = displayName || username;
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function timeAgo(dateStr: string): string {
  const parsed = safeDate(dateStr);
  if (isNaN(parsed.getTime())) return "–";
  const diff = Date.now() - parsed.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const fmtDate = fmtDateUtil;
type StatusInfo = { label: string; color: string; bg: string };
function getStatusInfo(status: string): StatusInfo {
  switch (status) {
    case "PENDING":              return { label: "Pending",           color: "#92400e", bg: "#fef3c7" };
    case "ACCEPTED":             return { label: "Accepted",          color: "#1d4ed8", bg: "#dbeafe" };
    case "DEPOSIT_CONFIRMED":    return { label: "Ready to hand off", color: "#0369a1", bg: "#e0f2fe" };
    case "AWAITING_HANDOFF_CONFIRM": return { label: "Awaiting handoff", color: "#0369a1", bg: "#e0f2fe" };
    case "IN_PROGRESS":          return { label: "In progress",       color: "#0f766e", bg: "#ccfbf1" };
    case "RETURN_REQUESTED":     return { label: "Return requested",  color: "#7e22ce", bg: "#f3e8ff" };
    case "COMPLETED":
    case "COMPLETED_EARLY":      return { label: "Completed ✓",      color: "#15803d", bg: "#dcfce7" };
    case "DECLINED":             return { label: "Declined",          color: "#991b1b", bg: "#fee2e2" };
    case "CANCELLED":            return { label: "Cancelled",         color: "#6b7280", bg: "#f3f4f6" };
    case "DISPUTED":             return { label: "Disputed ⚠️",      color: "#c2410c", bg: "#ffedd5" };
    default:                     return { label: status.replace(/_/g, " "), color: "#374151", bg: "#f3f4f6" };
  }
}

const PRIMARY = "#0DCEA1";
const TERMINAL = ["COMPLETED", "COMPLETED_EARLY", "DECLINED", "CANCELLED", "DISPUTED"];

// ── Component ─────────────────────────────────────────────────────────────────
export default function ChatScreen() {
  const { id, requestId } = useLocalSearchParams<{ id: string; requestId?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const isWeb = Platform.OS === "web";
  const flatListRef = useRef<FlatList>(null);
  const sendingRef = useRef(false);

  const [text, setText] = useState("");
  const [showEarnModal, setShowEarnModal] = useState(false);
  const [earnRequired, setEarnRequired] = useState(0);
  const [earnContext, setEarnContext] = useState<"borrow" | "swap">("borrow");

  // Payment sheets
  const [showDepositSheet, setShowDepositSheet] = useState(false);
  const [showRentalSheet, setShowRentalSheet] = useState(false);

  // Handoff / return / review sheets
  const [showHandoffSheetOwner, setShowHandoffSheetOwner] = useState(false);
  const [showHandoffSheetBorrower, setShowHandoffSheetBorrower] = useState(false);
  const [showReturnSheet, setShowReturnSheet] = useState(false);
  const [showConfirmReturnSheet, setShowConfirmReturnSheet] = useState(false);
  const [showReviewSheet, setShowReviewSheet] = useState(false);

  // Counter-proposal sheet
  const [showCounterSheet, setShowCounterSheet] = useState(false);

  // Extension sheet
  const [showExtensionSheet, setShowExtensionSheet] = useState(false);


  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: partner } = useQuery<PublicProfile>({
    queryKey: [`/api/users/${id}/public-profile`],
    queryFn: () => apiGet<PublicProfile>(`/api/users/${id}/public-profile`),
    enabled: !!id,
  });

  const messagesUrl = requestId
    ? `/api/messages/${id}?requestId=${requestId}`
    : `/api/messages/${id}`;

  const { data: messages, isLoading } = useQuery<Message[]>({
    queryKey: [`/api/messages/${id}`, requestId ?? null],
    queryFn: () => apiGet<Message[]>(messagesUrl),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const { data: allRequests } = useQuery<ItemRequest[]>({
    queryKey: ["/api/requests"],
    queryFn: () => apiGet<ItemRequest[]>("/api/requests"),
    enabled: !!requestId,
    refetchInterval: 8000,
  });

  const reqId = requestId ? parseInt(requestId) : null;
  const request = reqId ? (allRequests?.find((r) => r.id === reqId) ?? null) : null;

  // Extension queries — only active during an in-progress borrow
  const isInProgressBorrow =
    request?.status === "IN_PROGRESS" && request?.requestType === "BORROW";

  const { data: pendingExtension } = useQuery<ExtensionRequest | null>({
    queryKey: [`/api/requests/${requestId}/extension`],
    queryFn: () => apiGet<ExtensionRequest | null>(`/api/requests/${requestId}/extension`),
    enabled: !!requestId && isInProgressBorrow,
    refetchInterval: 8000,
  });

  const { data: activeExtensions } = useQuery<ExtensionRequest[]>({
    queryKey: ["/api/extensions/active"],
    queryFn: () => apiGet<ExtensionRequest[]>("/api/extensions/active"),
    enabled: !!requestId && isInProgressBorrow,
    refetchInterval: 8000,
  });

  const hasPendingExtension = !!pendingExtension;
  const hasAcceptedExtension = !!(
    reqId && activeExtensions?.some((e) => e.requestId === reqId && e.status === "accepted")
  );
  const isOverdue = !!(request?.endDate && new Date() > new Date(request.endDate));

  // Auto-show review sheet on first transition to COMPLETED/COMPLETED_EARLY
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!request) return;
    const prev = prevStatusRef.current;
    const curr = request.status;
    prevStatusRef.current = curr;
    if (
      prev &&
      prev !== "COMPLETED" &&
      prev !== "COMPLETED_EARLY" &&
      (curr === "COMPLETED" || curr === "COMPLETED_EARLY")
    ) {
      setShowReviewSheet(true);
    }
  }, [request?.status]);

  const isOwner = !!(request && request.item?.ownerId === user?.id);
  const isBorrower = !!(request && request.requesterId === user?.id);
  // Counter proposed to ME (I must respond)
  const hasPendingCounter =
    request?.negotiationStatus === "counter_proposed" &&
    request.counterProposedBy !== null &&
    request.counterProposedBy !== user?.id;
  // Counter proposed BY ME (waiting for other side to respond)
  const iSentCounter =
    request?.negotiationStatus === "counter_proposed" &&
    request.counterProposedBy === user?.id;

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["/api/requests"] });
    qc.invalidateQueries({ queryKey: [`/api/messages/${id}`, requestId ?? null] });
    // Invalidate both active and archived inbox so status transitions (accept,
    // decline, cancel, complete) move the thread to the correct bucket
    // immediately — matching web's chat-widget.tsx invalidation pattern.
    qc.invalidateQueries({ queryKey: ["/api/inbox"] });
    qc.invalidateQueries({ queryKey: ["/api/inbox/archived"] });
  }

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const acceptMutation = useMutation({
    mutationFn: () => apiPatch(`/api/requests/${requestId}`, { status: "ACCEPTED" }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidateAll();
    },
    onError: (e: any) => {
      if (e?.code === "INSUFFICIENT_SHARECOINS") {
        const required = e.required ?? 0;
        if (e.payerIsRequester) {
          Alert.alert(
            "Not Enough ShareCoins",
            `This swap can't proceed — the requester needs ${required} ShareCoins to cover the value difference but doesn't have enough.`,
          );
        } else {
          setEarnRequired(required);
          setEarnContext("swap");
          setShowEarnModal(true);
        }
      } else {
        Alert.alert("Error", e.message || "Failed to accept request");
      }
    },
  });

  const declineMutation = useMutation({
    mutationFn: () => apiPatch(`/api/requests/${requestId}`, { status: "DECLINED" }),
    onSuccess: () => invalidateAll(),
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: () => {
      const cancelRequestId = request?.id ?? reqId;
      if (!cancelRequestId) {
        throw new Error("Unable to identify this request. Please reopen the chat and try again.");
      }
      return apiPost(`/api/requests/${cancelRequestId}/cancel`, {});
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["/api/items"] });
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  function confirmAcceptedRequestCancellation() {
    const message = "The owner has already accepted your request.";
    if (isWeb && typeof window !== "undefined") {
      if (window.confirm(`Cancel request?\n\n${message}`)) {
        cancelMutation.mutate();
      }
      return;
    }
    Alert.alert("Cancel request?", message, [
      { text: "Keep booking", style: "cancel" },
      { text: "Cancel", style: "destructive", onPress: () => cancelMutation.mutate() },
    ]);
  }

  const acceptCounterMutation = useMutation({
    mutationFn: () => {
      // Only the requester pays ShareCoins. If they are accepting an owner's
      // counter, validate the final dates before sending the acceptance.
      if (request?.requestType === "BORROW" && request.requesterId === user?.id) {
        const weeklyPrice = parseFloat(String(request.item?.shareCoinPrice ?? 0)) || 5;
        const startDate = request.counterStartDate || request.startDate;
        const endDate = request.counterEndDate || request.endDate;
        const days = startDate && endDate
          ? Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000))
          : 0;
        const required = days > 0 ? Math.max(1, Math.ceil((weeklyPrice / 7) * days)) : weeklyPrice;
        if (Number((user as any)?.shareCoins ?? 0) < required) {
          const error: any = new Error("Insufficient ShareCoins");
          error.code = "PREFLIGHT_INSUFFICIENT";
          error.required = required;
          throw error;
        }
      }
      return apiPost(`/api/requests/${requestId}/respond-to-counter`, { accept: true });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidateAll();
    },
    onError: (e: any) => {
      if (e?.code === "PREFLIGHT_INSUFFICIENT" || e?.code === "INSUFFICIENT_SHARECOINS") {
        if (request?.requesterId === user?.id) {
          setEarnRequired(e.required ?? 0);
          setEarnContext("borrow");
          setShowEarnModal(true);
        } else {
          Alert.alert("Borrower needs more ShareCoins", e.message || "The borrower cannot afford these dates yet.");
        }
      } else {
        Alert.alert("Error", e.message || "Failed to accept counter");
      }
    },
  });

  const declineCounterMutation = useMutation({
    mutationFn: () => apiPost(`/api/requests/${requestId}/respond-to-counter`, { accept: false }),
    onSuccess: () => invalidateAll(),
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const counterMutation = useMutation({
    mutationFn: (payload: CounterPayload) => {
      // Only a borrower/requester spends ShareCoins. Validate their chosen
      // date range before sending the counter, rather than blocking the owner
      // from accepting it later.
      if (request?.requestType === "BORROW" && request.requesterId === user?.id) {
        const weeklyPrice = parseFloat(String(request.item?.shareCoinPrice ?? 0)) || 5;
        const startD = payload.startDate || request.counterStartDate || request.startDate;
        const endD = payload.endDate || request.counterEndDate || request.endDate;
        const days = startD && endD
          ? Math.max(1, Math.ceil((new Date(endD).getTime() - new Date(startD).getTime()) / 86400000))
          : 0;
        const required = days > 0 ? Math.max(1, Math.ceil((weeklyPrice / 7) * days)) : weeklyPrice;
        if (Number((user as any)?.shareCoins ?? 0) < required) {
          const err: any = new Error("Insufficient ShareCoins");
          err.code = "PREFLIGHT_INSUFFICIENT";
          err.required = required;
          err.context = "borrow";
          throw err;
        }
      }
      if (payload.isResponse) {
        // Counter-back: respond to an existing counter with new terms
        const { isResponse, ...counterFields } = payload;
        return apiPost(`/api/requests/${requestId}/respond-to-counter`, { counter: counterFields });
      }
      return apiPost(`/api/requests/${requestId}/counter-proposal`, payload);
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowCounterSheet(false);
      invalidateAll();
    },
    onError: (e: any) => {
      if (e?.code === "PREFLIGHT_INSUFFICIENT" || e?.code === "INSUFFICIENT_SHARECOINS") {
        setShowCounterSheet(false);
        setEarnRequired(e.required ?? 0);
        setEarnContext("borrow");
        setShowEarnModal(true);
      } else {
        Alert.alert("Error", e.message || "Failed to send counter");
      }
    },
  });

  const requestExtensionMutation = useMutation({
    mutationFn: (days: 1 | 2 | 3) =>
      apiPost(`/api/requests/${requestId}/extension`, { days }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowExtensionSheet(false);
      qc.invalidateQueries({ queryKey: [`/api/requests/${requestId}/extension`] });
      qc.invalidateQueries({ queryKey: ["/api/extensions/active"] });
      invalidateAll();
    },
    onError: (e: any) =>
      Alert.alert("Error", e.message || "Could not request extension"),
  });

  const respondExtensionMutation = useMutation({
    mutationFn: (action: "accept" | "decline") =>
      apiPost(`/api/requests/${requestId}/extension/respond`, { action }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: [`/api/requests/${requestId}/extension`] });
      qc.invalidateQueries({ queryKey: ["/api/extensions/active"] });
      invalidateAll();
    },
    onError: (e: any) =>
      Alert.alert("Error", e.message || "Could not respond to extension"),
  });

  const notifyDelayMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/requests/${requestId}/notify-delay`, {}),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidateAll();
    },
    onError: (e: any) => {
      const msg = e?.alreadyOverdue
        ? "The due date has already passed — you can no longer notify in advance."
        : e.message || "Could not send delay notification";
      Alert.alert("Could not notify", msg);
    },
  });

  // ── Request card ─────────────────────────────────────────────────────────────
  function renderRequestCard() {
    if (!request) return null;

    const { status } = request;
    const statusInfo = getStatusInfo(status);
    const itemName = request.item?.name ?? "Item";
    const itemPhoto = request.item?.photos?.[0] ?? null;
    const isBorrowType = request.requestType === "BORROW";
    const isTerminal = TERMINAL.includes(status);

    const depositAmt = request.trustDepositAmount;
    const depositBase = request.trustDepositBaseAmount;
    const depositDiscount = request.trustDiscountPercentage;
    const coinAmt = request.shareCoinAmount;
    const depositMethodLabel = request.depositMethod === "in_app" ? "In-app" : "In-person";

    const handoffStatuses = ["DEPOSIT_CONFIRMED", "AWAITING_HANDOFF_CONFIRM", "ACCEPTED"];
    const showHandoffForOwner =
      isOwner &&
      (handoffStatuses.includes(status)) &&
      request.depositMethod !== "in_app";
    const showHandoffForOwnerInApp =
      isOwner && status === "DEPOSIT_CONFIRMED";
    const canConfirmOwnerHandoff = showHandoffForOwner || showHandoffForOwnerInApp;

    const showPinEntryForBorrower =
      isBorrower &&
      (status === "DEPOSIT_CONFIRMED" || status === "AWAITING_HANDOFF_CONFIRM" ||
        (status === "ACCEPTED" && request.depositMethod !== "in_app"));

    const showDepositNeeded =
      isBorrower && status === "ACCEPTED" && request.depositMethod === "in_app";

    const anyMutating =
      acceptMutation.isPending || declineMutation.isPending ||
      cancelMutation.isPending || acceptCounterMutation.isPending ||
      declineCounterMutation.isPending;

    return (
      <View style={[card.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Header: photo + name + inline details + status badge top-right */}
        <View style={card.itemRow}>
          <View style={[card.thumb, { backgroundColor: colors.muted }]}>
            {itemPhoto ? (
              <Image source={{ uri: photoUrl(itemPhoto) }} style={card.thumbImg} resizeMode="cover" />
            ) : (
              <Feather name="box" size={20} color={colors.mutedForeground} />
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            {/* Name row with status badge pushed to top-right */}
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
              <Text style={[card.itemName, { color: colors.foreground, flex: 1 }]} numberOfLines={2}>
                {itemName}
              </Text>
              <View style={[card.statusBadge, { backgroundColor: statusInfo.bg, flexShrink: 0 }]}>
                <Text style={[card.statusBadgeText, { color: statusInfo.color }]}>
                  {statusInfo.label}
                </Text>
              </View>
            </View>

            {/* Who / what role */}
            <View style={card.detailRow}>
              <Feather name="user" size={12} color={colors.mutedForeground} />
              <Text style={[card.detailText, { color: colors.mutedForeground }]}>
                {isOwner && partner
                  ? `${partner.displayName || partner.username} wants to ${request.requestType === "GIFT" ? "claim gift" : (request.requestType?.toLowerCase() ?? "borrow")}`
                  : `You requested to ${request.requestType === "GIFT" ? "claim gift" : (request.requestType?.toLowerCase() ?? "borrow")}`}
              </Text>
            </View>

            {/* Dates */}
            {(request.startDate || request.endDate) && (
              <View style={{ gap: 1 }}>
                <View style={card.detailRow}>
                  <Feather name="clock" size={12} color={colors.mutedForeground} />
                  <Text style={[card.detailText, { color: colors.mutedForeground }]}>
                    {(status === "IN_PROGRESS" || status === "RETURN_REQUESTED") ? "Booked: " : ""}
                    {fmtDate(request.startDate)} – {fmtDate(request.endDate)}
                  </Text>
                </View>
                {request.actualHandoffAt && (
                  <Text style={[card.detailText, { color: colors.mutedForeground, paddingLeft: 17 }]}>
                    Handoff completed: {fmtDate(request.actualHandoffAt)}
                  </Text>
                )}
              </View>
            )}

            {/* Deposit method — always shown for BORROW */}
            {isBorrowType && request.depositMethod && (
              <View style={card.detailRow}>
                <Shield size={12} color={colors.mutedForeground} strokeWidth={2} />
                <Text style={[card.detailText, { color: colors.mutedForeground }]}>
                  {"Deposit "}
                  {request.depositMethod === "in_app" ? "in-app" : "in-person"}
                  {depositAmt != null ? `: $${depositAmt}` : ""}
                </Text>
              </View>
            )}

            {/* ShareCoins */}
            {coinAmt != null && (
              <View style={card.detailRow}>
                <Coins size={12} color={PRIMARY} strokeWidth={2} />
                <Text style={[card.detailText, { color: colors.mutedForeground }]}>
                  <Text style={{ color: PRIMARY, fontFamily: "Inter_600SemiBold" }}>{coinAmt}</Text>
                  {" ShareCoins"}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Actions ── */}
        {!isTerminal && (
          <View style={[card.actionsWrap, { borderTopColor: colors.border }]}>

            {/* Counter-proposal received: Accept or Decline counter */}
            {hasPendingCounter && (
              <>
                <View style={[card.counterBanner, { backgroundColor: "#fffbeb", borderColor: "#fcd34d" }]}>
                  <Text style={[card.counterBannerTitle, { color: "#92400e" }]}>Counter-proposal received</Text>
                  {request.counterStartDate && (
                    <Text style={[card.counterBannerText, { color: "#78350f" }]}>
                      📅 {fmtDate(request.counterStartDate)} – {fmtDate(request.counterEndDate)}
                    </Text>
                  )}
                  {request.counterDepositMethod && (
                    <Text style={[card.counterBannerText, { color: "#78350f" }]}>
                      🛡 Deposit: {request.counterDepositMethod === "in_app" ? "In-app" : "In-person"}
                    </Text>
                  )}
                </View>
                <View style={card.btnRow}>
                  <Pressable
                    style={[card.btn, { backgroundColor: PRIMARY, borderColor: PRIMARY, flex: 1 }]}
                    onPress={() => acceptCounterMutation.mutate()}
                    disabled={anyMutating}
                  >
                    {acceptCounterMutation.isPending
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={[card.btnLabel, { color: "#fff" }]}>Accept</Text>
                    }
                  </Pressable>
                  {(request.counterRound ?? 0) < 2 && (
                    <Pressable
                      style={[card.btn, { borderColor: "#f59e0b", backgroundColor: "#fffbeb", flex: 1 }]}
                      onPress={() => setShowCounterSheet(true)}
                      disabled={anyMutating}
                    >
                      <Text style={[card.btnLabel, { color: "#b45309" }]}>Counter</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={[card.btn, { borderColor: colors.border, flex: 1 }]}
                    onPress={() => declineCounterMutation.mutate()}
                    disabled={anyMutating}
                  >
                    <Text style={[card.btnLabel, { color: colors.foreground }]}>Decline</Text>
                  </Pressable>
                </View>
              </>
            )}

            {/* I sent a counter — waiting for the other side to respond */}
            {iSentCounter && (
              <View style={[card.counterBanner, { backgroundColor: "#fffbeb", borderColor: "#fcd34d" }]}>
                <Text style={[card.counterBannerTitle, { color: "#92400e" }]}>
                  ⏳ Waiting for the other party to respond to your proposed terms
                </Text>
                {request.counterStartDate && (
                  <Text style={[card.counterBannerText, { color: "#78350f" }]}>
                    📅 {fmtDate(request.counterStartDate)} – {fmtDate(request.counterEndDate)}
                  </Text>
                )}
                {request.counterDepositMethod && (
                  <Text style={[card.counterBannerText, { color: "#78350f" }]}>
                    🛡 Deposit: {request.counterDepositMethod === "in_app" ? "Handle Deposit In-app" : "Exchange Deposit In Person"}
                  </Text>
                )}
              </View>
            )}

            {/* Terms accepted — owner can now accept */}
            {request.negotiationStatus === "terms_accepted" && isOwner && status === "PENDING" && (
              <View style={[card.counterBanner, { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" }]}>
                <Text style={[card.counterBannerTitle, { color: "#15803d" }]}>
                  ✓ Requester accepted your proposed terms. You can now accept the request.
                </Text>
              </View>
            )}

            {/* PENDING: no counter active, and not waiting on our own counter */}
            {status === "PENDING" && !hasPendingCounter && !iSentCounter && (
              <View style={card.btnRow}>
                {isOwner && (
                  <>
                    <Pressable
                      style={[card.btn, { backgroundColor: PRIMARY, borderColor: PRIMARY, flex: 1 }]}
                      onPress={() => acceptMutation.mutate()}
                      disabled={anyMutating}
                    >
                      {acceptMutation.isPending
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={[card.btnLabel, { color: "#fff" }]}>Accept</Text>
                      }
                    </Pressable>
                    <Pressable
                      style={[card.btn, { borderColor: "#f59e0b", backgroundColor: "#fffbeb", flex: 1 }]}
                      onPress={() => setShowCounterSheet(true)}
                      disabled={anyMutating}
                    >
                      <Text style={[card.btnLabel, { color: "#b45309" }]}>Counter</Text>
                    </Pressable>
                    <Pressable
                      style={[card.btn, { borderColor: colors.border, flex: 1 }]}
                      onPress={() =>
                        Alert.alert("Decline request?", "The borrower will be notified.", [
                          { text: "Cancel", style: "cancel" },
                          { text: "Decline", style: "destructive", onPress: () => declineMutation.mutate() },
                        ])
                      }
                      disabled={anyMutating}
                    >
                      {declineMutation.isPending
                        ? <ActivityIndicator size="small" color={colors.foreground} />
                        : <Text style={[card.btnLabel, { color: colors.foreground }]}>Decline</Text>
                      }
                    </Pressable>
                  </>
                )}
                {/* Borrower: PENDING = free cancel, shown as plain text link (mirrors web) */}
                {isBorrower &&
                  !iSentCounter &&
                  request.negotiationStatus !== "terms_accepted" && (
                  <Pressable
                    onPress={() => cancelMutation.mutate()}
                    disabled={anyMutating}
                    style={{ paddingVertical: 4 }}
                  >
                    {cancelMutation.isPending
                      ? <ActivityIndicator size="small" color={colors.mutedForeground} />
                      : <Text style={[card.btnLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>Cancel</Text>
                    }
                  </Pressable>
                )}
              </View>
            )}

            {/* RENT + ACCEPTED: pay rental + deposit */}
            {isBorrower && status === "ACCEPTED" && request.requestType === "RENT" && (
              <Pressable
                style={[card.btn, { backgroundColor: "#16a34a", borderColor: "#16a34a" }]}
                onPress={() => setShowRentalSheet(true)}
                disabled={anyMutating}
              >
                <CreditCard size={14} color="#fff" strokeWidth={2} />
                <Text style={[card.btnLabel, { color: "#fff" }]}>Pay & Confirm Booking</Text>
              </Pressable>
            )}

            {/* DEPOSIT_CONFIRMED: borrower can still cancel (deposit will be refunded) */}
            {status === "DEPOSIT_CONFIRMED" && isBorrower && (
              <Pressable
                style={{ alignItems: "center", paddingVertical: 6 }}
                onPress={() =>
                  Alert.alert("Cancel this booking?", "Your deposit will be refunded automatically.", [
                    { text: "Keep booking", style: "cancel" },
                    { text: "Cancel", style: "destructive", onPress: () => cancelMutation.mutate() },
                  ])
                }
                disabled={anyMutating}
              >
                {cancelMutation.isPending
                  ? <ActivityIndicator size="small" color={colors.mutedForeground} />
                  : <Text style={[card.btnLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>Cancel</Text>
                }
              </Pressable>
            )}

            {/* GIFT owner: cancel an accepted gift (e.g. receiver never showed up) */}
            {isOwner && request.requestType === "GIFT" && status === "ACCEPTED" && (
              <Pressable
                style={{ alignItems: "center", paddingVertical: 6 }}
                onPress={() =>
                  Alert.alert("Cancel this gift?", "The requester will be notified.", [
                    { text: "Keep it", style: "cancel" },
                    { text: "Cancel", style: "destructive", onPress: () => cancelMutation.mutate() },
                  ])
                }
                disabled={anyMutating}
              >
                {cancelMutation.isPending
                  ? <ActivityIndicator size="small" color={colors.mutedForeground} />
                  : <Text style={[card.btnLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>Cancel</Text>
                }
              </Pressable>
            )}

            {/* ACCEPTED + in_app deposit: borrower pays deposit */}
            {showDepositNeeded && (
              <Pressable
                style={[card.btn, { backgroundColor: "#0d9488", borderColor: "#0d9488" }]}
                onPress={() => setShowDepositSheet(true)}
                disabled={anyMutating}
              >
                <Shield size={14} color="#fff" strokeWidth={2} />
                <Text style={[card.btnLabel, { color: "#fff" }]}>
                  {request.requestType === "RENT" ? "Pay Security Deposit" : "Pay Trust Deposit"}
                </Text>
              </Pressable>
            )}

            {/* ACCEPTED: borrower can always cancel before deposit or handoff */}
            {status === "ACCEPTED" && isBorrower && (
              <Pressable
                style={{ alignItems: "center", paddingVertical: 6 }}
                onPress={confirmAcceptedRequestCancellation}
                disabled={anyMutating}
              >
                {cancelMutation.isPending
                  ? <ActivityIndicator size="small" color={colors.foreground} />
                  : <Text style={[card.btnLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>Cancel</Text>
                }
              </Pressable>
            )}

            {/* ACCEPTED + in_app deposit: owner waits */}
            {isOwner && status === "ACCEPTED" && request.depositMethod === "in_app" && (
              <View style={[card.infoBanner, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Text style={[card.infoBannerText, { color: colors.mutedForeground }]}>
                  Waiting for the borrower to confirm their in-app deposit.
                </Text>
              </View>
            )}

            {/* Owner has one handoff action: confirmation opens the sheet. */}
            {canConfirmOwnerHandoff && (
              <Pressable
                style={[card.btn, { backgroundColor: "#0d9488", borderColor: "#0d9488" }]}
                onPress={() => setShowHandoffSheetOwner(true)}
                disabled={anyMutating}
              >
                <Feather name="check-circle" size={14} color="#fff" />
                <Text style={[card.btnLabel, { color: "#fff" }]}>Confirm handoff</Text>
              </Pressable>
            )}

            {/* Borrower: enter handoff code (opens HandoffSheet) */}
            {showPinEntryForBorrower && !hasPendingCounter && (
              <Pressable
                style={[card.btn, { backgroundColor: "#4f46e5", borderColor: "#4f46e5" }]}
                onPress={() => setShowHandoffSheetBorrower(true)}
              >
                <Text style={[card.btnLabel, { color: "#fff" }]}>Enter handoff code</Text>
              </Pressable>
            )}

            {/* IN_PROGRESS — borrower */}
            {status === "IN_PROGRESS" && isBorrower && (
              <View style={{ gap: 8 }}>
                <Pressable
                  style={[card.btn, { backgroundColor: "#2563eb", borderColor: "#2563eb" }]}
                  onPress={() => setShowReturnSheet(true)}
                  disabled={anyMutating}
                >
                  <Feather name="rotate-ccw" size={14} color="#fff" />
                  <Text style={[card.btnLabel, { color: "#fff" }]}>Return item</Text>
                </Pressable>

                {/* Extension controls remain visible but unavailable while the
                    owner decides, or after the one free extension is used. */}
                {!isOverdue && (
                  <>
                    <Pressable
                      style={[
                        card.btn,
                        {
                          borderColor: colors.border,
                          backgroundColor: hasPendingExtension || hasAcceptedExtension ? colors.muted : "transparent",
                          opacity: hasPendingExtension || hasAcceptedExtension ? 0.55 : 1,
                        },
                      ]}
                      disabled={hasPendingExtension || hasAcceptedExtension || requestExtensionMutation.isPending}
                      onPress={() => setShowExtensionSheet(true)}
                    >
                      <Feather name="clock" size={14} color={colors.foreground} />
                      <Text style={[card.btnLabel, { color: colors.foreground }]}>Need more time?</Text>
                    </Pressable>
                    {hasPendingExtension && (
                      <Text style={[{ fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" as const }, { color: "#92400e" }]}>
                        Extension pending owner approval
                      </Text>
                    )}
                    {hasAcceptedExtension && (
                      <Text style={[{ fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" as const }, { color: colors.mutedForeground }]}>
                        Your free extension has already been used.
                      </Text>
                    )}
                  </>
                )}

                {/* A late-return notice is unavailable until a pending
                    extension is resolved, and remains disabled once sent. */}
                {!isOverdue && (
                  <>
                  <Pressable
                    style={[
                      card.btn,
                      {
                        borderColor: request.returnDelayNotifiedAt || hasPendingExtension ? colors.border : "#f59e0b",
                        backgroundColor: request.returnDelayNotifiedAt || hasPendingExtension ? colors.muted : "#fffbeb",
                        opacity: request.returnDelayNotifiedAt || hasPendingExtension ? 0.55 : 1,
                      },
                    ]}
                    disabled={!!request.returnDelayNotifiedAt || hasPendingExtension || notifyDelayMutation.isPending}
                    onPress={() =>
                      Alert.alert(
                        "Notify owner about delay?",
                        "This lets the owner know you'll return late. Communicating in advance softens your late-return trust penalty by one tier.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Send notification",
                            onPress: () => notifyDelayMutation.mutate(),
                          },
                        ]
                      )
                    }
                  >
                    {notifyDelayMutation.isPending ? (
                      <ActivityIndicator size="small" color="#92400e" />
                    ) : (
                      <>
                        <Feather name="alert-triangle" size={14} color="#92400e" />
                        <Text style={[card.btnLabel, { color: "#92400e" }]}>I'll be running late</Text>
                      </>
                    )}
                  </Pressable>
                  {hasPendingExtension && (
                    <Text style={[{ fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" as const }, { color: "#92400e" }]}>
                      Available after the extension is resolved.
                    </Text>
                  )}
                  {request.returnDelayNotifiedAt && (
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <Feather name="check-circle" size={14} color="#16a34a" />
                      <Text style={[{ fontSize: 12, fontFamily: "Inter_400Regular" }, { color: "#15803d" }]}>
                        Owner notified — late-return penalty softened.
                      </Text>
                    </View>
                  )}
                  </>
                )}
              </View>
            )}

            {/* A return in progress, including an early return, locks return-date
                actions until the owner confirms receipt. */}
            {status === "RETURN_REQUESTED" && isBorrower && (
              <View style={{ gap: 8 }}>
                <Pressable
                  style={[card.btn, { borderColor: colors.border, backgroundColor: colors.muted, opacity: 0.55 }]}
                  disabled
                >
                  <Feather name="clock" size={14} color={colors.mutedForeground} />
                  <Text style={[card.btnLabel, { color: colors.mutedForeground }]}>Need more time?</Text>
                </Pressable>
                <Pressable
                  style={[card.btn, { borderColor: colors.border, backgroundColor: colors.muted, opacity: 0.55 }]}
                  disabled
                >
                  <Feather name="alert-triangle" size={14} color={colors.mutedForeground} />
                  <Text style={[card.btnLabel, { color: colors.mutedForeground }]}>I'll be running late</Text>
                </Pressable>
                <Text style={[{ fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" as const }, { color: colors.mutedForeground }]}>
                  Return is awaiting owner confirmation, so these actions are unavailable.
                </Text>
              </View>
            )}

            {/* IN_PROGRESS — owner */}
            {status === "IN_PROGRESS" && isOwner && (
              <View style={{ gap: 8 }}>
                <View style={[card.infoBanner, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <Text style={[card.infoBannerText, { color: colors.mutedForeground }]}>
                    The item is with the borrower. You'll be notified when they initiate a return.
                  </Text>
                </View>

                {/* Pending extension request from borrower */}
                {hasPendingExtension && pendingExtension && (
                  <View style={[card.counterBanner, { backgroundColor: "#fffbeb", borderColor: "#fcd34d" }]}>
                    <Text style={[card.counterBannerTitle, { color: "#92400e" }]}>
                      Extension requested: {pendingExtension.message}
                    </Text>
                    <Text style={[card.counterBannerText, { color: "#78350f" }]}>
                      New return date: {fmtDate(pendingExtension.requestedEndDate)}
                    </Text>
                    <View style={[card.btnRow, { marginTop: 6 }]}>
                      <Pressable
                        style={[card.btn, { backgroundColor: PRIMARY, borderColor: PRIMARY, flex: 1 }]}
                        onPress={() => respondExtensionMutation.mutate("accept")}
                        disabled={respondExtensionMutation.isPending}
                      >
                        {respondExtensionMutation.isPending
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Text style={[card.btnLabel, { color: "#fff" }]}>Accept</Text>
                        }
                      </Pressable>
                      <Pressable
                        style={[card.btn, { borderColor: colors.border, flex: 1 }]}
                        onPress={() => respondExtensionMutation.mutate("decline")}
                        disabled={respondExtensionMutation.isPending}
                      >
                        <Text style={[card.btnLabel, { color: colors.foreground }]}>Decline</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* RETURN_REQUESTED */}
            {status === "RETURN_REQUESTED" && isOwner && (
              <Pressable
                style={[card.btn, { backgroundColor: "#16a34a", borderColor: "#16a34a" }]}
                onPress={() => setShowConfirmReturnSheet(true)}
                disabled={anyMutating}
              >
                <Feather name="check-circle" size={14} color="#fff" />
                <Text style={[card.btnLabel, { color: "#fff" }]}>Confirm return</Text>
              </Pressable>
            )}
            {status === "RETURN_REQUESTED" && isBorrower && (
              <View style={[card.infoBanner, { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" }]}>
                <Text style={[card.infoBannerText, { color: "#15803d" }]}>
                  Return initiated — waiting for the owner to confirm receipt.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Terminal state */}
        {isTerminal && (
          <View style={[card.detailsWrap, { borderTopColor: colors.border }]}>
            <Text style={[card.detailText, { color: statusInfo.color, fontFamily: "Inter_500Medium" }]}>
              This {request.requestType.toLowerCase()} request is {statusInfo.label.toLowerCase()}.
            </Text>
          </View>
        )}
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  const activeStatus = getActiveStatus(partner?.lastActiveAt ?? null);
  const partnerName = partner ? partner.displayName || partner.username : "";
  const initials = partner ? getInitials(partner.displayName, partner.username) : "?";
  const reversed = messages
  ? [...messages].reverse().filter((msg) => {
      if (msg.messageType === "system") {
        // The counter event card already conveys the proposed terms. Do not
        // render legacy duplicate system stamps in existing conversations.
        if (msg.content.startsWith("📋 New terms proposed for")) return false;
        // Acceptance events are now rendered once as lifecycle events; hide
        // redundant stamps created by older builds.
        if (msg.content.startsWith("✅ Your ") && msg.content.includes(" was accepted")) return false;

        const visibleTo = msg.metadata?.visibleToUserId as number | undefined;
        if (visibleTo && visibleTo !== user?.id) return false;
      }
      return true;
    })
  : [];
  const topPad = isWeb ? 67 : insets.top;
  const hasRating = partner && (partner.reviewCount ?? 0) > 0;
  const hasSubtext = hasRating || activeStatus || partner?.responseTime;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border },
        ]}
      >
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </Pressable>

        <View style={styles.avatarWrap}>
          <View style={[styles.avatar, { backgroundColor: colors.primary + "25" }]}>
            {partner?.profilePhoto ? (
              <Image source={{ uri: photoUrl(partner.profilePhoto) }} style={styles.avatarImg} />
            ) : (
              <Text style={[styles.avatarText, { color: colors.primary }]}>{initials}</Text>
            )}
          </View>
          {activeStatus?.isNow && (
            <View style={[styles.activeDot, { backgroundColor: "#22c55e", borderColor: colors.background }]} />
          )}
        </View>

        <View style={styles.headerMeta}>
          <Pressable
            style={styles.nameRow}
            onPress={() => router.push(`/profile/${id}` as never)}
            hitSlop={6}
          >
            {({ hovered }: { hovered?: boolean }) => (
              <>
                <Text
                  style={[styles.partnerName, { color: colors.foreground }, hovered ? { textDecorationLine: "underline" } : null]}
                  numberOfLines={1}
                >
                  {partnerName || "Loading…"}
                </Text>
                {partner?.isVerified && (
                  <View style={{ width: 18, height: 18 }}>
                    <MaterialCommunityIcons name="check-decagram" size={22} color="white" style={{ position: "absolute", top: -2, left: -2 }} />
                    <MaterialCommunityIcons name="check-decagram" size={18} color="#0DCEA1" style={{ position: "absolute" }} />
                  </View>
                )}
              </>
            )}
          </Pressable>

          {hasSubtext && (
            <View style={styles.metaRow}>
              {hasRating && (
                <>
                  <Feather name="star" size={11} color="#f59e0b" />
                  <Text style={[styles.metaText, { color: colors.foreground }]}>
                    {Number(partner!.averageRating).toFixed(1)}
                  </Text>
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                    ({partner!.reviewCount})
                  </Text>
                </>
              )}
              {hasRating && (activeStatus || partner?.responseTime) && (
                <Text style={[styles.metaSep, { color: colors.mutedForeground }]}>·</Text>
              )}
              {activeStatus && (
                <Text style={[styles.metaText, { color: activeStatus.isNow ? "#16a34a" : colors.mutedForeground }]}>
                  {activeStatus.label}
                </Text>
              )}
              {activeStatus && partner?.responseTime && (
                <Text style={[styles.metaSep, { color: colors.mutedForeground }]}>·</Text>
              )}
              {!activeStatus && partner?.responseTime && (
                <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {partner.responseTime}
                </Text>
              )}
            </View>
          )}
        </View>
      </View>

      {/* Request card (fixed between header and messages) */}
      {request && (
        <View style={[styles.cardScroll, { borderBottomColor: colors.border, padding: 12 }]}>
          {renderRequestCard()}
        </View>
      )}

      {/* Messages */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={reversed}
          keyExtractor={(m) => m.id.toString()}
          inverted
          contentContainerStyle={styles.messageList}
          renderItem={({ item: msg }) => {
            const isMe = msg.senderId === user?.id;

            // ── Event messages (request_accepted, counter_proposed, etc.) ──────
            if (msg.messageType === "event") {
              const et = msg.metadata?.eventType as string | undefined;
              const relatedReq = msg.requestId
                ? allRequests?.find((r) => r.id === msg.requestId) ?? null
                : null;

              const iActor = msg.senderId === user?.id;
              const actorName = partner?.displayName || partner?.username || "";
              const actor = iActor ? "You" : actorName;

              const extDate = msg.metadata?.requestedEndDate as string | undefined;
              const eventLabel =
                et === "request_accepted" ? `✅ ${actor} accepted the request` :
                et === "request_declined" ? `❌ ${actor} declined the request` :
                et === "request_cancelled" ? `🚫 ${actor} cancelled the request` :
                et === "terms_accepted" ? `✅ ${actor} accepted the new terms` :
                et === "terms_declined" ? `❌ ${actor} declined the new terms` :
                et === "handoff_confirmed" ? "🤝 Handoff confirmed" :
                et === "deposit_confirmed" ? "🔒 Deposit secured" :
                et === "extension_accepted" ? `✅ Extension accepted${extDate ? ` — new return date: ${fmtDate(extDate)}` : ""}` :
                et === "extension_declined" ? `❌ Extension declined` :
                et === "extension_requested" ? null :
                et === "counter_proposed" ? null :
                msg.content;

              // Counter-proposed card: show Previous → Proposed columns
              const counterCard = et === "counter_proposed" && msg.metadata
                ? (() => {
                    const mStart = msg.metadata.startDate as string | undefined;
                    const mEnd = msg.metadata.endDate as string | undefined;
                    const origStartRaw = (msg.metadata.origStartDate as string | undefined) ?? relatedReq?.startDate ?? undefined;
                    const origEndRaw = (msg.metadata.origEndDate as string | undefined) ?? relatedReq?.endDate ?? undefined;
                    const origStart = origStartRaw ? fmtDate(origStartRaw) : null;
                    const origEnd = origEndRaw ? fmtDate(origEndRaw) : null;
                    const newStart = mStart ? fmtDate(mStart) : null;
                    const newEnd = mEnd ? fmtDate(mEnd) : null;
                    const dateChanged = (newStart && newStart !== origStart) || (newEnd && newEnd !== origEnd);
                    const origDeposit = msg.metadata.origDepositMethod as string | undefined;
                    const newDeposit = msg.metadata.depositMethod as string | undefined;
                    const depositChanged = origDeposit !== newDeposit;
                    const depLabel = (m?: string | null) => m === "in_person" ? "In-person" : "In-app";

                    return (
                      <View style={[styles.counterTermsCard, { borderColor: colors.border, backgroundColor: colors.muted }]}>
                        {/* Previous column */}
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={[styles.counterTermsColLabel, { color: "#9ca3af" }]}>Previous</Text>
                          {origStart && origEnd && (
                            <View style={styles.counterTermsRow}>
                              <Feather name="clock" size={11} color={colors.mutedForeground} />
                              <Text style={[styles.counterTermsText, { color: colors.mutedForeground }]}>
                                {origStart} – {origEnd}
                              </Text>
                            </View>
                          )}
                          {origDeposit != null && (
                            <View style={styles.counterTermsRow}>
                              <Shield size={11} color={colors.mutedForeground} strokeWidth={2} />
                              <Text style={[styles.counterTermsText, { color: colors.mutedForeground }]}>
                                {depLabel(origDeposit)}
                              </Text>
                            </View>
                          )}
                        </View>
                        {/* Divider arrow */}
                        <Text style={{ color: "#9ca3af", fontFamily: "Inter_600SemiBold", paddingHorizontal: 6, paddingTop: 20 }}>→</Text>
                        {/* Proposed column */}
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={[styles.counterTermsColLabel, { color: "#f59e0b" }]}>Proposed</Text>
                          {newStart && newEnd && (
                            <View style={styles.counterTermsRow}>
                              <Feather name="clock" size={11} color={dateChanged ? "#d97706" : colors.mutedForeground} />
                              <Text style={[styles.counterTermsText, {
                                color: dateChanged ? "#d97706" : colors.mutedForeground,
                                fontFamily: dateChanged ? "Inter_600SemiBold" : "Inter_400Regular",
                              }]}>
                                {newStart} – {newEnd}
                              </Text>
                            </View>
                          )}
                          {newDeposit != null && (
                            <View style={styles.counterTermsRow}>
                              <Shield size={11} color={depositChanged ? "#d97706" : colors.mutedForeground} strokeWidth={2} />
                              <Text style={[styles.counterTermsText, {
                                color: depositChanged ? "#d97706" : colors.mutedForeground,
                                fontFamily: depositChanged ? "Inter_600SemiBold" : "Inter_400Regular",
                              }]}>
                                {depLabel(newDeposit)}
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })()
                : null;

              // Extension-requested cards are a read-only history entry. The
              // one active Accept / Decline control pair lives in the request
              // card above, so owners never see duplicate actions.
              const extensionCard = et === "extension_requested" && msg.metadata
                ? (() => {
                    const days = msg.metadata.days as number | undefined;
                    const reqEndDate = msg.metadata.requestedEndDate as string | undefined;
                    return (
                      <View style={[card.counterBanner, { backgroundColor: "#fffbeb", borderColor: "#fcd34d", marginTop: 6 }]}>
                        <Text style={[card.counterBannerTitle, { color: "#92400e" }]}>
                          ⏳ {iActor ? "You requested" : `${actorName} requested`} +{days} day{days !== 1 ? "s" : ""}
                        </Text>
                        {reqEndDate && (
                          <Text style={[card.counterBannerText, { color: "#78350f" }]}>
                            New return date: {fmtDate(reqEndDate)}
                          </Text>
                        )}
                      </View>
                    );
                  })()
                : null;

              return (
                <View style={styles.eventWrap}>
                  <Text style={[styles.eventLabel, { color: colors.mutedForeground }]}>
                    {et === "counter_proposed" ? `🔄 ${actor} proposed new terms` :
                     et === "extension_requested" ? null :
                     eventLabel}
                  </Text>
                  {counterCard}
                  {extensionCard}
                </View>
              );
            }

            // ── System messages ───────────────────────────────────────────────
            if (msg.messageType === "system") {
              const myName = (user as any)?.displayName || (user as any)?.username || "";
              const personalizedContent = msg.content.replace(
                new RegExp(`^${myName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s)`),
                "You"
              );
              return (
                <View style={styles.systemWrap}>
                  <Text style={[styles.systemText, { color: colors.mutedForeground }]}>
                    {personalizedContent}
                  </Text>
                  <Text style={[styles.systemTime, { color: colors.mutedForeground }]}>
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </View>
              );
            }

            // ── Regular text message ──────────────────────────────────────────
            return (
              <View
                style={[
                  styles.bubble,
                  isMe ? styles.bubbleMe : styles.bubbleThem,
                  { backgroundColor: isMe ? colors.primary : colors.card, borderColor: isMe ? colors.primary : colors.border },
                ]}
              >
                <Text style={[styles.bubbleText, { color: isMe ? colors.primaryForeground : colors.foreground }]}>
                  {msg.content}
                </Text>
                <Text style={[styles.bubbleTime, { color: isMe ? "rgba(255,255,255,0.7)" : colors.mutedForeground }]}>
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="message-circle" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Send the first message
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        />
      )}

      {/* Input bar */}
      <View
        style={[
          styles.inputBar,
          { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: insets.bottom + (isWeb ? 34 : 8) },
        ]}
      >
        <TextInput
          style={[styles.input, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
          placeholder="Type a message..."
          placeholderTextColor={colors.mutedForeground}
          value={text}
          onChangeText={setText}
          multiline
          returnKeyType="default"
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendBtn,
            { backgroundColor: text.trim().length > 0 ? colors.primary : colors.muted, opacity: pressed ? 0.8 : 1 },
          ]}
          onPress={async () => {
            const trimmed = text.trim();
            if (!trimmed || sendingRef.current) return;
            sendingRef.current = true;
            setText("");
            try {
              await apiPost(`/api/messages`, {
                receiverId: parseInt(id ?? "0"),
                content: trimmed,
                ...(requestId ? { requestId: parseInt(requestId) } : {}),
              });
              qc.invalidateQueries({ queryKey: [`/api/messages/${id}`, requestId ?? null] });
              // Invalidate both buckets: sending a message to a terminal-status
              // thread triggers server-side auto-unarchive (unarchivedAt = now),
              // so the thread must move from archived → active immediately.
              qc.invalidateQueries({ queryKey: ["/api/inbox"] });
              qc.invalidateQueries({ queryKey: ["/api/inbox/archived"] });
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            } catch {
              // Restore text so the user can retry if the send failed
              setText(trimmed);
            } finally {
              sendingRef.current = false;
            }
          }}
          disabled={!text.trim()}
        >
          <Feather
            name="send"
            size={18}
            color={text.trim().length > 0 ? colors.primaryForeground : colors.mutedForeground}
          />
        </Pressable>
      </View>

      {/* Handoff sheet — owner view */}
      {request && (
        <HandoffSheet
          visible={showHandoffSheetOwner}
          onClose={() => setShowHandoffSheetOwner(false)}
          onSuccess={() => { setShowHandoffSheetOwner(false); invalidateAll(); }}
          requestId={request.id}
          userRole="owner"
          itemName={request.item?.name ?? "Item"}
          requestType={request.requestType}
          deliveryMethod={request.deliveryMethod}
          // Borrower has confirmed on their side — owner sees "borrower confirmed" state
          otherPartyConfirmed={request.borrowerConfirmedHandoff ?? false}
        />
      )}

      {/* Handoff sheet — borrower view */}
      {request && (
        <HandoffSheet
          visible={showHandoffSheetBorrower}
          onClose={() => setShowHandoffSheetBorrower(false)}
          onSuccess={() => { setShowHandoffSheetBorrower(false); invalidateAll(); }}
          requestId={request.id}
          userRole="borrower"
          itemName={request.item?.name ?? "Item"}
          requestType={request.requestType}
          deliveryMethod={request.deliveryMethod}
          // Owner has confirmed on their side — borrower sees "owner confirmed" state
          otherPartyConfirmed={request.ownerConfirmedHandoff ?? false}
        />
      )}

      {/* Counter-proposal sheet — BORROW/RENT: dates + deposit; SWAP: item picker + note */}
      {request && (
        <CounterProposalSheet
          visible={showCounterSheet}
          onClose={() => setShowCounterSheet(false)}
          request={request}
          isOwner={isOwner}
          partnerId={isOwner ? request.requesterId : (request.item?.ownerId ?? null)}
          onSubmit={(payload) => counterMutation.mutate(payload)}
          isPending={counterMutation.isPending}
        />
      )}

      <InsufficientShareCoinsModal
        isOpen={showEarnModal}
        onClose={() => setShowEarnModal(false)}
        currentBalance={Number((user as any)?.shareCoins ?? 0)}
        required={earnRequired}
        context={earnContext}
      />

      {/* Return sheet — borrower initiates return */}
      {request && (
        <ReturnConfirmationSheet
          visible={showReturnSheet}
          onClose={() => setShowReturnSheet(false)}
          onSuccess={() => { setShowReturnSheet(false); invalidateAll(); }}
          requestId={request.id}
          itemName={request.item?.name ?? "Item"}
          depositAmount={request.trustDepositAmount}
          userRole="borrower"
          requestType={request.requestType}
          endDate={request.endDate}
          depositMethod={request.depositMethod}
        />
      )}

      {/* Return sheet — owner confirms return */}
      {request && (
        <ReturnConfirmationSheet
          visible={showConfirmReturnSheet}
          onClose={() => setShowConfirmReturnSheet(false)}
          onSuccess={() => { setShowConfirmReturnSheet(false); invalidateAll(); }}
          requestId={request.id}
          itemName={request.item?.name ?? "Item"}
          depositAmount={request.trustDepositAmount}
          userRole="owner"
          requestType={request.requestType}
          endDate={request.endDate}
          depositMethod={request.depositMethod}
        />
      )}

      {/* Post-return review sheet */}
      {request && partner && (
        <PostReturnReviewSheet
          visible={showReviewSheet}
          onClose={() => setShowReviewSheet(false)}
          reviewedUserId={partner.id}
          reviewedUserName={partner.displayName || partner.username}
          requestId={request.id}
          requestType={request.requestType as any}
        />
      )}

      {/* Extension sheet — borrower requests more time */}
      {request && (
        <ExtensionSheet
          visible={showExtensionSheet}
          onClose={() => setShowExtensionSheet(false)}
          onRequest={(days) => requestExtensionMutation.mutate(days)}
          isPending={requestExtensionMutation.isPending}
          currentEndDate={request.endDate}
          itemName={request.item?.name ?? "Item"}
          ownerAlreadyNotifiedOfDelay={!!request.returnDelayNotifiedAt}
        />
      )}


      {/* BORROW in_app deposit payment sheet */}
      {request && (
        <PayDepositSheet
          visible={showDepositSheet}
          onClose={() => setShowDepositSheet(false)}
          onSuccess={() => {
            setShowDepositSheet(false);
            invalidateAll();
          }}
          requestId={request.id}
          item={{
            name: request.item?.name ?? "Item",
            tier: request.item?.tier ?? null,
            originalValue: request.item?.originalValue ?? null,
            shareCoinPrice: request.item?.shareCoinPrice ?? null,
          }}
          startDate={request.startDate}
          endDate={request.endDate}
          reputationScore={Number((user as any)?.reputationScore ?? 0)}
        />
      )}

      {/* RENT payment sheet */}
      {request && (
        <PayRentalSheet
          visible={showRentalSheet}
          onClose={() => setShowRentalSheet(false)}
          onSuccess={() => {
            setShowRentalSheet(false);
            invalidateAll();
          }}
          requestId={request.id}
          item={{
            name: request.item?.name ?? "Item",
            tier: request.item?.tier ?? null,
            category: request.item?.category ?? null,
            replacementValue: request.item?.replacementValue ?? null,
            dollarsPrice: request.item?.dollarsPrice ?? null,
            securityDeposit: request.item?.securityDeposit ?? null,
          }}
          startDate={request.startDate}
          endDate={request.endDate}
        />
      )}
    </KeyboardAvoidingView>
  );
}


// ── Card styles ───────────────────────────────────────────────────────────────
const card = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
  },
  thumbImg: { width: 44, height: 44 },
  itemName: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  typeBadgeText: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase" },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  statusBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  detailsWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 5,
  },
  detailRow: { flexDirection: "row", alignItems: "flex-start", gap: 5 },
  detailText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 17 },
  actionsWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
  },
  btnRow: { flexDirection: "row", gap: 10 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  btnLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  counterBanner: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 2,
  },
  counterBannerTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  counterBannerText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  infoBanner: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  infoBannerTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  infoBannerText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  pinDisplay: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    gap: 4,
  },
  pinLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  pinCode: {
    fontSize: 36,
    fontFamily: "Inter_700Bold",
    letterSpacing: 10,
  },
  pinHint: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center" },
  pinExpiredText: { fontSize: 12, fontFamily: "Inter_400Regular" },
});

// ── Screen styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 2 },
  avatarWrap: { position: "relative", flexShrink: 0 },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
  },
  avatarImg: { width: 38, height: 38, borderRadius: 19 },
  avatarText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  activeDot: {
    position: "absolute", bottom: 1, right: 1,
    width: 10, height: 10, borderRadius: 5, borderWidth: 2,
  },
  headerMeta: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  partnerName: { fontSize: 15, fontFamily: "Inter_700Bold", flexShrink: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 1, flexWrap: "nowrap" },
  metaText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  metaSep: { fontSize: 10, fontFamily: "Inter_400Regular" },
  cardScroll: { maxHeight: 320, borderBottomWidth: StyleSheet.hairlineWidth },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  messageList: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 8 },
  bubble: {
    maxWidth: "80%", borderRadius: 18, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10, gap: 3,
  },
  bubbleMe: { alignSelf: "flex-end", borderBottomRightRadius: 4 },
  bubbleThem: { alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 20 },
  bubbleTime: { fontSize: 10, fontFamily: "Inter_400Regular", alignSelf: "flex-end" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 10,
    paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1, borderRadius: 22, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, fontFamily: "Inter_400Regular", maxHeight: 120,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: "center", justifyContent: "center",
  },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  pinSheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, gap: 12,
  },
  pinHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  pinTitle: { fontSize: 17, fontFamily: "Inter_700Bold", textAlign: "center" },
  pinSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  pinInput: {
    borderWidth: 1, borderRadius: 12,
    fontSize: 28, fontFamily: "Inter_700Bold",
    letterSpacing: 12, paddingVertical: 14,
    paddingHorizontal: 20, textAlign: "center",
  },
  pinSubmit: {
    borderRadius: 12, paddingVertical: 14,
    alignItems: "center", justifyContent: "center",
  },
  pinSubmitText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  counterCard: {
    borderWidth: 1, borderRadius: 12, padding: 14, gap: 4,
  },
  counterCardTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  counterCardSub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  // Event messages (request_accepted, counter_proposed, etc.)
  eventWrap: {
    alignItems: "center", alignSelf: "center",
    marginVertical: 4, maxWidth: "90%", gap: 6,
  },
  eventLabel: {
    fontSize: 12, fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  // Counter-proposal terms card (Previous → Proposed)
  counterTermsCard: {
    flexDirection: "row", alignItems: "flex-start",
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
    gap: 2, width: 260,
  },
  counterTermsColLabel: {
    fontSize: 9, fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2,
  },
  counterTermsRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  counterTermsText: { fontSize: 11, fontFamily: "Inter_400Regular", flexShrink: 1 },
  // System messages
  systemWrap: {
    alignItems: "center", alignSelf: "center",
    marginVertical: 4, maxWidth: "80%", gap: 1,
  },
  systemText: {
    fontSize: 12, fontFamily: "Inter_600SemiBold",
    textAlign: "center", lineHeight: 16,
  },
  systemTime: {
    fontSize: 10, fontFamily: "Inter_400Regular",
    textAlign: "center", opacity: 0.6,
  },
});
