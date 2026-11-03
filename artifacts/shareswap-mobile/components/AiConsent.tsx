import React, { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/lib/api";
import { openLegalLink, PRIVACY_URL } from "@/lib/legalLinks";

export type AiFeature = { key: string; title: string; purpose: string; shared: string; notShared: string; withoutConsent: string; fallback: "unavailable" | "no-ai" };
type AiFeatureList = { provider: string; version: string; features: AiFeature[] };
type Options = { askOnce?: boolean };
type AiConsentContextType = {
  /** Resolves true when this person has agreed to send content to OpenAI for the feature (asking first if they have not). */
  ensureAiConsent: (feature: string, options?: Options) => Promise<boolean>;
};

const AiConsentContext = createContext<AiConsentContextType>({ ensureAiConsent: async () => false });
export const useAiConsent = () => useContext(AiConsentContext);

/**
 * The prompt before the first use of each AI feature. The wording comes from the server (/api/ai-consent/features), the same
 * list the Privacy Policy describes, and agreement is stored per person and per feature. The server refuses to call OpenAI
 * without it, so this only asks.
 */
export function AiConsentProvider({ children }: { children: ReactNode }) {
  const { user, refetchUser } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState<{ feature: AiFeature; provider: string; resolve: (agreed: boolean) => void } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const declined = useRef(new Set<string>());
  const list = useRef<AiFeatureList | null>(null);
  const agreedTo = user?.aiConsents ?? [];

  const ensureAiConsent = useCallback(
    async (feature: string, options?: Options) => {
      if (agreedTo.includes(feature)) return true;
      if (options?.askOnce && declined.current.has(feature)) return false;
      try {
        list.current ??= await apiGet<AiFeatureList>("/api/ai-consent/features");
      } catch {
        return false; // cannot show what would be shared, so nothing is shared
      }
      const definition = list.current.features.find((candidate) => candidate.key === feature);
      if (!definition) return false;
      setError(null);
      return new Promise<boolean>((resolve) => setPending({ feature: definition, provider: list.current!.provider, resolve }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agreedTo.join(",")],
  );

  const settle = (agreed: boolean) => {
    if (!pending) return;
    if (!agreed) declined.current.add(pending.feature.key);
    pending.resolve(agreed);
    setPending(null);
  };

  const allow = async () => {
    if (!pending || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiPost("/api/ai-consent", { feature: pending.feature.key });
      await refetchUser();
      settle(true);
    } catch {
      setError("Couldn't save your choice. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AiConsentContext.Provider value={{ ensureAiConsent }}>
      {children}
      <Modal visible={!!pending} animationType="slide" transparent onRequestClose={() => settle(false)}>
        <View style={styles.backdrop}>
          {pending ? (
            <View testID="ai-consent" style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 20 }]}>
              <Text style={[styles.title, { color: colors.foreground }]}>{pending.feature.title} uses {pending.provider}</Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>{pending.feature.purpose}</Text>
              <Text style={[styles.body, { color: colors.foreground }]}>
                <Text style={styles.bold}>Shared with {pending.provider}: </Text>{pending.feature.shared}
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>{pending.feature.notShared}</Text>
              <Text style={[styles.body, { color: colors.foreground }]}>
                <Text style={styles.bold}>If you say no: </Text>{pending.feature.withoutConsent}
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                You can change your mind any time by writing to support@shareswap.app. See our{" "}
                <Text style={styles.link} accessibilityRole="link" onPress={() => openLegalLink(PRIVACY_URL)}>Privacy Policy</Text>.
              </Text>
              {error ? <Text testID="ai-consent-error" style={styles.error}>{error}</Text> : null}
              <Pressable testID="ai-consent-allow" accessibilityRole="button" disabled={saving} onPress={allow}
                style={[styles.button, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}>
                {saving ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Allow and continue</Text>}
              </Pressable>
              <Pressable testID="ai-consent-decline" accessibilityRole="button" disabled={saving} onPress={() => settle(false)} style={styles.secondary}>
                <Text style={[styles.secondaryText, { color: colors.mutedForeground }]}>Not now</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Modal>
    </AiConsentContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 12 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  body: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  bold: { fontFamily: "Inter_700Bold" },
  link: { textDecorationLine: "underline", color: "#0d9488" },
  error: { color: "#dc2626", fontSize: 13, fontFamily: "Inter_500Medium" },
  button: { borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 4 },
  buttonText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  secondary: { paddingVertical: 12, alignItems: "center" },
  secondaryText: { fontSize: 15, fontFamily: "Inter_500Medium" },
});
