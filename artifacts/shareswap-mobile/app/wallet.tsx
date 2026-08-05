import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  KeyboardAvoidingView,
  Linking,
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
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/lib/api";
import { fmtDate } from "@/lib/dateUtils";

interface BalanceData {
  balance: { available: number; pending: number; total: number };
  hasConnectedAccount: boolean;
  payouts: Array<{
    id: number;
    requestId: number | null;
    amount: string;
    netAmount: string;
    processingFee: string;
    status: string;
    disputeStatus?: string;
    releasedAt: string | null;
    paidOutAt: string | null;
    createdAt: string;
  }>;
}

interface ConnectStatus {
  connected: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  chargesEnabled?: boolean;
  accountId?: string;
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "";
  return fmtDate(dateStr, { month: "short", day: "numeric", year: "numeric" });
}

function getStatusLabel(status: string, disputeStatus?: string) {
  if (disputeStatus === "captured") return "Damage Compensation";
  switch (status) {
    case "released": return "Added to Balance";
    case "held": return "Pending Handoff";
    case "pending_payout": return "Payout Processing";
    case "paid_out": return "Paid to Bank";
    default: return status;
  }
}

function getTxLabel(status: string, disputeStatus?: string) {
  const isPayout = status === "paid_out" || status === "pending_payout";
  if (isPayout) return "Bank Payout";
  if (disputeStatus === "captured") return "Damage Compensation";
  if (status === "held") return "Rental Earnings (Held)";
  return "Rental Earnings";
}

function StatusIcon({ status, colors }: { status: string; colors: ReturnType<typeof useColors> }) {
  switch (status) {
    case "released":
    case "paid_out":
      return <Feather name="check-circle" size={16} color="#0BB88C" />;
    case "held":
      return <Feather name="clock" size={16} color="#f59e0b" />;
    case "pending_payout":
      return <Feather name="arrow-down-circle" size={16} color="#3b82f6" />;
    default:
      return <Feather name="alert-circle" size={16} color={colors.mutedForeground} />;
  }
}

export default function MyBalanceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");

  // Track when the Stripe Connect browser is open so AppState listener knows to act
  const hasOpenedStripe = useRef(false);
  const appStateRef = useRef(AppState.currentState);

  const { data: balanceData, isLoading: balanceLoading } = useQuery<BalanceData>({
    queryKey: ["/api/rental-balance"],
    queryFn: () => apiGet("/api/rental-balance"),
  });

  const { data: connectStatus, isLoading: statusLoading, refetch: refetchStatus } = useQuery<ConnectStatus>({
    queryKey: ["/api/stripe/connect/status"],
    queryFn: () => apiGet("/api/stripe/connect/status"),
  });

  // Native: refetch connect status when user returns from Stripe Connect browser
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        next === "active" &&
        hasOpenedStripe.current
      ) {
        hasOpenedStripe.current = false;
        refetchStatus();
        queryClient.invalidateQueries({ queryKey: ["/api/rental-balance"] });
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [refetchStatus, queryClient]);

  // Web: detect Stripe Connect redirect back with ?connected / ?reconnect params
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "true") {
      Alert.alert("Bank account connected!", "Your payout account is set up. Earnings will be sent to your bank.");
      window.history.replaceState({}, "", window.location.pathname);
      refetchStatus();
    } else if (params.get("reconnect") === "true") {
      Alert.alert("Complete your setup", "Please finish connecting your bank account.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refetchStatus]);

  const onboardMutation = useMutation({
    mutationFn: () => {
      const returnUrl = Linking.createURL("/wallet?connected=true");
      const refreshUrl = Linking.createURL("/wallet?reconnect=true");
      return apiPost<{ url: string }>("/api/stripe/connect/onboard", { returnUrl, refreshUrl });
    },
    onSuccess: (data) => {
      if (data.url) {
        hasOpenedStripe.current = true;
        Linking.openURL(data.url);
      }
    },
    onError: (err: any) => Alert.alert("Setup Failed", err.message || "Could not start bank account setup."),
  });

  const payoutMutation = useMutation({
    mutationFn: (amount: number) => apiPost<{ message: string }>("/api/rental-balance/payout", { amount }),
    onSuccess: (data) => {
      Alert.alert("Payout Initiated!", data.message ?? "Processing your withdrawal.");
      setCashOutOpen(false);
      setPayoutAmount("");
      queryClient.invalidateQueries({ queryKey: ["/api/rental-balance"] });
    },
    onError: (err: any) => Alert.alert("Payout Failed", err.message || "Failed to process payout."),
  });

  function handlePayout() {
    const amount = parseFloat(payoutAmount);
    if (isNaN(amount) || amount < 10) {
      Alert.alert("Invalid Amount", "Minimum payout is $10.");
      return;
    }
    if (amount > available) {
      Alert.alert("Insufficient Balance", `Maximum available is $${available.toFixed(2)}.`);
      return;
    }
    payoutMutation.mutate(amount);
  }

  const available = balanceData?.balance?.available ?? 0;
  const pending = balanceData?.balance?.pending ?? 0;
  const isConnected = connectStatus?.connected ?? false;
  const detailsSubmitted = connectStatus?.detailsSubmitted ?? false;
  const payoutsEnabled = connectStatus?.payoutsEnabled ?? false;
  const canCashOut = available >= 10 && payoutsEnabled;

  const isLoading = balanceLoading || statusLoading;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
          <Text style={[styles.backText, { color: colors.foreground }]}>Back to Profile</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0BB88C" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Title */}
          <View style={styles.titleRow}>
            <View style={styles.titleIcon}>
              <Feather name="credit-card" size={22} color="#0BB88C" />
            </View>
            <View>
              <Text style={[styles.title, { color: colors.foreground }]}>My Balance</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Rental earnings and payouts</Text>
            </View>
          </View>

          {/* Balance card */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.balanceRow}>
              <View style={styles.balanceBox}>
                <Text style={styles.balanceCaption}>AVAILABLE</Text>
                <Text style={styles.availableAmount}>${available.toFixed(2)}</Text>
              </View>
              <View style={[styles.balanceBox, styles.pendingBox]}>
                <Text style={styles.balanceCaption}>PENDING</Text>
                <Text style={styles.pendingAmount}>${pending.toFixed(2)}</Text>
                <Text style={styles.pendingNote}>Released at handoff</Text>
              </View>
            </View>

            {canCashOut && (
              <>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <Pressable
                  style={({ pressed }) => [styles.cashOutBtn, { opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => setCashOutOpen(true)}
                >
                  <Feather name="arrow-down-circle" size={16} color="#fff" />
                  <Text style={styles.cashOutBtnText}>Cash Out ${available.toFixed(2)}</Text>
                </Pressable>
              </>
            )}
          </View>

          {/* Payout Account card */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Feather name="home" size={15} color={colors.mutedForeground} />
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Payout Account</Text>
            </View>
            <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
              Your bank account for receiving rental earnings
            </Text>

            {!isConnected || !detailsSubmitted ? (
              <View style={{ gap: 12, marginTop: 12 }}>
                <View style={styles.alertAmber}>
                  <Feather name="alert-circle" size={18} color="#d97706" style={{ flexShrink: 0 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertAmberTitle}>No bank account connected</Text>
                    <Text style={styles.alertAmberBody}>Connect your bank to cash out your rental earnings.</Text>
                  </View>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.connectBtn, { opacity: pressed || onboardMutation.isPending ? 0.8 : 1 }]}
                  onPress={() => onboardMutation.mutate()}
                  disabled={onboardMutation.isPending}
                >
                  {onboardMutation.isPending
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Feather name="external-link" size={16} color="#fff" />}
                  <Text style={styles.connectBtnText}>
                    {onboardMutation.isPending ? "Redirecting to Stripe…" : "Connect Bank Account"}
                  </Text>
                </Pressable>
                <Text style={[styles.stripeNote, { color: colors.mutedForeground }]}>
                  Powered by Stripe · Bank-level security · Takes ~2 minutes
                </Text>
              </View>
            ) : payoutsEnabled ? (
              <View style={{ gap: 12, marginTop: 12 }}>
                <View style={styles.alertTeal}>
                  <Feather name="check-circle" size={18} color="#0BB88C" style={{ flexShrink: 0 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertTealTitle}>Bank account connected</Text>
                    <Text style={styles.alertTealBody}>Payouts enabled · Managed by Stripe</Text>
                  </View>
                  <View style={styles.activeBadge}>
                    <Text style={styles.activeBadgeText}>Active</Text>
                  </View>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.outlineBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => onboardMutation.mutate()}
                  disabled={onboardMutation.isPending}
                >
                  <Feather name="refresh-cw" size={13} color={colors.foreground} />
                  <Text style={[styles.outlineBtnText, { color: colors.foreground }]}>Update bank details</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ gap: 12, marginTop: 12 }}>
                <View style={styles.alertBlue}>
                  <Feather name="loader" size={18} color="#3b82f6" style={{ flexShrink: 0 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertBlueTitle}>Verification in progress</Text>
                    <Text style={styles.alertBlueBody}>Stripe is verifying your account. This usually takes a few minutes.</Text>
                  </View>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.outlineBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => onboardMutation.mutate()}
                  disabled={onboardMutation.isPending}
                >
                  <Feather name="external-link" size={13} color={colors.foreground} />
                  <Text style={[styles.outlineBtnText, { color: colors.foreground }]}>Complete Stripe Verification</Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* Transaction History */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Transaction History</Text>
            </View>
            <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>Your earnings and payouts</Text>

            {balanceData?.payouts && balanceData.payouts.length > 0 ? (
              <View style={{ gap: 8, marginTop: 12 }}>
                {balanceData.payouts.map((payout) => {
                  const isPayout = payout.status === "paid_out" || payout.status === "pending_payout";
                  const net = parseFloat(payout.netAmount);
                  const date = payout.paidOutAt || payout.releasedAt || payout.createdAt;
                  return (
                    <View key={payout.id} style={[styles.txRow, { backgroundColor: colors.background }]}>
                      <StatusIcon status={payout.status} colors={colors} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.txLabel, { color: colors.foreground }]}>
                          {getTxLabel(payout.status, payout.disputeStatus)}
                        </Text>
                        <Text style={[styles.txDate, { color: colors.mutedForeground }]}>{formatDate(date)}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={[styles.txAmount, { color: isPayout ? "#ef4444" : "#0BB88C" }]}>
                          {isPayout ? "-" : "+"}${net.toFixed(2)}
                        </Text>
                        <Text style={[styles.txStatus, { color: colors.mutedForeground }]}>
                          {getStatusLabel(payout.status, payout.disputeStatus)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptyTx}>
                <Feather name="credit-card" size={40} color={colors.border} />
                <Text style={[styles.emptyTxTitle, { color: colors.foreground }]}>No transactions yet</Text>
                <Text style={[styles.emptyTxSub, { color: colors.mutedForeground }]}>
                  Your rental earnings will appear here after handoff.
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {/* Cash Out Modal */}
      <Modal visible={cashOutOpen} transparent animationType="slide" onRequestClose={() => setCashOutOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <Pressable style={styles.modalOverlay} onPress={() => setCashOutOpen(false)}>
            <Pressable style={[styles.modalSheet, { backgroundColor: colors.card }]} onPress={() => {}}>
              <View style={styles.modalHandle} />
              <View style={styles.modalHeader}>
                <Feather name="arrow-down-circle" size={20} color="#0BB88C" />
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Cash Out to Bank</Text>
              </View>
              <Text style={[styles.modalDesc, { color: colors.mutedForeground }]}>
                Transfer earnings to your connected bank account
              </Text>

              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Amount to withdraw</Text>
              <View style={[styles.inputWrap, { borderColor: colors.border }]}>
                <Feather name="dollar-sign" size={16} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.input, { color: colors.foreground }]}
                  placeholder="0.00"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="decimal-pad"
                  value={payoutAmount}
                  onChangeText={setPayoutAmount}
                />
              </View>
              <Text style={[styles.inputHint, { color: colors.mutedForeground }]}>
                Available: ${available.toFixed(2)} · Minimum: $10.00
              </Text>
              <Pressable onPress={() => setPayoutAmount(available.toFixed(2))}>
                <Text style={styles.fullBalanceLink}>Withdraw full balance</Text>
              </Pressable>

              <View style={styles.processingNote}>
                <Feather name="clock" size={14} color="#3b82f6" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.processingTitle}>Processing Time</Text>
                  <Text style={styles.processingBody}>Funds arrive in your bank account within 2–5 business days.</Text>
                </View>
              </View>

              <View style={styles.modalActions}>
                <Pressable
                  style={[styles.cancelBtn, { borderColor: colors.border }]}
                  onPress={() => setCashOutOpen(false)}
                >
                  <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.sendBtn, { opacity: payoutMutation.isPending || !payoutAmount ? 0.7 : 1 }]}
                  onPress={handlePayout}
                  disabled={payoutMutation.isPending || !payoutAmount}
                >
                  {payoutMutation.isPending
                    ? <ActivityIndicator size="small" color="#fff" />
                    : null}
                  <Text style={styles.sendBtnText}>
                    {payoutMutation.isPending ? "Processing…" : "Send to Bank"}
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  backText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },

  content: { padding: 16, gap: 16 },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  titleIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#D4F7F1",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },

  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  cardDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },

  balanceRow: {
    flexDirection: "row",
    gap: 12,
  },
  balanceBox: {
    flex: 1,
    backgroundColor: "#f0fdfa",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 4,
  },
  pendingBox: {
    backgroundColor: "#fffbeb",
  },
  balanceCaption: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: "#64748b",
    letterSpacing: 0.5,
  },
  availableAmount: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: "#0BB88C",
  },
  pendingAmount: {
    fontSize: 24,
    fontFamily: "Inter_600SemiBold",
    color: "#d97706",
  },
  pendingNote: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#94a3b8",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 14,
  },
  cashOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#0BB88C",
    borderRadius: 12,
    paddingVertical: 12,
  },
  cashOutBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },

  alertAmber: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fde68a",
    borderRadius: 10,
    padding: 12,
  },
  alertAmberTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#92400e",
  },
  alertAmberBody: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#b45309",
    marginTop: 2,
  },
  alertTeal: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#f0fdfa",
    borderWidth: 1,
    borderColor: "#99f6e4",
    borderRadius: 10,
    padding: 12,
  },
  alertTealTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#134e4a",
  },
  alertTealBody: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#0d9488",
    marginTop: 2,
  },
  activeBadge: {
    backgroundColor: "#0BB88C",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  activeBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  alertBlue: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
    borderRadius: 10,
    padding: 12,
  },
  alertBlueTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#1e40af",
  },
  alertBlueBody: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#3b82f6",
    marginTop: 2,
  },
  connectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#0BB88C",
    borderRadius: 12,
    paddingVertical: 13,
  },
  connectBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  stripeNote: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  outlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
  },
  outlineBtnText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },

  txRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
  },
  txLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  txDate: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  txAmount: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  txStatus: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  emptyTx: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 8,
    marginTop: 8,
  },
  emptyTxTitle: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
  },
  emptyTxSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
    gap: 12,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
    alignSelf: "center",
    marginBottom: 8,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  modalDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: -4,
  },
  inputLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  inputHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: -4,
  },
  fullBalanceLink: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#0BB88C",
  },
  processingNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
  },
  processingTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#1e40af",
  },
  processingBody: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#3b82f6",
    marginTop: 2,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  sendBtn: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    backgroundColor: "#0BB88C",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnText: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
