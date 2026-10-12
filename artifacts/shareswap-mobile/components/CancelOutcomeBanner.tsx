import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * What a cancel did ("Request cancelled. Your $42 temporary hold was released..."), or why it failed.
 * Mobile has no toast, and Alert.alert is silent on react-native-web, so this is a small banner that
 * hides itself.
 */
export function CancelOutcomeBanner({
  title,
  message,
  tone = "success",
  onHide,
  hideAfterMs = 7000,
}: {
  title: string;
  message?: string;
  tone?: "success" | "error";
  onHide: () => void;
  hideAfterMs?: number;
}) {
  useEffect(() => {
    const timer = setTimeout(onHide, hideAfterMs);
    return () => clearTimeout(timer);
  }, [title, message, onHide, hideAfterMs]);

  const error = tone === "error";
  return (
    <View
      style={[s.banner, error ? s.error : s.success]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="cancel-outcome-banner"
    >
      <Text style={[s.title, { color: error ? "#991b1b" : "#065f46" }]}>{title}</Text>
      {message ? <Text style={[s.message, { color: error ? "#991b1b" : "#065f46" }]}>{message}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  banner: { marginHorizontal: 12, marginTop: 8, padding: 12, borderRadius: 12, gap: 2, borderWidth: 1 },
  success: { backgroundColor: "#ecfdf5", borderColor: "#a7f3d0" },
  error: { backgroundColor: "#fef2f2", borderColor: "#fecaca" },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  message: { fontSize: 13, lineHeight: 18 },
});
