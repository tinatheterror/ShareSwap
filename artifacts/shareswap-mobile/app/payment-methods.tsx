import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiRequest } from "@/lib/api";

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

export default function PaymentMethodsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const [isRedirecting, setIsRedirecting] = useState(false);
  const [removeModalOpen, setRemoveModalOpen] = useState(false);
  const [removeBlockReason, setRemoveBlockReason] = useState<string | null>(null);

  // After returning from Stripe browser, refetch payment method on app foreground
  const appState = useRef(AppState.currentState);
  const hasOpenedStripe = useRef(false);

  const { data, isLoading, refetch } = useQuery<PaymentMethodData>({
    queryKey: ["payment-method"],
    queryFn: () => apiGet("/api/payment-method"),
  });

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        next === "active" &&
        hasOpenedStripe.current
      ) {
        // User returned from Stripe — refresh payment method status
        hasOpenedStripe.current = false;
        setIsRedirecting(false);
        refetch();
        queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [refetch, queryClient]);

  // POST /api/payment-method/create-checkout-session → open Stripe URL
  const addCardMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/payment-method/create-checkout-session");
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || body?.message || "Failed to start payment setup.");
      return body;
    },
    onSuccess: (data) => {
      if (data.url) {
        setIsRedirecting(true);
        hasOpenedStripe.current = true;
        Linking.openURL(data.url).catch(() => {
          setIsRedirecting(false);
          hasOpenedStripe.current = false;
          Alert.alert("Error", "Could not open payment page.");
        });
      } else {
        Alert.alert("Error", "No redirect URL received from payment provider.");
      }
    },
    onError: (e: Error) => {
      setIsRedirecting(false);
      Alert.alert("Error", e.message || "Failed to start payment setup.");
    },
  });

  // DELETE /api/payment-method
  const removeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/payment-method");
      const body = await res.json();
      if (!res.ok) throw Object.assign(new Error(body?.error || body?.message || "Failed to remove"), { code: body?.code });
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment-method"] });
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      setRemoveModalOpen(false);
      setRemoveBlockReason(null);
      Alert.alert("Card removed", "Your payment method has been removed.");
    },
    onError: (e: Error) => {
      setRemoveBlockReason(e.message);
    },
  });

  const statusColors = {
    verified: { bg: "#f0fdf4", text: "#15803d", icon: "check-circle" as const },
    expired:  { bg: "#fffbeb", text: "#92400e", icon: "alert-triangle" as const },
    missing:  { bg: "#f3f4f6", text: "#4b5563", icon: "x-circle" as const },
  };

  const s = data?.status ?? "missing";
  const sc = statusColors[s] ?? statusColors.missing;
  const statusLabel = s === "verified" ? "On file" : s === "expired" ? "Needs update" : "Required";

  return (
    <View style={[styles.container, { backgroundColor: colors.muted ?? "#f5f6f8" }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPad + 16, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Page header */}
        <View style={styles.pageHeader}>
          <View style={[styles.iconWrap, { backgroundColor: "#f3f4f6" }]}>
            <Feather name="credit-card" size={22} color="#374151" />
          </View>
          <View>
            <Text style={[styles.pageTitle, { color: colors.foreground }]}>Payment Methods</Text>
            <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>For deposits and rentals</Text>
          </View>
        </View>

        {isLoading ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, alignItems: "center", justifyContent: "center", paddingVertical: 40 }]}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : data?.hasPaymentMethod ? (
          /* ── Card on file ── */
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardTopRow}>
              <View style={styles.cardInfoRow}>
                <View style={[styles.smallIconWrap, { backgroundColor: "#f9fafb" }]}>
                  <Feather name="credit-card" size={18} color="#4b5563" />
                </View>
                <View>
                  <Text style={[styles.cardBrand, { color: colors.foreground }]}>
                    {formatBrand(data.paymentMethod?.brand || "")} ••••{" "}{data.paymentMethod?.last4}
                  </Text>
                  <Text style={[styles.cardExpiry, { color: colors.mutedForeground }]}>
                    Expires {data.paymentMethod?.expMonth}/{data.paymentMethod?.expYear}
                  </Text>
                </View>
              </View>
              <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
                <Feather name={sc.icon} size={13} color={sc.text} />
                <Text style={[styles.statusPillText, { color: sc.text }]}>{statusLabel}</Text>
              </View>
            </View>

            <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
              Used for rental payments, security deposits, and damage reimbursements
            </Text>

            <View style={[styles.sep, { backgroundColor: colors.border }]} />

            <View style={styles.btnRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.outlineBtn,
                  { borderColor: colors.border, backgroundColor: colors.background, flex: 1, opacity: pressed || addCardMutation.isPending || isRedirecting ? 0.7 : 1 },
                ]}
                onPress={() => addCardMutation.mutate()}
                disabled={addCardMutation.isPending || isRedirecting}
              >
                {addCardMutation.isPending || isRedirecting ? (
                  <><ActivityIndicator size="small" color={colors.mutedForeground} /><Text style={[styles.outlineBtnText, { color: colors.mutedForeground }]}>  Redirecting...</Text></>
                ) : (
                  <><Feather name="external-link" size={14} color={colors.mutedForeground} /><Text style={[styles.outlineBtnText, { color: colors.foreground }]}> Update payment method</Text></>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.ghostBtn, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => { setRemoveBlockReason(null); setRemoveModalOpen(true); }}
              >
                <Text style={[styles.ghostBtnText, { color: colors.mutedForeground }]}>Remove</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          /* ── No card ── */
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardTopRow}>
              <View style={styles.cardInfoRow}>
                <View style={[styles.smallIconWrap, { backgroundColor: "#f9fafb" }]}>
                  <Feather name="credit-card" size={18} color="#9ca3af" />
                </View>
                <View>
                  <Text style={[styles.cardBrand, { color: "#4b5563" }]}>No card on file</Text>
                  <Text style={[styles.cardExpiry, { color: colors.mutedForeground }]}>
                    Required for borrowing and renting
                  </Text>
                </View>
              </View>
              <View style={[styles.statusPill, { backgroundColor: "#f3f4f6" }]}>
                <Feather name="x-circle" size={13} color="#4b5563" />
                <Text style={[styles.statusPillText, { color: "#4b5563" }]}>Required</Text>
              </View>
            </View>

            <View style={[styles.infoBox, { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" }]}>
              <Feather name="shield" size={14} color="#3b82f6" />
              <Text style={styles.infoBoxText}>
                Your card is used for rental payments, security deposits when borrowing items, and any damage reimbursements if applicable.
              </Text>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                { opacity: pressed || addCardMutation.isPending || isRedirecting ? 0.8 : 1 },
              ]}
              onPress={() => addCardMutation.mutate()}
              disabled={addCardMutation.isPending || isRedirecting}
            >
              {addCardMutation.isPending || isRedirecting ? (
                <><ActivityIndicator color="#fff" size="small" /><Text style={styles.primaryBtnText}>  Redirecting to secure payment page...</Text></>
              ) : (
                <><Feather name="external-link" size={16} color="#fff" /><Text style={styles.primaryBtnText}> Add payment method</Text></>
              )}
            </Pressable>

            <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
              You'll be redirected to a secure page to enter your card details
            </Text>
          </View>
        )}

        {isRedirecting && (
          <View style={[styles.returnCard, { backgroundColor: "#f0fdfa", borderColor: "#99f6e4" }]}>
            <Feather name="info" size={16} color="#0d9488" />
            <Text style={[styles.returnText, { color: "#065f46" }]}>
              Complete the payment setup in your browser, then return to this screen. Your card will appear automatically.
            </Text>
          </View>
        )}

        <Text style={[styles.footnote, { color: colors.mutedForeground, textAlign: "center", marginTop: 8 }]}>
          Your card is securely handled by Stripe. It may be used for refundable deposits, paid transactions, subscriptions, or reimbursements when applicable.
        </Text>
      </ScrollView>

      {/* Remove Card Modal */}
      <Modal
        visible={removeModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setRemoveModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setRemoveModalOpen(false)} />
          <View style={[styles.modalSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Remove payment method?</Text>

            <View style={[styles.infoBox, { backgroundColor: "#fffbeb", borderColor: "#fde68a" }]}>
              <Feather name="alert-triangle" size={14} color="#d97706" />
              <Text style={[styles.infoBoxText, { color: "#92400e" }]}>
                Removing your payment method will disable borrowing and renting until another card is added.
              </Text>
            </View>

            {removeBlockReason ? (
              <View style={[styles.infoBox, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
                <Feather name="x-circle" size={14} color="#dc2626" />
                <Text style={[styles.infoBoxText, { color: "#991b1b" }]}>{removeBlockReason}</Text>
              </View>
            ) : (
              <>
                <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
                  Your card can only be removed if you have no active borrows or rentals, pending returns, damage claims, or unpaid balances.
                </Text>
                <View style={[styles.infoBox, { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" }]}>
                  <Feather name="info" size={14} color="#3b82f6" />
                  <Text style={[styles.infoBoxText, { color: "#1e40af" }]}>
                    To switch cards, use <Text style={{ fontFamily: "Inter_600SemiBold" }}>Update payment method</Text> — your old card will be replaced automatically.
                  </Text>
                </View>
              </>
            )}

            <View style={styles.modalBtns}>
              <Pressable
                style={({ pressed }) => [
                  styles.destructiveBtn,
                  { opacity: (pressed || removeMutation.isPending || !!removeBlockReason) ? 0.5 : 1 },
                ]}
                onPress={() => removeMutation.mutate()}
                disabled={removeMutation.isPending || !!removeBlockReason}
              >
                {removeMutation.isPending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.primaryBtnText}>Remove card</Text>}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.outlineBtn,
                  { borderColor: colors.border, backgroundColor: colors.background, opacity: pressed ? 0.7 : 1 },
                ]}
                onPress={() => { setRemoveModalOpen(false); setRemoveBlockReason(null); }}
              >
                <Text style={[styles.outlineBtnText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 16 },
  pageHeader: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 4 },
  iconWrap: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  pageTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  pageSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 14 },
  cardTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  cardInfoRow: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  smallIconWrap: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardBrand: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardExpiry: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusPillText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  cardDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  sep: { height: StyleSheet.hairlineWidth },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  outlineBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  outlineBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  ghostBtn: { paddingHorizontal: 12, paddingVertical: 11 },
  ghostBtnText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: 10, padding: 12 },
  infoBoxText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, color: "#1e40af" },
  primaryBtn: { backgroundColor: "#0d9488", borderRadius: 12, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  primaryBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  footnote: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  returnCard: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderRadius: 12, padding: 14 },
  returnText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  // Modal
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  modalBtns: { gap: 10, marginTop: 4 },
  destructiveBtn: { backgroundColor: "#dc2626", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
});
