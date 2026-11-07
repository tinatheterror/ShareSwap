import { useInfiniteQuery } from "@tanstack/react-query";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/lib/api";
import { fmtDate } from "@/lib/dateUtils";
import { formatWalletAmount, walletDebtNotice, type WalletPage } from "@/lib/walletHistory";

const PAGE_SIZE = 20;

/** Every change to the wallet balance (rental earnings, claim awards, withdrawals, chargebacks, conversions), newest first. */
export function WalletHistory() {
  const colors = useColors();
  const { user } = useAuth();
  const query = useInfiniteQuery({
    queryKey: ["/api/wallet"],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }: { pageParam: number | null }) =>
      apiGet<WalletPage>(`/api/wallet?limit=${PAGE_SIZE}${pageParam ? `&cursor=${pageParam}` : ""}`),
    getNextPageParam: (last: WalletPage) => last.nextCursor,
    enabled: !!user,
  });
  const pages = query.data?.pages ?? [];
  if (pages.length === 0) return null;
  const rows = pages.flatMap(page => page.transactions);
  const currency = pages[0].currency;
  const debt = walletDebtNotice(pages[0].balance.debt);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]} testID="wallet-history">
      <Text style={[styles.title, { color: colors.foreground }]}>Wallet history</Text>
      <Text style={[styles.desc, { color: colors.mutedForeground }]}>Every change to your wallet balance</Text>
      {debt && (
        <View style={styles.debt} testID="wallet-debt">
          <Text style={styles.debtTitle}>{debt.title}</Text>
          <Text style={styles.debtBody}>{debt.body}</Text>
        </View>
      )}
      {rows.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>Nothing here yet.</Text>
      ) : (
        <View style={{ gap: 8, marginTop: 12 }}>
          {rows.map(row => (
            <View key={row.id} style={[styles.row, { backgroundColor: colors.background }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>{row.label}</Text>
                <Text style={[styles.date, { color: colors.mutedForeground }]}>{fmtDate(row.createdAt, { month: "short", day: "numeric", year: "numeric" })}</Text>
              </View>
              <Text style={[styles.amount, { color: Number(row.amount) < 0 ? "#ef4444" : "#0BB88C" }]}>{formatWalletAmount(row, currency)}</Text>
            </View>
          ))}
        </View>
      )}
      {query.hasNextPage && (
        <Pressable
          style={({ pressed }) => [styles.more, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
          onPress={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {query.isFetchingNextPage ? <ActivityIndicator size="small" /> : <Text style={[styles.moreText, { color: colors.foreground }]}>Show more</Text>}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 16 },
  title: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  desc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  debt: { marginTop: 12, backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a", borderRadius: 10, padding: 12 },
  debtTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#92400e" },
  debtBody: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#b45309", marginTop: 2 },
  empty: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 20 },
  row: { flexDirection: "row", alignItems: "center", borderRadius: 10, padding: 12, gap: 12 },
  label: { fontSize: 14, fontFamily: "Inter_500Medium" },
  date: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  amount: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  more: { marginTop: 12, borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  moreText: { fontSize: 13, fontFamily: "Inter_500Medium" },
});
