import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { openLegalLink, PRIVACY_URL } from "@/lib/legalLinks";

/** The server's biometric consent (GET /api/biometric-consent): the wording lives in artifacts/api-server/src/biometric-consent.ts. */
export interface BiometricConsent {
  version: string;
  notice: string;
  checkboxLabel: string;
  policyPath: string;
  consented: boolean;
  consentedAt: string | null;
}

/** https://shareswap.app/privacy#identity-verification-and-face-matching */
export const biometricPolicyUrl = (policyPath: string) => `${PRIVACY_URL.replace(/\/privacy$/, "")}${policyPath}`;

/** The notice and the required checkbox shown before Start Verification. Already agreed at the current wording: just says so. */
export function BiometricConsentNotice({ consent, agreed, onAgreedChange }: { consent: BiometricConsent | undefined; agreed: boolean; onAgreedChange: (value: boolean) => void }) {
  const colors = useColors();
  if (!consent) return null;
  return (
    <View testID="biometric-consent" style={[styles.box, { borderColor: colors.border }]}>
      <Text testID="biometric-notice" style={[styles.notice, { color: colors.foreground }]}>
        {consent.notice}{" "}
        <Text testID="biometric-policy-link" accessibilityRole="link" style={{ color: colors.primary, textDecorationLine: "underline" }} onPress={() => openLegalLink(biometricPolicyUrl(consent.policyPath))}>
          Read the Privacy Policy section
        </Text>
        .
      </Text>
      {consent.consented ? (
        <Text testID="biometric-agreed" style={[styles.small, { color: colors.mutedForeground }]}>
          You agreed to this{consent.consentedAt ? ` on ${new Date(consent.consentedAt).toLocaleDateString()}` : ""}.
        </Text>
      ) : (
        <Pressable testID="biometric-checkbox" accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} onPress={() => onAgreedChange(!agreed)} style={styles.checkRow}>
          <Feather name={agreed ? "check-square" : "square"} size={22} color={agreed ? colors.primary : colors.mutedForeground} />
          <Text style={[styles.checkLabel, { color: colors.foreground }]}>{consent.checkboxLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  notice: { fontSize: 13, lineHeight: 19 },
  small: { fontSize: 12 },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkLabel: { flex: 1, fontSize: 13, lineHeight: 19 },
});
