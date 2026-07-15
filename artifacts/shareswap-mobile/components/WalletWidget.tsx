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

  // Vertically align with the Dynamic Island pill.
  // insets.top on DI phones ≈ 59; the pill center is ~18 px from the top edge.
  // We subtract enough so the widget sits IN the pill row, not below it.
  const top = Math.max(6, insets.top - 44);

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
          size={12}
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
    right: 10,
    zIndex: 9999,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 3,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 3,
    alignItems: "flex-start",
    gap: 1,
  },
  label: {
    fontSize: 8,
    fontFamily: "Inter_400Regular",
    letterSpacing: 0.1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  amount: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
});
