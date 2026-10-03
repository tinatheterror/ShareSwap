import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

// Shared stack-screen header (back chevron + centered title). Placement matches
// the Transactions screen so every wallet-related page lines up.
export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
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
      <Pressable style={styles.backBtn} onPress={onBack ?? (() => router.back())} hitSlop={10}>
        <Feather name="chevron-left" size={26} color={colors.foreground} />
      </Pressable>
      <Text style={[styles.headerTitle, { color: colors.foreground }]}>{title}</Text>
      <View style={{ width: 30 }} />
    </View>
  );
}

const styles = StyleSheet.create({
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
});
