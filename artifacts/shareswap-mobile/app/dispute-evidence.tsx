import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiRequest } from "@/lib/api";
import { EVIDENCE_PHOTOS_MAX, evidenceBody, evidenceProblem, type EvidenceRequest } from "@/lib/disputeEvidence";

const QUERY_KEY = "/api/disputes/evidence-requests";

function EvidenceCard({ request, onSent }: { request: EvidenceRequest; onSent: () => void }) {
  const colors = useColors();
  const [note, setNote] = React.useState("");
  const [photos, setPhotos] = React.useState<ImagePicker.ImagePickerAsset[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function pickPhotos() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo access to attach evidence.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], quality: 0.8, allowsMultipleSelection: true, selectionLimit: Math.max(1, EVIDENCE_PHOTOS_MAX - photos.length),
    });
    if (!result.canceled) setPhotos((current) => [...current, ...result.assets].slice(0, EVIDENCE_PHOTOS_MAX));
  }

  async function submit() {
    const problem = evidenceProblem(note, photos.length);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const photoUrls: string[] = [];
      for (const [index, photo] of photos.entries()) {
        const formData = new FormData();
        const extension = photo.fileName?.split(".").pop()?.toLowerCase() || "jpg";
        const type = photo.mimeType || (extension === "png" ? "image/png" : "image/jpeg");
        formData.append("photo", { uri: photo.uri, type, name: photo.fileName || `dispute-evidence-${index}.${extension}` } as any);
        const uploadRes = await apiRequest("POST", "/api/uploads/dispute-evidence", formData);
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok || !uploadData?.url) throw new Error(uploadData?.error || "Could not upload a photo");
        photoUrls.push(uploadData.url);
      }
      const res = await apiRequest("POST", `/api/disputes/${encodeURIComponent(request.disputeId)}/evidence`, evidenceBody(note, photoUrls));
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any)?.message || "Could not send your evidence");
      setSent(true);
      onSent();
    } catch (e: any) {
      setError(e?.message || "Could not send your evidence");
    } finally {
      setBusy(false);
    }
  }

  const due = request.dueBy ? new Date(request.dueBy).toLocaleDateString() : null;
  return (
    <View testID={`evidence-card-${request.disputeId}`} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>{request.itemName ?? "A payment you received"}</Text>
      {due ? <Text style={[styles.help, { color: colors.mutedForeground }]}>We need your evidence by {due}.</Text> : null}
      <Text style={[styles.help, { color: colors.mutedForeground }]}>
        You will not be charged. We need your handoff confirmation, photos and messages to answer the dispute.
      </Text>
      {sent ? (
        <Text testID="evidence-sent" style={{ color: colors.success, fontFamily: "Inter_600SemiBold" }}>Thank you, your evidence was sent.</Text>
      ) : (
        <>
          <TextInput
            testID="evidence-note" multiline value={note} onChangeText={setNote} placeholder="What happened at the handoff? Anything that shows the item was handed over."
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          <Pressable testID="evidence-add-photos" disabled={busy || photos.length >= EVIDENCE_PHOTOS_MAX} onPress={pickPhotos} style={[styles.photoButton, { borderColor: colors.primary }]}>
            <Feather name="image" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Add photos ({photos.length}/{EVIDENCE_PHOTOS_MAX})</Text>
          </Pressable>
          {photos.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
              {photos.map((photo, index) => <Image key={`${photo.uri}-${index}`} source={{ uri: photo.uri }} style={styles.preview} />)}
            </ScrollView>
          ) : null}
          {error ? <Text testID="evidence-error" style={{ color: colors.destructive }}>{error}</Text> : null}
          <Pressable testID="evidence-submit" disabled={busy} onPress={submit} style={[styles.submit, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}>
            {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" }}>Send evidence</Text>}
          </Pressable>
        </>
      )}
    </View>
  );
}

export default function DisputeEvidenceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ requests: EvidenceRequest[] }>({ queryKey: [QUERY_KEY], queryFn: () => apiGet<{ requests: EvidenceRequest[] }>(QUERY_KEY) });
  const requests = data?.requests ?? [];
  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}><Feather name="arrow-left" size={22} color={colors.foreground} /></Pressable>
        <Text style={[styles.heading, { color: colors.foreground }]}>Evidence for a dispute</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        {isLoading ? <ActivityIndicator color={colors.primary} /> : null}
        {!isLoading && requests.length === 0 ? <Text testID="evidence-empty" style={{ color: colors.mutedForeground }}>Nothing is waiting for your evidence.</Text> : null}
        {requests.map((request) => (
          <EvidenceCard key={request.disputeId} request={request} onSent={() => void queryClient.invalidateQueries({ queryKey: [QUERY_KEY] })} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  heading: { fontSize: 18, fontFamily: "Inter_700Bold" },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  title: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  help: { fontSize: 13, fontFamily: "Inter_400Regular" },
  input: { borderWidth: 1, borderRadius: 10, padding: 10, minHeight: 90, textAlignVertical: "top" },
  photoButton: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, padding: 10, alignSelf: "flex-start" },
  photoRow: { gap: 8 },
  preview: { width: 64, height: 64, borderRadius: 8 },
  submit: { borderRadius: 10, padding: 12, alignItems: "center" },
});
