import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export function WalletWidget() {
  const { user } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  if (!user) return null;

  const coins = user.shareCoins ?? 0;

  // Position beside the camera pill: go slightly above the safe-area bottom
  // to sit at the same vertical level as the Dynamic Island / notch.
  // Clamp to at least 8 so it's never flush against the very top edge.
  const top = Math.max(8, insets.top - 42);

  return (
    <Pressable
      onPress={() => router.push("/wallet" as never)}
      style={[
        styles.container,
        {
          top,
          backgroundColor: colors.card,
          borderColor: colors.border,
          shadowColor: "#000",
        },
      ]}
    >
      <Text style={[styles.label, { color: colors.mutedForeground }]}>
        Total Balance
      </Text>
      <View style={styles.row}>
        <MaterialCommunityIcons
          name="circle-multiple"
          size={15}
          color={colors.primary}
        />
        <Text style={[styles.amount, { color: colors.foreground }]}>
          {coins} ShareCoins
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    right: 12,
    zIndex: 9999,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
    alignItems: "flex-start",
    gap: 1,
  },
  label: {
    fontSize: 9,
    fontFamily: "Inter_400Regular",
    letterSpacing: 0.1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  amount: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
});
