import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

const RESEND_COOLDOWN = 30; // seconds

export default function VerifyEmailPromptScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, resendVerification, refetchUser } = useAuth();

  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // If the user verifies (e.g. clicks link in email and returns to app),
  // automatically navigate to tabs.
  useEffect(() => {
    if (user?.emailVerified) {
      router.replace("/(tabs)");
    }
  }, [user?.emailVerified]);

  // Poll for verification status whenever app comes to foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") refetchUser();
    });
    return () => sub.remove();
  }, [refetchUser]);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN);
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  async function handleResend() {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setSentMessage(null);
    setErrorMessage(null);
    try {
      await resendVerification();
      setSentMessage("Verification email sent! Check your inbox (and spam folder).");
      startCooldown();
    } catch {
      setErrorMessage("Failed to send. Please try again.");
    } finally {
      setResending(false);
    }
  }

  function handleContinue() {
    router.replace("/(tabs)");
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      {/* Icon */}
      <View style={[styles.iconWrap, { backgroundColor: colors.primary + "18" }]}>
        <Feather name="mail" size={36} color={colors.primary} />
      </View>

      {/* Heading */}
      <Text style={[styles.heading, { color: colors.foreground }]}>Check your email</Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        We sent a verification link to
      </Text>
      <Text style={[styles.email, { color: colors.foreground }]} numberOfLines={1}>
        {user?.email ?? "your email address"}
      </Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        Click the link in that email to verify your account. Once verified, you'll be able to borrow and rent items from neighbours.
      </Text>

      {/* Status messages */}
      {sentMessage && (
        <View style={[styles.messageBanner, { backgroundColor: "#dcfce7", borderColor: "#bbf7d0" }]}>
          <Feather name="check-circle" size={14} color="#16a34a" />
          <Text style={[styles.messageText, { color: "#15803d" }]}>{sentMessage}</Text>
        </View>
      )}
      {errorMessage && (
        <View style={[styles.messageBanner, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
          <Feather name="alert-circle" size={14} color="#dc2626" />
          <Text style={[styles.messageText, { color: "#b91c1c" }]}>{errorMessage}</Text>
        </View>
      )}

      {/* Resend button */}
      <Pressable
        style={({ pressed }) => [
          styles.resendBtn,
          {
            backgroundColor: cooldown > 0 ? colors.muted : colors.primary,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
        onPress={handleResend}
        disabled={cooldown > 0 || resending}
      >
        {resending ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.resendBtnText}>
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend verification email"}
          </Text>
        )}
      </Pressable>

      {/* Continue link */}
      <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]} onPress={handleContinue}>
        <Text style={[styles.continueLink, { color: colors.mutedForeground }]}>
          Continue to app →
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 28,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 32,
    marginBottom: 24,
  },
  heading: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
    marginBottom: 8,
    textAlign: "center",
  },
  sub: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  email: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginTop: 2,
    marginBottom: 16,
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 24,
  },
  messageBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
    width: "100%",
  },
  messageText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 18,
  },
  resendBtn: {
    width: "100%",
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  resendBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  continueLink: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
});
