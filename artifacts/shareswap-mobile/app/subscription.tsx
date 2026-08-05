import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { apiGet, apiPost } from "@/lib/api";

interface SubStatus {
  subscriptionTier: string;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus: string | null;
  monthlyBorrowCount: number;
  monthlyBorrowResetAt: string | null;
}

type Tier = "free" | "member" | "pro";

const PLAN_META: Record<
  Tier,
  {
    name: string;
    price: string;
    priceNum: number;
    icon: string;
    iconBg: string;
    iconColor: string;
    borderColor: string;
    accentColor: string;
    features: string[];
    limitations: string[];
  }
> = {
  free: {
    name: "Free",
    price: "$0",
    priceNum: 0,
    icon: "zap",
    iconBg: "#f1f5f9",
    iconColor: "#64748b",
    borderColor: "#e2e8f0",
    accentColor: "#64748b",
    features: ["3 borrows per month", "Unlimited swaps & gifts"],
    limitations: ["5% service fee on rentals"],
  },
  member: {
    name: "Member",
    price: "$4.99/mo",
    priceNum: 4.99,
    icon: "star",
    iconBg: "#f0fdfa",
    iconColor: "#0d9488",
    borderColor: "#2dd4bf",
    accentColor: "#0d9488",
    features: ["Unlimited borrows", "Unlimited swaps & gifts", "5% service fee on rentals"],
    limitations: [],
  },
  pro: {
    name: "Pro",
    price: "$9.99/mo",
    priceNum: 9.99,
    icon: "award",
    iconBg: "#fffbeb",
    iconColor: "#f59e0b",
    borderColor: "#fbbf24",
    accentColor: "#f59e0b",
    features: [
      "Unlimited borrows",
      "Unlimited swaps & gifts",
      "Reduced 4% service fee on rentals",
      "Activity & Insights dashboard",
      "$1.50 courier fee waived (5/mo)",
    ],
    limitations: [],
  },
};

export default function SubscriptionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;
  const hasOpenedStripe = useRef(false);

  // Handle Stripe deep-link return
  const params = useLocalSearchParams<{ sub_success?: string; sub_canceled?: string }>();
  useEffect(() => {
    if (params.sub_success === "true") {
      qc.invalidateQueries({ queryKey: ["/api/subscription/status"] });
      Alert.alert("Subscription activated!", "Your new plan benefits are now active.");
    } else if (params.sub_canceled === "true") {
      Alert.alert("Checkout canceled", "No charges were made.");
    }
  }, [params.sub_success, params.sub_canceled]);

  // Re-fetch subscription when returning from Stripe
  useEffect(() => {
    const sub = Linking.addEventListener("url", () => {
      if (hasOpenedStripe.current) {
        hasOpenedStripe.current = false;
        qc.invalidateQueries({ queryKey: ["/api/subscription/status"] });
      }
    });
    return () => sub.remove();
  }, []);

  const { data: subStatus, isLoading } = useQuery<SubStatus>({
    queryKey: ["/api/subscription/status"],
    queryFn: () => apiGet<SubStatus>("/api/subscription/status"),
    enabled: !!user,
  });

  const currentTier: Tier = (subStatus?.subscriptionTier ?? "free") as Tier;
  const hasActivePaidSub =
    currentTier !== "free" && subStatus?.stripeSubscriptionStatus === "active";
  const plan = PLAN_META[currentTier] ?? PLAN_META.free;

  const checkoutMutation = useMutation({
    mutationFn: (tier: string) => {
      const successUrl = Linking.createURL("/subscription?sub_success=true");
      const cancelUrl = Linking.createURL("/subscription?sub_canceled=true");
      return apiPost<{ url: string }>("/api/subscription/checkout", {
        tier,
        successUrl,
        cancelUrl,
      });
    },
    onSuccess: (data) => {
      if (data.url) {
        hasOpenedStripe.current = true;
        Linking.openURL(data.url);
      }
    },
    onError: () => Alert.alert("Checkout failed", "Please try again."),
  });

  const portalMutation = useMutation({
    mutationFn: () => {
      const returnUrl = Linking.createURL("/subscription");
      return apiPost<{ url: string }>("/api/subscription/portal", { returnUrl });
    },
    onSuccess: (data) => {
      if (data.url) {
        hasOpenedStripe.current = true;
        Linking.openURL(data.url);
      }
    },
    onError: () => Alert.alert("Error", "Could not open subscription portal."),
  });

  const anyMutating = checkoutMutation.isPending || portalMutation.isPending;

  const billingDate = subStatus?.monthlyBorrowResetAt
    ? new Date(subStatus.monthlyBorrowResetAt).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
      })
    : null;

  const borrowUsed = subStatus?.monthlyBorrowCount ?? 0;
  const borrowPct = Math.min((borrowUsed / 3) * 100, 100);

  const otherTiers = (["free", "member", "pro"] as Tier[]).filter((t) => t !== currentTier);

  return (
    <View style={[s.container, { backgroundColor: colors.muted ?? "#f5f6f8" }]}>
      <ScrollView
        contentContainerStyle={[
          s.scroll,
          { paddingTop: topPad + 16, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Page header */}
        <View style={s.pageHeader}>
          <Pressable
            style={({ pressed }) => [s.backBtn, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => router.back()}
          >
            <Feather name="arrow-left" size={18} color={colors.mutedForeground} />
          </Pressable>
          <View style={[s.headerIconWrap, { backgroundColor: "#D4F7F1" }]}>
            <Feather name="award" size={22} color="#0d9488" />
          </View>
          <View>
            <Text style={[s.pageTitle, { color: colors.foreground }]}>Subscription</Text>
            <Text style={[s.pageSubtitle, { color: colors.mutedForeground }]}>
              Manage your plan and billing
            </Text>
          </View>
        </View>

        {/* ── Current plan card ── */}
        {isLoading ? (
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border, alignItems: "center", paddingVertical: 32 }]}>
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        ) : (
          <View
            style={[
              s.card,
              { backgroundColor: colors.card, borderColor: plan.borderColor, borderWidth: 2 },
            ]}
          >
            {/* Header */}
            <View style={s.planHeaderRow}>
              <View style={s.planHeaderLeft}>
                <View style={[s.planIconWrap, { backgroundColor: plan.iconBg }]}>
                  <Feather name={plan.icon as any} size={20} color={plan.iconColor} />
                </View>
                <View>
                  <Text style={[s.planCurrentLabel, { color: colors.mutedForeground }]}>
                    Current plan
                  </Text>
                  <Text style={[s.planName, { color: colors.foreground }]}>{plan.name}</Text>
                </View>
              </View>
              <View style={s.planHeaderRight}>
                {hasActivePaidSub ? (
                  <View style={s.activePill}>
                    <Text style={s.activePillText}>Active</Text>
                  </View>
                ) : (
                  <View style={[s.activePill, { backgroundColor: "#f1f5f9", borderColor: "#e2e8f0" }]}>
                    <Text style={[s.activePillText, { color: "#64748b" }]}>Free</Text>
                  </View>
                )}
                <Text style={[s.planPrice, { color: colors.foreground }]}>{plan.price}</Text>
              </View>
            </View>

            <View style={[s.divider, { backgroundColor: colors.border }]} />

            {/* Billing & usage */}
            <View style={s.infoSection}>
              {billingDate && (
                <View style={s.infoRow}>
                  <Text style={[s.infoLabel, { color: colors.mutedForeground }]}>
                    {hasActivePaidSub ? "Next billing" : "Usage resets"}
                  </Text>
                  <Text style={[s.infoValue, { color: colors.foreground }]}>{billingDate}</Text>
                </View>
              )}
              {currentTier === "free" ? (
                <View>
                  <View style={[s.infoRow, { marginBottom: 6 }]}>
                    <Text style={[s.infoLabel, { color: colors.mutedForeground }]}>
                      Borrows this month
                    </Text>
                    <Text style={[s.infoValue, { color: colors.foreground }]}>
                      {borrowUsed} / 3
                    </Text>
                  </View>
                  <View style={[s.progressBg, { backgroundColor: colors.muted }]}>
                    <View
                      style={[s.progressFill, { width: `${borrowPct}%` as any, backgroundColor: "#14b8a6" }]}
                    />
                  </View>
                </View>
              ) : (
                <View style={s.infoRow}>
                  <Text style={[s.infoLabel, { color: colors.mutedForeground }]}>
                    Borrows this month
                  </Text>
                  <Text style={[s.infoValue, { color: "#0d9488", fontFamily: "Inter_600SemiBold" }]}>
                    Unlimited
                  </Text>
                </View>
              )}
            </View>

            <View style={[s.divider, { backgroundColor: colors.border }]} />

            {/* Features */}
            <View style={s.featureList}>
              {plan.features.map((f) => (
                <View key={f} style={s.featureRow}>
                  <Feather name="check" size={13} color="#14b8a6" />
                  <Text style={[s.featureText, { color: colors.foreground }]}>{f}</Text>
                </View>
              ))}
              {plan.limitations.map((f) => (
                <View key={f} style={s.featureRow}>
                  <View style={s.featureDot} />
                  <Text style={[s.featureText, { color: colors.mutedForeground }]}>{f}</Text>
                </View>
              ))}
            </View>

            {/* Primary action */}
            {hasActivePaidSub ? (
              <Pressable
                style={({ pressed }) => [
                  s.manageBillingBtn,
                  { borderColor: colors.border, opacity: pressed || anyMutating ? 0.7 : 1 },
                ]}
                onPress={() => portalMutation.mutate()}
                disabled={anyMutating}
              >
                {portalMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.mutedForeground} />
                ) : (
                  <Feather name="credit-card" size={16} color={colors.mutedForeground} />
                )}
                <Text style={[s.manageBillingBtnText, { color: colors.foreground }]}>
                  {portalMutation.isPending ? "Opening…" : "Manage billing"}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  s.upgradeBtn,
                  { backgroundColor: pressed ? "#0f766e" : "#0d9488", opacity: anyMutating ? 0.7 : 1 },
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  checkoutMutation.mutate("member");
                }}
                disabled={anyMutating}
              >
                {checkoutMutation.isPending && checkoutMutation.variables === "member" ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Feather name="star" size={15} color="#fff" />
                )}
                <Text style={s.upgradeBtnText}>Upgrade to Member — $4.99/mo</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* ── Other plans ── */}
        {!isLoading && (
          <View style={s.otherSection}>
            <Text style={[s.otherSectionLabel, { color: colors.mutedForeground }]}>
              {hasActivePaidSub ? "SWITCH PLAN" : "AVAILABLE PLANS"}
            </Text>
            <View style={[s.otherCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {otherTiers.map((tier, idx) => {
                const p = PLAN_META[tier];
                const isLastRow = idx === otherTiers.length - 1;
                const isCheckingOut =
                  checkoutMutation.isPending && checkoutMutation.variables === tier;

                return (
                  <View key={tier}>
                    <View style={s.otherRow}>
                      <View style={[s.otherIconWrap, { backgroundColor: p.iconBg }]}>
                        <Feather name={p.icon as any} size={16} color={p.iconColor} />
                      </View>
                      <View style={s.otherTextGroup}>
                        <Text style={[s.otherPlanName, { color: colors.foreground }]}>
                          {p.name}
                        </Text>
                        <Text style={[s.otherPlanPrice, { color: colors.mutedForeground }]}>
                          {p.price}
                        </Text>
                      </View>
                      {tier === "free" ? (
                        /* Downgrade → open portal to cancel */
                        <Pressable
                          style={({ pressed }) => [s.otherActionBtn, { opacity: pressed ? 0.6 : 1 }]}
                          onPress={() => portalMutation.mutate()}
                          disabled={anyMutating}
                        >
                          <Text style={[s.otherActionBtnText, { color: colors.mutedForeground }]}>
                            Downgrade
                          </Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          style={({ pressed }) => [
                            s.otherActionBtn,
                            {
                              backgroundColor: tier === "pro" ? p.accentColor : "transparent",
                              borderColor: tier === "pro" ? p.accentColor : colors.border,
                              opacity: pressed || anyMutating ? 0.7 : 1,
                            },
                          ]}
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            hasActivePaidSub
                              ? portalMutation.mutate()
                              : checkoutMutation.mutate(tier);
                          }}
                          disabled={anyMutating}
                        >
                          {isCheckingOut ? (
                            <ActivityIndicator
                              size="small"
                              color={tier === "pro" ? "#fff" : colors.foreground}
                            />
                          ) : (
                            <Text
                              style={[
                                s.otherActionBtnText,
                                {
                                  color:
                                    tier === "pro" ? "#fff" : colors.foreground,
                                },
                              ]}
                            >
                              {hasActivePaidSub
                                ? tier === "pro"
                                  ? "Upgrade"
                                  : "Switch"
                                : "Subscribe"}
                            </Text>
                          )}
                        </Pressable>
                      )}
                    </View>
                    {!isLastRow && (
                      <View style={[s.rowDivider, { backgroundColor: colors.border }]} />
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <Text style={[s.footer, { color: colors.mutedForeground }]}>
          Subscriptions renew monthly · Cancel anytime via Manage billing · Service fee includes
          Stripe payment processing
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 0 },

  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  backBtn: { padding: 4 },
  headerIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  pageTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  pageSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },

  card: {
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    gap: 0,
  },
  planHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  planHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  planHeaderRight: { alignItems: "flex-end", gap: 6 },
  planIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  planCurrentLabel: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  planName: { fontSize: 22, fontFamily: "Inter_700Bold", marginTop: 1 },
  activePill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  activePillText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#15803d",
  },
  planPrice: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  divider: { height: 1, marginVertical: 14 },

  infoSection: { gap: 10, marginBottom: 0 },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  infoValue: { fontSize: 13, fontFamily: "Inter_500Medium" },
  progressBg: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },

  featureList: { gap: 8, marginBottom: 16 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#cbd5e1",
    marginLeft: 4,
  },
  featureText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },

  manageBillingBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  manageBillingBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },

  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 10,
  },
  upgradeBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  otherSection: { marginBottom: 0 },
  otherSectionLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  otherCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 16,
  },
  otherRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  otherIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  otherTextGroup: { flex: 1 },
  otherPlanName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  otherPlanPrice: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  otherActionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
    minWidth: 80,
    alignItems: "center",
  },
  otherActionBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  rowDivider: { height: 1, marginHorizontal: 14 },

  footer: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 16,
    marginTop: 4,
  },
});
