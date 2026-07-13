import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState, useRef } from "react";
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
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

interface Message {
  id: number;
  content: string;
  senderId: number;
  createdAt: string;
  messageType?: string;
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

interface RequestContext {
  id: number;
  requestType: string;
  status: string;
  negotiationStatus: string | null;
  counterProposedBy: number | null;
  counterRound: number | null;
  startDate: string | null;
  endDate: string | null;
  counterStartDate: string | null;
  counterEndDate: string | null;
  deliveryMethod: string | null;
  depositMethod: string | null;
  counterDeliveryMethod: string | null;
  counterDepositMethod: string | null;
  ownerConfirmedHandoff: boolean | null;
  borrowerConfirmedHandoff: boolean | null;
  requesterId: number;
  depositStatus: string | null;
  itemOwnerId: number | null;
  itemName: string;
}

type ActionState =
  | "owner_decide"
  | "requester_waiting"
  | "received_counter"
  | "counter_sent"
  | "can_handoff"
  | "waiting_handoff"
  | "can_return"
  | "waiting_return"
  | "can_confirm_return"
  | "waiting_confirm_return"
  | "completed"
  | "declined"
  | "ended"
  | null;

const HANDOFF_STATUSES = ["ACCEPTED", "DEPOSIT_PENDING", "DEPOSIT_CONFIRMED", "AWAITING_HANDOFF_CONFIRM", "HANDOFF_CONFIRMED"];
const IN_PROGRESS_STATUSES = ["IN_PROGRESS"];

function getActionState(req: RequestContext, userId: number, iAmRequester: boolean): ActionState {
  const { status, negotiationStatus, counterProposedBy, ownerConfirmedHandoff, borrowerConfirmedHandoff } = req;

  if (status === "PENDING") {
    if (negotiationStatus === "counter_proposed") {
      return counterProposedBy === userId ? "counter_sent" : "received_counter";
    }
    return iAmRequester ? "requester_waiting" : "owner_decide";
  }
  if (HANDOFF_STATUSES.includes(status)) {
    const iConfirmed = iAmRequester ? !!borrowerConfirmedHandoff : !!ownerConfirmedHandoff;
    return iConfirmed ? "waiting_handoff" : "can_handoff";
  }
  if (IN_PROGRESS_STATUSES.includes(status)) {
    return iAmRequester ? "can_return" : "waiting_return";
  }
  if (status === "RETURN_REQUESTED") {
    return iAmRequester ? "waiting_confirm_return" : "can_confirm_return";
  }
  if (status === "COMPLETED" || status === "RETURN_CONFIRMED") return "completed";
  if (status === "DECLINED") return "declined";
  if (status === "CANCELLED" || status === "WITHDRAWN") return "ended";
  return null;
}

function getActiveStatus(lastActiveAt: string | null): { label: string; isNow: boolean } | null {
  if (!lastActiveAt) return null;
  const diff = Date.now() - new Date(lastActiveAt).getTime();
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
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(dateStr).toLocaleDateString([], { month: "short", day: "numeric" });
}

function fmtDate(d: string | null): string {
  if (!d) return "–";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ChatScreen() {
  const { id, requestId, iAmRequester: iAmRequesterParam } = useLocalSearchParams<{
    id: string;
    requestId?: string;
    requestType?: string;
    iAmRequester?: string;
    itemName?: string;
  }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const isWeb = Platform.OS === "web";
  const iAmRequester = iAmRequesterParam === "1";

  const [text, setText] = useState("");
  const flatListRef = useRef<FlatList>(null);

  const [showCounterModal, setShowCounterModal] = useState(false);
  const [counterModalMode, setCounterModalMode] = useState<"propose" | "respond">("propose");
  const [counterStartDate, setCounterStartDate] = useState("");
  const [counterEndDate, setCounterEndDate] = useState("");

  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnRating, setReturnRating] = useState(5);
  const [returnNotes, setReturnNotes] = useState("");
  const [returnSameCondition, setReturnSameCondition] = useState(true);

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: [`/api/messages/${id}`, requestId ?? null] });
    qc.invalidateQueries({ queryKey: ["/api/inbox"] });
    qc.invalidateQueries({ queryKey: [`/api/requests/${requestId}`] });
  }

  const { data: partner } = useQuery<PublicProfile>({
    queryKey: [`/api/users/${id}/public-profile`],
    queryFn: () => apiGet<PublicProfile>(`/api/users/${id}/public-profile`),
    enabled: !!id,
  });

  const messagesUrl = requestId ? `/api/messages/${id}?requestId=${requestId}` : `/api/messages/${id}`;
  const { data: messages, isLoading } = useQuery<Message[]>({
    queryKey: [`/api/messages/${id}`, requestId ?? null],
    queryFn: () => apiGet<Message[]>(messagesUrl),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const { data: reqCtx } = useQuery<RequestContext>({
    queryKey: [`/api/requests/${requestId}`],
    queryFn: () => apiGet<RequestContext>(`/api/requests/${requestId}`),
    enabled: !!requestId,
    refetchInterval: 5000,
  });

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      apiPost(`/api/messages`, {
        receiverId: parseInt(id ?? "0"),
        content,
        ...(requestId ? { requestId: parseInt(requestId) } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/messages/${id}`, requestId ?? null] });
      qc.invalidateQueries({ queryKey: ["/api/inbox"] });
      setText("");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
  });

  const acceptMutation = useMutation({
    mutationFn: () => apiPatch(`/api/requests/${requestId}`, { status: "ACCEPTED" }),
    onSuccess: () => { invalidateAll(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const declineMutation = useMutation({
    mutationFn: () => apiPatch(`/api/requests/${requestId}`, { status: "DECLINED" }),
    onSuccess: () => { invalidateAll(); },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const acceptCounterMutation = useMutation({
    mutationFn: () => apiPost(`/api/requests/${requestId}/respond-to-counter`, { accept: true }),
    onSuccess: () => { invalidateAll(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const counterProposalMutation = useMutation({
    mutationFn: (body: object) => {
      if (counterModalMode === "propose") {
        return apiPost(`/api/requests/${requestId}/counter-proposal`, body);
      } else {
        return apiPost(`/api/requests/${requestId}/respond-to-counter`, { accept: false, counter: body });
      }
    },
    onSuccess: () => {
      invalidateAll();
      setShowCounterModal(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const handoffMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/requests/${requestId}/handoff`, {
        confirmedBy: iAmRequester ? "borrower" : "owner",
      }),
    onSuccess: () => { invalidateAll(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const returnMutation = useMutation({
    mutationFn: () => apiPost(`/api/requests/${requestId}/return`, {}),
    onSuccess: () => { invalidateAll(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const confirmReturnMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/requests/${requestId}/confirm-return`, {
        conditionRating: returnRating,
        conditionNotes: returnNotes,
        sameCondition: returnSameCondition,
        triggerDispute: false,
        disputePhotoUrl: null,
      }),
    onSuccess: () => {
      invalidateAll();
      setShowReturnModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
  }

  function openCounterModal(mode: "propose" | "respond") {
    setCounterModalMode(mode);
    setCounterStartDate(reqCtx?.startDate?.slice(0, 10) ?? todayStr());
    setCounterEndDate(reqCtx?.endDate?.slice(0, 10) ?? "");
    setShowCounterModal(true);
  }

  function submitCounter() {
    if (!counterStartDate) {
      Alert.alert("Missing date", "Please enter a start date.");
      return;
    }
    counterProposalMutation.mutate({
      deliveryMethod: reqCtx?.deliveryMethod ?? "self_arrange",
      depositMethod: reqCtx?.depositMethod ?? "in_person",
      startDate: counterStartDate,
      endDate: counterEndDate || null,
    });
  }

  function confirmDecline() {
    Alert.alert("Decline Request", "Are you sure you want to decline this request?", [
      { text: "Cancel", style: "cancel" },
      { text: "Decline", style: "destructive", onPress: () => declineMutation.mutate() },
    ]);
  }

  function confirmHandoff() {
    Alert.alert(
      "Confirm Handoff",
      `Confirm that the item has physically changed hands?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm", onPress: () => handoffMutation.mutate() },
      ]
    );
  }

  function confirmReturn() {
    Alert.alert(
      "Initiate Return",
      "Confirm you have returned the item to the owner?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm", onPress: () => returnMutation.mutate() },
      ]
    );
  }

  const activeStatus = getActiveStatus(partner?.lastActiveAt ?? null);
  const partnerName = partner ? partner.displayName || partner.username : "";
  const initials = partner ? getInitials(partner.displayName, partner.username) : "?";
  const reversed = messages ? [...messages].reverse() : [];
  const topPad = isWeb ? 67 : insets.top;
  const hasRating = partner && (partner.reviewCount ?? 0) > 0;
  const hasSubtext = hasRating || activeStatus || partner?.responseTime;

  const actionState: ActionState =
    reqCtx && user ? getActionState(reqCtx, user.id, iAmRequester) : null;

  const anyMutating =
    acceptMutation.isPending ||
    declineMutation.isPending ||
    acceptCounterMutation.isPending ||
    handoffMutation.isPending ||
    returnMutation.isPending;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
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
              <Image source={{ uri: partner.profilePhoto }} style={styles.avatarImg} />
            ) : (
              <Text style={[styles.avatarText, { color: colors.primary }]}>{initials}</Text>
            )}
          </View>
          {activeStatus?.isNow ? (
            <View style={[styles.activeDot, { backgroundColor: "#22c55e", borderColor: colors.background }]} />
          ) : null}
        </View>

        <View style={styles.headerMeta}>
          <View style={styles.nameRow}>
            <Text style={[styles.partnerName, { color: colors.foreground }]} numberOfLines={1}>
              {partnerName || "Loading…"}
            </Text>
            {partner?.isVerified ? (
              <View style={[styles.verifiedBadge, { backgroundColor: colors.primary }]}>
                <Feather name="check" size={8} color="#fff" />
              </View>
            ) : null}
          </View>

          {hasSubtext ? (
            <View style={styles.metaRow}>
              {hasRating ? (
                <>
                  <Feather name="star" size={11} color="#f59e0b" />
                  <Text style={[styles.metaText, { color: colors.foreground }]}>
                    {Number(partner!.averageRating).toFixed(1)}
                  </Text>
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                    ({partner!.reviewCount})
                  </Text>
                </>
              ) : null}
              {hasRating && (activeStatus || partner?.responseTime) ? (
                <Text style={[styles.metaSep, { color: colors.mutedForeground }]}>·</Text>
              ) : null}
              {activeStatus ? (
                <Text style={[styles.metaText, { color: activeStatus.isNow ? "#16a34a" : colors.mutedForeground }]}>
                  {activeStatus.label}
                </Text>
              ) : null}
              {activeStatus && partner?.responseTime ? (
                <Text style={[styles.metaSep, { color: colors.mutedForeground }]}>·</Text>
              ) : null}
              {!activeStatus && partner?.responseTime ? (
                <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {partner.responseTime}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        <Pressable style={styles.profileBtn} onPress={() => router.push(`/profile/${id}` as never)} hitSlop={10}>
          <Feather name="user" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* ── Messages ───────────────────────────────────────────── */}
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
          renderItem={({ item }) => {
            const isSystem = item.messageType === "system" || item.messageType === "event";
            if (isSystem) {
              return (
                <View style={styles.systemRow}>
                  <View style={[styles.systemPill, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                    <Text style={[styles.systemText, { color: colors.mutedForeground }]}>{item.content}</Text>
                  </View>
                </View>
              );
            }
            const isMe = item.senderId === user?.id;
            return (
              <View
                style={[
                  styles.bubble,
                  isMe ? styles.bubbleMe : styles.bubbleThem,
                  { backgroundColor: isMe ? colors.primary : colors.card, borderColor: isMe ? colors.primary : colors.border },
                ]}
              >
                <Text style={[styles.bubbleText, { color: isMe ? colors.primaryForeground : colors.foreground }]}>
                  {item.content}
                </Text>
                <Text style={[styles.bubbleTime, { color: isMe ? "rgba(255,255,255,0.7)" : colors.mutedForeground }]}>
                  {timeAgo(item.createdAt)}
                </Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="message-circle" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Send the first message</Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        />
      )}

      {/* ── Transaction Action Card ─────────────────────────────── */}
      {actionState ? (
        <View style={[styles.actionCard, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
          {actionState === "owner_decide" ? (
            <>
              <Text style={[styles.actionTitle, { color: colors.foreground }]}>
                📬 New request for {reqCtx?.itemName}
              </Text>
              <View style={styles.actionRow}>
                <Pressable
                  style={[styles.actionBtn, { backgroundColor: colors.primary, opacity: anyMutating ? 0.6 : 1 }]}
                  onPress={() => acceptMutation.mutate()}
                  disabled={anyMutating}
                >
                  {acceptMutation.isPending ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <Text style={[styles.actionBtnText, { color: colors.primaryForeground }]}>Accept</Text>
                  )}
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, styles.actionBtnOutline, { borderColor: colors.primary, opacity: anyMutating ? 0.6 : 1 }]}
                  onPress={() => openCounterModal("propose")}
                  disabled={anyMutating}
                >
                  <Text style={[styles.actionBtnText, { color: colors.primary }]}>Propose Changes</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, styles.actionBtnDestructive, { opacity: anyMutating ? 0.6 : 1 }]}
                  onPress={confirmDecline}
                  disabled={anyMutating}
                >
                  {declineMutation.isPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={[styles.actionBtnText, { color: "#fff" }]}>Decline</Text>
                  )}
                </Pressable>
              </View>
            </>
          ) : actionState === "requester_waiting" ? (
            <Text style={[styles.actionStatus, { color: colors.mutedForeground }]}>
              ⏳ Waiting for the owner to respond…
            </Text>
          ) : actionState === "received_counter" ? (
            <>
              <Text style={[styles.actionTitle, { color: colors.foreground }]}>
                🔄 Counter-proposal received
              </Text>
              {reqCtx?.counterStartDate ? (
                <Text style={[styles.actionSubtitle, { color: colors.mutedForeground }]}>
                  Proposed dates: {fmtDate(reqCtx.counterStartDate?.slice(0, 10) ?? null)}{reqCtx.counterEndDate ? ` → ${fmtDate(reqCtx.counterEndDate?.slice(0, 10) ?? null)}` : ""}
                </Text>
              ) : null}
              <View style={styles.actionRow}>
                <Pressable
                  style={[styles.actionBtn, { backgroundColor: colors.primary, opacity: anyMutating ? 0.6 : 1 }]}
                  onPress={() => acceptCounterMutation.mutate()}
                  disabled={anyMutating}
                >
                  {acceptCounterMutation.isPending ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <Text style={[styles.actionBtnText, { color: colors.primaryForeground }]}>Accept Terms</Text>
                  )}
                </Pressable>
                {(reqCtx?.counterRound ?? 0) < 2 ? (
                  <Pressable
                    style={[styles.actionBtn, styles.actionBtnOutline, { borderColor: colors.primary, opacity: anyMutating ? 0.6 : 1 }]}
                    onPress={() => openCounterModal("respond")}
                    disabled={anyMutating}
                  >
                    <Text style={[styles.actionBtnText, { color: colors.primary }]}>Counter Back</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={[styles.actionBtn, styles.actionBtnDestructive, { opacity: anyMutating ? 0.6 : 1 }]}
                  onPress={confirmDecline}
                  disabled={anyMutating}
                >
                  <Text style={[styles.actionBtnText, { color: "#fff" }]}>Decline</Text>
                </Pressable>
              </View>
            </>
          ) : actionState === "counter_sent" ? (
            <Text style={[styles.actionStatus, { color: colors.mutedForeground }]}>
              ⏳ Counter-proposal sent — waiting for their response…
            </Text>
          ) : actionState === "can_handoff" ? (
            <>
              <Text style={[styles.actionTitle, { color: colors.foreground }]}>
                🤝 Ready for handoff
              </Text>
              <Text style={[styles.actionSubtitle, { color: colors.mutedForeground }]}>
                Both parties must confirm the item has changed hands.
              </Text>
              <Pressable
                style={[styles.actionBtnFull, { backgroundColor: colors.primary, opacity: handoffMutation.isPending ? 0.6 : 1 }]}
                onPress={confirmHandoff}
                disabled={handoffMutation.isPending}
              >
                {handoffMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.actionBtnText, { color: colors.primaryForeground }]}>Confirm Handoff</Text>
                )}
              </Pressable>
            </>
          ) : actionState === "waiting_handoff" ? (
            <Text style={[styles.actionStatus, { color: colors.mutedForeground }]}>
              ✅ Handoff confirmed on your end — waiting for the other party…
            </Text>
          ) : actionState === "can_return" ? (
            <>
              <Text style={[styles.actionTitle, { color: colors.foreground }]}>
                📦 Ready to return the item?
              </Text>
              <Pressable
                style={[styles.actionBtnFull, { backgroundColor: colors.primary, opacity: returnMutation.isPending ? 0.6 : 1 }]}
                onPress={confirmReturn}
                disabled={returnMutation.isPending}
              >
                {returnMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.actionBtnText, { color: colors.primaryForeground }]}>Return Item</Text>
                )}
              </Pressable>
            </>
          ) : actionState === "waiting_return" ? (
            <Text style={[styles.actionStatus, { color: colors.mutedForeground }]}>
              📦 Item is with the borrower — waiting for return…
            </Text>
          ) : actionState === "can_confirm_return" ? (
            <>
              <Text style={[styles.actionTitle, { color: colors.foreground }]}>
                📬 Borrower has returned the item
              </Text>
              <Pressable
                style={[styles.actionBtnFull, { backgroundColor: colors.primary }]}
                onPress={() => setShowReturnModal(true)}
              >
                <Text style={[styles.actionBtnText, { color: colors.primaryForeground }]}>Confirm Return</Text>
              </Pressable>
            </>
          ) : actionState === "waiting_confirm_return" ? (
            <Text style={[styles.actionStatus, { color: colors.mutedForeground }]}>
              ⏳ Return initiated — waiting for owner to confirm…
            </Text>
          ) : actionState === "completed" ? (
            <Text style={[styles.actionStatus, { color: "#16a34a" }]}>
              ✅ Transaction complete
            </Text>
          ) : actionState === "declined" ? (
            <Text style={[styles.actionStatus, { color: colors.mutedForeground }]}>
              ❌ This request was declined
            </Text>
          ) : actionState === "ended" ? (
            <Text style={[styles.actionStatus, { color: colors.mutedForeground }]}>
              Request was cancelled
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* ── Input bar ──────────────────────────────────────────── */}
      <View
        style={[
          styles.inputBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + (isWeb ? 34 : 8),
          },
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
          onPress={handleSend}
          disabled={sendMutation.isPending || !text.trim()}
        >
          {sendMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Feather
              name="send"
              size={18}
              color={text.trim().length > 0 ? colors.primaryForeground : colors.mutedForeground}
            />
          )}
        </Pressable>
      </View>

      {/* ── Counter-Proposal Modal ──────────────────────────────── */}
      <Modal visible={showCounterModal} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {counterModalMode === "propose" ? "Propose New Terms" : "Counter-Propose"}
            </Text>
            <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>
              Enter your proposed dates (YYYY-MM-DD)
            </Text>

            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Start Date</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: colors.border, backgroundColor: colors.muted, color: colors.foreground }]}
              value={counterStartDate}
              onChangeText={setCounterStartDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />

            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>End Date (optional)</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: colors.border, backgroundColor: colors.muted, color: colors.foreground }]}
              value={counterEndDate}
              onChangeText={setCounterEndDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />

            <View style={styles.modalBtnRow}>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnOutline, { borderColor: colors.border }]}
                onPress={() => setShowCounterModal(false)}
              >
                <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: colors.primary, opacity: counterProposalMutation.isPending ? 0.6 : 1 }]}
                onPress={submitCounter}
                disabled={counterProposalMutation.isPending}
              >
                {counterProposalMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.modalBtnText, { color: colors.primaryForeground }]}>Send Proposal</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Confirm Return Modal ────────────────────────────────── */}
      <Modal visible={showReturnModal} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={[styles.modalSheet, { backgroundColor: colors.card }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Confirm Return</Text>
            <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>
              How was the item returned?
            </Text>

            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Condition Rating</Text>
            <View style={styles.starRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} onPress={() => setReturnRating(n)} hitSlop={4}>
                  <Feather
                    name="star"
                    size={32}
                    color={n <= returnRating ? "#f59e0b" : colors.border}
                  />
                </Pressable>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Notes (optional)</Text>
            <TextInput
              style={[
                styles.fieldInput,
                styles.fieldInputMultiline,
                { borderColor: colors.border, backgroundColor: colors.muted, color: colors.foreground },
              ]}
              value={returnNotes}
              onChangeText={setReturnNotes}
              placeholder="Any notes about the item's condition…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
            />

            <View style={styles.switchRow}>
              <Text style={[styles.switchLabel, { color: colors.foreground }]}>Same condition as lent?</Text>
              <Switch
                value={returnSameCondition}
                onValueChange={setReturnSameCondition}
                trackColor={{ true: colors.primary }}
              />
            </View>

            <View style={styles.modalBtnRow}>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnOutline, { borderColor: colors.border }]}
                onPress={() => setShowReturnModal(false)}
              >
                <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: colors.primary, opacity: confirmReturnMutation.isPending ? 0.6 : 1 }]}
                onPress={() => confirmReturnMutation.mutate()}
                disabled={confirmReturnMutation.isPending}
              >
                {confirmReturnMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.modalBtnText, { color: colors.primaryForeground }]}>Confirm</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

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
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImg: { width: 38, height: 38, borderRadius: 19 },
  avatarText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  activeDot: { position: "absolute", bottom: 1, right: 1, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  headerMeta: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  partnerName: { fontSize: 15, fontFamily: "Inter_700Bold", flexShrink: 1 },
  verifiedBadge: { width: 14, height: 14, borderRadius: 7, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 1, flexWrap: "nowrap" },
  metaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  metaSep: { fontSize: 11, fontFamily: "Inter_400Regular" },
  profileBtn: { padding: 4, flexShrink: 0 },

  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  messageList: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 8 },

  systemRow: { alignItems: "center", paddingVertical: 4 },
  systemPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "85%",
  },
  systemText: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 16 },

  bubble: {
    maxWidth: "80%",
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 3,
  },
  bubbleMe: { alignSelf: "flex-end", borderBottomRightRadius: 4 },
  bubbleThem: { alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 20 },
  bubbleTime: { fontSize: 10, fontFamily: "Inter_400Regular", alignSelf: "flex-end" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },

  actionCard: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  actionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  actionSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular" },
  actionStatus: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 4 },
  actionRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  actionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 80,
  },
  actionBtnOutline: { borderWidth: 1, backgroundColor: "transparent" },
  actionBtnDestructive: { backgroundColor: "#ef4444" },
  actionBtnFull: { borderRadius: 10, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  actionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    maxHeight: 120,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 12,
    gap: 4,
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#d1d5db", alignSelf: "center", marginBottom: 12 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 2 },
  modalSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 8, marginBottom: 4 },
  fieldInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  fieldInputMultiline: { height: 80, textAlignVertical: "top" },
  starRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 },
  switchLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  modalBtnRow: { flexDirection: "row", gap: 10, marginTop: 20 },
  modalBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  modalBtnOutline: { borderWidth: 1, backgroundColor: "transparent" },
  modalBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
