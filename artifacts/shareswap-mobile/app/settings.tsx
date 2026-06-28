import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

interface SettingRow {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const router = useRouter();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const rows: SettingRow[] = [
    {
      icon: "user",
      label: "Edit Profile",
      onPress: () =>
        Alert.alert("Coming Soon", "Profile editing is available on the web app."),
    },
    {
      icon: "bell",
      label: "Notifications",
      onPress: () =>
        Alert.alert("Coming Soon", "Notification settings coming soon."),
    },
    {
      icon: "shield",
      label: "Privacy",
      onPress: () =>
        Alert.alert("Coming Soon", "Privacy settings coming soon."),
    },
    {
      icon: "help-circle",
      label: "Help & FAQ",
      onPress: () =>
        Alert.alert("Help", "Visit shareswap.community for help and FAQs."),
    },
    {
      icon: "log-out",
      label: "Sign Out",
      onPress: () =>
        Alert.alert("Sign out", "Are you sure?", [
          { text: "Cancel", style: "cancel" },
          {
            text: "Sign out",
            style: "destructive",
            onPress: async () => {
              await logout();
              router.replace("/(tabs)");
            },
          },
        ]),
      destructive: true,
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + (isWeb ? 34 : 0) + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {user ? (
          <View
            style={[
              styles.userCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View
              style={[styles.avatar, { backgroundColor: colors.primary + "30" }]}
            >
              <Text style={[styles.avatarText, { color: colors.primary }]}>
                {(user.displayName ?? user.username).charAt(0).toUpperCase()}
              </Text>
            </View>
            <View>
              <Text style={[styles.userName, { color: colors.foreground }]}>
                {user.displayName ?? user.username}
              </Text>
              <Text style={[styles.userEmail, { color: colors.mutedForeground }]}>
                {user.email}
              </Text>
            </View>
          </View>
        ) : null}

        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {rows.map((row, i) => (
            <React.Fragment key={row.label}>
              {i > 0 ? (
                <View
                  style={[styles.sep, { backgroundColor: colors.border }]}
                />
              ) : null}
              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
                onPress={row.onPress}
              >
                <Feather
                  name={row.icon}
                  size={18}
                  color={row.destructive ? colors.destructive : colors.foreground}
                />
                <Text
                  style={[
                    styles.rowLabel,
                    {
                      color: row.destructive
                        ? colors.destructive
                        : colors.foreground,
                    },
                  ]}
                >
                  {row.label}
                </Text>
                {!row.destructive ? (
                  <Feather
                    name="chevron-right"
                    size={16}
                    color={colors.mutedForeground}
                  />
                ) : null}
              </Pressable>
            </React.Fragment>
          ))}
        </View>

        <Text style={[styles.version, { color: colors.mutedForeground }]}>
          ShareSwap v1.0.0
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: {
    padding: 16,
    gap: 16,
  },
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  userName: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  userEmail: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  section: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  sep: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 48,
  },
  version: {
    textAlign: "center",
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 8,
  },
});
