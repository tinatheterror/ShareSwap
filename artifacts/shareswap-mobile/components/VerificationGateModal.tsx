import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

/**
 * Mirrors the web's VerificationModal in verification-modal.tsx.
 * Shown when a BORROW or RENT request is blocked because the user is not
 * fully_verified (email + ID + payment required).
 *
 * `missing.idVerified` / `missing.paymentVerified` drive which steps are shown.
 */
interface Props {
  visible: boolean;
  onClose: () => void;
  missing?: {
    idVerified?: boolean;
    paymentVerified?: boolean;
  };
}

export function VerificationGateModal({ visible, onClose, missing }: Props) {
  const colors = useColors();
  const router = useRouter();

  const needsId = missing?.idVerified === false;
  const needsPayment = missing?.paymentVerified === false;

  function goVerify() {
    onClose();
    router.push("/verification" as never);
  }

  function goPayment() {
    onClose();
    router.push("/payment-methods" as never);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.card }]} onPress={() => {}}>
          {/* Icon */}
          <View style={[styles.iconWrap, { backgroundColor: colors.primary }]}>
            <Feather name="shield" size={28} color="#fff" />
          </View>

          {/* Heading */}
          <Text style={[styles.title, { color: colors.foreground }]}>
            To continue, please verify your profile.
          </Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            Verification helps keep the community safe and builds trust with neighbours.
          </Text>

          {/* Why verify */}
          <View style={[styles.infoBox, { backgroundColor: colors.muted ?? "#f9fafb" }]}>
            <View style={styles.infoRow}>
              <Feather name="shield" size={16} color={colors.primary} style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoTitle, { color: colors.foreground }]}>Why verify?</Text>
                <Text style={[styles.infoBullet, { color: colors.mutedForeground }]}>• Unlocks borrowing or renting items</Text>
                <Text style={[styles.infoBullet, { color: colors.mutedForeground }]}>• Lower trust deposits on borrows</Text>
                <Text style={[styles.infoBullet, { color: colors.mutedForeground }]}>• Priority in matching</Text>
              </View>
            </View>
          </View>

          {/* Missing steps */}
          {(needsId || needsPayment) && (
            <View style={styles.steps}>
              <Text style={[styles.stepsLabel, { color: colors.foreground }]}>Steps needed:</Text>

              {needsId && (
                <Pressable
                  style={({ pressed }) => [
                    styles.stepBtn,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
                  ]}
                  onPress={goVerify}
                >
                  <Feather name="credit-card" size={16} color="#fff" />
                  <Text style={styles.stepBtnText}>Verify identity (ID + selfie)</Text>
                  <Feather name="arrow-right" size={14} color="#fff" />
                </Pressable>
              )}

              {needsPayment && (
                <Pressable
                  style={({ pressed }) => [
                    styles.stepBtn,
                    { backgroundColor: "#0f766e", opacity: pressed ? 0.85 : 1 },
                  ]}
                  onPress={goPayment}
                >
                  <Feather name="credit-card" size={16} color="#fff" />
                  <Text style={styles.stepBtnText}>Add a payment method</Text>
                  <Feather name="arrow-right" size={14} color="#fff" />
                </Pressable>
              )}
            </View>
          )}

          {/* Fallback: just go to verification */}
          {!needsId && !needsPayment && (
            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={goVerify}
            >
              <Text style={styles.primaryBtnText}>Verify now</Text>
            </Pressable>
          )}

          {/* Not now */}
          <Pressable
            style={({ pressed }) => [styles.cancelBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            onPress={onClose}
          >
            <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>Not now</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  sheet: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 14,
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  title: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    lineHeight: 24,
  },
  sub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 19,
    marginTop: -4,
  },
  infoBox: {
    width: "100%",
    borderRadius: 12,
    padding: 14,
  },
  infoRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  infoTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 6,
  },
  infoBullet: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  steps: {
    width: "100%",
    gap: 8,
  },
  stepsLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  stepBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  stepBtnText: {
    flex: 1,
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  primaryBtn: {
    width: "100%",
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  cancelBtn: {
    width: "100%",
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -4,
  },
  cancelBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
});
