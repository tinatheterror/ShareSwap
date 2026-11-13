import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ArrowLeftRight } from "lucide-react-native";

interface Valuation {
  offset: number;
  exceedsMax: boolean;
  offsetDirection: "none" | "you_pay" | "you_receive";
  isFair: boolean;
}

/**
 * The "Your offer ⇄ Their offer" box shown under the item pickers, shared by the swap request modal and the
 * propose-new-terms sheet so both read the same: green when fair, yellow when ShareCoins settle a difference,
 * red when the offset is over the maximum.
 */
export function SwapFairnessSummary({ yourSC, theirSC, valuation, maxOffset }: { yourSC: number; theirSC: number; valuation: Valuation; maxOffset: number }) {
  let fc = { bg: "#fefce8", border: "#fcd34d", text: "#92400e" }; // yellow = offset
  if (valuation.exceedsMax) fc = { bg: "#fef2f2", border: "#fecaca", text: "#b91c1c" };
  else if (valuation.isFair) fc = { bg: "#f0fdf4", border: "#86efac", text: "#15803d" };

  const message = valuation.isFair
    ? "Fair swap"
    : valuation.exceedsMax
      ? `Offset is ${valuation.offset} ShareCoins — maximum allowed is ${maxOffset}`
      : valuation.offsetDirection === "you_pay"
        ? `You pay ${valuation.offset} ShareCoins to balance`
        : `You receive +${valuation.offset} ShareCoins to balance`;

  return (
    <View style={[s.fairness, { backgroundColor: fc.bg, borderColor: fc.border }]}>
      <View style={s.fairnessRow}>
        <View style={s.fairnessSide}>
          <Text style={[s.fairnessSub, { color: fc.text }]}>Your offer</Text>
          <Text style={[s.fairnessBig, { color: fc.text }]}>{yourSC}</Text>
          <Text style={[s.fairnessSub, { color: fc.text }]}>ShareCoin</Text>
        </View>
        <ArrowLeftRight size={16} color={fc.text} strokeWidth={2} />
        <View style={s.fairnessSide}>
          <Text style={[s.fairnessSub, { color: fc.text }]}>Their offer</Text>
          <Text style={[s.fairnessBig, { color: fc.text }]}>{theirSC}</Text>
          <Text style={[s.fairnessSub, { color: fc.text }]}>ShareCoin</Text>
        </View>
      </View>
      <View style={[s.fairnessDivider, { borderColor: fc.border }]} />
      <View style={s.fairnessMsgRow}>
        <Feather name={valuation.exceedsMax ? "alert-triangle" : "info"} size={11} color={fc.text} style={{ marginTop: 1 }} />
        <Text style={[s.fairnessMsgText, { color: fc.text }]}>{message}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  fairness: { borderRadius: 10, padding: 12, borderWidth: 1 },
  fairnessRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  fairnessSide: { flex: 1, alignItems: "center" },
  fairnessSub: { fontSize: 10, fontFamily: "Inter_400Regular", opacity: 0.8, marginBottom: 2 },
  fairnessBig: { fontSize: 24, fontFamily: "Inter_700Bold", lineHeight: 28 },
  fairnessDivider: { borderTopWidth: 1, opacity: 0.2 },
  fairnessMsgRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8 },
  fairnessMsgText: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 16 },
});
