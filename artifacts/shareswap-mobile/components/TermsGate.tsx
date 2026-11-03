import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { AccountDeletionSheet } from "@/components/AccountDeletionSheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgeFields, ageComplete, emptyAge, type AgeValue } from "@/components/AgeFields";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiPost } from "@/lib/api";
import { GUIDELINES_URL, openLegalLink, TERMS_URL } from "@/lib/legalLinks";
import { moderationErrorMessage } from "@/lib/moderation";

/**
 * A screen nobody can dismiss until they accept the current Terms and Community Guidelines and have confirmed their age:
 * accounts from before they existed, new Google sign-ins, and everyone again whenever the version changes. The server decides
 * (termsAcceptanceRequired and ageConfirmationRequired on /api/user); this only asks for what is missing and records the answer.
 */
export function TermsGate() {
  const { user, refetchUser, logout } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [agreed, setAgreed] = useState(false);
  const [age, setAge] = useState<AgeValue>(emptyAge);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const termsRequired = !!user && user.termsAcceptanceRequired === true && !!user.currentTermsVersion;
  const ageRequired = !!user && user.ageConfirmationRequired === true;
  if (!termsRequired && !ageRequired) return null;
  const ready = (!termsRequired || agreed) && (!ageRequired || ageComplete(age));

  async function accept() {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (ageRequired) await apiPost("/api/account/confirm-age", age);
      if (termsRequired) await apiPost("/api/account/accept-terms", { version: user!.currentTermsVersion });
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
        <Text style={[styles.title, { color: colors.foreground }]}>{termsRequired ? "Our Terms and Community Guidelines" : "Confirm your age"}</Text>
        {termsRequired ? (
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            ShareSwap has no tolerance for objectionable content or abusive people. Please read our{" "}
            <Text style={styles.link} accessibilityRole="link" onPress={() => openLegalLink(TERMS_URL)}>Terms of Service</Text> and{" "}
            <Text style={styles.link} accessibilityRole="link" onPress={() => openLegalLink(GUIDELINES_URL)}>Community Guidelines</Text>{" "}
            {ageRequired ? "and confirm your age, then agree " : "and agree "}to keep using ShareSwap.
          </Text>
        ) : (
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            Renting and lending are contracts, so you need to have reached the age of majority where you live. Tell us where that is and your date of birth to keep using ShareSwap.
          </Text>
        )}

        {ageRequired ? <AgeFields value={age} onChange={setAge} /> : null}

        {termsRequired ? (
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
        ) : null}

        {error ? <Text testID="terms-gate-error" style={styles.error}>{error}</Text> : null}

        <Pressable
          testID="terms-gate-accept"
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready || saving }}
          disabled={!ready || saving}
          onPress={accept}
          style={[styles.button, { backgroundColor: colors.primary, opacity: !ready || saving ? 0.5 : 1 }]}
        >
          {saving ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{termsRequired ? "Agree and continue" : "Continue"}</Text>}
        </Pressable>

        {/* A way out for someone who cannot or will not continue. The deletion calls are under /api/account, which the server exempts. */}
        <View style={styles.wayOut}>
          <Pressable testID="terms-gate-sign-out" accessibilityRole="button" onPress={() => { void logout(); }} hitSlop={8}>
            <Text style={[styles.wayOutText, { color: colors.mutedForeground }]}>Sign out</Text>
          </Pressable>
          <Pressable testID="terms-gate-delete-account" accessibilityRole="button" onPress={() => setDeleting(true)} hitSlop={8}>
            <Text style={[styles.wayOutText, { color: "#dc2626" }]}>Delete my account</Text>
          </Pressable>
        </View>
        {deleting ? <AccountDeletionSheet visible onClose={() => setDeleting(false)} /> : null}
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
  wayOut: { flexDirection: "row", justifyContent: "space-between", alignSelf: "stretch" },
  wayOutText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  error: { color: "#dc2626", fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
  button: { alignSelf: "stretch", borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: "auto" },
  buttonText: { fontSize: 16, fontFamily: "Inter_700Bold" },
});
