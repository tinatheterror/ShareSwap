import React from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { CancelDialogSpec } from "@workspace/api-client-react/cancel-flow";
import { useColors } from "@/hooks/useColors";

/**
 * The one cancel dialog on mobile (and mobile web). It draws whatever CancelDialogSpec it is given:
 * the BORROW/RENT penalty modal ("Proceed to cancel" / "Keep booking", the second being
 * the default action) and the old confirmations SWAP and GIFT still use.
 *
 * It is a real Modal with its own buttons: Alert.alert with buttons does nothing on react-native-web,
 * and window.confirm cannot label buttons.
 */
export function CancelDialog({
  spec,
  pending,
  onConfirm,
  onKeep,
}: {
  spec: CancelDialogSpec | null;
  pending: boolean;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const colors = useColors();
  const keepIsPrimary = spec?.primary === "keep";

  return (
    <Modal visible={!!spec} transparent animationType="fade" onRequestClose={() => { if (!pending) onKeep(); }} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={() => { if (!pending) onKeep(); }} accessibilityLabel="Close" />
      <View style={s.centered} pointerEvents="box-none">
        <View style={[s.card, { backgroundColor: colors.card }]} testID="cancel-dialog">
          <Text style={[s.title, { color: colors.foreground }]} accessibilityRole="header">{spec?.title}</Text>
          {spec?.message ? <Text style={[s.message, { color: colors.foreground }]}>{spec.message}</Text> : null}
          {spec?.hint ? <Text style={[s.hint, { color: colors.mutedForeground }]} testID="cancel-dialog-hint">{spec.hint}</Text> : null}

          <Pressable
            testID="cancel-dialog-keep"
            accessibilityRole="button"
            onPress={onKeep}
            disabled={pending}
            style={[s.button, keepIsPrimary ? s.primaryButton : [s.secondaryButton, { borderColor: colors.border }]]}
          >
            <Text style={[s.buttonLabel, { color: keepIsPrimary ? "#fff" : colors.foreground }]}>{spec?.keepLabel}</Text>
          </Pressable>
          <Pressable
            testID="cancel-dialog-confirm"
            accessibilityRole="button"
            onPress={onConfirm}
            disabled={pending}
            style={[s.button, keepIsPrimary ? [s.secondaryButton, { borderColor: colors.border }] : s.destructiveButton]}
          >
            {pending
              ? <ActivityIndicator size="small" color={keepIsPrimary ? "#b91c1c" : "#fff"} />
              : <Text style={[s.buttonLabel, { color: keepIsPrimary ? "#b91c1c" : "#fff" }]}>{spec?.confirmLabel}</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  card: { width: "100%", maxWidth: 380, borderRadius: 16, padding: 20, gap: 10 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", fontWeight: "700" },
  message: { fontSize: 15, lineHeight: 21 },
  hint: { fontSize: 13, lineHeight: 18 },
  button: { minHeight: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  primaryButton: { backgroundColor: "#0DCEA1" },
  secondaryButton: { borderWidth: 1, backgroundColor: "transparent" },
  destructiveButton: { backgroundColor: "#dc2626" },
  buttonLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
});
