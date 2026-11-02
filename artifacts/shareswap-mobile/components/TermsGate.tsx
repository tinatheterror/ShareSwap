import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiPost } from "@/lib/api";
import { GUIDELINES_URL, openLegalLink, TERMS_URL } from "@/lib/legalLinks";
import { moderationErrorMessage } from "@/lib/moderation";

/**
 * A screen nobody can dismiss until they accept the current Terms and Community Guidelines: accounts from before they
 * existed, new Google sign-ins, and everyone again whenever the version changes. The server decides
 * (termsAcceptanceRequired on /api/user); this only asks and records the answer.
 */
export function TermsGate() {
  const { user, refetchUser } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const required = !!user && user.termsAcceptanceRequired === true && !!user.currentTermsVersion;
  if (!required) return null;

  async function accept() {
    if (!agreed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiPost("/api/account/accept-terms", { version: user!.currentTermsVersion });
      await refetchUser();
    } catch (err) {
      setError(moderationErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible animationType="fade" transparent={false} onRequestClose={() => {}}>
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]} testID="terms-gate">
        <Feather name="shield" size={40} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground }]}>Our Terms and Community Guidelines</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          ShareSwap has no tolerance for objectionable content or abusive people. Please read our{" "}
          <Text style={styles.link} accessibilityRole="link" onPress={() => openLegalLink(TERMS_URL)}>Terms of Service</Text> and{" "}
          <Text style={styles.link} accessibilityRole="link" onPress={() => openLegalLink(GUIDELINES_URL)}>Community Guidelines</Text>{" "}
          and agree to them to keep using ShareSwap.
        </Text>

        <Pressable
          testID="terms-gate-checkbox"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          onPress={() => setAgreed((value) => !value)}
          style={styles.agreeRow}
        >
          <Feather name={agreed ? "check-square" : "square"} size={24} color={agreed ? colors.primary : colors.mutedForeground} />
          <Text style={[styles.agreeText, { color: colors.foreground }]}>I have read and agree to the Terms of Service and Community Guidelines.</Text>
        </Pressable>

        {error ? <Text testID="terms-gate-error" style={styles.error}>{error}</Text> : null}

        <Pressable
          testID="terms-gate-accept"
          accessibilityRole="button"
          accessibilityState={{ disabled: !agreed || saving }}
          disabled={!agreed || saving}
          onPress={accept}
          style={[styles.button, { backgroundColor: colors.primary, opacity: !agreed || saving ? 0.5 : 1 }]}
        >
          {saving ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Agree and continue</Text>}
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, alignItems: "center", gap: 16 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center" },
  body: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular", textAlign: "center" },
  link: { textDecorationLine: "underline", color: "#0d9488" },
  agreeRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, alignSelf: "stretch", marginTop: 8 },
  agreeText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: "Inter_500Medium" },
  error: { color: "#dc2626", fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
  button: { alignSelf: "stretch", borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: "auto" },
  buttonText: { fontSize: 16, fontFamily: "Inter_700Bold" },
});
