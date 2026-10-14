import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

/**
 * "Trust Deposit: $X" on the item card. When the viewer's trust level discounts it, the original amount is black
 * text with a teal line through it, the discounted amount sits next to it in teal, and tapping either shows why
 * (the phone's version of the web hover tooltip).
 */
export function TrustDepositLine({ base, amount, discountPercentage }: { base: number; amount: number; discountPercentage: number }) {
  const colors = useColors();
  const [showWhy, setShowWhy] = useState(false);
  const label = <Text style={[styles.text, { color: colors.mutedForeground }]}>Trust Deposit: </Text>;

  if (discountPercentage <= 0) {
    return (
      <View style={styles.row} testID="trust-deposit-line">
        {label}
        <Text style={[styles.text, { color: colors.mutedForeground }]} testID="trust-deposit-amount">${base}</Text>
      </View>
    );
  }

  const why = `Discounted ${discountPercentage}% by your trust score`;
  return (
    <View testID="trust-deposit-line">
      <Pressable
        onPress={() => setShowWhy((open) => !open)}
        accessibilityRole="button"
        accessibilityLabel={`Trust Deposit ${base} dollars, now ${amount} dollars. ${why}`}
        style={styles.row}
      >
        {label}
        <View style={styles.struck} testID="trust-deposit-struck">
          <Text style={[styles.text, { color: colors.foreground }]}>${base}</Text>
          <View pointerEvents="none" style={[styles.line, { backgroundColor: colors.primary }]} testID="trust-deposit-line-through" />
        </View>
        <Text style={[styles.text, styles.amount, { color: colors.primaryDark }]} testID="trust-deposit-amount">${amount}</Text>
      </Pressable>
      {showWhy ? (
        <View style={[styles.tooltip, { backgroundColor: colors.card, borderColor: colors.border }]} testID="trust-deposit-tooltip">
          <Text style={[styles.tooltipText, { color: colors.foreground }]}>{why}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  text: { fontSize: 12, fontFamily: "Inter_400Regular" },
  struck: { position: "relative", justifyContent: "center" },
  line: { position: "absolute", left: 0, right: 0, top: "50%", height: 2, marginTop: -1 },
  amount: { marginLeft: 6, fontFamily: "Inter_600SemiBold" },
  tooltip: { alignSelf: "flex-start", marginTop: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  tooltipText: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
