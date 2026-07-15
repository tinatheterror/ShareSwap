import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export function WalletWidget() {
  const { user } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  if (!user) return null;

  const coins = user.shareCoins ?? 0;

  return (
    <Pressable
      onPress={() => router.push("/wallet" as never)}
      style={[
        styles.container,
        {
          top: insets.top + 14,
          backgroundColor: colors.card,
          borderColor: colors.border,
          shadowColor: "#000",
        },
      ]}
    >
      <MaterialCommunityIcons
        name="circle-multiple"
        size={14}
        color={colors.primary}
      />
      <Text style={[styles.amount, { color: colors.foreground }]}>
        {coins} ShareCoins
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    right: 12,
    zIndex: 9999,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 3,
  },
  amount: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
});
