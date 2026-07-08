import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

interface WishlistItem {
  id: number;
  userId: number;
  itemName: string;
  description?: string;
  category?: string;
  needType: string;
  urgency: string;
  neededDate?: string;
  isActive: boolean;
  isExpired?: boolean;
  createdAt: string;
  user?: {
    id: number;
    username: string;
    displayName?: string;
    isVerified?: boolean;
  };
}

const NEED_TYPES = [
  { key: "borrow", label: "Borrow" },
  { key: "rent", label: "Rent" },
  { key: "swap", label: "Swap" },
  { key: "gift", label: "Gift" },
];

const URGENCY_LEVELS = [
  { key: "normal", label: "Whenever" },
  { key: "soon", label: "Soon" },
  { key: "urgent", label: "Urgent" },
];

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export default function WishlistScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const [tab, setTab] = useState<"mine" | "community">("mine");
  const [showAdd, setShowAdd] = useState(false);
  const [itemName, setItemName] = useState("");
  const [description, setDescription] = useState("");
  const [needType, setNeedType] = useState("borrow");
  const [urgency, setUrgency] = useState("normal");

  const { data: myWishlists, isLoading: loadingMine } = useQuery<WishlistItem[]>({
    queryKey: ["/api/my-wishlists"],
    queryFn: () => apiGet<WishlistItem[]>("/api/my-wishlists"),
    enabled: !!user,
  });

  const { data: communityWishlists, isLoading: loadingCommunity } = useQuery<
    WishlistItem[]
  >({
    queryKey: ["/api/wishlists"],
    queryFn: () => apiGet<WishlistItem[]>("/api/wishlists"),
    enabled: !!user && tab === "community",
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!itemName.trim()) throw new Error("Please tell us what you're looking for");
      return apiPost("/api/wishlists", {
        itemName: itemName.trim(),
        description: description.trim() || undefined,
        needType,
        urgency,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-wishlists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wishlists"] });
      setItemName("");
      setDescription("");
      setNeedType("borrow");
      setUrgency("normal");
      setShowAdd(false);
    },
    onError: (error: Error) => {
      Alert.alert("Couldn't add to wishlist", error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiDelete(`/api/wishlists/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-wishlists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wishlists"] });
    },
  });

  function confirmDelete(item: WishlistItem) {
    Alert.alert("Remove from wishlist?", `"${item.itemName}" will be removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => deleteMutation.mutate(item.id),
      },
    ]);
  }

  const list = tab === "mine" ? myWishlists : communityWishlists;
  const isLoading = tab === "mine" ? loadingMine : loadingCommunity;

  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Wishlist</Text>
        </View>
        <View style={styles.centered}>
          <Feather name="heart" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Sign in to see wishlists</Text>
          <Pressable
            style={[styles.signInBtn, { backgroundColor: colors.primary }]}
            onPress={() => router.push("/login")}
          >
            <Text style={[styles.signInBtnText, { color: colors.primaryForeground }]}>Sign In</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 12, backgroundColor: colors.background, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.headerTop}>
          <Text style={[styles.title, { color: colors.foreground }]}>Wishlist</Text>
          <Pressable
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
            onPress={() => setShowAdd(true)}
          >
            <Feather name="plus" size={18} color={colors.primaryForeground} />
          </Pressable>
        </View>
        <View style={[styles.tabRow, { backgroundColor: colors.muted }]}>
          <Pressable
            style={[styles.tabBtn, tab === "mine" && { backgroundColor: colors.card }]}
            onPress={() => setTab("mine")}
          >
            <Text
              style={[
                styles.tabText,
                { color: tab === "mine" ? colors.foreground : colors.mutedForeground },
              ]}
            >
              My Wishlist
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, tab === "community" && { backgroundColor: colors.card }]}
            onPress={() => setTab("community")}
          >
            <Text
              style={[
                styles.tabText,
                { color: tab === "community" ? colors.foreground : colors.mutedForeground },
              ]}
            >
              Community Requests
            </Text>
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : !list?.length ? (
        <View style={styles.centered}>
          <Feather name="heart" size={44} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {tab === "mine" ? "Nothing on your wishlist yet" : "No community requests yet"}
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {tab === "mine"
              ? "Add something you're hoping to borrow, rent, swap, or receive as a gift."
              : "Check back soon to see what neighbours are looking for."}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + (isWeb ? 34 : 0) + 100 }]}
          showsVerticalScrollIndicator={false}
        >
          {list.map((item) => (
            <View
              key={item.id}
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.cardTop}>
                <Text style={[styles.itemName, { color: colors.foreground }]} numberOfLines={1}>
                  {item.itemName}
                </Text>
                {item.urgency === "urgent" ? (
                  <View style={[styles.urgentPill, { backgroundColor: colors.destructive + "20" }]}>
                    <Text style={[styles.urgentText, { color: colors.destructive }]}>Urgent</Text>
                  </View>
                ) : null}
              </View>
              {item.description ? (
                <Text
                  style={[styles.itemDesc, { color: colors.mutedForeground }]}
                  numberOfLines={2}
                >
                  {item.description}
                </Text>
              ) : null}
              <View style={styles.cardMeta}>
                <View style={[styles.needPill, { backgroundColor: colors.accent }]}>
                  <Text style={[styles.needText, { color: colors.accentForeground }]}>
                    {NEED_TYPES.find((n) => n.key === item.needType)?.label ?? item.needType}
                  </Text>
                </View>
                {tab === "community" && item.user ? (
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                    {item.user.displayName || item.user.username}
                  </Text>
                ) : (
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                    {timeAgo(item.createdAt)}
                  </Text>
                )}
              </View>
              {tab === "mine" ? (
                <Pressable style={styles.deleteBtn} onPress={() => confirmDelete(item)}>
                  <Feather name="trash-2" size={16} color={colors.mutedForeground} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={showAdd} animationType="slide" transparent onRequestClose={() => setShowAdd(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add to Wishlist</Text>
              <Pressable onPress={() => setShowAdd(false)}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <Text style={[styles.label, { color: colors.foreground }]}>What are you looking for?</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
              placeholder="e.g. Pressure washer"
              placeholderTextColor={colors.mutedForeground}
              value={itemName}
              onChangeText={setItemName}
            />

            <Text style={[styles.label, { color: colors.foreground }]}>Details (optional)</Text>
            <TextInput
              style={[
                styles.input,
                styles.textArea,
                { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card },
              ]}
              placeholder="Any specifics that would help neighbours..."
              placeholderTextColor={colors.mutedForeground}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
            />

            <Text style={[styles.label, { color: colors.foreground }]}>How would you like it?</Text>
            <View style={styles.chipRow}>
              {NEED_TYPES.map((t) => {
                const active = needType === t.key;
                return (
                  <Pressable
                    key={t.key}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? colors.primary : colors.muted,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setNeedType(t.key)}
                  >
                    <Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>
                      {t.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.label, { color: colors.foreground }]}>How soon?</Text>
            <View style={styles.chipRow}>
              {URGENCY_LEVELS.map((u) => {
                const active = urgency === u.key;
                return (
                  <Pressable
                    key={u.key}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? colors.primary : colors.muted,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setUrgency(u.key)}
                  >
                    <Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>
                      {u.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={[
                styles.submitBtn,
                { backgroundColor: colors.primary, opacity: createMutation.isPending ? 0.7 : 1 },
              ]}
              onPress={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.submitBtnText, { color: colors.primaryForeground }]}>Add to Wishlist</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  tabRow: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: "center",
  },
  tabText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  scroll: {
    padding: 16,
    gap: 12,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  itemName: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  urgentPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  urgentText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  itemDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  needPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  needText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  metaText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  deleteBtn: {
    position: "absolute",
    top: 14,
    right: 14,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  emptyText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  signInBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 4,
  },
  signInBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 10,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  textArea: {
    minHeight: 70,
    textAlignVertical: "top",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  submitBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 10,
  },
  submitBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
