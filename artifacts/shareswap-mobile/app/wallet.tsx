import { Feather } from "@expo/vector-icons";
import { Coins } from "lucide-react-native";
import { useRouter } from "expo-router";
import React from "react";
import {
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

interface MenuItem {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  route: string;
  accent?: boolean;
}

const MAIN_ITEMS: MenuItem[] = [
  { icon: "list", label: "View Transactions", route: "/transactions" },
  { icon: "award", label: "Achievements", route: "/achievements" },
];

const EARN_ITEMS: MenuItem[] = [
  { icon: "play-circle", label: "Play Games", route: "/games", accent: true },
  { icon: "user-plus", label: "Invite Friends", route: "/(tabs)/profile" },
  { icon: "heart", label: "Help Neighbours", route: "/" },
];

export default function WalletScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;
  const balance = Math.round(Number(user?.shareCoins ?? 0));

  function nav(route: string) {
    router.push(route as never);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Custom header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 8,
            backgroundColor: colors.primary,
            borderBottomColor: "transparent",
          },
        ]}
      >
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          ShareCoin Wallet
        </Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Balance card */}
        <View
          style={[
            styles.balanceCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.balanceLabel, { color: colors.mutedForeground }]}>
            Total Balance
          </Text>
          <View style={styles.balanceRow}>
            <Coins size={32} color="#0DCEA1" strokeWidth={1.5} />
            <Text style={[styles.balanceAmount, { color: colors.foreground }]}>
              {balance} ShareCoins
            </Text>
          </View>
        </View>

        {/* Main menu items */}
        <View
          style={[
            styles.menuCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {MAIN_ITEMS.map((item, i) => (
            <React.Fragment key={item.route}>
              <Pressable
                style={({ pressed }) => [
                  styles.menuRow,
                  pressed && { opacity: 0.6 },
                ]}
                onPress={() => nav(item.route)}
              >
                <View
                  style={[
                    styles.menuIconWrap,
                    { backgroundColor: colors.muted },
                  ]}
                >
                  <Feather name={item.icon} size={18} color={colors.foreground} />
                </View>
                <Text style={[styles.menuLabel, { color: colors.foreground }]}>
                  {item.label}
                </Text>
                <Feather
                  name="chevron-right"
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
              {i < MAIN_ITEMS.length - 1 && (
                <View
                  style={[styles.divider, { backgroundColor: colors.border }]}
                />
              )}
            </React.Fragment>
          ))}
        </View>

        {/* Earn More ShareCoins section */}
        <Text style={[styles.sectionLabel, { color: colors.primary }]}>
          Earn More ShareCoins
        </Text>

        <View
          style={[
            styles.menuCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {EARN_ITEMS.map((item, i) => (
            <React.Fragment key={item.route + item.label}>
              <Pressable
                style={({ pressed }) => [
                  styles.menuRow,
                  pressed && { opacity: 0.6 },
                ]}
                onPress={() => nav(item.route)}
              >
                <View
                  style={[
                    styles.menuIconWrap,
                    {
                      backgroundColor: item.accent
                        ? colors.primary + "18"
                        : colors.muted,
                    },
                  ]}
                >
                  <Feather
                    name={item.icon}
                    size={18}
                    color={item.accent ? colors.primary : colors.foreground}
                  />
                </View>
                <Text
                  style={[
                    styles.menuLabel,
                    {
                      color: item.accent ? colors.primary : colors.foreground,
                      fontFamily: item.accent
                        ? "Inter_600SemiBold"
                        : "Inter_400Regular",
                    },
                  ]}
                >
                  {item.label}
                </Text>
                <Feather
                  name="chevron-right"
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
              {i < EARN_ITEMS.length - 1 && (
                <View
                  style={[styles.divider, { backgroundColor: colors.border }]}
                />
              )}
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

  content: { padding: 16, gap: 12 },

  balanceCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 20,
    gap: 10,
    marginBottom: 4,
  },
  balanceLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  balanceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  coinCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  coinEmoji: { fontSize: 18 },
  balanceAmount: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
  },

  sectionLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginTop: 4,
    marginBottom: -4,
    paddingHorizontal: 4,
  },

  menuCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 66,
  },
});
