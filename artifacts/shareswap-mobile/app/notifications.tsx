import { Feather } from "@expo/vector-icons";
import {
  AlertCircle, AlertTriangle, ArrowLeftRight, Bell,
  Clock, Coins, DollarSign, Flag, Gift, Heart,
  Package, Shield, ShieldAlert, ShieldCheck,
  Star, TrendingUp, Truck, Unlock, UserCheck, Users,
} from "lucide-react-native";
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
import { useAuth } from "@/context/AuthContext";
import { apiGet } from "@/lib/api";
import { safeDate } from "@/lib/dateUtils";

// ── Time-ago helper (matches web display) ──────────────────────────────────
function timeAgo(dateStr: string): string {
  const parsed = safeDate(dateStr);
  if (isNaN(parsed.getTime())) return "–";
  const diff = Date.now() - parsed.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Icon per notification type — exact match to web app ───────────────────
type LucideIcon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
function notifIcon(type: string): { Icon: LucideIcon; color: string } {
  // Return stages intentionally have their own visual severity. They deep-link
  // to the request chat below, where the exact deadline and available action live.
  if (type === "return_stage_return_due_borrower" || type === "return_stage_return_due_owner") return { Icon: Clock, color: "#f97316" };
  if (type === "return_stage_overdue_grace_borrower" || type === "return_stage_overdue_grace_owner") return { Icon: AlertCircle, color: "#f59e0b" };
  if (type === "return_stage_overdue_borrower" || type === "return_stage_overdue_owner") return { Icon: AlertTriangle, color: "#ea580c" };
  if (type === "return_stage_seriously_overdue_borrower" || type === "return_stage_seriously_overdue_owner") return { Icon: ShieldAlert, color: "#b91c1c" };
  if (type === "return_stage_non_return_review_borrower" || type === "return_stage_non_return_review_owner") return { Icon: Flag, color: "#b91c1c" };
  if (type === "return_stage_returned_pending_review_borrower" || type === "return_stage_returned_pending_review_owner") return { Icon: ShieldCheck, color: "#2563eb" };
  if (type === "security_claim_opened" || type === "claim_opened") return { Icon: ShieldAlert, color: "#dc2626" };
  if (type === "security_claim_response" || type === "claim_response") return { Icon: AlertCircle, color: "#4f46e5" };
  if (type === "security_claim_approved" || type === "claim_approved") return { Icon: ShieldCheck, color: "#16a34a" };
  if (type === "security_claim_rejected" || type === "claim_rejected") return { Icon: Shield, color: "#64748b" };
  if (type === "security_claim_settled" || type === "claim_settled") return { Icon: DollarSign, color: "#16a34a" };
  if (type === "security_deposit_authorization_expired" || type === "deposit_authorization_expired") return { Icon: ShieldAlert, color: "#dc2626" };
  if (type === "return_reminder_overdue")                                      return { Icon: AlertCircle,    color: "#ef4444" };
  if (type === "return_reminder_overdue_restricted")                           return { Icon: AlertCircle,    color: "#dc2626" };
  if (type === "return_reminder_serious_overdue")                              return { Icon: ShieldAlert,    color: "#b91c1c" };
  if (type === "return_reminder_today")                                         return { Icon: Clock,          color: "#f97316" };
  if (type === "return_reminder_tomorrow")                                      return { Icon: Clock,          color: "#fbbf24" };
  if (type === "return_delay_notified" || type === "return_delay_follow_up")     return { Icon: AlertTriangle,  color: "#f59e0b" };
  if (type === "wishlist_match")                                                return { Icon: Heart,          color: "#ec4899" };
  if (type === "swap_match")                                                    return { Icon: ArrowLeftRight, color: "#14b8a6" };
  if (type === "item_request" || type === "request_accepted")                   return { Icon: Package,        color: "#3b82f6" };
  if (type === "request_cancelled")                                             return { Icon: AlertTriangle,  color: "#ef4444" };
  if (type === "terms_counter_proposed")                                        return { Icon: AlertTriangle,  color: "#f59e0b" };
  if (type === "terms_declined")                                                return { Icon: AlertTriangle,  color: "#ef4444" };
  if (type === "gift_completed" || type === "gift_received" || type === "gift_handoff_pending") return { Icon: Gift, color: "#ec4899" };
  if (type === "handoff_pending" || type === "handoff_confirmed")               return { Icon: Clock,          color: "#f59e0b" };
  if (type === "handoff_dispute" || type === "handoff_disputed")                return { Icon: AlertTriangle,  color: "#ef4444" };
  if (type === "handoff_flagged")                                               return { Icon: Flag,           color: "#f97316" };
  if (type === "handoff_auto_advanced")                                         return { Icon: Truck,          color: "#14b8a6" };
  if (type === "dispute_opened")                                                return { Icon: ShieldAlert,    color: "#ef4444" };
  if (type === "delivery_confirmed")                                            return { Icon: Truck,          color: "#14b8a6" };
  if (type === "courier_issue")                                                 return { Icon: AlertTriangle,  color: "#f97316" };
  if (type === "sharecoin_earned")                                              return { Icon: Coins,          color: "#eab308" };
  if (type === "milestone_achieved")                                            return { Icon: ShieldCheck,    color: "#14b8a6" };
  if (type === "badge_earned")                                                  return { Icon: Star,           color: "#a855f7" };
  if (type === "level_up")                                                      return { Icon: TrendingUp,     color: "#22c55e" };
  if (type === "trust_score_changed")                                           return { Icon: TrendingUp,     color: "#3b82f6" };
  if (type === "new_review_received")                                           return { Icon: Star,           color: "#eab308" };
  if (type === "referral_joined")                                               return { Icon: Users,          color: "#14b8a6" };
  if (type === "security_deposit_released")                                     return { Icon: Unlock,         color: "#22c55e" };
  if (type === "payment_received")                                              return { Icon: DollarSign,     color: "#22c55e" };
  if (type === "verification_failed")                                            return { Icon: ShieldAlert,    color: "#ef4444" };
  if (type === "terms_accepted")                                                return { Icon: UserCheck,      color: "#14b8a6" };
  return { Icon: Bell, color: "#0DCEA1" };
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
  const { Icon, color: iconColor } = notifIcon(notif.type);
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
      <View style={[styles.iconWrap, { backgroundColor: iconColor + "18" }]}>
        <Icon size={18} color={iconColor} strokeWidth={1.75} />
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
  const { user } = useAuth();
  const { notifications, unreadCount, markAllRead, markRead } = useNotifications();

  const [refreshing, setRefreshing] = React.useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    // React Query will refetch on the next render cycle; just show spinner briefly
    setTimeout(() => setRefreshing(false), 800);
  }

  async function handleNotifPress(notif: Notification) {
    if (!notif.isRead) markRead(notif.id);

    // Type-specific deep-links (matches web notifications-page.tsx routing)
    if (notif.type === "trust_score_changed" || notif.type === "level_up" || notif.type === "milestone_achieved" || notif.type === "badge_earned" || notif.type === "new_review_received") {
      router.push("/achievements" as never);
      return;
    }
    if (notif.type === "sharecoin_earned" || notif.type === "referral_joined") {
      router.push("/sharecoin-wallet" as never);
      return;
    }

    if (notif.requestId) {
      try {
        // Need the partner's userId — fetch requests to resolve it
        const requests = await apiGet<any[]>("/api/requests");
        const req = requests.find((r: any) => r.id === notif.requestId);
        if (req && user) {
          const partnerId =
            req.requesterId === user.id
              ? req.item?.ownerId
              : req.requesterId;
          if (partnerId) {
            router.push(`/chat/${partnerId}?requestId=${notif.requestId}` as never);
            return;
          }
        }
      } catch {}
      // Fallback: open inbox so user can find the conversation
      router.push("/(tabs)/inbox" as never);
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
