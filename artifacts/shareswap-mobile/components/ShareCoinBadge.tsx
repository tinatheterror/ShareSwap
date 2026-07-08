import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

export function ShareCoinBadge() {
  const colors = useColors();
  const { user } = useAuth();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.coinBackground, borderColor: colors.coin },
      ]}
    >
      <Text style={[styles.text, { color: colors.coin }]}>
        $ {Math.round(Number(user?.shareCoins ?? 0))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  text: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },
});
