import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useNotifications, type Notification } from "@/hooks/useNotifications";

// ── Time-ago helper (matches web display) ──────────────────────────────────
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ── Icon per notification type ─────────────────────────────────────────────
function notifIcon(type: string): { name: React.ComponentProps<typeof Feather>["name"]; color: string } {
  switch (type) {
    case "new_request":       return { name: "inbox",         color: "#0DCEA1" };
    case "request_accepted":  return { name: "check-circle",  color: "#16a34a" };
    case "request_declined":  return { name: "x-circle",      color: "#ef4444" };
    case "message":           return { name: "message-circle",color: "#3b82f6" };
    case "payment_received":  return { name: "dollar-sign",   color: "#f59e0b" };
    case "return_reminder":   return { name: "clock",         color: "#f97316" };
    case "wishlist_match":    return { name: "heart",         color: "#ec4899" };
    case "review":            return { name: "star",          color: "#f59e0b" };
    default:                  return { name: "bell",          color: "#6b7280" };
  }
}

// ── Single notification row ────────────────────────────────────────────────
function NotifRow({
  notif,
  onPress,
  colors,
}: {
  notif: Notification;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const icon = notifIcon(notif.type);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: notif.isRead ? colors.card : colors.primary + "12",
          borderColor: colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
      onPress={onPress}
    >
      <View style={[styles.iconWrap, { backgroundColor: icon.color + "18" }]}>
        <Feather name={icon.name} size={18} color={icon.color} />
      </View>
      <View style={styles.rowBody}>
        {notif.title ? (
          <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>
            {notif.title}
          </Text>
        ) : null}
        <Text style={[styles.rowMsg, { color: notif.isRead ? colors.mutedForeground : colors.foreground }]} numberOfLines={2}>
          {notif.message}
        </Text>
        <Text style={[styles.rowTime, { color: colors.mutedForeground }]}>
          {timeAgo(notif.createdAt)}
        </Text>
      </View>
      {!notif.isRead && <View style={styles.unreadDot} />}
    </Pressable>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────
export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { notifications, unreadCount, markAllRead, markRead } = useNotifications();

  const [refreshing, setRefreshing] = React.useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    // React Query will refetch on the next render cycle; just show spinner briefly
    setTimeout(() => setRefreshing(false), 800);
  }

  function handleNotifPress(notif: Notification) {
    if (!notif.isRead) markRead(notif.id);
    // Navigate to the related content — same logic as web
    if (notif.requestId) {
      router.push(`/chat/${notif.requestId}` as never);
    } else if (notif.itemId) {
      router.push(`/item/${notif.itemId}` as never);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: colors.primary }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Feather name="arrow-left" size={22} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Notifications</Text>
          {unreadCount > 0 ? (
            <Pressable onPress={markAllRead} hitSlop={8}>
              <Text style={styles.markAllText}>Mark all read</Text>
            </Pressable>
          ) : (
            <View style={{ width: 72 }} />
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
      >
        {notifications.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="bell-off" size={44} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No notifications yet</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              You'll see activity like requests, messages, and payments here.
            </Text>
          </View>
        ) : (
          notifications.map((notif) => (
            <NotifRow
              key={notif.id}
              notif={notif}
              onPress={() => handleNotifPress(notif)}
              colors={colors}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  markAllText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.85)",
    width: 72,
    textAlign: "right",
  },

  list: { padding: 12, gap: 8 },

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  rowMsg: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  rowTime: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#0DCEA1",
    marginTop: 4,
    flexShrink: 0,
  },

  empty: { alignItems: "center", gap: 12, paddingTop: 80, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
});
