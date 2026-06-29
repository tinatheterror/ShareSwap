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

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
    Alert.alert(
      "Google Sign-In",
      "Google sign-in is available via the web app. Please use the mobile login above.",
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoContainer}>
          <Image
            source={require("@/assets/images/shareswap-full-logo.png")}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
            Borrow, lend, swap & gift with your neighbours
          </Text>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            Sign in
          </Text>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              Username or Email
            </Text>
            <View
              style={[
                styles.inputWrapper,
                {
                  backgroundColor: colors.muted,
                  borderColor: colors.border,
                },
              ]}
            >
              <Feather name="user" size={16} color={colors.mutedForeground} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Enter username"
                placeholderTextColor={colors.mutedForeground}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              Password
            </Text>
            <View
              style={[
                styles.inputWrapper,
                {
                  backgroundColor: colors.muted,
                  borderColor: colors.border,
                },
              ]}
            >
              <Feather name="lock" size={16} color={colors.mutedForeground} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Enter password"
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
                  size={16}
                  color={colors.mutedForeground}
                />
              </Pressable>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.loginButton,
              {
                backgroundColor: colors.primary,
                opacity: pressed || loading ? 0.85 : 1,
              },
            ]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginButtonText}>Sign In</Text>
            )}
          </Pressable>

          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>
              or
            </Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.googleButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
            onPress={handleGoogleLogin}
          >
            <Feather name="globe" size={18} color={colors.foreground} />
            <Text style={[styles.googleButtonText, { color: colors.foreground }]}>
              Continue with Google
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.signupText, { color: colors.mutedForeground }]}>
          New to ShareSwap? Sign up on the web app at{"\n"}
          <Text style={{ color: colors.primary }}>shareswap.community</Text>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 32,
    gap: 8,
  },
  logo: {
    width: 220,
    height: 56,
  },
  tagline: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  card: {
    width: "100%",
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    gap: 16,
  },
  cardTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },
  field: {
    gap: 6,
  },
  label: {
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
  loginButton: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
  },
  loginButtonText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  googleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
  },
  googleButtonText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  signupText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 24,
    lineHeight: 20,
  },
});
