import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

type ClaimType = "damage" | "non_return" | "lost" | "missing_components" | "other";
const TYPES: { value: ClaimType; label: string }[] = [
  { value: "damage", label: "Damage" }, { value: "non_return", label: "Not returned" },
  { value: "lost", label: "Lost" }, { value: "missing_components", label: "Missing components" }, { value: "other", label: "Other" },
];

export function ClaimSheet({ visible, onClose, onSubmit, isPending, depositAmount }: {
  visible: boolean; onClose: () => void;
  onSubmit: (payload: { claimType: ClaimType; reason: string; requestedAmount: number; evidence: string[] }) => void;
  isPending: boolean; depositAmount: number | null;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [claimType, setClaimType] = useState<ClaimType>("damage");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [evidence, setEvidence] = useState("");
  useEffect(() => { if (visible) { setClaimType("damage"); setReason(""); setAmount(""); setEvidence(""); } }, [visible]);
  const maximum = Number(depositAmount ?? 0);
  const requested = Number(amount);
  const valid = reason.trim().length > 0 && requested > 0 && requested <= maximum;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 18 }]}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <Text style={[styles.title, { color: colors.foreground }]}>Report an issue</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>Open a claim for review. An overdue return alone never settles a security deposit.</Text>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
          <Text style={[styles.label, { color: colors.foreground }]}>Issue type</Text>
          <View style={styles.types}>
            {TYPES.map((type) => <Pressable key={type.value} testID={`claim-type-${type.value}`} onPress={() => setClaimType(type.value)}
              style={[styles.type, { borderColor: claimType === type.value ? colors.primary : colors.border, backgroundColor: claimType === type.value ? colors.primary + "16" : colors.background }]}>
              <Text style={{ color: claimType === type.value ? colors.primary : colors.foreground, fontSize: 12, fontFamily: "Inter_500Medium" }}>{type.label}</Text>
            </Pressable>)}
          </View>
          <Text style={[styles.label, { color: colors.foreground }]}>What happened?</Text>
          <TextInput testID="claim-reason" multiline value={reason} onChangeText={setReason} placeholder="Describe the issue and relevant return details…" placeholderTextColor={colors.mutedForeground}
            style={[styles.input, styles.notes, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
          <Text style={[styles.label, { color: colors.foreground }]}>Requested amount</Text>
          <TextInput testID="claim-requested-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={`Up to $${maximum.toFixed(2)}`} placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
          <Text style={[styles.help, { color: requested > maximum ? "#dc2626" : colors.mutedForeground }]}>Maximum available protection: ${maximum.toFixed(2)}. The reviewed approved amount—not the deposit—is what may be settled.</Text>
          <Text style={[styles.label, { color: colors.foreground }]}>Evidence details or URLs (optional)</Text>
          <TextInput testID="claim-evidence" multiline value={evidence} onChangeText={setEvidence} placeholder="Add links or details, one per line" placeholderTextColor={colors.mutedForeground}
            style={[styles.input, styles.notes, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
        </ScrollView>
        <View style={styles.buttons}>
          <Pressable onPress={onClose} style={[styles.button, { borderColor: colors.border }]}><Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium" }}>Cancel</Text></Pressable>
          <Pressable testID="submit-claim" disabled={!valid || isPending} onPress={() => onSubmit({ claimType, reason: reason.trim(), requestedAmount: requested, evidence: evidence.split(/\n|,/).map(x => x.trim()).filter(Boolean) })}
            style={[styles.button, { backgroundColor: "#dc2626", borderColor: "#dc2626", opacity: valid ? 1 : .5 }]}>
            {isPending ? <ActivityIndicator color="#fff" /> : <><Feather name="flag" size={14} color="#fff" /><Text style={styles.submit}>Open claim</Text></>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,.45)" }, sheet: { position: "absolute", bottom: 0, left: 0, right: 0, maxHeight: "92%", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 12, gap: 10 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center" }, title: { fontSize: 18, fontFamily: "Inter_700Bold" }, sub: { fontSize: 13, lineHeight: 18 }, form: { gap: 8, paddingTop: 4 }, label: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 4 }, types: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, type: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  input: { borderWidth: 1, borderRadius: 9, padding: 10, fontSize: 13 }, notes: { minHeight: 70, textAlignVertical: "top" }, help: { fontSize: 11, lineHeight: 16 }, buttons: { flexDirection: "row", gap: 10 }, button: { flex: 1, minHeight: 46, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }, submit: { color: "#fff", fontFamily: "Inter_600SemiBold" },
});