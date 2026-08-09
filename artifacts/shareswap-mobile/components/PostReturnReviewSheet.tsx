import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { apiPost } from "@/lib/api";

const TAGS_BY_TYPE: Record<string, { key: string; label: string }[]> = {
  BORROW: [
    { key: "on_time",             label: "Returned on time" },
    { key: "great_communication", label: "Great communication" },
    { key: "well_cared",          label: "Item well cared for" },
    { key: "late_return",         label: "Late return" },
    { key: "issue_reported",      label: "Issue reported" },
  ],
  RENT: [
    { key: "on_time",             label: "Returned on time" },
    { key: "great_communication", label: "Great communication" },
    { key: "well_cared",          label: "Item well cared for" },
    { key: "late_return",         label: "Late return" },
    { key: "issue_reported",      label: "Issue reported" },
  ],
  SWAP: [
    { key: "great_communication", label: "Great communication" },
    { key: "item_as_described",   label: "Item as described" },
    { key: "fair_exchange",       label: "Fair exchange" },
    { key: "item_not_described",  label: "Item not as described" },
    { key: "no_show",             label: "No-show / cancelled" },
    { key: "issue_reported",      label: "Issue reported" },
  ],
  GIFT: [
    { key: "great_communication", label: "Great communication" },
    { key: "generous_giver",      label: "Generous giver" },
    { key: "item_as_described",   label: "Item as described" },
    { key: "picked_up_promptly",  label: "Picked up promptly" },
    { key: "no_show",             label: "Didn't collect" },
    { key: "issue_reported",      label: "Issue reported" },
  ],
};

interface PostReturnReviewSheetProps {
  visible: boolean;
  onClose: () => void;
  reviewedUserId: number;
  reviewedUserName: string;
  requestId: number;
  requestType?: string;
  wasDisputed?: boolean;
  wasLate?: boolean;
}

export function PostReturnReviewSheet({
  visible,
  onClose,
  reviewedUserId,
  reviewedUserName,
  requestId,
  requestType = "BORROW",
  wasDisputed = false,
  wasLate = false,
}: PostReturnReviewSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const quickTags = TAGS_BY_TYPE[requestType] ?? TAGS_BY_TYPE.BORROW;
  const defaultTags = wasDisputed ? ["issue_reported"] : wasLate ? ["late_return"] : [];

  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>(defaultTags);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  const toggleTag = (key: string) =>
    setTags((prev) => (prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]));

  const mutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/users/${reviewedUserId}/reviews`, {
        rating,
        comment: note.trim() || undefined,
        transactionId: requestId,
        feedbackTags: tags,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    },
    onError: () => {},
  });

  const firstName = reviewedUserName.split(" ")[0] || reviewedUserName;
  const canSubmit = rating > 0;

  const typeLabel =
    requestType === "SWAP"
      ? "Swap complete"
      : requestType === "GIFT"
      ? "Gift complete"
      : requestType === "RENT"
      ? "Rental complete"
      : "Transaction complete";

  const heading = wasDisputed
    ? "How was this experience overall?"
    : `How was your experience with ${firstName}?`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={ss.backdrop} onPress={onClose} />
      <View
        style={[ss.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 }]}
      >
        <View style={[ss.handle, { backgroundColor: colors.border }]} />

        {/* Header */}
        <View style={{ alignItems: "center", gap: 4 }}>
          <Text
            style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1, color: colors.mutedForeground, textTransform: "uppercase" }}
          >
            {typeLabel}
          </Text>
          <Text style={{ fontSize: 17, fontFamily: "Inter_600SemiBold", color: colors.foreground, textAlign: "center" }}>
            {heading}
          </Text>
        </View>

        {/* Stars */}
        <View style={ss.starsRow}>
          {[1, 2, 3, 4, 5].map((s) => (
            <Pressable
              key={s}
              onPress={() => {
                setRating(s);
                if (!showNote) setShowNote(true);
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Text style={{ fontSize: 36, color: s <= rating ? "#f59e0b" : "#e5e7eb" }}>★</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
          <View style={{ gap: 14 }}>
            {/* Quick tags */}
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
                Select what applied
              </Text>
              <View style={ss.tagsWrap}>
                {quickTags.map((tag) => {
                  const active = tags.includes(tag.key);
                  return (
                    <Pressable
                      key={tag.key}
                      onPress={() => toggleTag(tag.key)}
                      style={[
                        ss.tag,
                        {
                          backgroundColor: active ? "#0d9488" : colors.background,
                          borderColor: active ? "#0d9488" : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: active ? "#fff" : colors.mutedForeground }}
                      >
                        {active ? "✓ " : ""}{tag.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Optional note */}
            {showNote && (
              <TextInput
                style={[ss.noteInput, { borderColor: colors.border, backgroundColor: colors.muted, color: colors.foreground }]}
                placeholder="Add a note (optional)"
                placeholderTextColor={colors.mutedForeground}
                value={note}
                onChangeText={setNote}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                maxLength={300}
              />
            )}
          </View>
        </ScrollView>

        {/* Actions */}
        <View style={{ gap: 8 }}>
          <Pressable
            style={[ss.submitBtn, { backgroundColor: "#0d9488", opacity: canSubmit ? 1 : 0.5 }]}
            onPress={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" }}>
                Submit review
              </Text>
            )}
          </Pressable>
          <Pressable onPress={onClose} style={{ paddingVertical: 6 }}>
            <Text
              style={{ color: colors.mutedForeground, fontSize: 13, textAlign: "center" }}
            >
              Skip
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const ss = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 16,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  starsRow: { flexDirection: "row", justifyContent: "center", gap: 8 },
  tagsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    minHeight: 72,
  },
  submitBtn: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});
