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

interface MenuItem {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  sublabel: string;
  route: string;
  accent: string;
  bg: string;
}

const MENU: MenuItem[] = [
  {
    icon: "list",
    label: "View Transactions",
    sublabel: "See your earn & spend history",
    route: "/transactions",
    accent: "#0d9488",
    bg: "#D4F7F1",
  },
  {
    icon: "award",
    label: "Achievements",
    sublabel: "Track your milestones",
    route: "/achievements",
    accent: "#7c3aed",
    bg: "#ede9fe",
  },
  {
    icon: "zap",
    label: "Play Games",
    sublabel: "Earn ShareCoins by playing",
    route: "/games",
    accent: "#f59e0b",
    bg: "#fef3c7",
  },
  {
    icon: "users",
    label: "Invite Friends",
    sublabel: "Earn 5 coins per referral",
    route: "/referrals",
    accent: "#2563eb",
    bg: "#dbeafe",
  },
  {
    icon: "heart",
    label: "Help Neighbours",
    sublabel: "List items for your community",
    route: "/(tabs)/share",
    accent: "#e11d48",
    bg: "#ffe4e6",
  },
];

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

  const balance = Math.round(
    Number((freshUser ?? user)?.shareCoins ?? 0)
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Teal header with balance */}
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: "#0d9488" }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Feather name="chevron-left" size={26} color="#fff" />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>ShareCoin Wallet</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {/* Balance card */}
      <View style={[styles.balanceCard, { backgroundColor: "#0d9488" }]}>
        <View style={styles.balanceInner}>
          <Image source={shareCoinIcon} style={styles.coinIcon} resizeMode="contain" />
          <Text style={styles.balanceAmount}>{balance}</Text>
          <Text style={styles.balanceLabel}>ShareCoins</Text>
        </View>
        <Text style={styles.balanceHint}>
          Use ShareCoins to borrow items, tip neighbours, and more
        </Text>
      </View>

      {/* Menu */}
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.menuCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {MENU.map((item, idx) => (
            <React.Fragment key={item.route}>
              {idx > 0 && (
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              )}
              <Pressable
                style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => router.push(item.route as never)}
              >
                <View style={[styles.iconWrap, { backgroundColor: item.bg }]}>
                  <Feather name={item.icon} size={18} color={item.accent} />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>
                    {item.label}
                  </Text>
                  <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                    {item.sublabel}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            </React.Fragment>
          ))}
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
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: { width: 36, alignItems: "flex-start" },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  balanceCard: {
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 28,
    alignItems: "center",
    gap: 6,
  },
  balanceInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  coinIcon: { width: 36, height: 36 },
  balanceAmount: {
    fontSize: 48,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: -1,
  },
  balanceLabel: {
    fontSize: 18,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.85)",
    marginTop: 6,
  },
  balanceHint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.7)",
    textAlign: "center",
    maxWidth: 260,
    marginTop: 4,
  },
  scroll: { padding: 16, gap: 16 },
  menuCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowSub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  divider: { height: 1, marginLeft: 68 },
});
