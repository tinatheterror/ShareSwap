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
  preferredLocation?: string;
  urgency: string;
  neededDate?: string;
  returnDate?: string;
  isActive: boolean;
  isExpired?: boolean;
  isPrivate?: boolean;
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

const NEED_TYPE_OPTIONS = [
  { key: "borrow", label: "Borrow It", icon: "heart" as const },
  { key: "rent", label: "Rent It", icon: "repeat" as const },
  { key: "swap", label: "Swap It", icon: "repeat" as const },
  { key: "gift", label: "Be Gifted", icon: "gift" as const },
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

  const [tab, setTab] = useState<"mine" | "community">("community");
  const [showAdd, setShowAdd] = useState(false);
  const [itemName, setItemName] = useState("");
  const [description, setDescription] = useState("");
  const [needTypes, setNeedTypes] = useState<string[]>(["borrow"]);
  const [urgency, setUrgency] = useState("normal");

  function toggleNeedType(key: string) {
    setNeedTypes((prev) => {
      if (prev.includes(key)) {
        const next = prev.filter((t) => t !== key);
        return next.length ? next : prev;
      }
      return [...prev, key];
    });
  }

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
        needType: needTypes.join(","),
        urgency,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-wishlists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wishlists"] });
      setItemName("");
      setDescription("");
      setNeedTypes(["borrow"]);
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
            style={[styles.tabBtn, tab === "community" && { backgroundColor: colors.card }]}
            onPress={() => setTab("community")}
          >
            <Text
              style={[
                styles.tabText,
                { color: tab === "community" ? colors.foreground : colors.mutedForeground },
              ]}
            >
              Community Wishlist
            </Text>
          </Pressable>
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
            {tab === "mine" ? "Nothing on your wishlist yet" : "No community wishlist items yet"}
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
          {list.map((item) =>
            tab === "community" ? (
              <View
                key={item.id}
                style={[styles.commCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={[styles.commAccent, { backgroundColor: colors.primary }]} />
                <View style={styles.commBody}>
                  <View style={styles.cardTop}>
                    <Text style={[styles.itemName, { color: colors.foreground }]} numberOfLines={1}>
                      {item.itemName}
                    </Text>
                  </View>
                  <View style={styles.commBadgeRow}>
                    {item.urgency === "urgent" ? (
                      <View style={[styles.urgentPill, { backgroundColor: "#EFE4B0" }]}>
                        <Feather name="clock" size={11} color="#78350f" />
                        <Text style={[styles.urgentText, { color: "#78350f" }]}>URGENT</Text>
                      </View>
                    ) : null}
                    <View style={[styles.needPill, { backgroundColor: colors.accent }]}>
                      <Feather name="heart" size={11} color={colors.accentForeground} />
                      <Text style={[styles.needText, { color: colors.accentForeground }]}>
                        {NEED_TYPES.find((n) => n.key === item.needType)?.label ?? item.needType}
                      </Text>
                    </View>
                  </View>

                  {item.description ? (
                    <Text
                      style={[styles.itemDesc, { color: colors.mutedForeground }]}
                      numberOfLines={2}
                    >
                      {item.description}
                    </Text>
                  ) : null}

                  <View style={styles.commInfoList}>
                    {item.isPrivate ? (
                      <View style={styles.commInfoRow}>
                        <View style={[styles.commIconCircle, { backgroundColor: colors.muted }]}>
                          <Feather name="eye-off" size={13} color={colors.mutedForeground} />
                        </View>
                        <Text style={[styles.commInfoText, { color: colors.mutedForeground, fontStyle: "italic" }]}>
                          Private request
                        </Text>
                      </View>
                    ) : item.user ? (
                      <View style={styles.commInfoRow}>
                        <View style={[styles.commAvatarCircle, { backgroundColor: colors.accent }]}>
                          <Text style={[styles.commAvatarText, { color: colors.accentForeground }]}>
                            {(item.user.displayName || item.user.username || "?").charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <Text style={[styles.commInfoText, { color: colors.mutedForeground }]}>
                          {item.user.displayName || item.user.username}
                        </Text>
                      </View>
                    ) : null}

                    {item.preferredLocation ? (
                      <View style={styles.commInfoRow}>
                        <View style={[styles.commIconCircle, { backgroundColor: colors.muted }]}>
                          <Feather name="map-pin" size={13} color={colors.mutedForeground} />
                        </View>
                        <Text style={[styles.commInfoText, { color: colors.mutedForeground }]}>
                          {item.preferredLocation}
                        </Text>
                      </View>
                    ) : null}

                    {item.neededDate ? (
                      <View style={styles.commInfoRow}>
                        <View style={[styles.commAvatarCircle, { backgroundColor: colors.accent }]}>
                          <Feather name="calendar" size={13} color={colors.accentForeground} />
                        </View>
                        <View>
                          <Text style={[styles.commInfoText, { color: colors.mutedForeground }]}>
                            Needed: {new Date(item.neededDate).toLocaleDateString()}
                          </Text>
                          {item.returnDate && item.needType === "borrow" ? (
                            <Text style={[styles.commInfoSubText, { color: colors.mutedForeground }]}>
                              Return: {new Date(item.returnDate).toLocaleDateString()}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                  </View>

                  <Pressable
                    style={[styles.commBtn, { backgroundColor: colors.primary }]}
                    onPress={() => router.push("/(tabs)/share")}
                  >
                    <Text style={[styles.commBtnText, { color: colors.primaryForeground }]}>
                      I Have This Item!
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
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
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                    {timeAgo(item.createdAt)}
                  </Text>
                </View>
                <Pressable style={styles.deleteBtn} onPress={() => confirmDelete(item)}>
                  <Feather name="trash-2" size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ),
          )}
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

            <Text style={[styles.label, { color: colors.foreground }]}>I want to</Text>
            <View style={styles.wantGrid}>
              {NEED_TYPE_OPTIONS.map((t) => {
                const active = needTypes.includes(t.key);
                const isGift = t.key === "gift";
                const activeColor = isGift ? "#ec4899" : colors.primary;
                return (
                  <Pressable
                    key={t.key}
                    style={[
                      styles.wantBtn,
                      {
                        backgroundColor: active ? activeColor : colors.muted,
                      },
                    ]}
                    onPress={() => toggleNeedType(t.key)}
                  >
                    <Feather
                      name={t.icon}
                      size={14}
                      color={active ? "#fff" : colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.wantBtnText,
                        { color: active ? "#fff" : colors.mutedForeground },
                      ]}
                    >
                      {t.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.helperNote, { color: colors.mutedForeground }]}>
              Select one or more options
            </Text>

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
    paddingHorizontal: 16,
    paddingBottom: 14,
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
    textAlign: "center",
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
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
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
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
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
  commCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  commAccent: {
    height: 6,
  },
  commBody: {
    padding: 16,
    gap: 10,
  },
  commBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  commInfoList: {
    gap: 10,
  },
  commInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  commIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  commAvatarCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  commAvatarText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  commInfoText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  commInfoSubText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  commBtn: {
    marginTop: 4,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  commBtnText: {
    fontSize: 15,
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
  wantGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  wantBtn: {
    flexBasis: "48%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 20,
  },
  wantBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  helperNote: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
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
