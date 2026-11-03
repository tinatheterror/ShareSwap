import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { openLegalLink, PRIVACY_URL } from "@/lib/legalLinks";
import type { AiFeature } from "@/components/AiConsent";

/**
 * Settings > AI features: one switch per feature that sends content to OpenAI. Switching on is the same recorded consent as the
 * prompt before first use; switching off withdraws it, and the feature goes back to unavailable or to working without OpenAI.
 * The wording comes from the server, the same list the prompt and the Privacy Policy use.
 */
export function AiConsentSettings() {
  const { user, refetchUser } = useAuth();
  const colors = useColors();
  const [busy, setBusy] = useState<string | null>(null);
  const { data } = useQuery<{ provider: string; features: AiFeature[] }>({
    queryKey: ["/api/ai-consent/features"],
    queryFn: () => apiGet("/api/ai-consent/features"),
    staleTime: Infinity,
  });
  const agreedTo = user?.aiConsents ?? [];

  if (!data) return null;
  const change = async (feature: AiFeature, on: boolean) => {
    setBusy(feature.key);
    try {
      if (on) await apiPost("/api/ai-consent", { feature: feature.key });
      else await apiDelete(`/api/ai-consent/${feature.key}`);
      await refetchUser();
    } catch {
      Alert.alert("Couldn't save your choice", "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View testID="ai-consent-settings" style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Feather name="cpu" size={17} color="#0d9488" />
        <Text style={[styles.title, { color: colors.foreground }]}>AI features</Text>
      </View>
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>
        These features send content to {data.provider} to work. Nothing is sent unless the switch is on, and you can turn it off at any time. See our{" "}
        <Text style={styles.link} accessibilityRole="link" onPress={() => openLegalLink(PRIVACY_URL)}>Privacy Policy</Text>.
      </Text>
      {data.features.map((feature) => (
        <View key={feature.key} style={[styles.row, { borderTopColor: colors.border }]}>
          <View style={styles.text}>
            <Text style={[styles.label, { color: colors.foreground }]}>{feature.title}</Text>
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>{feature.purpose}</Text>
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>Sent to {data.provider}: {feature.shared}</Text>
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>When off: {feature.withoutConsent}</Text>
          </View>
          <Switch
            testID={`ai-consent-switch-${feature.key}`}
            accessibilityLabel={`${feature.title} (sends content to ${data.provider})`}
            value={agreedTo.includes(feature.key)}
            onValueChange={(on) => { void change(feature, on); }}
            trackColor={{ false: colors.border, true: "#0d9488" }}
            thumbColor="#fff"
            disabled={busy !== null}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 14, fontFamily: "Inter_500Medium" },
  hint: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  link: { textDecorationLine: "underline", color: "#0d9488" },
});
