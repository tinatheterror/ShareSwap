import * as AppleAuthentication from "expo-apple-authentication";
import React from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";

/**
 * "Continue with Apple". On iOS it is Apple's own button (Apple's guidelines ask for it, and it handles the language
 * and dark mode); on the web build it is a plain black button with the same wording.
 */
export function AppleSignInButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  if (Platform.OS === "ios") {
    return (
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={12}
        style={styles.native}
        onPress={disabled ? () => undefined : onPress}
      />
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.web, { opacity: pressed || disabled ? 0.85 : 1 }]}
    >
      <Text style={styles.webText}>Continue with Apple</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  native: { width: "100%", height: 48 },
  web: { width: "100%", height: 48, borderRadius: 12, backgroundColor: "#000000", alignItems: "center", justifyContent: "center" },
  webText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
