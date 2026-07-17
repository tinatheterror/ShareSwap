import { Check, Copy, Gift, Share2, Users } from "lucide-react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/lib/api";

interface User {
  referralCode?: string;
  [key: string]: unknown;
}

export default function ReferralsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
    queryFn: () => apiGet<User>("/api/user"),
  });

  const code = generatedCode ?? user?.referralCode ?? null;

  const generateMutation = useMutation({
    mutationFn: () => apiPost<{ referralCode: string }>("/api/referrals/generate", {}),
    onSuccess: (data) => {
      setGeneratedCode(data.referralCode);
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
    onError: () => {
      Alert.alert("Error", "Failed to generate referral code. Please try again.");
    },
  });

  async function copyCode() {
    if (!code) return;
    Clipboard.setString(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function shareCode() {
    if (!code) return;
    try {
      await Share.share({
        title: "Join ShareSwap",
        message: `Hi! Join me on ShareSwap with code ${code} — it helps me earn ShareCoins.`,
      });
    } catch {
      copyCode();
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTitleRow}>
            <Users size={26} color={colors.primary} strokeWidth={1.75} />
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>Invite Friends</Text>
          </View>
          <Text style={[styles.heroSubtitle, { color: colors.mutedForeground }]}>
            Earn 10 ShareCoins every time a friend joins and completes their first transaction
          </Text>
        </View>

        {/* Referral Code Card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Gift size={18} color={colors.primary} strokeWidth={1.75} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Your Referral Code</Text>
          </View>

          {code ? (
            <View style={styles.codeSection}>
              {/* Code display */}
              <View style={[styles.codeBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Text style={[styles.codeText, { color: colors.foreground }]}>{code}</Text>
              </View>

              {/* Buttons */}
              <View style={styles.btnRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.btn,
                    styles.btnOutline,
                    { borderColor: colors.border, backgroundColor: pressed ? colors.muted : colors.card },
                  ]}
                  onPress={copyCode}
                >
                  {copied ? <Check size={15} color={colors.foreground} strokeWidth={2} /> : <Copy size={15} color={colors.foreground} strokeWidth={2} />}
                  <Text style={[styles.btnText, { color: colors.foreground }]}>
                    {copied ? "Copied!" : "Copy"}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.btn,
                    styles.btnPrimary,
                    { backgroundColor: pressed ? colors.primary + "cc" : colors.primary },
                  ]}
                  onPress={shareCode}
                >
                  <Share2 size={15} color="#fff" strokeWidth={2} />
                  <Text style={[styles.btnText, { color: "#fff" }]}>Share</Text>
                </Pressable>
              </View>

              {/* How it works */}
              <View style={[styles.howItWorks, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
                <Text style={[styles.howTitle, { color: colors.primary }]}>How it works:</Text>
                <Text style={[styles.howItem, { color: colors.primary + "cc" }]}>• Share your code with friends</Text>
                <Text style={[styles.howItem, { color: colors.primary + "cc" }]}>• They sign up using your code</Text>
                <Text style={[styles.howItem, { color: colors.primary + "cc" }]}>
                  • When they complete their first transaction, you get 10 ShareCoins!
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.noCodeSection}>
              <Text style={[styles.noCodeText, { color: colors.mutedForeground }]}>
                When neighbours sign up using your code you'll earn ShareCoins to use on future rentals or requests.
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.generateBtn,
                  { backgroundColor: pressed ? colors.primary + "cc" : colors.primary },
                ]}
                onPress={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.generateBtnText}>Generate Referral Code</Text>
                )}
              </Pressable>
            </View>
          )}
        </View>

        {/* Benefits Card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Referral Benefits</Text>

          <View style={styles.benefitsRow}>
            <View style={styles.benefit}>
              <View style={[styles.benefitIcon, { backgroundColor: colors.primary + "18" }]}>
                <Gift size={28} color={colors.primary} strokeWidth={1.5} />
              </View>
              <Text style={[styles.benefitTitle, { color: colors.foreground }]}>Earn ShareCoins</Text>
              <Text style={[styles.benefitText, { color: colors.mutedForeground }]}>
                Get 10 ShareCoins for each successful referral
              </Text>
            </View>

            <View style={styles.benefit}>
              <View style={[styles.benefitIcon, { backgroundColor: colors.primary + "18" }]}>
                <Users size={28} color={colors.primary} strokeWidth={1.5} />
              </View>
              <Text style={[styles.benefitTitle, { color: colors.foreground }]}>Build Community</Text>
              <Text style={[styles.benefitText, { color: colors.mutedForeground }]}>
                Strengthen the connections in your neighbourhood
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  backBtn: { width: 30, alignItems: "flex-start" },
  headerTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: -0.3,
  },
  content: { padding: 16, gap: 16 },

  hero: { alignItems: "center", paddingVertical: 8, gap: 10 },
  heroTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  heroTitle: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
  heroSubtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 12,
  },

  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 14,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },

  codeSection: { gap: 12 },
  codeBox: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  codeText: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: 3,
  },
  btnRow: { flexDirection: "row", gap: 10 },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnOutline: { borderWidth: 1 },
  btnPrimary: {},
  btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  howItWorks: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    gap: 5,
  },
  howTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  howItem: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },

  noCodeSection: { alignItems: "center", gap: 16, paddingVertical: 8 },
  noCodeText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  generateBtn: {
    paddingHorizontal: 24,
    paddingVertical: 13,
    borderRadius: 10,
    minWidth: 200,
    alignItems: "center",
  },
  generateBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  benefitsRow: { flexDirection: "row", gap: 12 },
  benefit: { flex: 1, alignItems: "center", gap: 10 },
  benefitIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  benefitTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  benefitText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 17,
  },
});
