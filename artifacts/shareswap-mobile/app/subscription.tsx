import { Feather } from "@expo/vector-icons";
import { PRICES_IN_CAD_NOTE } from "@/lib/money";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
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
    features: ["3 borrows per month", "Unlimited swaps & gifts & rentals"],
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
    features: ["Unlimited borrows"],
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
      "4% rental service fee instead of 5%",
      "$1.50 courier fee waived for 5 deliveries a month",
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
  const params = useLocalSearchParams<{ sub_success?: string; sub_canceled?: string; session_id?: string }>();
  useEffect(() => {
    if (params.sub_success === "true") {
      // Ask the server to read the Checkout session from Stripe so the plan shows now, without waiting on the webhook.
      const refresh = () => qc.invalidateQueries({ queryKey: ["/api/subscription/status"] });
      const confirm = params.session_id
        ? apiPost("/api/subscription/confirm", { sessionId: params.session_id }).catch(() => undefined)
        : Promise.resolve();
      confirm.then(refresh);
      Alert.alert("Subscription activated!", "Your new plan benefits are now active.");
    } else if (params.sub_canceled === "true") {
      Alert.alert("Checkout canceled", "No charges were made.");
    }
  }, [params.sub_success, params.sub_canceled, params.session_id]);

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

  // Upgrades use the saved card (no Checkout redirect). Stripe Checkout stays for web.
  const [confirmTier, setConfirmTier] = useState<Tier | null>(null);
  const [retryTierAfterCard, setRetryTierAfterCard] = useState<Tier | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const pendingSubscriptionId = useRef<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  const { data: cardData } = useQuery<SavedCard>({
    queryKey: ["payment-method"],
    queryFn: () => apiGet<SavedCard>("/api/payment-method"),
    enabled: !!user,
  });

  // Back from adding a card for an upgrade: reopen the sheet so the user can retry.
  useFocusEffect(
    useCallback(() => {
      if (retryTierAfterCard) {
        qc.invalidateQueries({ queryKey: ["payment-method"] });
        setConfirmTier(retryTierAfterCard);
        setRetryTierAfterCard(null);
      }
    }, [retryTierAfterCard]),
  );

  // Back from authenticating the payment in the browser: ask the server to read the subscription from Stripe.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const subscriptionId = pendingSubscriptionId.current;
      if (next === "active" && subscriptionId) {
        pendingSubscriptionId.current = null;
        apiPost("/api/subscription/confirm", { subscriptionId })
          .catch(() => undefined)
          .then(() => qc.invalidateQueries({ queryKey: ["/api/subscription/status"] }));
      }
    });
    return () => sub.remove();
  }, []);

  const subscribeMutation = useMutation({
    mutationFn: (tier: Tier) => apiPost<{ tier: Tier }>("/api/subscription/subscribe", { tier }),
    onSuccess: (_data, tier) => {
      setConfirmTier(null);
      setSheetError(null);
      setAuthUrl(null);
      qc.invalidateQueries({ queryKey: ["/api/subscription/status"] });
      Alert.alert("Subscription activated!", `You're now on the ${PLAN_META[tier].name} plan.`);
    },
    onError: (e: any, tier) => {
      if (e?.code === "CARD_REQUIRED") {
        setConfirmTier(null);
        qc.invalidateQueries({ queryKey: ["payment-method"] });
        Alert.alert("Please add a card", "Add a card, then come back to finish upgrading.", [
          { text: "Not now", style: "cancel" },
          {
            text: "Add a card",
            onPress: () => {
              setRetryTierAfterCard(tier);
              router.push("/payment-methods" as never);
            },
          },
        ]);
      } else if (e?.requiresAction) {
        pendingSubscriptionId.current = e.subscriptionId ?? null;
        setAuthUrl(e.hostedInvoiceUrl ?? null);
        setSheetError("Your card needs additional authentication to finish this upgrade.");
      } else {
        setSheetError(e?.message || "We couldn't start your subscription. Please try again.");
      }
    },
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

  const anyMutating = subscribeMutation.isPending || portalMutation.isPending;

  const billingDate = subStatus?.monthlyBorrowResetAt
    ? new Date(subStatus.monthlyBorrowResetAt).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
      })
    : null;

  const borrowUsed = subStatus?.monthlyBorrowCount ?? 0;
  const borrowPct = Math.min((borrowUsed / 3) * 100, 100);

  const otherTiers = (["member", "pro"] as Tier[]).filter((t) => t !== currentTier);

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
        <Pressable
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, opacity: pressed ? 0.6 : 1, alignSelf: "flex-start" })}
          onPress={() => router.back()}
        >
          <Feather name="arrow-left" size={16} color={colors.mutedForeground} />
          <Text style={{ fontSize: 14, color: colors.mutedForeground }}>Profile</Text>
        </Pressable>
        <View style={s.pageHeader}>
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

        {/* ── Current plan status ── */}
        {isLoading ? (
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, alignItems: "center", paddingVertical: 32, marginBottom: 16 }]}>
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        ) : (
          <View style={[s.card, { backgroundColor: colors.card, borderColor: plan.borderColor, borderWidth: 2, marginBottom: 16 }]}>
            {/* Plan name + badge */}
            <View style={s.planHeaderRow}>
              <View style={s.planHeaderLeft}>
                <View style={[s.planIconWrap, { backgroundColor: plan.iconBg }]}>
                  <Feather name={plan.icon as any} size={20} color={plan.iconColor} />
                </View>
                <View>
                  <Text style={[s.planCurrentLabel, { color: colors.mutedForeground }]}>Current plan</Text>
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

            {/* Billing + usage */}
            <View style={s.infoSection}>
              {billingDate && (
                <View style={s.infoRow}>
                  <Text style={[s.infoLabel, { color: colors.mutedForeground }]}>
                    {hasActivePaidSub ? "Next billing" : "Usage resets"}
                  </Text>
                  <Text style={[s.infoValue, { color: colors.foreground }]}>{billingDate}</Text>
                </View>
              )}
              {hasActivePaidSub && (
                <View style={s.infoRow}>
                  <Text style={[s.infoLabel, { color: colors.mutedForeground }]}>Amount</Text>
                  <Text style={[s.infoValue, { color: colors.foreground }]}>{plan.price}</Text>
                </View>
              )}
              {currentTier === "free" ? (
                <View>
                  <View style={[s.infoRow, { marginBottom: 6 }]}>
                    <Text style={[s.infoLabel, { color: colors.mutedForeground }]}>Borrows this month</Text>
                    <Text style={[s.infoValue, { color: colors.foreground }]}>{borrowUsed} / 3</Text>
                  </View>
                  <View style={[s.progressBg, { backgroundColor: colors.muted }]}>
                    <View style={[s.progressFill, { width: `${borrowPct}%` as any, backgroundColor: "#14b8a6" }]} />
                  </View>
                </View>
              ) : (
                <View style={s.infoRow}>
                  <Text style={[s.infoLabel, { color: colors.mutedForeground }]}>Borrows this month</Text>
                  <Text style={[s.infoValue, { color: "#0d9488", fontFamily: "Inter_600SemiBold" }]}>Unlimited</Text>
                </View>
              )}
            </View>

            {/* Features */}
            <View style={[s.divider, { backgroundColor: colors.border }]} />
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

            {/* CTA */}
            <View style={{ gap: 8 }}>
              {currentTier === "free" && (
                <View style={[s.manageBillingBtn, { borderColor: "#e2e8f0", backgroundColor: "transparent", opacity: 0.5 }]}>
                  <Text style={[s.manageBillingBtnText, { color: "#94a3b8" }]}>Your Current Plan</Text>
                </View>
              )}
              <Pressable
                style={({ pressed }) => [
                  s.manageBillingBtn,
                  { borderColor: colors.border, opacity: pressed || anyMutating ? 0.7 : 1 },
                ]}
                onPress={() => portalMutation.mutate()}
                disabled={anyMutating}
              >
                {portalMutation.isPending
                  ? <ActivityIndicator size="small" color={colors.mutedForeground} />
                  : <Feather name="credit-card" size={16} color={colors.mutedForeground} />}
                <Text style={[s.manageBillingBtnText, { color: colors.foreground }]}>
                  {portalMutation.isPending ? "Opening…" : "Manage billing"}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ── Plans & Pricing ── */}
        {!isLoading && (
          <View style={s.pricingSection}>
            {otherTiers.map((tier) => {
              const p = PLAN_META[tier];
              const isCurrent = currentTier === tier;
              const isCheckingOut = false;

              // Current free plan gets teal border like paid plans
              const borderColor =
                isCurrent && tier === "free"
                  ? "#2dd4bf"
                  : tier === "member"
                  ? "#2dd4bf"
                  : tier === "pro"
                  ? "#fbbf24"
                  : "#e2e8f0";

              const btnBg = tier === "member" ? "#0d9488" : "#f59e0b";
              const btnBgPressed = tier === "member" ? "#0f766e" : "#d97706";

              const features: { text: string; included: boolean }[] =
                tier === "free"
                  ? [
                      { text: "3 borrows per month", included: true },
                      { text: "Unlimited swaps & gifts & rentals", included: true },
                      { text: "5% service fee on rentals", included: false },
                    ]
                  : tier === "member"
                  ? [
                      { text: "Unlimited borrows", included: true },
                    ]
                  : [
                      { text: "Unlimited borrows", included: true },
                      { text: "4% rental service fee instead of 5%", included: true },
                      { text: "$1.50 courier fee waived for 5 deliveries a month", included: true },
                    ];

              return (
                <React.Fragment key={tier}>
                  {/* Badge sits in the gap between Free and Member */}
                  {tier === "member" && (
                    <View style={s.badgeRow}>
                      <View style={s.popularBadge}>
                        <Text style={s.popularBadgeText}>Most Popular</Text>
                      </View>
                    </View>
                  )}
                  {tier === "pro" && (
                    <View style={[s.badgeRow, { backgroundColor: "transparent" }]} />
                  )}

                  <View style={[s.planCard, { backgroundColor: colors.card, borderColor }]}>
                    {/* Current-plan banner */}
                    {isCurrent && (
                      <View style={[s.currentBanner, { borderBottomColor: colors.border }]}>
                        <Text style={s.currentLabel}>Current Plan</Text>
                        {tier === "free" ? (
                          <Text style={[s.currentSub, { color: colors.mutedForeground }]}>
                            {borrowUsed} / 3 borrows used this month
                          </Text>
                        ) : (
                          <View style={s.activePill}>
                            <Text style={s.activePillText}>Active</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Icon + name + price row */}
                    <View style={s.tierRow}>
                      <View style={[s.tierIcon, { backgroundColor: p.iconBg }]}>
                        <Feather name={p.icon as any} size={15} color={p.iconColor} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.tierName, { color: colors.foreground }]}>{p.name}</Text>
                        <Text style={[s.tierNote, { color: colors.mutedForeground }]}>
                          {tier === "free" ? "Free forever" : tier === "member" ? "$4.99 / month" : "$9.99 / month"}
                          {tier !== "free" ? ` · ${PRICES_IN_CAD_NOTE}` : ""}
                        </Text>
                      </View>
                      <Text style={[s.tierPrice, { color: tier === "free" ? "#475569" : colors.foreground }]}>
                        {tier === "free" ? "$0" : tier === "member" ? "$4.99" : "$9.99"}
                        {tier !== "free" && (
                          <Text style={[s.tierPriceSuffix, { color: colors.mutedForeground }]}> /mo</Text>
                        )}
                      </Text>
                    </View>

                    {/* Feature list */}
                    <View style={s.featureList}>
                      {features.map(({ text, included }) => (
                        <View key={text} style={s.featureItem}>
                          {included ? (
                            <Feather name="check" size={13} color="#14b8a6" style={{ marginTop: 1 }} />
                          ) : (
                            <View style={s.featureDotSm} />
                          )}
                          <Text style={[s.featureItemText, { color: included ? "#475569" : "#94a3b8" }]}>
                            {text}
                          </Text>
                        </View>
                      ))}
                    </View>

                    {/* CTA button */}
                    {tier === "free" ? (
                      <View style={[s.ghostBtn, { borderColor: "#e2e8f0" }]}>
                        <Text style={s.ghostBtnText}>
                          {isCurrent ? "Your Current Plan" : "Free Plan"}
                        </Text>
                      </View>
                    ) : isCurrent ? (
                      <View style={{ gap: 8 }}>
                        <View style={[s.ghostBtn, {
                          borderColor: tier === "member" ? "#99f6e4" : "#fde68a",
                        }]}>
                          <Text style={[s.ghostBtnText, {
                            color: tier === "member" ? "#0d9488" : "#d97706",
                          }]}>✓ Current Plan</Text>
                        </View>
                        <Pressable
                          style={({ pressed }) => [s.manageRow, { opacity: pressed ? 0.7 : 1 }]}
                          onPress={() => portalMutation.mutate()}
                          disabled={anyMutating}
                        >
                          <Feather name="settings" size={13} color="#64748b" />
                          <Text style={s.manageRowText}>
                            {portalMutation.isPending ? "Opening…" : "Manage Subscription"}
                          </Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        style={({ pressed }) => [
                          s.solidBtn,
                          { backgroundColor: pressed ? btnBgPressed : btnBg, opacity: anyMutating ? 0.7 : 1 },
                        ]}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setSheetError(null);
                          setAuthUrl(null);
                          setConfirmTier(tier);
                        }}
                        disabled={anyMutating}
                      >
                        {isCheckingOut ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={s.solidBtnText}>
                            {hasActivePaidSub
                              ? tier === "pro" ? "Upgrade to Pro" : "Switch to Member"
                              : tier === "member" ? "Subscribe — $4.99/mo" : "Subscribe — $9.99/mo"}
                          </Text>
                        )}
                      </Pressable>
                    )}
                  </View>
                </React.Fragment>
              );
            })}

            <Text style={[s.pricingFooter, { color: colors.mutedForeground }]}>
              Subscriptions renew monthly · Cancel anytime · Service fee includes Stripe processing
            </Text>
          </View>
        )}

      </ScrollView>

      <Modal visible={confirmTier !== null} transparent animationType="slide" onRequestClose={() => setConfirmTier(null)}>
        <Pressable style={s.sheetBackdrop} onPress={() => !subscribeMutation.isPending && setConfirmTier(null)}>
          <Pressable style={[s.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 }]} onPress={() => {}}>
            {confirmTier && (
              <ConfirmSheetBody
                tier={confirmTier}
                changing={hasActivePaidSub}
                card={cardData?.hasPaymentMethod ? cardData.paymentMethod : null}
                pending={subscribeMutation.isPending}
                error={sheetError}
                authUrl={authUrl}
                onConfirm={() => {
                  setSheetError(null);
                  subscribeMutation.mutate(confirmTier);
                }}
                onAddCard={() => {
                  setRetryTierAfterCard(confirmTier);
                  setConfirmTier(null);
                  router.push("/payment-methods" as never);
                }}
                onAuthenticate={() => authUrl && Linking.openURL(authUrl)}
                onClose={() => setConfirmTier(null)}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

interface SavedCard {
  hasPaymentMethod: boolean;
  paymentMethod: { last4: string; brand: string } | null;
}

const BRAND_NAMES: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay" };

function ConfirmSheetBody(props: {
  tier: Tier;
  changing: boolean;
  card: { last4: string; brand: string } | null;
  pending: boolean;
  error: string | null;
  authUrl: string | null;
  onConfirm: () => void;
  onAddCard: () => void;
  onAuthenticate: () => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const meta = PLAN_META[props.tier];
  return (
    <View style={{ gap: 14 }}>
      <Text style={[s.sheetTitle, { color: colors.foreground }]}>
        {props.changing ? `Switch to ${meta.name}` : `Subscribe to ${meta.name}`}
      </Text>
      <Text style={[s.sheetPrice, { color: colors.foreground }]}>{`$${meta.priceNum.toFixed(2)} CAD / month`}</Text>
      <View style={{ gap: 6 }}>
        {meta.features.map((f) => (
          <View key={f} style={s.featureRow}>
            <Feather name="check" size={13} color="#14b8a6" />
            <Text style={[s.featureText, { color: colors.foreground }]}>{f}</Text>
          </View>
        ))}
      </View>
      <View style={[s.sheetCardRow, { borderColor: colors.border }]}>
        <Feather name="credit-card" size={16} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, fontSize: 14 }}>
          {props.card ? `${BRAND_NAMES[props.card.brand?.toLowerCase()] ?? props.card.brand} •••• ${props.card.last4}` : "No card on file"}
        </Text>
      </View>
      {props.changing && (
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
          Your current subscription changes to this plan. Stripe prorates the difference.
        </Text>
      )}
      {props.error && <Text style={{ color: "#dc2626", fontSize: 13 }}>{props.error}</Text>}
      {props.authUrl && (
        <Pressable style={[s.solidBtn, { backgroundColor: "#0d9488" }]} onPress={props.onAuthenticate}>
          <Text style={s.solidBtnText}>Authenticate card</Text>
        </Pressable>
      )}
      {props.card ? (
        <Pressable
          style={[s.solidBtn, { backgroundColor: "#0d9488", opacity: props.pending ? 0.7 : 1 }]}
          onPress={props.onConfirm}
          disabled={props.pending}
        >
          {props.pending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.solidBtnText}>{`Confirm — $${meta.priceNum.toFixed(2)} CAD/mo`}</Text>}
        </Pressable>
      ) : (
        <Pressable style={[s.solidBtn, { backgroundColor: "#0d9488" }]} onPress={props.onAddCard}>
          <Text style={s.solidBtnText}>Add a card</Text>
        </Pressable>
      )}
      <Pressable onPress={props.onClose} disabled={props.pending} style={{ alignItems: "center", padding: 6 }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  sheetPrice: { fontSize: 22, fontFamily: "Inter_700Bold" },
  sheetCardRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, padding: 12 },
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

  // ── Plans & Pricing section ──────────────────────────────────────────────────
  pricingSection: { marginBottom: 0 },

  pricingHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginBottom: 6,
  },
  pricingTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  pricingSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 16,
    paddingHorizontal: 8,
  },

  // Plan card
  planCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    marginBottom: 0,
  },

  // "Most Popular" badge row (sits between cards)
  badgeRow: {
    alignItems: "center",
    marginVertical: 8,
  },
  popularBadge: {
    backgroundColor: "#0d9488",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  popularBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },

  // Current-plan banner inside card
  currentBanner: {
    marginBottom: 12,
    paddingBottom: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  currentLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#94a3b8",
    marginBottom: 2,
  },
  currentSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },

  // Icon + name + price row
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    marginBottom: 14,
  },
  tierIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  tierName: { fontSize: 15, fontFamily: "Inter_700Bold" },
  tierNote: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  tierPrice: { fontSize: 22, fontFamily: "Inter_700Bold" },
  tierPriceSuffix: { fontSize: 13, fontFamily: "Inter_400Regular" },

  // Feature list
  featureList: { gap: 10, marginBottom: 16 },
  featureItem: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  featureDotSm: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#cbd5e1",
    marginTop: 5,
    marginLeft: 4,
  },
  featureItemText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },

  // Ghost / outlined button (Free or current paid plan)
  ghostBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  ghostBtnText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#94a3b8",
    textAlign: "center",
  },

  // Manage subscription ghost row
  manageRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  manageRowText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#64748b",
  },

  // Solid CTA button (Subscribe / Switch / Upgrade)
  solidBtn: {
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  solidBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  // Footer note
  pricingFooter: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 16,
    lineHeight: 15,
    paddingHorizontal: 8,
  },
});
