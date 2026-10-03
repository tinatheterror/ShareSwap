import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiRequest } from "@/lib/api";
import { formatMoney } from "@/lib/depositCopy";

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
  const [evidencePhotos, setEvidencePhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  useEffect(() => { if (visible) { setClaimType("damage"); setReason(""); setAmount(""); setEvidence(""); setEvidencePhotos([]); } }, [visible]);
  const maximum = Number(depositAmount ?? 0);
  const requested = Number(amount);
  const valid = reason.trim().length > 0 && requested > 0 && requested <= maximum;
  async function pickEvidencePhotos() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo access to attach evidence.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, 5 - evidencePhotos.length),
    });
    if (!result.canceled) setEvidencePhotos(current => [...current, ...result.assets].slice(0, 5));
  }
  async function submitClaim() {
    setIsUploading(true);
    try {
      const uploadedPhotoUrls: string[] = [];
      for (const [index, photo] of evidencePhotos.entries()) {
        const formData = new FormData();
        const extension = photo.fileName?.split(".").pop()?.toLowerCase() || "jpg";
        const type = photo.mimeType || (extension === "png" ? "image/png" : "image/jpeg");
        formData.append("photo", { uri: photo.uri, type, name: photo.fileName || `claim-evidence-${index}.${extension}` } as any);
        const uploadRes = await apiRequest("POST", "/api/uploads/claim-evidence", formData);
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok || !uploadData?.url) throw new Error(uploadData?.error || "Could not upload evidence photo");
        uploadedPhotoUrls.push(uploadData.url);
      }
      onSubmit({ claimType, reason: reason.trim(), requestedAmount: requested, evidence: [...evidence.split(/\n|,/).map(x => x.trim()).filter(Boolean), ...uploadedPhotoUrls] });
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || "Could not upload evidence photos.");
    } finally {
      setIsUploading(false);
    }
  }
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 18 }]}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <Text style={[styles.title, { color: colors.foreground }]}>Report an issue</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>Tell us what happened with the item.</Text>
        <Text testID="claim-charge-warning" style={[styles.help, { color: "#b91c1c", paddingHorizontal: 18, marginBottom: 6 }]}>
          Opening a claim charges the borrower's {maximum > 0 ? formatMoney(maximum) + " " : ""}security deposit to their card while the claim is reviewed. If the claim is resolved in the borrower's favor, the charged amount is refunded.
        </Text>
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
          <Text style={[styles.label, { color: colors.foreground }]}>Amount requested</Text>
          <TextInput testID="claim-requested-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={`Up to $${maximum.toFixed(2)}`} placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
          <Text style={[styles.help, { color: requested > maximum ? "#dc2626" : colors.mutedForeground }]}>Maximum claim amount: ${maximum.toFixed(2)}</Text>
          <Text style={[styles.label, { color: colors.foreground }]}>Evidence (optional)</Text>
          <TextInput testID="claim-evidence" multiline value={evidence} onChangeText={setEvidence} placeholder="Photos, details, or links..." placeholderTextColor={colors.mutedForeground}
            style={[styles.input, styles.notes, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
          <Pressable testID="pick-claim-evidence-photos" disabled={evidencePhotos.length >= 5 || isUploading} onPress={pickEvidencePhotos} style={[styles.photoButton, { borderColor: colors.border }]}>
            <Feather name="image" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Add photos</Text>
          </Pressable>
          {evidencePhotos.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
            {evidencePhotos.map((photo, index) => <View key={`${photo.uri}-${index}`} style={styles.previewWrap}>
              <Image source={{ uri: photo.uri }} style={styles.preview} />
              <Pressable accessibilityLabel={`Remove evidence photo ${index + 1}`} onPress={() => setEvidencePhotos(current => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.removePhoto}>
                <Feather name="x" size={13} color="#fff" />
              </Pressable>
            </View>)}
          </ScrollView>}
          <Text style={[styles.help, { color: colors.mutedForeground }]}>Add up to 5 photos.</Text>
        </ScrollView>
        <View style={styles.buttons}>
          <Pressable onPress={onClose} style={[styles.button, { borderColor: colors.border }]}><Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium" }}>Cancel</Text></Pressable>
          <Pressable testID="submit-claim" disabled={!valid || isPending || isUploading} onPress={submitClaim}
            style={[styles.button, { backgroundColor: "#dc2626", borderColor: "#dc2626", opacity: valid && !isUploading ? 1 : .5 }]}>
            {isPending || isUploading ? <ActivityIndicator color="#fff" /> : <><Feather name="flag" size={14} color="#fff" /><Text style={styles.submit}>Open claim</Text></>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,.45)" }, sheet: { position: "absolute", bottom: 0, left: 0, right: 0, maxHeight: "92%", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 12, gap: 10 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center" }, title: { fontSize: 18, fontFamily: "Inter_700Bold" }, sub: { fontSize: 13, lineHeight: 18 }, form: { gap: 8, paddingTop: 4 }, label: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 4 }, types: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, type: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  input: { borderWidth: 1, borderRadius: 9, padding: 10, fontSize: 13 }, notes: { minHeight: 70, textAlignVertical: "top" }, help: { fontSize: 11, lineHeight: 16 }, photoButton: { minHeight: 42, borderWidth: 1, borderRadius: 9, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 }, photoRow: { gap: 8 }, previewWrap: { position: "relative" }, preview: { width: 72, height: 72, borderRadius: 9 }, removePhoto: { position: "absolute", right: 4, top: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,.7)", alignItems: "center", justifyContent: "center" }, buttons: { flexDirection: "row", gap: 10 }, button: { flex: 1, minHeight: 46, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }, submit: { color: "#fff", fontFamily: "Inter_600SemiBold" },
});