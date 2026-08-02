import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNotifications } from "@/hooks/useNotifications";

interface Props {
  /** Icon + badge text colour — use "#fff" on dark/primary backgrounds, primary colour on light */
  color?: string;
}

export function NotificationBell({ color = "#fff" }: Props) {
  const router = useRouter();
  const { unreadCount } = useNotifications();

  function handlePress() {
    router.push("/notifications" as never);
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.7 : 1 }]}
      onPress={handlePress}
      hitSlop={8}
    >
      <Feather name="bell" size={22} color={color} />
      {unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: {
    color: "#fff",
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    lineHeight: 11,
  },
});
