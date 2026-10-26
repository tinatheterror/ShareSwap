import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  acceptPushPrePrompt,
  dismissPushPrePrompt,
  subscribePushPrePrompt,
} from "@/hooks/usePushNotifications";
import { useColors } from "@/hooks/useColors";

/** Explains why we ask for notifications, before the system permission prompt. */
export function PushPrePrompt() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  useEffect(() => subscribePushPrePrompt(setVisible), []);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={dismissPushPrePrompt}>
      <View
        testID="push-pre-prompt"
        style={[
          styles.container,
          { backgroundColor: colors.background, paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 },
        ]}
      >
        <View style={styles.body}>
          <View style={[styles.iconCircle, { backgroundColor: colors.muted }]}>
            <Feather name="bell" size={36} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>Stay in the loop</Text>
          <Text style={[styles.text, { color: colors.mutedForeground }]}>
            ShareSwap sends notifications when someone messages you, answers a borrow request, or when an
            item is due back, so nothing gets missed.
          </Text>
          <Text style={[styles.text, { color: colors.mutedForeground }]}>
            You can change this any time in your phone's settings.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
          onPress={acceptPushPrePrompt}
        >
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Turn on notifications</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.secondaryBtn} onPress={dismissPushPrePrompt}>
          <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Not now</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  body: { flex: 1, alignItems: "center", gap: 16 },
  iconCircle: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", textAlign: "center" },
  text: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  primaryBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  primaryBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  secondaryBtn: { paddingVertical: 14, alignItems: "center" },
  secondaryBtnText: { fontSize: 15, fontFamily: "Inter_500Medium" },
});
