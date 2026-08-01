import { Feather } from "@expo/vector-icons";
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

export default function ShareCoinWalletScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

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
          <Row icon="heart" label="Help Neighbours" route="/(tabs)/share" />
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
});
