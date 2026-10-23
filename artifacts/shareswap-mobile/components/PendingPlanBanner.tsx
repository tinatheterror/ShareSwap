import { Feather } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { apiPost } from "@/lib/api";
import { keepPlanLabel, pendingChangeLabel, type PendingPlanChange, type Tier } from "@/lib/subscriptionPlan";

/**
 * "Switching to Member on <date>" with a "Keep Pro" button. Keep Pro drops the pending change
 * (POST /api/subscription/keep-plan: no sheet, no charge) and refreshes the subscription status.
 * Renders nothing when no change is pending.
 */
export function PendingPlanBanner({ pending, currentTier }: { pending: PendingPlanChange | null | undefined; currentTier: Tier }) {
  const qc = useQueryClient();
  const keepPlan = useMutation({
    mutationFn: () => apiPost("/api/subscription/keep-plan", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/subscription/status"] }),
    onError: () => Alert.alert("Couldn't keep your plan", "Please try again."),
  });

  const label = pendingChangeLabel(pending);
  if (!label) return null;
  return (
    <View style={styles.banner} testID="pending-plan-banner">
      <Feather name="clock" size={14} color="#92400e" />
      <Text style={styles.text}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        testID="keep-plan-button"
        style={({ pressed }) => [styles.button, { opacity: pressed || keepPlan.isPending ? 0.7 : 1 }]}
        onPress={() => keepPlan.mutate()}
        disabled={keepPlan.isPending}
      >
        {keepPlan.isPending ? <ActivityIndicator size="small" color="#92400e" /> : <Text style={styles.buttonText}>{keepPlanLabel(currentTier)}</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fffbeb", borderColor: "#fde68a", borderWidth: 1, borderRadius: 10, padding: 10 },
  text: { flex: 1, fontSize: 13, color: "#92400e", fontFamily: "Inter_600SemiBold" },
  button: { borderWidth: 1, borderColor: "#fcd34d", backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  buttonText: { fontSize: 12, color: "#92400e", fontFamily: "Inter_600SemiBold" },
});
