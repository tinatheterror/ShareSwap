import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useState } from "react";
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
import { LAST_AUTH_METHOD_KEY } from "@/context/AuthContext";

export default function LoginScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { login, refetchUser } = useAuth();
  const params = useLocalSearchParams<{ session_expired?: string }>();

  const sessionExpired = params.session_expired === "1";

  const [showEmailForm, setShowEmailForm] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  const [referralCode, setReferralCode] = useState("");
  const [lastAuthMethod, setLastAuthMethod] = useState<"google" | "email" | null>(null);

  // Read the previously used sign-in method so we can highlight it.
  useEffect(() => {
    AsyncStorage.getItem(LAST_AUTH_METHOD_KEY)
      .then((val) => {
        if (val === "google" || val === "email") setLastAuthMethod(val);
      })
      .catch(() => {});
  }, []);

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

  async function handleGoogleLogin() {
    if (Platform.OS === "web") {
      window.location.href = `${BASE_URL}/api/auth/google`;
    } else {
      const redirectUri = Linking.createURL("/");
      const googleUrl = `${BASE_URL}/api/auth/google?platform=native&redirect_uri=${encodeURIComponent(redirectUri)}`;
      setLoading(true);
      try {
        const result = await WebBrowser.openAuthSessionAsync(googleUrl, redirectUri);
        if (result.type === "success") {
          await AsyncStorage.setItem(LAST_AUTH_METHOD_KEY, "google");
          await refetchUser();
          router.replace("/(tabs)");
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Google sign-in failed.";
        Alert.alert("Sign-in failed", msg);
      } finally {
        setLoading(false);
      }
    }
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
          {sessionExpired && (
            <View style={[styles.sessionBanner, { backgroundColor: "#fff7ed", borderColor: "#fdba74" }]}>
              <Feather name="clock" size={15} color="#ea580c" />
              <Text style={styles.sessionBannerText}>
                Your session expired — please sign in again.
              </Text>
            </View>
          )}

          <Text style={[styles.heading, { color: colors.foreground }]}>
            Sign in and discover a world of shared resources
          </Text>

          <Pressable
            style={({ pressed }) => [
              styles.googleBtn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 },
              lastAuthMethod === "google" && styles.googleBtnHighlighted,
            ]}
            onPress={handleGoogleLogin}
          >
            <Text style={[styles.googleBtnText, { color: colors.primaryForeground }]}>
              Continue with Google
            </Text>
            {lastAuthMethod === "google" && (
              <View style={styles.lastUsedBadge}>
                <Text style={styles.lastUsedBadgeText}>Last used</Text>
              </View>
            )}
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
                  placeholder="Email"
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
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.signInBtnText, { color: colors.primaryForeground }]}>Sign In</Text>
                )}
              </Pressable>

              <Pressable
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, alignSelf: "center" }]}
                onPress={() => router.push("/forgot-password" as never)}
                hitSlop={8}
              >
                <Text style={[styles.forgotLink, { color: colors.mutedForeground }]}>
                  Forgot password?
                </Text>
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

          <Pressable onPress={() => router.push("/register" as never)}>
            <Text style={[styles.referralLink, { color: colors.mutedForeground, textAlign: "center" }]}>
              New to ShareSwap?{" "}
              <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}>
                Create an account
              </Text>
            </Text>
          </Pressable>

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
    lineHeight: 28,
    marginBottom: 4,
  },
  sessionBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sessionBannerText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#ea580c",
    flex: 1,
  },
  googleBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  googleBtnHighlighted: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  googleBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  lastUsedBadge: {
    backgroundColor: "rgba(255,255,255,0.25)",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  lastUsedBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
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
  forgotLink: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textDecorationLine: "underline",
    textAlign: "center",
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
