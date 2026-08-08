import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { photoUrl } from "@/lib/api";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiRequest } from "@/lib/api";
import { formatTime } from "@/lib/dateUtils";
import { useAuth } from "@/context/AuthContext";
import { NotificationBell } from "@/components/NotificationBell";

export interface InboxItem {
  requestId: number;
  partnerId: number;
  partnerUsername: string;
  partnerDisplayName: string | null;
  partnerPhoto: string | null;
  partnerIsVerified: boolean;
  partnerLastActiveAt: string | null;
  partnerActiveStatus: string | null;
  lastActivityTime: string;
  preview: string;
  previewType: "message" | "request";
  previewSentByMe: boolean | null;
  unreadCount: number;
  requestType: string;
  requestStatus: string;
  requestNegotiationStatus: string | null;
  itemName: string;
  itemId: number;
  itemPhoto: string | null;
  iAmRequester: boolean;
  isArchived: boolean;
}

type FilterKey = "all" | "lending" | "renting" | "swapping" | "gifting" | "archived";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "lending", label: "Lend" },
  { key: "renting", label: "Rent" },
  { key: "swapping", label: "Swap" },
  { key: "gifting", label: "Gift" },
  { key: "archived", label: "Archive" },
];


export function InboxRow({ item, onPress }: { item: InboxItem; onPress: () => void }) {
  const colors = useColors();
  const partnerName = item.partnerDisplayName || item.partnerUsername;
  const initials = partnerName.charAt(0).toUpperCase();
  const isUnread = item.unreadCount > 0;
  const needsAction =
    !item.isArchived &&
    ((item.requestStatus === "PENDING" && !item.iAmRequester) ||
      item.requestNegotiationStatus === "counter_proposed");

  const previewText =
    item.previewType === "message"
      ? (item.previewSentByMe ? "You: " : "") + item.preview
      : item.preview;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: needsAction
            ? "#fffbeb"
            : isUnread
            ? colors.accent
            : colors.card,
          borderBottomColor: colors.border,
          opacity: pressed ? 0.93 : 1,
        },
      ]}
      onPress={onPress}
    >
      {/* Avatar */}
      <View style={styles.avatarWrap}>
        <View style={[styles.avatar, { backgroundColor: colors.primary + "25" }]}>
          {item.partnerPhoto ? (
            <Image
              source={{ uri: photoUrl(item.partnerPhoto) }}
              style={styles.avatarImg}
            />
          ) : (
            <Text style={[styles.avatarText, { color: colors.primary }]}>
              {initials}
            </Text>
          )}
        </View>
        {item.partnerActiveStatus === "online" ? (
          <View
            style={[styles.activeDot, { backgroundColor: "#22c55e", borderColor: colors.card }]}
          />
        ) : null}
      </View>

      {/* Content */}
      <View style={styles.content}>
        {/* Row 1: name + time + unread */}
        <View style={styles.row1}>
          <View style={styles.nameRow}>
            <Text
              style={[
                styles.name,
                {
                  color: colors.foreground,
                  fontFamily: isUnread || needsAction ? "Inter_700Bold" : "Inter_600SemiBold",
                },
              ]}
              numberOfLines={1}
            >
              {partnerName}
            </Text>
            {item.partnerIsVerified ? (
              <View style={{ width: 16, height: 16 }}>
                <MaterialCommunityIcons name="check-decagram" size={20} color="white" style={{ position: "absolute", top: -2, left: -2 }} />
                <MaterialCommunityIcons name="check-decagram" size={16} color="#0DCEA1" style={{ position: "absolute" }} />
              </View>
            ) : null}
          </View>
          <View style={styles.metaRight}>
            {isUnread ? (
              <View style={[styles.unreadBadge, { backgroundColor: "#ef4444" }]}>
                <Text style={styles.unreadText}>{item.unreadCount}</Text>
              </View>
            ) : needsAction ? (
              <View style={[styles.unreadBadge, { backgroundColor: "#f59e0b" }]}>
                <Text style={styles.unreadText}>!</Text>
              </View>
            ) : null}
            <Text style={[styles.time, { color: colors.mutedForeground }]}>
              {formatTime(item.lastActivityTime)}
            </Text>
          </View>
        </View>

        {/* Row 2: item name */}
        <Text
          style={[styles.itemName, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {item.itemName}
        </Text>

        {/* Row 3: message preview */}
        <Text
          style={[
            styles.preview,
            {
              color: isUnread || needsAction ? colors.foreground : colors.mutedForeground,
              fontFamily: isUnread ? "Inter_500Medium" : "Inter_400Regular",
            },
          ]}
          numberOfLines={1}
        >
          {previewText}
        </Text>
      </View>

      <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function InboxScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";

  const [filter, setFilter] = useState<FilterKey>("all");
  const [refreshing, setRefreshing] = useState(false);

  const isArchiveFilter = filter === "archived";

  const { data: activeItems = [], isLoading: loadingActive, refetch: refetchActive } = useQuery<InboxItem[]>({
    queryKey: ["/api/inbox"],
    queryFn: () => apiGet<InboxItem[]>("/api/inbox"),
    enabled: !!user,
  });

  const { data: archivedItems = [], isLoading: loadingArchived, refetch: refetchArchived } = useQuery<InboxItem[]>({
    queryKey: ["/api/inbox/archived"],
    queryFn: () => apiGet<InboxItem[]>("/api/inbox?archived=true"),
    enabled: !!user && isArchiveFilter,
  });

  const isLoading = isArchiveFilter ? loadingArchived : loadingActive;
  const baseItems = isArchiveFilter ? archivedItems : activeItems;

  const filteredItems = baseItems.filter((item) => {
    if (filter === "all" || filter === "archived") return true;
    if (filter === "lending") return item.requestType === "BORROW";
    if (filter === "renting") return item.requestType === "RENT";
    if (filter === "swapping") return item.requestType === "SWAP";
    if (filter === "gifting") return item.requestType === "GIFT";
    return true;
  });

  const totalUnread = activeItems.reduce((s, i) => s + i.unreadCount, 0);

  async function handleRefresh() {
    setRefreshing(true);
    await (isArchiveFilter ? refetchArchived() : refetchActive());
    setRefreshing(false);
  }

  function handleOpen(item: InboxItem) {
    if (item.unreadCount > 0) {
      apiRequest("POST", `/api/messages/mark-read/${item.partnerId}`, { requestId: item.requestId })
        .then(() => {
          qc.invalidateQueries({ queryKey: ["/api/inbox"] });
          qc.invalidateQueries({ queryKey: ["/api/inbox/archived"] });
        })
        .catch(() => {});
    }
    router.push(`/chat/${item.partnerId}?requestId=${item.requestId}`);
  }

  const topPad = isWeb ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 12,
            backgroundColor: colors.primary,
            borderBottomColor: "transparent",
          },
        ]}
      >
        <View style={styles.headerTop}>
          <Text style={[styles.title, { color: colors.foreground }]}>Inbox</Text>
          {totalUnread > 0 ? (
            <View style={[styles.totalBadge, { backgroundColor: "rgba(0,0,0,0.18)" }]}>
              <Text style={[styles.totalBadgeText, { color: "#fff" }]}>
                {totalUnread}
              </Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          <NotificationBell />
        </View>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const isArchive = f.key === "archived";
            return (
              <Pressable
                key={f.key}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active
                      ? isArchive
                        ? "#6b7280"
                        : colors.foreground
                      : colors.muted,
                    borderColor: active
                      ? isArchive
                        ? "#6b7280"
                        : colors.foreground
                      : colors.border,
                  },
                ]}
                onPress={() => setFilter(f.key)}
              >
                <Text
                  style={[
                    styles.filterText,
                    {
                      color: active ? "#fff" : colors.mutedForeground,
                      fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
                    },
                  ]}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Body */}
      {!user ? (
        <View style={styles.centered}>
          <Feather name="lock" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Sign in to see messages
          </Text>
        </View>
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : filteredItems.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="message-circle" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {filter === "archived" ? "No archived chats" : "Nothing here yet"}
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {filter === "all"
              ? "Start a conversation by requesting an item"
              : "Try a different filter"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.requestId.toString()}
          renderItem={({ item }) => (
            <InboxRow item={item} onPress={() => handleOpen(item)} />
          )}
          contentContainerStyle={{
            paddingBottom: insets.bottom + (isWeb ? 34 : 0) + 90,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  totalBadge: {
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: "center",
  },
  totalBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  filterRow: {
    gap: 5,
    paddingRight: 4,
  },
  filterChip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterText: {
    fontSize: 11,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarWrap: {
    position: "relative",
    flexShrink: 0,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarText: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  activeDot: {
    position: "absolute",
    bottom: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  content: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  row1: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 14,
    flexShrink: 1,
  },
  verifiedBadge: {
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  metaRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  unreadBadge: {
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 16,
    alignItems: "center",
  },
  unreadText: {
    color: "#fff",
    fontSize: 10,
    fontFamily: "Inter_700Bold",
  },
  time: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
  },
  itemName: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    flexShrink: 1,
    fontStyle: "italic",
  },
  preview: {
    fontSize: 13,
    lineHeight: 18,
  },
});
