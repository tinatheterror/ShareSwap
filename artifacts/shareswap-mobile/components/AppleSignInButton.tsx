import * as AppleAuthentication from "expo-apple-authentication";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { AppleLogo } from "@/components/ProviderLogos";

/**
 * "Continue with Apple". On iOS it is Apple's own button (Apple's guidelines ask for it, and it handles the language
 * and dark mode); on the web build it is a white button with a thin black outline and the Apple logo (Apple's white-outline style).
 */
export function AppleSignInButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  if (Platform.OS === "ios") {
    return (
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
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
      <View style={styles.row}>
        <AppleLogo size={20} />
        <Text style={styles.webText}>Continue with Apple</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  native: { width: "100%", height: 48 },
  web: { width: "100%", height: 48, borderRadius: 12, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#000000", alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  webText: { color: "#000000", fontSize: 16, fontWeight: "600" },
});
