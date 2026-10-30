import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/lib/api";
import {
  GRACE_DAYS,
  WHAT_IS_DELETED,
  WHAT_IS_KEPT,
  blockerAction,
  canRequestDeletion,
  walletCopy,
  type DeletionEligibility,
} from "@/lib/accountDeletion";

/**
 * Settings > Delete Account. Step 1 shows what the server says about the account (what blocks deletion, the wallet
 * tier and any forfeit) and asks for the forfeit acknowledgement; step 2 is the final confirmation. Confirming asks
 * the server to start the 14-day grace period; nothing is deleted until it ends or the person chooses "Delete now".
 */
export function AccountDeletionSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"review" | "confirm">("review");
  const [forfeitAcknowledged, setForfeitAcknowledged] = useState(false);
  const [understood, setUnderstood] = useState(false);

  useEffect(() => {
    if (visible) {
      setStep("review");
      setForfeitAcknowledged(false);
      setUnderstood(false);
    }
  }, [visible]);

  const { data: eligibility, isLoading, isError, refetch } = useQuery<DeletionEligibility>({
    queryKey: ["deletion-eligibility"],
    queryFn: () => apiGet("/api/account/deletion-eligibility"),
    enabled: visible,
    staleTime: 0,
  });

  const request = useMutation({
    mutationFn: () => apiPost("/api/account/deletion/request", { acknowledgeForfeit: forfeitAcknowledged }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-status"] });
      onClose();
      Alert.alert(
        "Deletion requested",
        `Your account will be deleted in ${GRACE_DAYS} days. We've emailed you the date. You can cancel from Settings until then.`,
      );
    },
    onError: (error: Error) => {
      setStep("review");
      refetch();
      Alert.alert("Couldn't request deletion", error.message);
    },
  });

  const wallet = eligibility ? walletCopy(eligibility.wallet) : null;
  const canContinue = canRequestDeletion(eligibility, forfeitAcknowledged);

  const check = (checked: boolean, label: string, onPress: () => void, testID: string) => (
    <Pressable style={styles.checkRow} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked }} testID={testID}>
      <View style={[styles.checkbox, { borderColor: checked ? "#0d9488" : colors.border, backgroundColor: checked ? "#0d9488" : colors.background }]}>
        {checked && <Feather name="check" size={13} color="#fff" />}
      </View>
      <Text style={[styles.checkLabel, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 }]} testID="account-deletion-sheet">
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.titleRow}>
            <Feather name="trash-2" size={20} color="#dc2626" />
            <Text style={[styles.title, { color: colors.foreground }]}>Delete your account</Text>
          </View>

          {isLoading ? (
            <ActivityIndicator style={{ marginVertical: 32 }} />
          ) : isError || !eligibility ? (
            <View style={styles.errorBox}>
              <Text style={[styles.body, { color: colors.foreground }]}>We couldn't check your account. Try again.</Text>
              <Pressable onPress={() => refetch()}><Text style={styles.link}>Retry</Text></Pressable>
            </View>
          ) : step === "review" ? (
            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              <View style={styles.box}>
                <Text style={styles.boxTitle}>What happens</Text>
                <Text style={styles.boxItem}>• Your account is scheduled for deletion in {GRACE_DAYS} days. You can cancel any time before that.</Text>
                {WHAT_IS_DELETED.map((item) => <Text key={item} style={styles.boxItem}>• {item}</Text>)}
                {eligibility.willEnd.subscription ? <Text style={styles.boxItem}>• Your subscription ends.</Text> : null}
                {eligibility.autoResolve.requests > 0 ? (
                  <Text style={styles.boxItem}>• {eligibility.autoResolve.requests} open {eligibility.autoResolve.requests === 1 ? "request" : "requests"} with nothing paid will be cancelled.</Text>
                ) : null}
              </View>
              <View style={[styles.box, styles.keptBox]}>
                <Text style={[styles.boxItem, { color: "#1e40af" }]}>{WHAT_IS_KEPT}</Text>
              </View>

              {eligibility.blockers.length > 0 ? (
                <View style={[styles.box, styles.blockBox]} testID="deletion-blockers">
                  <Text style={[styles.boxTitle, { color: "#92400e" }]}>Before you can delete your account</Text>
                  {eligibility.blockers.map((b) => {
                    const action = blockerAction(b.code);
                    return (
                      <View key={b.code} style={{ gap: 2 }}>
                        <Text style={[styles.boxItem, { color: "#92400e" }]}>• {b.message}{b.amount ? ` ($${b.amount})` : ""}</Text>
                        {action ? (
                          <Pressable onPress={() => { onClose(); router.push(action.href as never); }}>
                            <Text style={styles.link}>{action.label}</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {wallet && wallet.lines.length > 0 ? (
                <View style={[styles.box, styles.walletBox]} testID={`deletion-wallet-${eligibility.wallet.tier}`}>
                  <Text style={styles.boxTitle}>Your wallet</Text>
                  {wallet.lines.map((line) => <Text key={line} style={styles.boxItem}>{line}</Text>)}
                </View>
              ) : null}
              {wallet?.acknowledgement ? check(forfeitAcknowledged, wallet.acknowledgement, () => setForfeitAcknowledged((v) => !v), "deletion-forfeit-check") : null}

              <View style={styles.buttons}>
                <Pressable
                  accessibilityRole="button"
                  testID="deletion-continue"
                  style={({ pressed }) => [styles.dangerBtn, { opacity: !canContinue || pressed ? 0.5 : 1 }]}
                  onPress={() => setStep("confirm")}
                  disabled={!canContinue}
                >
                  <Text style={styles.dangerText}>Continue</Text>
                </Pressable>
                <Pressable style={[styles.cancelBtn, { borderColor: colors.border, backgroundColor: colors.background }]} onPress={onClose}>
                  <Text style={[styles.cancelText, { color: colors.foreground }]}>Keep my account</Text>
                </Pressable>
              </View>
            </ScrollView>
          ) : (
            <View>
              <Text style={[styles.body, { color: colors.foreground }]}>
                Last step. In {GRACE_DAYS} days your account and the data listed above will be permanently deleted. You'll get an email with the exact date, and a Cancel button in the app until then.
              </Text>
              {check(understood, "I understand my account will be permanently deleted.", () => setUnderstood((v) => !v), "deletion-final-check")}
              <View style={styles.buttons}>
                <Pressable
                  accessibilityRole="button"
                  testID="deletion-final-confirm"
                  style={({ pressed }) => [styles.dangerBtn, { opacity: !understood || request.isPending || pressed ? 0.5 : 1 }]}
                  onPress={() => request.mutate()}
                  disabled={!understood || request.isPending}
                >
                  {request.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.dangerText}>Delete my account</Text>}
                </Pressable>
                <Pressable style={[styles.cancelBtn, { borderColor: colors.border, backgroundColor: colors.background }]} onPress={() => setStep("review")}>
                  <Text style={[styles.cancelText, { color: colors.foreground }]}>Back</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 6 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  body: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular", marginBottom: 8 },
  errorBox: { gap: 8, paddingVertical: 16 },
  box: { gap: 4, borderWidth: 1, borderColor: "#fecaca", backgroundColor: "#fef2f2", borderRadius: 10, padding: 12, marginBottom: 10 },
  boxTitle: { fontSize: 13, color: "#991b1b", fontFamily: "Inter_700Bold" },
  boxItem: { fontSize: 13, lineHeight: 18, color: "#7f1d1d", fontFamily: "Inter_400Regular" },
  keptBox: { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" },
  blockBox: { backgroundColor: "#fffbeb", borderColor: "#fde68a" },
  walletBox: { backgroundColor: "#f0fdfa", borderColor: "#99f6e4" },
  link: { fontSize: 13, color: "#0d9488", fontFamily: "Inter_600SemiBold" },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginVertical: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkLabel: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  buttons: { gap: 8, marginTop: 6 },
  dangerBtn: { alignItems: "center", backgroundColor: "#dc2626", borderRadius: 10, paddingVertical: 13 },
  dangerText: { fontSize: 15, color: "#fff", fontFamily: "Inter_600SemiBold" },
  cancelBtn: { alignItems: "center", borderWidth: 1, borderRadius: 10, paddingVertical: 12 },
  cancelText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
