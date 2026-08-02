import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiPost } from "@/lib/api";

export default function ResetPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Token may arrive via deep link query param
  const params = useLocalSearchParams<{ token?: string }>();

  const [token, setToken] = useState(params.token ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReset() {
    setError(null);
    if (!token.trim()) { setError("Please enter the reset token from your email."); return; }
    if (newPassword.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match."); return; }

    setLoading(true);
    try {
      await apiPost("/api/auth/reset-password", {
        token: token.trim(),
        newPassword,
      });
      setDone(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not reset password. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#f1f5f9" }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Back */}
        <Pressable
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
          <Text style={[styles.backText, { color: colors.foreground }]}>Back</Text>
        </Pressable>

        <View style={styles.card}>
          {!done ? (
            <>
              <View style={[styles.iconWrap, { backgroundColor: colors.primary + "18" }]}>
                <Feather name="key" size={30} color={colors.primary} />
              </View>

              <Text style={[styles.heading, { color: colors.foreground }]}>Set new password</Text>
              <Text style={[styles.sub, { color: colors.mutedForeground }]}>
                Enter the token from your reset email and choose a new password.
              </Text>

              {error && (
                <View style={[styles.errorBox, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
                  <Feather name="alert-circle" size={14} color="#dc2626" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              {/* Reset token */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.label, { color: colors.foreground }]}>Reset token</Text>
                <View style={[styles.inputWrapper, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <Feather name="hash" size={15} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    placeholder="Paste token from email"
                    placeholderTextColor={colors.mutedForeground}
                    value={token}
                    onChangeText={setToken}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                  />
                </View>
              </View>

              {/* New password */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.label, { color: colors.foreground }]}>New password</Text>
                <View style={[styles.inputWrapper, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <Feather name="lock" size={15} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    placeholder="At least 8 characters"
                    placeholderTextColor={colors.mutedForeground}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showNew}
                    returnKeyType="next"
                  />
                  <Pressable onPress={() => setShowNew((v) => !v)} hitSlop={8}>
                    <Feather name={showNew ? "eye-off" : "eye"} size={15} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              </View>

              {/* Confirm password */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.label, { color: colors.foreground }]}>Confirm new password</Text>
                <View style={[styles.inputWrapper, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <Feather name="lock" size={15} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    placeholder="Re-enter new password"
                    placeholderTextColor={colors.mutedForeground}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!showConfirm}
                    returnKeyType="done"
                    onSubmitEditing={handleReset}
                  />
                  <Pressable onPress={() => setShowConfirm((v) => !v)} hitSlop={8}>
                    <Feather name={showConfirm ? "eye-off" : "eye"} size={15} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.submitBtn,
                  { backgroundColor: colors.primary, opacity: pressed || loading ? 0.85 : 1 },
                ]}
                onPress={handleReset}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>Reset password</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <View style={[styles.successIcon, { backgroundColor: "#dcfce7" }]}>
                <Feather name="check-circle" size={32} color="#16a34a" />
              </View>
              <Text style={[styles.heading, { color: colors.foreground }]}>Password reset!</Text>
              <Text style={[styles.sub, { color: colors.mutedForeground }]}>
                Your password has been updated. Sign in with your new password.
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.submitBtn,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
                ]}
                onPress={() => router.replace("/login" as never)}
              >
                <Text style={styles.submitBtnText}>Sign in</Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    gap: 20,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  backText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  card: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 28,
    gap: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  heading: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    letterSpacing: -0.3,
  },
  sub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 21,
    color: "#64748b",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    width: "100%",
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#b91c1c",
    lineHeight: 18,
  },
  fieldGroup: {
    width: "100%",
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  submitBtn: {
    width: "100%",
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
