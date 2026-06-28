import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

interface Conversation {
  id: number;
  otherUser: {
    id: number;
    displayName?: string;
    username: string;
    avatarUrl?: string;
    trustScore?: number;
  };
  lastMessage?: {
    content: string;
    createdAt: string;
    senderId: number;
  };
  itemTitle?: string;
  unreadCount?: number;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function ConversationRow({
  convo,
  currentUserId,
}: {
  convo: Conversation;
  currentUserId: number;
}) {
  const colors = useColors();
  const router = useRouter();
  const isUnread = (convo.unreadCount ?? 0) > 0;
  const isSentByMe = convo.lastMessage?.senderId === currentUserId;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: isUnread ? colors.accent : colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
      onPress={() => router.push(`/chat/${convo.id}`)}
    >
      <View
        style={[styles.avatar, { backgroundColor: colors.primary + "30" }]}
      >
        <Text style={[styles.avatarText, { color: colors.primary }]}>
          {(convo.otherUser.displayName ?? convo.otherUser.username)
            .charAt(0)
            .toUpperCase()}
        </Text>
        {isUnread ? (
          <View
            style={[styles.unreadDot, { backgroundColor: colors.primary }]}
          />
        ) : null}
      </View>

      <View style={styles.rowContent}>
        <View style={styles.rowTop}>
          <Text
            style={[
              styles.name,
              { color: colors.foreground },
              isUnread && { fontFamily: "Inter_700Bold" },
            ]}
            numberOfLines={1}
          >
            {convo.otherUser.displayName ?? convo.otherUser.username}
          </Text>
          {convo.lastMessage?.createdAt ? (
            <Text style={[styles.time, { color: colors.mutedForeground }]}>
              {timeAgo(convo.lastMessage.createdAt)}
            </Text>
          ) : null}
        </View>

        {convo.itemTitle ? (
          <View style={styles.itemTag}>
            <Feather name="package" size={10} color={colors.primary} />
            <Text style={[styles.itemTagText, { color: colors.primary }]} numberOfLines={1}>
              {convo.itemTitle}
            </Text>
          </View>
        ) : null}

        {convo.lastMessage ? (
          <Text
            style={[
              styles.preview,
              { color: isUnread ? colors.foreground : colors.mutedForeground },
            ]}
            numberOfLines={1}
          >
            {isSentByMe ? "You: " : ""}
            {convo.lastMessage.content}
          </Text>
        ) : (
          <Text style={[styles.preview, { color: colors.mutedForeground }]}>
            No messages yet
          </Text>
        )}
      </View>

      <Feather
        name="chevron-right"
        size={16}
        color={colors.mutedForeground}
      />
    </Pressable>
  );
}

export default function InboxScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isWeb = Platform.OS === "web";
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    queryFn: () => apiGet<Conversation[]>("/api/conversations"),
    enabled: !!user,
  });

  async function handleRefresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  const topPad = isWeb ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 12,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>Inbox</Text>
        {(data?.reduce((a, c) => a + (c.unreadCount ?? 0), 0) ?? 0) > 0 ? (
          <View style={[styles.badge, { backgroundColor: colors.primary }]}>
            <Text style={styles.badgeText}>
              {data!.reduce((a, c) => a + (c.unreadCount ?? 0), 0)}
            </Text>
          </View>
        ) : null}
      </View>

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
      ) : !data?.length ? (
        <View style={styles.centered}>
          <Feather name="message-circle" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No conversations yet
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Start a conversation by messaging an item owner
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(c) => c.id.toString()}
          renderItem={({ item }) => (
            <ConversationRow convo={item} currentUserId={user!.id} />
          )}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + (isWeb ? 34 : 0) + 90 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => (
            <View
              style={[styles.separator, { backgroundColor: colors.border }]}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  badge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: "center",
  },
  badgeText: {
    color: "#fff",
    fontSize: 12,
    fontFamily: "Inter_700Bold",
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
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  list: {
    paddingTop: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  avatarText: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  unreadDot: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "#fff",
  },
  rowContent: {
    flex: 1,
    gap: 3,
  },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  name: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  time: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  itemTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  itemTagText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  preview: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
  },
});
