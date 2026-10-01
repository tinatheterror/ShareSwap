import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { BASE_URL } from "@/lib/api";
import { getApiEnvironment } from "@/lib/apiEnvironment";

const palettes = {
  development: { backgroundColor: "#eff6ff", borderColor: "#bfdbfe", color: "#1e40af" },
  production: { backgroundColor: "#ecfdf5", borderColor: "#6ee7b7", color: "#065f46" },
  unknown: { backgroundColor: "#fffbeb", borderColor: "#fcd34d", color: "#92400e" },
};

export function ApiEnvironmentLabel({ baseUrl = BASE_URL }: { baseUrl?: string }) {
  const environment = getApiEnvironment(baseUrl);
  const palette = palettes[environment.kind];

  return (
    <View
      testID="api-environment-label"
      accessible
      accessibilityLabel={`API environment: ${environment.label}. ${environment.description}. API server: ${environment.host}`}
      style={[styles.container, { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor }]}
    >
      <Text style={[styles.heading, { color: palette.color }]}>
        API environment: {environment.label}
      </Text>
      <Text style={[styles.description, { color: palette.color }]}>{environment.description}</Text>
      <Text selectable style={styles.host}>API server: {environment.host}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 4,
    marginBottom: 8,
  },
  heading: { fontSize: 14, fontWeight: "700" },
  description: { fontSize: 12, lineHeight: 18 },
  host: { fontSize: 11, lineHeight: 17, color: "#475569", flexShrink: 1 },
});