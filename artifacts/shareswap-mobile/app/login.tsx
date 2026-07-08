import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { BASE_URL } from "@/lib/api";

export default function LoginScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();

  const [showEmailForm, setShowEmailForm] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  const [referralCode, setReferralCode] = useState("");

  async function handleLogin() {
    if (!username.trim() || !password.trim()) {
      Alert.alert("Missing fields", "Please enter your username and password.");
      return;
    }
    setLoading(true);
    try {
      await login(username.trim(), password);
      router.replace("/(tabs)");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Login failed. Please try again.";
      Alert.alert("Login failed", msg);
    } finally {
      setLoading(false);
    }
  }

  function handleGoogleLogin() {
    const googleUrl = `${BASE_URL}/api/auth/google`;
    Alert.alert(
      "Continue with Google",
      "Google sign-in opens a browser window. Tap OK to continue.",
      [{ text: "Cancel", style: "cancel" }, { text: "OK" }],
    );
  }

  function handlePhone() {
    Alert.alert(
      "Phone sign-in",
      "Phone number sign-in is coming soon. Please use email or Google.",
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#f1f5f9" }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Image
          source={require("@/assets/images/shareswap-full-logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />

        <View style={styles.card}>
          <Text style={styles.heading}>
            Sign in and discover a world of shared resources
          </Text>

          <Pressable
            style={({ pressed }) => [
              styles.googleBtn,
              { opacity: pressed ? 0.88 : 1 },
            ]}
            onPress={handleGoogleLogin}
          >
            <Text style={styles.googleBtnText}>Continue with Google</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.phoneBtn,
              { borderColor: colors.border, opacity: pressed ? 0.75 : 1 },
            ]}
            onPress={handlePhone}
          >
            <Text
              style={[styles.phoneBtnText, { color: colors.foreground }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              Continue with Phone Number
            </Text>
          </Pressable>

          {!showEmailForm ? (
            <Pressable onPress={() => setShowEmailForm(true)}>
              <Text style={[styles.emailLink, { color: colors.foreground }]}>
                Continue with Email
              </Text>
            </Pressable>
          ) : (
            <View style={styles.emailForm}>
              <View
                style={[
                  styles.inputWrapper,
                  { backgroundColor: colors.muted, borderColor: colors.border },
                ]}
              >
                <Feather name="user" size={15} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.input, { color: colors.foreground }]}
                  placeholder="Username or email"
                  placeholderTextColor={colors.mutedForeground}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                />
              </View>
              <View
                style={[
                  styles.inputWrapper,
                  { backgroundColor: colors.muted, borderColor: colors.border },
                ]}
              >
                <Feather name="lock" size={15} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.input, { color: colors.foreground }]}
                  placeholder="Password"
                  placeholderTextColor={colors.mutedForeground}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <Pressable onPress={() => setShowPassword((v) => !v)}>
                  <Feather
                    name={showPassword ? "eye-off" : "eye"}
                    size={15}
                    color={colors.mutedForeground}
                  />
                </Pressable>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.signInBtn,
                  { backgroundColor: colors.primary, opacity: pressed || loading ? 0.85 : 1 },
                ]}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.signInBtnText}>Sign In</Text>
                )}
              </Pressable>
            </View>
          )}

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <Pressable
            style={styles.referralRow}
            onPress={() => setShowReferral((v) => !v)}
          >
            <Feather name="user" size={16} color={colors.mutedForeground} />
            <Text style={[styles.referralLink, { color: colors.mutedForeground }]}>
              Have a referral code?
            </Text>
          </Pressable>

          {showReferral && (
            <View
              style={[
                styles.inputWrapper,
                { backgroundColor: colors.muted, borderColor: colors.border, marginTop: -4 },
              ]}
            >
              <Feather name="tag" size={15} color={colors.mutedForeground} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Enter referral code"
                placeholderTextColor={colors.mutedForeground}
                value={referralCode}
                onChangeText={setReferralCode}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>
          )}

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.trustRow}>
            <Feather name="lock" size={15} color={colors.primary} />
            <Text style={[styles.trustText, { color: colors.primary }]}>
              Your identity helps keep ShareSwap safe and honest.
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 24,
  },
  logo: {
    width: 240,
    height: 60,
  },
  card: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  heading: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    color: "#0f172a",
    lineHeight: 28,
    marginBottom: 4,
  },
  googleBtn: {
    backgroundColor: "#0DCEA1",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  googleBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  phoneBtn: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 15,
    paddingHorizontal: 12,
    alignItems: "center",
    backgroundColor: "transparent",
  },
  phoneBtnText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  emailLink: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    textDecorationLine: "underline",
  },
  emailForm: {
    gap: 10,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  signInBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 2,
  },
  signInBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  divider: {
    height: 1,
    width: "100%",
  },
  referralRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  referralLink: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textDecorationLine: "underline",
  },
  trustRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  trustText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
});
