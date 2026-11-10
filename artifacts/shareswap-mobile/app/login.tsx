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
import { BASE_URL, apiRequest } from "@/lib/api";
import { LAST_AUTH_METHOD_KEY } from "@/context/AuthContext";
import { registerPushToken } from "@/hooks/usePushNotifications";
import { resumeDestination } from "@/lib/sessionNavigation";
import { ApiEnvironmentLabel } from "@/components/ApiEnvironmentLabel";
import { AppleSignInButton } from "@/components/AppleSignInButton";
import { GoogleLogo } from "@/components/ProviderLogos";
import { AppleSignInCancelled, appleSignInAvailable, requestAppleCredential } from "@/lib/appleSignIn";
import { parseAppleRedirect, parseGoogleRedirect } from "@/lib/appleRedirect";

export default function LoginScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, login, setUserData } = useAuth();
  const params = useLocalSearchParams<{ session_expired?: string; returnTo?: string; returnUserId?: string }>();

  useEffect(() => {
    if (user) router.replace(resumeDestination(params.returnTo, params.returnUserId, user.id) as never);
  }, [user, router, params.returnTo, params.returnUserId]);

  const sessionExpired = params.session_expired === "1";

  const [showEmailForm, setShowEmailForm] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  const [referralCode, setReferralCode] = useState("");
  const [lastAuthMethod, setLastAuthMethod] = useState<"google" | "apple" | "email" | null>(null);
  // Sign in with Apple: Apple's sheet on iOS (when the device supports it); the browser redirect flow on Android and the web.
  const [appleAvailable, setAppleAvailable] = useState(Platform.OS !== "ios");

  // Read the previously used sign-in method so we can highlight it.
  useEffect(() => {
    AsyncStorage.getItem(LAST_AUTH_METHOD_KEY)
      .then((val) => {
        if (val === "google" || val === "apple" || val === "email") setLastAuthMethod(val);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    appleSignInAvailable().then((ok) => {
      if (active && ok) setAppleAvailable(true);
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleLogin() {
    if (!username.trim() || !password.trim()) {
      setLoginError("Please enter your email and password.");
      return;
    }
    setLoginError("");
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Login failed. Please try again.";
      setLoginError(msg);
    } finally {
      setLoading(false);
    }
  }

  /** Apple (or Google) confirmed an account that is deactivated: ask, then redeem the token to bring it back. */
  async function offerReactivation(token: string): Promise<boolean> {
    const confirmed = await new Promise<boolean>((resolve) =>
      Alert.alert(
        "Account deactivated",
        "Your account is deactivated and your listings are hidden. Reactivate it now?",
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Reactivate", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      ),
    );
    if (!confirmed) return false;
    const resp = await apiRequest("POST", "/api/auth/oauth-reactivate", { token });
    const reactivated = await resp.json();
    if (!reactivated?.user?.id) throw new Error("Unable to reactivate your account. Please try again.");
    setUserData(reactivated.user);
    return true;
  }

  async function handleAppleLogin() {
    if (Platform.OS === "web") {
      window.location.href = `${BASE_URL}/api/auth/apple/start`;
      return;
    }
    setLoading(true);
    try {
      let signedIn: boolean;
      if (Platform.OS === "ios") {
        const payload = await requestAppleCredential();
        const resp = await apiRequest("POST", "/api/auth/apple/native", payload);
        const body = await resp.json();
        if (body?.reactivate && typeof body.token === "string") {
          signedIn = await offerReactivation(body.token);
        } else if (body?.id) {
          setUserData(body);
          signedIn = true;
        } else {
          throw new Error("Unable to verify your sign-in. Please try again.");
        }
      } else {
        // Android has no native Apple sheet: the server's redirect flow runs in the system browser and returns here.
        const redirectUri = Linking.createURL("/");
        const ref = referralCode.trim() ? `&ref=${encodeURIComponent(referralCode.trim())}` : "";
        const startUrl = `${BASE_URL}/api/auth/apple/start?platform=native&redirect_uri=${encodeURIComponent(redirectUri)}${ref}`;
        const result = await WebBrowser.openAuthSessionAsync(startUrl, redirectUri);
        if (result.type !== "success") return;
        const outcome = parseAppleRedirect(result.url);
        if (outcome.kind === "cancelled") return;
        if (outcome.kind === "error") throw new Error(outcome.message);
        if (outcome.kind === "reactivate") {
          signedIn = await offerReactivation(outcome.token);
        } else {
          const resp = await apiRequest("POST", "/api/auth/exchange-token", { token: outcome.token });
          const userData = await resp.json();
          if (!userData?.id) throw new Error("Unable to verify your sign-in. Please try again.");
          setUserData(userData);
          signedIn = true;
        }
      }
      if (!signedIn) return;
      await AsyncStorage.setItem(LAST_AUTH_METHOD_KEY, "apple");
      registerPushToken().catch(() => {});
    } catch (err: unknown) {
      if (err instanceof AppleSignInCancelled) return;
      const msg = err instanceof Error ? err.message : "Apple sign-in failed.";
      Alert.alert("Sign-in failed", msg);
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
          // The server encodes a one-time token in the deep-link URL because
          // the OAuth session cookie lives in the in-app browser's isolated
          // cookie jar and never reaches the native app's fetch credential
          // store.  We extract the token and exchange it via a normal fetch
          // call so the session cookie is set in the right jar.
          const url = result.url;
          const redirect = parseGoogleRedirect(url);
          if (redirect.reactivate && redirect.token) {
            // Google confirmed the account, but it is deactivated: offer to bring it back.
            const reactivateToken = redirect.token;
            const confirmed = await new Promise<boolean>((resolve) =>
              Alert.alert(
                "Account deactivated",
                "Your account is deactivated and your listings are hidden. Reactivate it now?",
                [
                  { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                  { text: "Reactivate", onPress: () => resolve(true) },
                ],
                { cancelable: true, onDismiss: () => resolve(false) },
              ),
            );
            if (!confirmed) return;
            const resp = await apiRequest("POST", "/api/auth/google-reactivate", { token: reactivateToken });
            const reactivated = await resp.json();
            if (!reactivated?.user?.id) throw new Error("Unable to reactivate your account. Please try again.");
            setUserData(reactivated.user);
          } else if (redirect.token) {
            // Exchange the one-time token for a session cookie via a regular
            // native fetch call. The response body is the user object — we set
            // it directly so the app knows the user is logged in before
            // navigating (avoids a race where refetchUser sees 401 while the
            // cookie is still propagating through the native cookie jar).
            const resp = await apiRequest("POST", "/api/auth/exchange-token", {
              token: redirect.token,
            });
            const userData = await resp.json();
            if (userData?.id) {
              setUserData(userData);
            } else {
              throw new Error("Unable to verify your sign-in. Please try again.");
            }
          } else {
            throw new Error("Unable to verify your sign-in. Please try again.");
          }
          await AsyncStorage.setItem(LAST_AUTH_METHOD_KEY, "google");
          // Register push token after Google OAuth — mirrors what login() and
          // register() do so no auth path is left uncovered.
          registerPushToken().catch(() => {});
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Google sign-in failed.";
        Alert.alert("Sign-in failed", msg);
      } finally {
        setLoading(false);
      }
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

        <ApiEnvironmentLabel />

        <View style={styles.card}>
          {sessionExpired && (
            <View style={[styles.sessionBanner, { backgroundColor: "#fff7ed", borderColor: "#fdba74" }]}>
              <Feather name="clock" size={15} color="#ea580c" />
              <Text style={styles.sessionBannerText}>
                Your session expired — please sign in again.
              </Text>
            </View>
          )}

          <Text style={[styles.heading, { color: colors.primaryForeground }]}>
            Sign in and discover a world of shared resources
          </Text>

          {appleAvailable && (
            <View style={styles.appleRow}>
              <AppleSignInButton onPress={handleAppleLogin} disabled={loading} />
              {lastAuthMethod === "apple" && (
                <View pointerEvents="none" style={[styles.lastUsedBadge, styles.appleBadge]}>
                  <Text style={styles.lastUsedBadgeText}>Last used</Text>
                </View>
              )}
            </View>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.googleBtn,
              { backgroundColor: "#ffffff", opacity: pressed ? 0.88 : 1 },
              lastAuthMethod === "google" && styles.googleBtnHighlighted,
            ]}
            onPress={handleGoogleLogin}
          >
            <GoogleLogo size={20} />
            <Text style={[styles.googleBtnText, { color: "#000000" }]}>
              Continue with Google
            </Text>
            {lastAuthMethod === "google" && (
              <View style={styles.lastUsedBadge}>
                <Text style={styles.lastUsedBadgeText}>Last used</Text>
              </View>
            )}
          </Pressable>

          {!showEmailForm ? (
            <Pressable onPress={() => setShowEmailForm(true)}>
              <Text style={[styles.emailLink, { color: colors.primaryForeground }]}>
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
                  onChangeText={(value) => { setUsername(value); setLoginError(""); }}
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
                  onChangeText={(value) => { setPassword(value); setLoginError(""); }}
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
              {!!loginError && (
                <Text accessibilityRole="alert" style={styles.loginError}>
                  {loginError}
                </Text>
              )}
              <Pressable
                style={({ pressed }) => [
                  styles.signInBtn,
                  { backgroundColor: colors.primaryForeground, opacity: pressed || loading ? 0.85 : 1 },
                ]}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={[styles.signInBtnText, { color: "#ffffff" }]}>Sign In</Text>
                )}
              </Pressable>

              <Pressable
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, alignSelf: "center" }]}
                onPress={() => router.push("/forgot-password" as never)}
                hitSlop={8}
              >
                <Text style={[styles.forgotLink, { color: colors.primaryForeground }]}>
                  Forgot password?
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, alignSelf: "center" }]}
                onPress={() => router.push("/register" as never)}
                hitSlop={8}
              >
                <Text style={[styles.forgotLink, { color: colors.primaryForeground, fontFamily: "Inter_700Bold" }]}>
                  New to ShareSwap? Create an account
                </Text>
              </Pressable>
            </View>
          )}

          <View style={[styles.divider, { backgroundColor: "rgba(0,35,25,0.25)" }]} />

          <Pressable
            style={styles.referralRow}
            onPress={() => setShowReferral((v) => !v)}
          >
            <Feather name="user" size={16} color={colors.primaryForeground} />
            <Text style={[styles.referralLink, { color: colors.primaryForeground }]}>
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

          <View style={styles.trustRow}>
            <Feather name="lock" size={15} color={colors.primaryForeground} style={{ marginTop: 2.5 }} />
            <Text style={[styles.trustText, { color: colors.primaryForeground }]}>
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
    backgroundColor: "#0DCEA1",
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
  appleRow: { marginBottom: 12, width: "100%" },
  appleBadge: { position: "absolute", right: 12, top: 14 },
  googleBtn: {
    borderWidth: 1,
    borderColor: "#000000",
    borderRadius: 12,
    height: 48,
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
    backgroundColor: "#0DCEA1",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  lastUsedBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: "#002319",
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
  loginError: {
    color: "#b91c1c",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
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
    alignItems: "flex-start",
    gap: 8,
  },
  trustText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
});
