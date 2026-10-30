import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { apiGet, apiPost } from "@/lib/api";
import {
  blockerAction,
  deletionDateLabel,
  isDeletionPending,
  pendingBannerText,
  type AccountStatus,
  type DeletionEligibility,
} from "@/lib/accountDeletion";

/**
 * Shown while a deletion is waiting out its 14 days: the date, a Cancel button, a way to withdraw a small balance,
 * and "Delete now" behind its own confirmation. Renders nothing for an account that is not pending deletion.
 */
export function DeletionPendingBanner() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: status } = useQuery<AccountStatus>({
    queryKey: ["account-status"],
    queryFn: () => apiGet("/api/account/status"),
    enabled: !!user,
  });
  const pending = isDeletionPending(status);
  const { data: eligibility } = useQuery<DeletionEligibility>({
    queryKey: ["deletion-eligibility"],
    queryFn: () => apiGet("/api/account/deletion-eligibility"),
    enabled: !!user && pending,
  });

  const cancel = useMutation({
    mutationFn: () => apiPost("/api/account/deletion/cancel", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-status"] });
      Alert.alert("Deletion cancelled", "Your account stays open and your listings are visible again.");
    },
    onError: (error: Error) => Alert.alert("Couldn't cancel", error.message),
  });

  const deleteNow = useMutation({
    mutationFn: () => apiPost("/api/account/deletion/confirm", { confirmDeletion: true }),
    onSuccess: async () => {
      setConfirmOpen(false);
      await logout();
      router.replace("/login" as never);
      Alert.alert("Account deleted", "Your ShareSwap account has been deleted.");
    },
    onError: (error: Error) => {
      setConfirmOpen(false);
      Alert.alert("Couldn't delete the account", error.message);
    },
  });

  if (!pending) return null;
  const blockers = eligibility?.blockers ?? [];
  const wallet = eligibility?.wallet;
  const canWithdraw = wallet?.tier === "offer_withdrawal" && wallet.withdrawalOffer;

  return (
    <View style={styles.banner} testID="deletion-pending-banner">
      <View style={styles.row}>
        <Feather name="trash-2" size={14} color="#991b1b" />
        <Text style={styles.text}>{pendingBannerText(status.deletionScheduledFor)}</Text>
      </View>
      <Text style={styles.detail}>
        Until {deletionDateLabel(status.deletionScheduledFor)} you can change your mind. Your listings are hidden in the meantime.
      </Text>
      {canWithdraw ? (
        <Pressable accessibilityRole="button" testID="deletion-withdraw-button" style={styles.link} onPress={() => router.push("/wallet" as never)}>
          <Text style={styles.linkText}>Withdraw your ${wallet.available} before it is forfeited</Text>
        </Pressable>
      ) : null}
      <View style={styles.buttons}>
        <Pressable
          accessibilityRole="button"
          testID="deletion-cancel-button"
          style={({ pressed }) => [styles.cancelButton, { opacity: pressed || cancel.isPending ? 0.7 : 1 }]}
          onPress={() => cancel.mutate()}
          disabled={cancel.isPending}
        >
          {cancel.isPending ? <ActivityIndicator size="small" color="#065f46" /> : <Text style={styles.cancelText}>Cancel deletion</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" testID="deletion-delete-now-button" style={({ pressed }) => [styles.nowButton, { opacity: pressed ? 0.7 : 1 }]} onPress={() => setConfirmOpen(true)}>
          <Text style={styles.nowText}>Delete now</Text>
        </Pressable>
      </View>

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.dialog} testID="deletion-delete-now-dialog">
            <Text style={styles.dialogTitle}>Delete your account now?</Text>
            <Text style={styles.dialogBody}>
              This can't be undone. Your account is deleted straight away instead of on {deletionDateLabel(status.deletionScheduledFor)}.
            </Text>
            {blockers.map((b) => {
              const action = blockerAction(b.code);
              return (
                <View key={b.code} style={styles.blocker}>
                  <Text style={styles.blockerText}>{b.message}</Text>
                  {action ? (
                    <Pressable onPress={() => { setConfirmOpen(false); router.push(action.href as never); }}>
                      <Text style={styles.linkText}>{action.label}</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
            <Pressable
              accessibilityRole="button"
              testID="deletion-delete-now-confirm"
              style={({ pressed }) => [styles.dangerButton, { opacity: pressed || deleteNow.isPending || blockers.length > 0 ? 0.5 : 1 }]}
              onPress={() => deleteNow.mutate()}
              disabled={deleteNow.isPending || blockers.length > 0}
            >
              {deleteNow.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.dangerText}>Delete my account now</Text>}
            </Pressable>
            <Pressable style={styles.keepButton} onPress={() => setConfirmOpen(false)}>
              <Text style={styles.keepText}>Keep waiting</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { gap: 6, backgroundColor: "#fef2f2", borderColor: "#fecaca", borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  text: { flex: 1, fontSize: 14, color: "#991b1b", fontFamily: "Inter_600SemiBold" },
  detail: { fontSize: 12, color: "#7f1d1d", fontFamily: "Inter_400Regular" },
  link: { alignSelf: "flex-start" },
  linkText: { fontSize: 13, color: "#0d9488", fontFamily: "Inter_600SemiBold" },
  buttons: { flexDirection: "row", gap: 8, marginTop: 4 },
  cancelButton: { flex: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#6ee7b7", backgroundColor: "#ecfdf5", borderRadius: 8, paddingVertical: 8 },
  cancelText: { fontSize: 13, color: "#065f46", fontFamily: "Inter_600SemiBold" },
  nowButton: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#fca5a5", backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  nowText: { fontSize: 13, color: "#b91c1c", fontFamily: "Inter_600SemiBold" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  dialog: { width: "100%", maxWidth: 420, gap: 10, backgroundColor: "#fff", borderRadius: 14, padding: 18 },
  dialogTitle: { fontSize: 18, color: "#111827", fontFamily: "Inter_700Bold" },
  dialogBody: { fontSize: 14, color: "#374151", fontFamily: "Inter_400Regular" },
  blocker: { gap: 4, backgroundColor: "#fffbeb", borderColor: "#fde68a", borderWidth: 1, borderRadius: 8, padding: 10 },
  blockerText: { fontSize: 13, color: "#92400e", fontFamily: "Inter_400Regular" },
  dangerButton: { alignItems: "center", backgroundColor: "#dc2626", borderRadius: 10, paddingVertical: 12 },
  dangerText: { fontSize: 15, color: "#fff", fontFamily: "Inter_600SemiBold" },
  keepButton: { alignItems: "center", paddingVertical: 10 },
  keepText: { fontSize: 14, color: "#374151", fontFamily: "Inter_500Medium" },
});
