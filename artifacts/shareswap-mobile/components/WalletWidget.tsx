import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
          top: insets.top + 8,
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
          size={18}
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
    right: 14,
    zIndex: 9999,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
    alignItems: "flex-start",
    gap: 2,
  },
  label: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    letterSpacing: 0.2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  amount: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
