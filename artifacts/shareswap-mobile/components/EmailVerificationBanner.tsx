import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

/**
 * Mirrors the web's EmailVerificationBanner in navbar.tsx.
 * Shows only when emailVerified is false and authProvider is not 'google'.
 * Tapping "Resend" calls POST /api/auth/resend-verification.
 */
export function EmailVerificationBanner() {
  const { user, resendVerification } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const [resending, setResending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);

  if (!user || user.emailVerified || user.authProvider === "google") return null;

  async function handleResend() {
    if (resending || sent) return;
    setResending(true);
    setError(false);
    try {
      await resendVerification();
      setSent(true);
    } catch {
      setError(true);
    } finally {
      setResending(false);
    }
  }

  return (
    <View style={[styles.banner, { backgroundColor: "#fffbeb", borderBottomColor: "#fde68a" }]}>
      <Feather name="mail" size={14} color="#d97706" style={styles.icon} />
      <Text style={styles.message} numberOfLines={2}>
        {sent
          ? "Verification email sent! Check your inbox."
          : error
          ? "Failed to send. Please try again."
          : "Please verify your email to access all features."}
      </Text>
      {!sent && (
        <Pressable
          onPress={handleResend}
          disabled={resending}
          hitSlop={8}
          style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.7 : 1 }]}
        >
          {resending ? (
            <ActivityIndicator size="small" color="#d97706" />
          ) : (
            <Text style={[styles.btnText, { color: colors.primary }]}>Resend</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  icon: {
    marginRight: 8,
    flexShrink: 0,
  },
  message: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#92400e",
    lineHeight: 16,
  },
  btn: {
    marginLeft: 10,
    minWidth: 52,
    alignItems: "center",
  },
  btnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
});
