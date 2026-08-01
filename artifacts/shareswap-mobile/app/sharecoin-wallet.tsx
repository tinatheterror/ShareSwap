import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/useAuth";
import { apiGet } from "@/lib/api";

const shareCoinIcon = require("../assets/icons/sharecoin.png");

interface Transaction {
  id: number;
  amount: string | number;
  description: string;
  createdAt: string;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ShareCoinWalletScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const { data: transactions = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions"],
    queryFn: () => apiGet("/api/transactions"),
  });

  const balance = Math.round(Number(user?.shareCoins ?? 0));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 8,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
          <Text style={[styles.backText, { color: colors.foreground }]}>Back</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0d9488" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Title row */}
          <View style={styles.titleRow}>
            <View style={styles.titleIcon}>
              <Image source={shareCoinIcon} style={styles.titleCoin} resizeMode="contain" />
            </View>
            <View>
              <Text style={[styles.title, { color: colors.foreground }]}>ShareCoin Wallet</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                Your coins and transaction history
              </Text>
            </View>
          </View>

          {/* Balance card */}
          <View style={[styles.balanceCard, { backgroundColor: "#D4F7F1", borderColor: "#A7F0E4" }]}>
            <Text style={styles.balanceCaption}>CURRENT BALANCE</Text>
            <View style={styles.balanceRow}>
              <Image source={shareCoinIcon} style={styles.balanceCoin} resizeMode="contain" />
              <Text style={styles.balanceAmount}>{balance}</Text>
            </View>
            <Text style={styles.balanceLabel}>ShareCoins</Text>
          </View>

          {/* How to earn */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Feather name="info" size={15} color="#0d9488" />
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>How to earn ShareCoins</Text>
            </View>
            <View style={styles.earnList}>
              {[
                { icon: "user", text: "Add a profile photo (+1 🪙)" },
                { icon: "package", text: "List an item to share (+varies by tier)" },
                { icon: "repeat", text: "Complete a swap with another member" },
                { icon: "gift", text: "Play games and earn rewards" },
              ].map(({ icon, text }) => (
                <View key={text} style={styles.earnRow}>
                  <Feather name={icon as any} size={14} color="#0d9488" />
                  <Text style={[styles.earnText, { color: colors.mutedForeground }]}>{text}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Transaction history */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Feather name="list" size={15} color={colors.mutedForeground} />
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Transaction History</Text>
            </View>

            {transactions.length === 0 ? (
              <View style={styles.empty}>
                <Image source={shareCoinIcon} style={styles.emptyCoin} resizeMode="contain" />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No transactions yet</Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                  Earn your first ShareCoin by adding a profile photo.
                </Text>
              </View>
            ) : (
              <View style={styles.txList}>
                {transactions.map((tx) => {
                  const amt = Number(tx.amount);
                  const positive = amt >= 0;
                  return (
                    <View
                      key={tx.id}
                      style={[styles.txRow, { backgroundColor: colors.background }]}
                    >
                      <View
                        style={[
                          styles.txIconWrap,
                          { backgroundColor: positive ? "#D4F7F1" : "#fee2e2" },
                        ]}
                      >
                        <Feather
                          name={positive ? "arrow-up-circle" : "arrow-down-circle"}
                          size={16}
                          color={positive ? "#0d9488" : "#dc2626"}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.txDesc, { color: colors.foreground }]}
                          numberOfLines={2}
                        >
                          {tx.description}
                        </Text>
                        <Text style={[styles.txDate, { color: colors.mutedForeground }]}>
                          {formatDate(tx.createdAt)}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.txAmount,
                          { color: positive ? "#0d9488" : "#dc2626" },
                        ]}
                      >
                        {positive ? "+" : ""}
                        {Math.abs(amt).toFixed(2)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      )}
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
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  backText: { fontSize: 15, fontFamily: "Inter_500Medium" },

  content: { padding: 16, gap: 16 },

  titleRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
  titleIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#D4F7F1",
    alignItems: "center",
    justifyContent: "center",
  },
  titleCoin: { width: 26, height: 26 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },

  balanceCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 4,
  },
  balanceCaption: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#0d9488",
    letterSpacing: 0.8,
  },
  balanceRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  balanceCoin: { width: 40, height: 40 },
  balanceAmount: {
    fontSize: 56,
    fontFamily: "Inter_700Bold",
    color: "#0d9488",
    lineHeight: 64,
  },
  balanceLabel: {
    fontSize: 16,
    fontFamily: "Inter_500Medium",
    color: "#0d9488",
    marginTop: 2,
  },

  card: { borderRadius: 16, borderWidth: 1, padding: 16 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  earnList: { gap: 10 },
  earnRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  earnText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },

  txList: { gap: 8, marginTop: 4 },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
  },
  txIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  txDesc: { fontSize: 13, fontFamily: "Inter_500Medium" },
  txDate: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  txAmount: { fontSize: 14, fontFamily: "Inter_600SemiBold", flexShrink: 0 },

  empty: { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyCoin: { width: 48, height: 48, opacity: 0.3 },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_500Medium", marginTop: 4 },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
});
