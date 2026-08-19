import { Feather } from "@expo/vector-icons";
import React, { useState, useEffect } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { fmtDate as fmtDateUtil } from "@/lib/dateUtils";

const PRIMARY = "#0DCEA1";

interface Props {
  visible: boolean;
  onClose: () => void;
  onRequest: (days: 1 | 2 | 3) => void;
  isPending: boolean;
  currentEndDate: string | null;
  itemName: string;
  ownerAlreadyNotifiedOfDelay?: boolean;
}

export default function ExtensionSheet({
  visible,
  onClose,
  onRequest,
  isPending,
  currentEndDate,
  itemName,
  ownerAlreadyNotifiedOfDelay = false,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState<1 | 2 | 3 | null>(null);

  // Reset selection when sheet opens
  useEffect(() => {
    if (visible) setDays(null);
  }, [visible]);

  const newEndDate =
    days && currentEndDate
      ? new Date(
          new Date(currentEndDate).getTime() + days * 86_400_000
        ).toISOString()
      : null;

  function handleClose() {
    setDays(null);
    onClose();
  }

  function handleSubmit() {
    if (!days) return;
    onRequest(days);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose} />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.card,
            paddingBottom: insets.bottom + 16,
            borderTopColor: colors.border,
          },
        ]}
      >
        {/* Handle */}
        <View style={[styles.handle, { backgroundColor: colors.border }]} />

        <Text style={[styles.title, { color: colors.foreground }]}>
          Need a bit more time?
        </Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          Short extensions help with small delays. For a longer period, start a
          new borrow.
        </Text>

        {ownerAlreadyNotifiedOfDelay && (
          <View style={styles.notice}>
            <Feather name="info" size={14} color="#92400e" />
            <Text style={styles.noticeText}>
              Your request will note that the owner has already been notified you may be running late.
            </Text>
          </View>
        )}

        {/* Current end date */}
        {currentEndDate && (
          <View
            style={[
              styles.dateRow,
              {
                backgroundColor: colors.muted,
                borderColor: colors.border,
              },
            ]}
          >
            <Feather name="clock" size={13} color={colors.mutedForeground} />
            <Text style={[styles.dateLabel, { color: colors.mutedForeground }]}>
              Current return date:{" "}
            </Text>
            <Text
              style={[styles.dateValue, { color: colors.foreground }]}
            >
              {fmtDateUtil(currentEndDate)}
            </Text>
          </View>
        )}

        {/* Day picker */}
        <View style={styles.dayRow}>
          {([1, 2, 3] as const).map((d) => {
            const selected = days === d;
            return (
              <Pressable
                key={d}
                onPress={() => setDays(d)}
                style={[
                  styles.dayBtn,
                  {
                    borderColor: selected ? PRIMARY : colors.border,
                    backgroundColor: selected
                      ? PRIMARY + "18"
                      : colors.background,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.dayNum,
                    { color: selected ? PRIMARY : colors.foreground },
                  ]}
                >
                  +{d}
                </Text>
                <Text
                  style={[
                    styles.dayLabel,
                    { color: selected ? PRIMARY : colors.mutedForeground },
                  ]}
                >
                  {d === 1 ? "day" : "days"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* New end date preview */}
        {newEndDate && (
          <Text style={[styles.newDate, { color: colors.mutedForeground }]}>
            New return date:{" "}
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_600SemiBold",
              }}
            >
              {fmtDateUtil(newEndDate)}
            </Text>
          </Text>
        )}

        {/* Submit */}
        <Pressable
          style={[
            styles.submitBtn,
            {
              backgroundColor: days ? PRIMARY : colors.muted,
              opacity: isPending ? 0.7 : 1,
            },
          ]}
          onPress={handleSubmit}
          disabled={!days || isPending}
        >
          {isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.submitLabel}>Request extension</Text>
          )}
        </Pressable>

        {/* Cancel */}
        <Pressable style={styles.cancelBtn} onPress={handleClose}>
          <Text style={[styles.cancelLabel, { color: colors.mutedForeground }]}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 14,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  sub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
  },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fcd34d",
    backgroundColor: "#fffbeb",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noticeText: {
    flex: 1,
    color: "#92400e",
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dateLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  dateValue: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  dayRow: {
    flexDirection: "row",
    gap: 10,
  },
  dayBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    gap: 2,
  },
  dayNum: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  dayLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  newDate: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  submitBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  submitLabel: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  cancelBtn: {
    alignItems: "center",
    paddingVertical: 4,
  },
  cancelLabel: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
});
