import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

interface Message {
  id: number;
  content: string;
  senderId: number;
  createdAt: string;
}

interface PublicProfile {
  id: number;
  username: string;
  displayName: string | null;
  profilePhoto: string | null;
  isVerified: boolean;
  reputationScore: number;
  lastActiveAt: string | null;
  reviewCount: number;
  averageRating: number | null;
  responseTime: string | null;
}

function getActiveStatus(lastActiveAt: string | null): { label: string; isNow: boolean } | null {
  if (!lastActiveAt) return null;
  const diff = Date.now() - new Date(lastActiveAt).getTime();
  const min = diff / 60_000;
  const hrs = diff / 3_600_000;
  const days = diff / 86_400_000;
  if (min < 10) return { label: "Active now", isNow: true };
  if (hrs < 24) return { label: "Active today", isNow: false };
  if (days < 7) return { label: "Active this week", isNow: false };
  if (days < 30) return { label: "Active this month", isNow: false };
  return null;
}

function getInitials(displayName: string | null, username: string): string {
  const name = displayName || username;
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(dateStr).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

export default function ChatScreen() {
  const { id, requestId } = useLocalSearchParams<{
    id: string;
    requestId?: string;
  }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const isWeb = Platform.OS === "web";

  const [text, setText] = useState("");
  const flatListRef = useRef<FlatList>(null);

  const { data: partner } = useQuery<PublicProfile>({
    queryKey: [`/api/users/${id}/public-profile`],
    queryFn: () => apiGet<PublicProfile>(`/api/users/${id}/public-profile`),
    enabled: !!id,
  });

  const messagesUrl = requestId
    ? `/api/messages/${id}?requestId=${requestId}`
    : `/api/messages/${id}`;

  const { data: messages, isLoading } = useQuery<Message[]>({
    queryKey: [`/api/messages/${id}`, requestId ?? null],
    queryFn: () => apiGet<Message[]>(messagesUrl),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      apiPost(`/api/messages`, {
        receiverId: parseInt(id ?? "0"),
        content,
        ...(requestId ? { requestId: parseInt(requestId) } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [`/api/messages/${id}`, requestId ?? null],
      });
      qc.invalidateQueries({ queryKey: ["/api/inbox"] });
      setText("");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
  });

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
  }

  const activeStatus = getActiveStatus(partner?.lastActiveAt ?? null);
  const partnerName = partner
    ? partner.displayName || partner.username
    : "";
  const initials = partner
    ? getInitials(partner.displayName, partner.username)
    : "?";
  const reversed = messages ? [...messages].reverse() : [];
  const topPad = isWeb ? 67 : insets.top;
  const hasRating = partner && (partner.reviewCount ?? 0) > 0;
  const hasSubtext = hasRating || activeStatus || partner?.responseTime;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      {/* Custom header — replaces Expo stack header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 8,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        {/* Back */}
        <Pressable
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={10}
        >
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </Pressable>

        {/* Avatar + active dot */}
        <View style={styles.avatarWrap}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: colors.primary + "25" },
            ]}
          >
            {partner?.profilePhoto ? (
              <Image
                source={{ uri: partner.profilePhoto }}
                style={styles.avatarImg}
              />
            ) : (
              <Text style={[styles.avatarText, { color: colors.primary }]}>
                {initials}
              </Text>
            )}
          </View>
          {activeStatus?.isNow ? (
            <View
              style={[
                styles.activeDot,
                {
                  backgroundColor: "#22c55e",
                  borderColor: colors.background,
                },
              ]}
            />
          ) : null}
        </View>

        {/* Name + meta */}
        <View style={styles.headerMeta}>
          <View style={styles.nameRow}>
            <Text
              style={[styles.partnerName, { color: colors.foreground }]}
              numberOfLines={1}
            >
              {partnerName || "Loading…"}
            </Text>
            {partner?.isVerified ? (
              <View
                style={[
                  styles.verifiedBadge,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Feather name="check" size={8} color="#fff" />
              </View>
            ) : null}
          </View>

          {hasSubtext ? (
            <View style={styles.metaRow}>
              {hasRating ? (
                <>
                  <Feather name="star" size={11} color="#f59e0b" />
                  <Text
                    style={[styles.metaText, { color: colors.foreground }]}
                  >
                    {Number(partner!.averageRating).toFixed(1)}
                  </Text>
                  <Text
                    style={[
                      styles.metaText,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    ({partner!.reviewCount})
                  </Text>
                </>
              ) : null}

              {hasRating && (activeStatus || partner?.responseTime) ? (
                <Text
                  style={[styles.metaSep, { color: colors.mutedForeground }]}
                >
                  ·
                </Text>
              ) : null}

              {activeStatus ? (
                <Text
                  style={[
                    styles.metaText,
                    {
                      color: activeStatus.isNow
                        ? "#16a34a"
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  {activeStatus.label}
                </Text>
              ) : null}

              {activeStatus && partner?.responseTime ? (
                <Text
                  style={[styles.metaSep, { color: colors.mutedForeground }]}
                >
                  ·
                </Text>
              ) : null}

              {!activeStatus && partner?.responseTime ? (
                <Text
                  style={[
                    styles.metaText,
                    { color: colors.mutedForeground },
                  ]}
                  numberOfLines={1}
                >
                  {partner.responseTime}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* View profile button */}
        <Pressable
          style={styles.profileBtn}
          onPress={() => router.push(`/profile/${id}` as never)}
          hitSlop={10}
        >
          <Feather name="user" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Messages */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={reversed}
          keyExtractor={(m) => m.id.toString()}
          inverted
          contentContainerStyle={styles.messageList}
          renderItem={({ item }) => {
            const isMe = item.senderId === user?.id;
            return (
              <View
                style={[
                  styles.bubble,
                  isMe ? styles.bubbleMe : styles.bubbleThem,
                  {
                    backgroundColor: isMe ? colors.primary : colors.card,
                    borderColor: isMe ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.bubbleText,
                    {
                      color: isMe
                        ? colors.primaryForeground
                        : colors.foreground,
                    },
                  ]}
                >
                  {item.content}
                </Text>
                <Text
                  style={[
                    styles.bubbleTime,
                    {
                      color: isMe
                        ? "rgba(255,255,255,0.7)"
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  {timeAgo(item.createdAt)}
                </Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather
                name="message-circle"
                size={40}
                color={colors.mutedForeground}
              />
              <Text
                style={[styles.emptyText, { color: colors.mutedForeground }]}
              >
                Send the first message
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        />
      )}

      {/* Input bar */}
      <View
        style={[
          styles.inputBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + (isWeb ? 34 : 8),
          },
        ]}
      >
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.muted,
              borderColor: colors.border,
              color: colors.foreground,
            },
          ]}
          placeholder="Type a message..."
          placeholderTextColor={colors.mutedForeground}
          value={text}
          onChangeText={setText}
          multiline
          returnKeyType="default"
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendBtn,
            {
              backgroundColor:
                text.trim().length > 0 ? colors.primary : colors.muted,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
          onPress={handleSend}
          disabled={sendMutation.isPending || !text.trim()}
        >
          {sendMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Feather
              name="send"
              size={18}
              color={
                text.trim().length > 0
                  ? colors.primaryForeground
                  : colors.mutedForeground
              }
            />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 2 },
  avatarWrap: { position: "relative", flexShrink: 0 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: 38, height: 38, borderRadius: 19 },
  avatarText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  activeDot: {
    position: "absolute",
    bottom: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  headerMeta: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  partnerName: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
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
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 1,
    flexWrap: "nowrap",
  },
  metaText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  metaSep: { fontSize: 10, fontFamily: "Inter_400Regular" },
  profileBtn: { padding: 4, flexShrink: 0 },

  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  messageList: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 8,
  },
  bubble: {
    maxWidth: "80%",
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 3,
  },
  bubbleMe: { alignSelf: "flex-end", borderBottomRightRadius: 4 },
  bubbleThem: { alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  bubbleText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  bubbleTime: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    alignSelf: "flex-end",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
  },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    maxHeight: 120,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
});
