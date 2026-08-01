import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import {
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
import { useAuth } from "@/context/AuthContext";
import { apiGet } from "@/lib/api";

const shareCoinIcon = require("../assets/icons/sharecoin.png");

interface User {
  shareCoins?: number | string | null;
}

export default function ShareCoinWalletScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth() as { user: User | null };
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const { data: freshUser } = useQuery<User>({
    queryKey: ["/api/user"],
    queryFn: () => apiGet<User>("/api/user"),
  });

  const balance = Math.round(Number((freshUser ?? user)?.shareCoins ?? 0));

  function Row({
    icon,
    label,
    route,
  }: {
    icon: React.ComponentProps<typeof Feather>["name"];
    label: string;
    route: string;
  }) {
    return (
      <Pressable
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: pressed ? colors.muted : colors.card },
        ]}
        onPress={() => router.push(route as never)}
      >
        <Feather name={icon} size={20} color={colors.foreground} style={styles.rowIcon} />
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      </Pressable>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>ShareCoin Wallet</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Balance card */}
        <View style={[styles.balanceCard, { backgroundColor: "#D4F7F1" }]}>
          <Text style={styles.balanceCaption}>CURRENT BALANCE</Text>
          <View style={styles.balanceRow}>
            <Image source={shareCoinIcon} style={styles.balanceCoin} resizeMode="contain" />
            <Text style={styles.balanceAmount}>{balance}</Text>
          </View>
          <Text style={styles.balanceLabel}>ShareCoins</Text>
        </View>

        {/* Top group */}
        <View style={[styles.group, { borderColor: colors.border }]}>
          <Row icon="list" label="View Transactions" route="/transactions" />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <Row icon="award" label="Achievements" route="/achievements" />
        </View>

        {/* Section header */}
        <Text style={[styles.sectionHeader, { color: "#0d9488" }]}>Earn More ShareCoins</Text>

        {/* Bottom group */}
        <View style={[styles.group, { borderColor: colors.border }]}>
          <Row icon="zap" label="Play Games" route="/games" />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <Row icon="users" label="Invite Friends" route="/referrals" />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <Row icon="heart" label="Help Neighbours" route="/(tabs)/wishlist" />
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
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 26 },
  headerTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
  },

  scroll: {
    paddingTop: 20,
    paddingHorizontal: 16,
    gap: 6,
  },

  sectionHeader: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    paddingHorizontal: 4,
    paddingTop: 20,
    paddingBottom: 6,
    letterSpacing: 0.2,
  },

  group: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  rowIcon: {
    width: 28,
    marginRight: 12,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },

  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 56,
  },

  balanceCard: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 2,
    marginBottom: 8,
  },
  balanceCaption: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: "#0d9488",
    letterSpacing: 0.8,
  },
  balanceRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  balanceCoin: { width: 24, height: 24 },
  balanceAmount: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    color: "#0d9488",
    lineHeight: 38,
  },
  balanceLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#0d9488",
    marginTop: 1,
  },
});
