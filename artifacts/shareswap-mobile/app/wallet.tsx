import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { apiGet } from "@/lib/api";

interface Transaction {
  id: number;
  amount: string | number;
  description: string;
  createdAt: string;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function WalletScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const { data: transactions = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions"],
    queryFn: () => apiGet<Transaction[]>("/api/transactions"),
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
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          ShareCoin Wallet
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={transactions}
        keyExtractor={(t) => t.id.toString()}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
        ListHeaderComponent={
          <>
            {/* Balance card — matches the screenshot */}
            <View
              style={[
                styles.balanceCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.balanceLabel, { color: colors.mutedForeground }]}>
                Total Balance
              </Text>
              <View style={styles.balanceRow}>
                <View
                  style={[
                    styles.coinIconWrap,
                    { backgroundColor: colors.coinBackground },
                  ]}
                >
                  <Text style={styles.coinEmoji}>🪙</Text>
                </View>
                <Text style={[styles.balanceAmount, { color: colors.foreground }]}>
                  {balance} ShareCoins
                </Text>
              </View>
            </View>

            {/* Section heading */}
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Transaction History
            </Text>
          </>
        }
        renderItem={({ item }) => {
          const amt = Number(item.amount);
          const isPositive = amt >= 0;
          return (
            <View
              style={[
                styles.txRow,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              {/* Direction icon */}
              <View
                style={[
                  styles.txIconWrap,
                  {
                    backgroundColor: isPositive
                      ? colors.primary + "18"
                      : "#dc262618",
                  },
                ]}
              >
                <Feather
                  name={isPositive ? "arrow-up-circle" : "arrow-down-circle"}
                  size={20}
                  color={isPositive ? colors.primary : "#dc2626"}
                />
              </View>

              {/* Description + date */}
              <View style={styles.txMeta}>
                <Text
                  style={[styles.txDesc, { color: colors.foreground }]}
                  numberOfLines={2}
                >
                  {item.description}
                </Text>
                <Text style={[styles.txDate, { color: colors.mutedForeground }]}>
                  {formatDate(item.createdAt)}
                </Text>
              </View>

              {/* Amount */}
              <Text
                style={[
                  styles.txAmount,
                  { color: isPositive ? colors.primary : "#dc2626" },
                ]}
              >
                {isPositive ? "+" : "-"}
                {Math.abs(amt).toFixed(2)}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Feather name="inbox" size={36} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No transactions yet
              </Text>
            </View>
          )
        }
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => (
          <View style={{ height: 8 }} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  backBtn: { padding: 2 },
  headerTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    flex: 1,
    textAlign: "center",
  },
  headerSpacer: { width: 30 },

  content: { paddingHorizontal: 16, paddingTop: 20, gap: 8 },

  /* Balance card */
  balanceCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 20,
    marginBottom: 24,
    gap: 8,
  },
  balanceLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.3,
  },
  balanceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  coinIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  coinEmoji: { fontSize: 20 },
  balanceAmount: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
  },

  /* Section title */
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },

  /* Transaction row */
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  txIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  txMeta: { flex: 1, minWidth: 0, gap: 2 },
  txDesc: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    lineHeight: 18,
  },
  txDate: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  txAmount: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    flexShrink: 0,
  },

  centered: { paddingTop: 60, alignItems: "center" },
  empty: {
    paddingTop: 60,
    alignItems: "center",
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
});
