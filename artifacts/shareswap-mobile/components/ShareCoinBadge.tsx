import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
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
      <Feather name="dollar-sign" size={14} color={colors.coin} />
      <Text style={[styles.text, { color: colors.coin }]}>
        {user?.shareCoins ?? 0}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  text: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
