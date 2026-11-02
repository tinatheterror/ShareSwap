import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { affectedByBlock, blockUser, MAX_REPORT_DETAILS, moderationErrorMessage, REPORT_REASONS, submitReport, type ReportReason, type ReportTargetType } from "@/lib/moderation";

export type ReportSheetProps = {
  visible: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: number;
  /** What is being reported, in words: "this listing", "this message", "Avery". */
  targetLabel: string;
  /** The person who wrote it. When given, the sheet offers to block them in the same step. */
  authorId?: number | null;
  authorName?: string | null;
  onReported?: () => void;
  onBlocked?: () => void;
};

/** One sheet for every kind of report: pick a reason, add a note if you like, optionally block the person too. */
export function ReportSheet({ visible, onClose, targetType, targetId, targetLabel, authorId, authorName, onReported, onBlocked }: ReportSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh sheet every time it opens.
  useEffect(() => {
    if (visible) {
      setReason(null);
      setDetails("");
      setAlsoBlock(false);
      setSubmitting(false);
      setError(null);
    }
  }, [visible, targetType, targetId]);

  async function submit() {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitReport({ targetType, targetId, reason, details });
    } catch (err) {
      setError(moderationErrorMessage(err));
      setSubmitting(false);
      return;
    }
    onReported?.();

    let blocked = false;
    let blockError: string | null = null;
    if (alsoBlock && authorId) {
      try {
        await blockUser(authorId);
        blocked = true;
        qc.invalidateQueries({ predicate: (q) => affectedByBlock(q.queryKey) });
      } catch (err) {
        blockError = moderationErrorMessage(err);
      }
    }
    setSubmitting(false);
    onClose();
    if (blocked) onBlocked?.();
    Alert.alert(
      "Thanks for letting us know",
      blockError
        ? `We'll review your report. We couldn't block ${authorName ?? "them"}: ${blockError}`
        : `We'll review your report. ${blocked ? `${authorName ?? "They"} can no longer contact you. ` : ""}Nobody is told who reported.`,
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]} testID="report-sheet">
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text style={[styles.title, { color: colors.foreground }]}>Report {targetLabel}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Why are you reporting it? Nobody is told who reported.</Text>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            {REPORT_REASONS.map((option) => {
              const selected = reason === option.key;
              return (
                <Pressable
                  key={option.key}
                  testID={`report-reason-${option.key}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setReason(option.key)}
                  style={[styles.reasonRow, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + "12" : "transparent" }]}
                >
                  <Feather name={selected ? "check-circle" : "circle"} size={20} color={selected ? colors.primary : colors.mutedForeground} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.reasonLabel, { color: colors.foreground }]}>{option.label}</Text>
                    <Text style={[styles.reasonHint, { color: colors.mutedForeground }]}>{option.hint}</Text>
                  </View>
                </Pressable>
              );
            })}

            <TextInput
              testID="report-details"
              value={details}
              onChangeText={setDetails}
              placeholder="Add a note (optional)"
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={MAX_REPORT_DETAILS}
              style={[styles.details, { borderColor: colors.border, color: colors.foreground }]}
            />

            {authorId ? (
              <Pressable
                testID="report-also-block"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: alsoBlock }}
                onPress={() => setAlsoBlock((value) => !value)}
                style={styles.blockRow}
              >
                <Feather name={alsoBlock ? "check-square" : "square"} size={22} color={alsoBlock ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.blockText, { color: colors.foreground }]}>
                  Also block {authorName ?? "this person"}. You won't see each other's listings, profile or messages.
                </Text>
              </Pressable>
            ) : null}

            {error ? <Text testID="report-error" style={styles.error}>{error}</Text> : null}
          </ScrollView>

          <Pressable
            testID="report-submit"
            accessibilityRole="button"
            accessibilityState={{ disabled: !reason || submitting }}
            disabled={!reason || submitting}
            onPress={submit}
            style={[styles.submit, { backgroundColor: colors.primary, opacity: !reason || submitting ? 0.5 : 1 }]}
          >
            {submitting ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.submitText, { color: colors.primaryForeground }]}>Send report</Text>}
          </Pressable>
          <Pressable onPress={onClose} accessibilityRole="button" style={styles.cancel}>
            <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, maxHeight: "88%" },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2, marginBottom: 10 },
  scroll: { flexGrow: 0 },
  reasonRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderWidth: 1, borderRadius: 12, marginBottom: 8 },
  reasonLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  reasonHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  details: { minHeight: 70, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", textAlignVertical: "top", marginTop: 2 },
  blockRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 14 },
  blockText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  error: { color: "#dc2626", fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 12 },
  submit: { marginTop: 14, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  submitText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  cancel: { alignItems: "center", paddingVertical: 12 },
  cancelText: { fontSize: 15, fontFamily: "Inter_500Medium" },
});
