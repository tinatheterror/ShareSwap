import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiRequest, BASE_URL } from "@/lib/api";
import { fmtDate } from "@/lib/dateUtils";

type VerificationStatus = "unverified" | "pending" | "verified" | "failed";

interface VerificationData {
  status: VerificationStatus;
  legalFullName: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  failureReason: string | null;
}

export default function VerificationScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const [personaLoading, setPersonaLoading] = useState(false);
  const [personaError, setPersonaError] = useState<string | null>(null);
  // Store the inquiry ID so we can complete it when the user returns
  const pendingInquiryId = useRef<string | null>(null);
  const hasOpenedPersona = useRef(false);
  const appState = useRef(AppState.currentState);

  const { data: verification, isLoading, refetch } = useQuery<VerificationData>({
    queryKey: ["verification-status"],
    queryFn: () => apiGet("/api/verification-status"),
  });

  // When app comes back to foreground after Persona, complete the inquiry
  React.useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        next === "active" &&
        hasOpenedPersona.current &&
        pendingInquiryId.current
      ) {
        hasOpenedPersona.current = false;
        const id = pendingInquiryId.current;
        pendingInquiryId.current = null;
        setPersonaLoading(false);
        completeInquiryMutation.mutate({ inquiryId: id });
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  // POST /api/persona/create-inquiry
  const createInquiryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/persona/create-inquiry");
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || body?.message || "Could not start verification");
      return body;
    },
    onError: (e: Error) => {
      setPersonaError(e.message);
      setPersonaLoading(false);
    },
  });

  // POST /api/persona/inquiry-complete
  const completeInquiryMutation = useMutation({
    mutationFn: async ({ inquiryId }: { inquiryId: string }) => {
      const res = await apiRequest("POST", "/api/persona/inquiry-complete", {
        inquiryId,
        status: "completed",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || body?.message || "Verification error");
      return body;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["verification-status"] });
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      if (data.status === "approved") {
        Alert.alert("Identity Verified! ✅", data.message || "Your identity has been verified successfully.");
      } else if (data.status === "failed") {
        Alert.alert("Verification Failed", data.message || "Please try again.");
      } else {
        Alert.alert("Verification Submitted", "We're reviewing your submission and will notify you shortly.");
      }
    },
    onError: (e: Error) => {
      Alert.alert("Verification Error", e.message);
    },
  });

  const startPersonaVerification = async () => {
    setPersonaLoading(true);
    setPersonaError(null);

    try {
      const result = await createInquiryMutation.mutateAsync();
      const inquiryId = result.inquiryId;

      if (!inquiryId) throw new Error("Could not start verification");

      // Return URL — Persona will redirect here after completion.
      // On native, AppState foreground detection handles completion.
      const returnUrl = `${BASE_URL}/verification`;
      const personaUrl = `https://inquiry.withpersona.com/verify?inquiry-id=${inquiryId}&redirect-uri=${encodeURIComponent(returnUrl)}`;

      pendingInquiryId.current = inquiryId;
      hasOpenedPersona.current = true;

      await Linking.openURL(personaUrl);
    } catch (err: any) {
      setPersonaError(err.message || "Failed to start verification");
      setPersonaLoading(false);
      pendingInquiryId.current = null;
      hasOpenedPersona.current = false;
    }
  };

  const isVerified = verification?.status === "verified";
  const isPending  = verification?.status === "pending";
  const isFailed   = verification?.status === "failed";

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.muted ?? "#f5f6f8", alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

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
          <View style={[styles.badgeIconWrap, { backgroundColor: "#D4F7F1" }]}>
            <Feather name="shield" size={22} color="#0d9488" />
          </View>
          <View>
            <Text style={[styles.pageTitle, { color: colors.foreground }]}>Identity Verification</Text>
            <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>Build trust with a verified profile</Text>
          </View>
        </View>

        {/* ── VERIFIED ── */}
        {isVerified && (
          <>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.statusHeaderRow}>
                <View style={styles.cardInfoRow}>
                  <View style={[styles.iconCircle, { backgroundColor: "#dcfce7" }]}>
                    <Feather name="check-circle" size={22} color="#16a34a" />
                  </View>
                  <View>
                    <Text style={[styles.statusTitle, { color: colors.foreground }]}>Identity Verified</Text>
                    <Text style={[styles.statusSub, { color: colors.mutedForeground }]}>
                      Verified on {verification?.verifiedAt ? fmtDate(verification.verifiedAt, { month: "short", day: "numeric", year: "numeric" }) : "N/A"}
                    </Text>
                  </View>
                </View>
                <View style={[styles.statusPill, { backgroundColor: "#f0fdf4" }]}>
                  <Feather name="check-circle" size={13} color="#15803d" />
                  <Text style={[styles.statusPillText, { color: "#15803d" }]}>Verified</Text>
                </View>
              </View>

              <View style={[styles.sep, { backgroundColor: colors.border }]} />

              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Legal Name</Text>
                <Text style={[styles.detailValue, { color: colors.foreground }]}>{verification?.legalFullName}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Verification Method</Text>
                <Text style={[styles.detailValue, { color: colors.foreground }]}>ID + Selfie Match</Text>
              </View>
            </View>

            <View style={[styles.card, { backgroundColor: "#f0fdfa", borderColor: "#99f6e4" }]}>
              <Text style={[styles.benefitsTitle, { color: "#134e4a" }]}>Your Verification Benefits</Text>
              {[
                { icon: "shield" as const, title: "Verified Badge", desc: "Your profile shows a verified badge, building instant trust" },
                { icon: "star" as const,   title: "Improved Trust Score", desc: "Verification contributes positively to your trust score" },
                { icon: "eye" as const,    title: "Increased Visibility", desc: "Verified users may be highlighted in urgent requests" },
              ].map(({ icon, title, desc }) => (
                <View key={title} style={styles.benefitRow}>
                  <View style={[styles.benefitIcon, { backgroundColor: "#ccfbf1" }]}>
                    <Feather name={icon} size={16} color="#0d9488" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.benefitTitle, { color: colors.foreground }]}>{title}</Text>
                    <Text style={[styles.benefitDesc, { color: colors.mutedForeground }]}>{desc}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── PENDING ── */}
        {isPending && (
          <>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.statusHeaderRow}>
                <View style={styles.cardInfoRow}>
                  <View style={[styles.iconCircle, { backgroundColor: "#fef3c7" }]}>
                    <Feather name="clock" size={22} color="#d97706" />
                  </View>
                  <View>
                    <Text style={[styles.statusTitle, { color: colors.foreground }]}>Under Review</Text>
                    <Text style={[styles.statusSub, { color: colors.mutedForeground }]}>
                      Submitted on {verification?.submittedAt ? fmtDate(verification.submittedAt, { month: "short", day: "numeric", year: "numeric" }) : "N/A"}
                    </Text>
                  </View>
                </View>
                <View style={[styles.statusPill, { backgroundColor: "#fffbeb" }]}>
                  <Feather name="clock" size={13} color="#92400e" />
                  <Text style={[styles.statusPillText, { color: "#92400e" }]}>Under Review</Text>
                </View>
              </View>

              <View style={[styles.infoBox, { backgroundColor: "#fffbeb", borderColor: "#fde68a" }]}>
                <Text style={[styles.infoBoxText, { color: "#92400e" }]}>
                  We're reviewing your documents. This usually takes a few minutes. We'll notify you once complete.
                </Text>
              </View>

              <View style={[styles.sep, { backgroundColor: colors.border }]} />

              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Legal Name</Text>
                <Text style={[styles.detailValue, { color: colors.foreground }]}>{verification?.legalFullName || "Processing..."}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Verification Method</Text>
                <Text style={[styles.detailValue, { color: colors.foreground }]}>ID + Selfie Match</Text>
              </View>
            </View>

            <View style={[styles.card, { backgroundColor: "#f0fdfa", borderColor: "#99f6e4" }]}>
              <View style={styles.statusHeaderRow}>
                <View style={styles.cardInfoRow}>
                  <View style={[styles.iconCircle, { backgroundColor: "#ccfbf1" }]}>
                    <Feather name="credit-card" size={18} color="#0d9488" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.statusTitle, { color: colors.foreground }]}>Complete Payment Setup</Text>
                    <Text style={[styles.statusSub, { color: colors.mutedForeground }]}>Add a payment method to finish full verification</Text>
                  </View>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.tealBtn, { opacity: pressed ? 0.8 : 1 }]}
                  onPress={() => router.push("/payment-methods" as never)}
                >
                  <Text style={styles.tealBtnText}>Add Payment</Text>
                  <Feather name="arrow-right" size={14} color="#fff" />
                </Pressable>
              </View>
            </View>
          </>
        )}

        {/* ── UNVERIFIED / FAILED ── */}
        {!isVerified && !isPending && (
          <>
            {isFailed && (
              <View style={[styles.infoBox, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
                <Feather name="alert-triangle" size={14} color="#dc2626" />
                <Text style={[styles.infoBoxText, { color: "#991b1b" }]}>
                  {verification?.failureReason || "Your verification couldn't be completed. Please try again."}
                </Text>
              </View>
            )}

            {personaError && (
              <View style={[styles.infoBox, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
                <Feather name="alert-triangle" size={14} color="#dc2626" />
                <Text style={[styles.infoBoxText, { color: "#991b1b" }]}>{personaError}</Text>
              </View>
            )}

            {/* Why verify */}
            <View style={[styles.card, { backgroundColor: "#f0fdfa", borderColor: "#99f6e4" }]}>
              <Text style={[styles.benefitsTitle, { color: "#134e4a" }]}>Why Verify Your Identity?</Text>
              {[
                { icon: "shield" as const, text: "A verified badge builds instant trust with neighbours" },
                { icon: "star" as const,   text: "Improve your trust score and become a preferred choice for sharing" },
                { icon: "eye" as const,    text: "Verified users are prioritized in urgent requests and search results" },
              ].map(({ icon, text }) => (
                <View key={text} style={styles.whyRow}>
                  <Feather name={icon} size={22} color="#0d9488" />
                  <Text style={[styles.whyText, { color: "#0f766e" }]}>{text}</Text>
                </View>
              ))}
            </View>

            {/* Steps + Start button */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardSectionTitle, { color: colors.foreground }]}>Verify Your Identity</Text>
              <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
                Securely verify with a government ID and a quick selfie
              </Text>

              {[
                { icon: "credit-card" as const, title: "Step 1: Scan your ID", desc: "Take a photo of your driver's license, passport, or national ID" },
                { icon: "camera" as const,      title: "Step 2: Take a selfie", desc: "We'll match your selfie to your ID photo for security" },
                { icon: "check-circle" as const, title: "Step 3: Get verified", desc: "Results are usually instant — earn your verified badge right away" },
              ].map(({ icon, title, desc }) => (
                <View key={title} style={[styles.stepRow, { backgroundColor: "#f9fafb" }]}>
                  <View style={[styles.stepIcon, { backgroundColor: "#ccfbf1" }]}>
                    <Feather name={icon} size={18} color="#0d9488" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.stepTitle, { color: colors.foreground }]}>{title}</Text>
                    <Text style={[styles.stepDesc, { color: colors.mutedForeground }]}>{desc}</Text>
                  </View>
                </View>
              ))}

              <Pressable
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { opacity: pressed || personaLoading || createInquiryMutation.isPending ? 0.8 : 1 },
                ]}
                onPress={startPersonaVerification}
                disabled={personaLoading || createInquiryMutation.isPending}
              >
                {personaLoading || createInquiryMutation.isPending ? (
                  <><ActivityIndicator color="#fff" size="small" /><Text style={styles.primaryBtnText}>  Starting Verification...</Text></>
                ) : (
                  <><Feather name="shield" size={18} color="#fff" /><Text style={styles.primaryBtnText}> {isFailed ? "Try Again" : "Start Verification"}</Text></>
                )}
              </Pressable>

              <View style={styles.poweredRow}>
                <Feather name="shield" size={12} color={colors.mutedForeground} />
                <Text style={[styles.poweredText, { color: colors.mutedForeground }]}>
                  Powered by Persona — bank-level identity verification
                </Text>
              </View>
            </View>

            <Text style={[styles.footnote, { color: colors.mutedForeground, textAlign: "center" }]}>
              Your data is encrypted and processed securely. We only use it to verify your identity.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 16 },
  pageHeader: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 4 },
  badgeIconWrap: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  pageTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  pageSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },

  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  statusHeaderRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  cardInfoRow: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  iconCircle: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  statusTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  statusSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusPillText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  sep: { height: StyleSheet.hairlineWidth },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  detailValue: { fontSize: 13, fontFamily: "Inter_500Medium" },

  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: 10, padding: 12 },
  infoBoxText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  benefitsTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  benefitRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  benefitIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 2 },
  benefitTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  benefitDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 16, marginTop: 2 },

  tealBtn: { backgroundColor: "#0d9488", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  tealBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },

  whyRow: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  whyText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },

  cardSectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  cardDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: -4 },

  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 14, borderRadius: 12, padding: 14 },
  stepIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  stepTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  stepDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 16, marginTop: 2 },

  primaryBtn: { backgroundColor: "#0d9488", borderRadius: 12, paddingVertical: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  primaryBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },

  poweredRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  poweredText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  footnote: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
});
