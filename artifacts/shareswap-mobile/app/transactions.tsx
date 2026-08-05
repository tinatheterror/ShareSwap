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
import { apiGet } from "@/lib/api";
import { fmtDate } from "@/lib/dateUtils";

interface Transaction {
  id: number;
  amount: string | number;
  description: string;
  createdAt: string;
}

function formatDate(dateStr: string): string {
  return fmtDate(dateStr, { year: "numeric", month: "short", day: "numeric" });
}

export default function TransactionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const { data: transactions = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions"],
    queryFn: () => apiGet<Transaction[]>("/api/transactions"),
  });

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
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Transactions</Text>
        <View style={{ width: 30 }} />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(t) => t.id.toString()}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 24 },
          ]}
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
                <View style={styles.txMeta}>
                  <Text
                    style={[styles.txDesc, { color: colors.foreground }]}
                    numberOfLines={2}
                  >
                    {item.description}
                  </Text>
                  <Text
                    style={[styles.txDate, { color: colors.mutedForeground }]}
                  >
                    {formatDate(item.createdAt)}
                  </Text>
                </View>
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
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="inbox" size={36} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No transactions yet
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
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
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16, gap: 8 },
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
  txDesc: { fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 18 },
  txDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  txAmount: { fontSize: 14, fontFamily: "Inter_700Bold", flexShrink: 0 },
  empty: {
    paddingTop: 80,
    alignItems: "center",
    gap: 12,
  },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
