import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
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
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { NotificationBell } from "@/components/NotificationBell";

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
  // flat user fields returned by /api/all-wishlists (community tab)
  username?: string;
  displayName?: string;
  isVerified?: boolean;
}

const NEED_TYPES = [
  { key: "borrow", label: "Borrow" },
  { key: "rent", label: "Rent" },
  { key: "swap", label: "Swap" },
  { key: "gift", label: "Gift" },
];

const NEED_TYPE_OPTIONS = [
  { key: "borrow", label: "Borrow It", icon: "hand-heart", mci: true },
  { key: "rent", label: "Rent It", icon: "dollar-sign", mci: false },
  { key: "swap", label: "Swap It", icon: "repeat", mci: false },
  { key: "gift", label: "Be Gifted", icon: "gift", mci: false },
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

  const params = useLocalSearchParams<{ prefill?: string; addNew?: string }>();

  const [tab, setTab] = useState<"mine" | "community">("mine");
  const [showAdd, setShowAdd] = useState(false);
  const [itemName, setItemName] = useState("");
  const [description, setDescription] = useState("");
  const [needTypes, setNeedTypes] = useState<string[]>(["borrow"]);
  const [urgency, setUrgency] = useState("normal");
  const [isPrivate, setIsPrivate] = useState(false);
  const [neededFromDate, setNeededFromDate] = useState("");
  const [neededToDate, setNeededToDate] = useState("");
  const [preferredLocation, setPreferredLocation] = useState("");
  React.useEffect(() => {
    if (showAdd) {
      setPreferredLocation(user?.neighbourhood || user?.location || user?.defaultCity || "");
    }
  }, [showAdd]);

  // Auto-open the add form when navigated from search empty state
  React.useEffect(() => {
    if (params.addNew === "1" && params.prefill) {
      setItemName(params.prefill);
      setShowAdd(true);
    }
  }, [params.addNew, params.prefill]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerField, setDatePickerField] = useState<"from" | "to">("from");
  const [datePickerContext, setDatePickerContext] = useState<"add" | "edit">("add");
  const [pickerMonth, setPickerMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const [myFilter, setMyFilter] = useState<"all" | "active" | "expired">("active");

  const [editItem, setEditItem] = useState<WishlistItem | null>(null);
  const [editItemName, setEditItemName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editNeedTypes, setEditNeedTypes] = useState<string[]>(["borrow"]);
  const [editUrgency, setEditUrgency] = useState("normal");
  const [editNeededFromDate, setEditNeededFromDate] = useState("");
  const [editNeededToDate, setEditNeededToDate] = useState("");
  const [editPreferredLocation, setEditPreferredLocation] = useState("");

  function isUrgent(neededDate?: string) {
    if (!neededDate) return false;
    const today = new Date();
    const needed = new Date(neededDate);
    const daysUntilNeeded = Math.ceil((needed.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilNeeded <= 7 && daysUntilNeeded >= 0;
  }

  function checkExpired(item: WishlistItem): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (item.returnDate) return new Date(item.returnDate) < today;
    if (item.neededDate) return new Date(item.neededDate) < today;
    return false;
  }

  function toggleWhenever() {
    if (urgency === "normal") {
      setUrgency("soon");
      setDatePickerField("from");
      setShowDatePicker(true);
    } else {
      setUrgency("normal");
      setNeededFromDate("");
      setNeededToDate("");
    }
  }

  function openDatePicker(field: "from" | "to", context: "add" | "edit" = "add") {
    setDatePickerContext(context);
    setDatePickerField(field);
    setShowDatePicker(true);
  }

  function pickDate(day: number) {
    const y = pickerMonth.getFullYear();
    const m = pickerMonth.getMonth();
    const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (datePickerContext === "edit") {
      if (datePickerField === "from") {
        setEditNeededFromDate(dateStr);
        if (editNeededToDate && editNeededToDate < dateStr) setEditNeededToDate("");
      } else {
        setEditNeededToDate(dateStr);
      }
      setEditUrgency("soon");
    } else {
      if (datePickerField === "from") {
        setNeededFromDate(dateStr);
        if (neededToDate && neededToDate < dateStr) setNeededToDate("");
      } else {
        setNeededToDate(dateStr);
      }
    }
    setShowDatePicker(false);
  }

  function formatNeededDate(dateStr: string) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function toggleNeedType(key: string) {
    setNeedTypes((prev) => {
      if (prev.includes(key)) {
        const next = prev.filter((t) => t !== key);
        return next.length ? next : prev;
      }
      return [...prev, key];
    });
  }

  function toggleEditNeedType(key: string) {
    setEditNeedTypes((prev) => {
      if (prev.includes(key)) {
        const next = prev.filter((t) => t !== key);
        return next.length ? next : prev;
      }
      return [...prev, key];
    });
  }

  function openEdit(item: WishlistItem) {
    setEditItem(item);
    setEditItemName(item.itemName);
    setEditDescription(item.description || "");
    setEditNeedTypes(item.needType ? item.needType.split(",") : ["borrow"]);
    setEditUrgency(item.neededDate ? "soon" : "normal");
    setEditNeededFromDate(item.neededDate || "");
    setEditNeededToDate(item.returnDate || "");
    setEditPreferredLocation(item.preferredLocation || "");
  }

  const { data: myWishlists, isLoading: loadingMine } = useQuery<WishlistItem[]>({
    queryKey: ["/api/my-wishlists"],
    queryFn: () => apiGet<WishlistItem[]>("/api/my-wishlists"),
    enabled: !!user,
  });

  const { data: communityWishlists, isLoading: loadingCommunity } = useQuery<
    WishlistItem[]
  >({
    queryKey: ["/api/all-wishlists"],
    queryFn: () => apiGet<WishlistItem[]>("/api/all-wishlists"),
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
        isPrivate,
        neededDate: neededFromDate || undefined,
        returnDate: neededToDate || undefined,
        preferredLocation: preferredLocation.trim() || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-wishlists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wishlists"] });
      setItemName("");
      setDescription("");
      setNeedTypes(["borrow"]);
      setUrgency("normal");
      setIsPrivate(false);
      setNeededFromDate("");
      setNeededToDate("");
      setPreferredLocation("");
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

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editItem) throw new Error("No item selected");
      if (!editItemName.trim()) throw new Error("Please enter an item name");
      return apiPatch(`/api/wishlists/${editItem.id}`, {
        itemName: editItemName.trim(),
        description: editDescription.trim() || undefined,
        needType: editNeedTypes.join(","),
        urgency: editUrgency,
        neededDate: editNeededFromDate || undefined,
        returnDate: editNeededToDate || undefined,
        preferredLocation: editPreferredLocation.trim() || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-wishlists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wishlists"] });
      setEditItem(null);
    },
    onError: (error: Error) => {
      Alert.alert("Couldn't update wishlist", error.message);
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

  // Augment my wishlists with client-side expiry (server doesn't compute it for /api/my-wishlists)
  const mineWithExpiry = (myWishlists ?? []).map((item) => ({
    ...item,
    isExpired: item.isExpired ?? checkExpired(item),
  }));
  const mineActive = mineWithExpiry.filter((i) => !i.isExpired && i.isActive !== false);
  const mineExpired = mineWithExpiry.filter((i) => i.isExpired);
  const filteredMine =
    myFilter === "active" ? mineActive : myFilter === "expired" ? mineExpired : mineWithExpiry;

  const list = tab === "mine" ? filteredMine : communityWishlists;
  const isLoading = tab === "mine" ? loadingMine : loadingCommunity;

  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.primary, borderBottomColor: "transparent" }]}>
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
          { paddingTop: topPad + 12, backgroundColor: colors.primary, borderBottomColor: "transparent" },
        ]}
      >
        <View style={styles.headerTop}>
          <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>Wishlist</Text>
          <Pressable
            style={[styles.addBtn, { backgroundColor: "rgba(255,255,255,0.25)" }]}
            onPress={() => setShowAdd(true)}
          >
            <Feather name="plus" size={20} color="#fff" />
          </Pressable>
          <NotificationBell />
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
        {tab === "mine" && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {(["active", "expired", "all"] as const).map((f) => {
              const count = f === "active" ? mineActive.length : f === "expired" ? mineExpired.length : mineWithExpiry.length;
              const active = myFilter === f;
              return (
                <Pressable
                  key={f}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: active ? colors.foreground : colors.muted,
                      borderColor: active ? colors.foreground : colors.border,
                    },
                  ]}
                  onPress={() => setMyFilter(f)}
                >
                  <Text style={[styles.filterChipText, { color: active ? "#fff" : colors.mutedForeground, fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular" }]}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                    {count > 0 ? ` · ${count}` : ""}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + (isWeb ? 34 : 0) + 100 }]}
          showsVerticalScrollIndicator={false}
        >
          {tab === "community" && (
            <View style={styles.communitySubtitle}>
              <Text
                style={[styles.communityBannerTitle, { color: colors.foreground }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                Neighbours are looking for these items
              </Text>
              <Text style={[styles.communityBannerSub, { color: colors.mutedForeground }]}>
                Fulfill urgent wishlists and earn extra ShareCoins!
              </Text>
            </View>
          )}
          {!list?.length ? (
            <View style={styles.centered}>
              <Feather name="heart" size={44} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                {tab === "mine"
                  ? myFilter === "expired"
                    ? "No expired items"
                    : myFilter === "active"
                    ? "No active wishlist items"
                    : "Nothing on your wishlist yet"
                  : "No community wishlist items yet"}
              </Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {tab === "mine"
                  ? myFilter === "expired"
                    ? "Items expire once their needed date has passed."
                    : myFilter === "active"
                    ? "Add something you're hoping to borrow, rent, swap, or receive as a gift."
                    : "Add something you're hoping to borrow, rent, swap, or receive as a gift."
                  : "Check back soon to see what neighbours are looking for."}
              </Text>
            </View>
          ) : null}
          {(list ?? []).map((item) =>
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
                  {isUrgent(item.neededDate) ? (
                    <View style={styles.commBadgeRow}>
                      <View style={[styles.urgentPill, { backgroundColor: "#EFE4B0" }]}>
                        <Feather name="clock" size={11} color="#78350f" />
                        <Text style={[styles.urgentText, { color: "#78350f" }]}>URGENT</Text>
                      </View>
                    </View>
                  ) : null}
                  <View style={styles.commBadgeRow}>
                    {(item.needType ?? "").split(",").map(k => k.trim()).filter(Boolean).sort((a, b) => a === "gift" ? 1 : b === "gift" ? -1 : 0).map((key) => {
                      const match = NEED_TYPE_OPTIONS.find((n) => n.key === key);
                      const isGift = key === "gift";
                      const pillBg = isGift ? "#fce7f3" : "#e0fdf8";
                      const pillFg = isGift ? "#be185d" : "#0DCEA1";
                      return (
                        <View key={key} style={[styles.needPill, { backgroundColor: pillBg }]}>
                          {match?.mci ? (
                            <MaterialCommunityIcons name={match.icon as any} size={9} color={pillFg} />
                          ) : (
                            <Feather name={(match?.icon ?? "tag") as any} size={9} color={pillFg} />
                          )}
                          <Text style={[styles.needText, { color: pillFg }]}>{match?.label ?? key}</Text>
                        </View>
                      );
                    })}
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
                    ) : (item.displayName || item.username) ? (
                      <View style={styles.commInfoRow}>
                        <View style={[styles.commAvatarCircle, { backgroundColor: colors.accent }]}>
                          <Text style={[styles.commAvatarText, { color: colors.accentForeground }]}>
                            {(item.displayName || item.username || "?").charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <Text style={[styles.commInfoText, { color: colors.mutedForeground }]}>
                          {item.displayName || item.username}
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

                    <View style={styles.commInfoRow}>
                      <View style={[styles.commAvatarCircle, { backgroundColor: colors.accent }]}>
                        <Feather name="calendar" size={13} color={colors.accentForeground} />
                      </View>
                      <View>
                        <Text style={[styles.commInfoText, { color: colors.mutedForeground }]}>
                          Needed by: {item.neededDate ? new Date(item.neededDate).toLocaleDateString() : "Whenever"}
                        </Text>
                        {item.neededDate && item.returnDate && item.needType === "borrow" ? (
                          <Text style={[styles.commInfoText, { color: colors.mutedForeground, fontSize: 11 }]}>
                            Return: {new Date(item.returnDate).toLocaleDateString()}
                          </Text>
                        ) : null}
                      </View>
                    </View>
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
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: item.isExpired ? 0.65 : 1 }]}
              >
                <View style={styles.cardTop}>
                  <Text style={[styles.itemName, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>
                    {item.itemName}
                  </Text>
                  {item.isExpired ? (
                    <View style={[styles.urgentPill, { backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }]}>
                      <Text style={[styles.urgentText, { color: colors.mutedForeground }]}>EXPIRED</Text>
                    </View>
                  ) : isUrgent(item.neededDate) ? (
                    <View style={[styles.urgentPill, { backgroundColor: "#EFE4B0" }]}>
                      <Feather name="clock" size={11} color="#78350f" />
                      <Text style={[styles.urgentText, { color: "#78350f" }]}>URGENT</Text>
                    </View>
                  ) : null}
                </View>
                {item.description ? (
                  <Text style={[styles.itemDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
                <View style={styles.commBadgeRow}>
                  {(item.needType ?? "").split(",").map(k => k.trim()).filter(Boolean).sort((a, b) => a === "gift" ? 1 : b === "gift" ? -1 : 0).map((key) => {
                    const match = NEED_TYPE_OPTIONS.find((n) => n.key === key);
                    const isGift = key === "gift";
                    const pillBg = isGift ? "#fce7f3" : "#e0fdf8";
                    const pillFg = isGift ? "#be185d" : "#0DCEA1";
                    return (
                      <View key={key} style={[styles.needPill, { backgroundColor: pillBg }]}>
                        {match?.mci ? (
                          <MaterialCommunityIcons name={match.icon as any} size={9} color={pillFg} />
                        ) : (
                          <Feather name={(match?.icon ?? "tag") as any} size={9} color={pillFg} />
                        )}
                        <Text style={[styles.needText, { color: pillFg }]}>{match?.label ?? key}</Text>
                      </View>
                    );
                  })}
                </View>
                <View style={{ gap: 3 }}>
                  <View style={styles.commInfoRow}>
                    <Feather name="calendar" size={12} color={colors.mutedForeground} />
                    <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                      Needed by: {item.neededDate
                        ? formatNeededDate(item.neededDate) + (item.returnDate ? ` – ${formatNeededDate(item.returnDate)}` : "")
                        : "Whenever"}
                    </Text>
                  </View>
                  {item.preferredLocation ? (
                    <View style={styles.commInfoRow}>
                      <Feather name="map-pin" size={12} color={colors.mutedForeground} />
                      <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {item.preferredLocation}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={[styles.cardMeta, { marginTop: 2 }]}>
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                    {timeAgo(item.createdAt)}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 14 }}>
                    <Pressable onPress={() => openEdit(item)}>
                      <Feather name="edit-2" size={15} color={colors.primary} />
                    </Pressable>
                    <Pressable onPress={() => confirmDelete(item)}>
                      <Feather name="trash-2" size={15} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                </View>
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

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
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
            <Text style={[styles.helperNote, { color: colors.mutedForeground }]}>
              Select one or more options
            </Text>
            <View style={styles.wantGrid}>
              {NEED_TYPE_OPTIONS.map((t) => {
                const active = needTypes.includes(t.key);
                const isGift = t.key === "gift";
                const activeColor = isGift ? "#ec4899" : colors.primary;
                const inactiveBg = colors.muted;
                const inactiveBorder = colors.border;
                const inactiveText = colors.mutedForeground;
                return (
                  <Pressable
                    key={t.key}
                    style={[
                      styles.wantBtn,
                      {
                        backgroundColor: active ? activeColor : inactiveBg,
                        borderColor: active ? "transparent" : inactiveBorder,
                        borderWidth: active ? 0 : 1.5,
                      },
                    ]}
                    onPress={() => toggleNeedType(t.key)}
                  >
                    {t.mci ? (
                      <MaterialCommunityIcons
                        name={t.icon as any}
                        size={14}
                        color={active ? "#fff" : inactiveText}
                      />
                    ) : (
                      <Feather
                        name={t.icon as any}
                        size={14}
                        color={active ? "#fff" : inactiveText}
                      />
                    )}
                    <Text
                      style={[
                        styles.wantBtnText,
                        { color: active ? "#fff" : inactiveText },
                      ]}
                    >
                      {t.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.label, { color: colors.foreground }]}>Needed by</Text>

            <View style={styles.neededByRow}>
              <Pressable
                style={[styles.neededByChipDate, { backgroundColor: urgency !== "normal" ? colors.primary : colors.muted, borderColor: urgency !== "normal" ? "transparent" : colors.border }]}
                onPress={() => { if (urgency === "normal") setUrgency("soon"); }}
              >
                <Text style={[styles.neededByChipLabel, { color: urgency !== "normal" ? colors.primaryForeground : colors.mutedForeground }]}>From</Text>
                <Pressable
                  style={[styles.dateBtnCompact, { backgroundColor: "#fff", borderColor: "transparent" }]}
                  onPress={() => { if (urgency === "normal") setUrgency("soon"); openDatePicker("from"); }}
                >
                  <Feather name="calendar" size={12} color={urgency !== "normal" ? "#111827" : colors.mutedForeground} />
                  <Text style={[styles.dateBtnCompactText, { color: urgency !== "normal" ? "#111827" : colors.mutedForeground }]} numberOfLines={1}>
                    {neededFromDate ? formatNeededDate(neededFromDate) : "Select"}
                  </Text>
                </Pressable>
                <Text style={[styles.neededByChipLabel, { color: urgency !== "normal" ? colors.primaryForeground : colors.mutedForeground }]}>To</Text>
                <Pressable
                  style={[styles.dateBtnCompact, { backgroundColor: "#fff", borderColor: "transparent" }]}
                  onPress={() => { if (urgency === "normal") setUrgency("soon"); openDatePicker("to"); }}
                >
                  <Feather name="calendar" size={12} color={urgency !== "normal" ? "#111827" : colors.mutedForeground} />
                  <Text style={[styles.dateBtnCompactText, { color: urgency !== "normal" ? "#111827" : colors.mutedForeground }]} numberOfLines={1}>
                    {neededToDate ? formatNeededDate(neededToDate) : "Select"}
                  </Text>
                </Pressable>
              </Pressable>

              <Pressable
                style={[styles.neededByChip, { backgroundColor: urgency === "normal" ? colors.primary : colors.muted, borderColor: urgency === "normal" ? "transparent" : colors.border }]}
                onPress={() => { setUrgency("normal"); setNeededFromDate(""); setNeededToDate(""); }}
              >
                <Text style={[styles.neededByChipText, { color: urgency === "normal" ? colors.primaryForeground : colors.mutedForeground }]}>
                  Whenever
                </Text>
              </Pressable>
            </View>

            <Text style={[styles.label, { color: colors.foreground }]}>Preferred Location</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }]}
              placeholder="e.g. Downtown, Westside…"
              placeholderTextColor={colors.mutedForeground}
              value={preferredLocation}
              onChangeText={setPreferredLocation}
            />

            <View style={[styles.privateRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Switch
                value={isPrivate}
                onValueChange={setIsPrivate}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
              <View style={{ flex: 1 }}>
                <View style={styles.privateRowHeader}>
                  <Feather name="eye-off" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.privateRowTitle, { color: colors.foreground }]}>Private request</Text>
                </View>
                {isPrivate ? (
                  <Text style={[styles.privateRowHint, { color: colors.mutedForeground }]}>
                    Your name will be hidden until you send a request for an item someone offers.
                  </Text>
                ) : null}
              </View>
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
            </ScrollView>

            {/* Inline calendar — avoids stacking two Modals which breaks touches on iOS */}
            {showDatePicker && datePickerContext === "add" && (
              <Pressable style={styles.inlineDatePickerOverlay} onPress={() => setShowDatePicker(false)}>
                <Pressable style={[styles.datePickerCard, { backgroundColor: colors.card }]} onPress={() => {}}>
                  <View style={styles.datePickerHeader}>
                    <Pressable onPress={() => setPickerMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}>
                      <Feather name="chevron-left" size={20} color={colors.foreground} />
                    </Pressable>
                    <View style={{ alignItems: "center" }}>
                      <Text style={[styles.datePickerSubtitle, { color: colors.mutedForeground }]}>
                        {datePickerField === "from" ? "Select start date" : "Select end date"}
                      </Text>
                      <Text style={[styles.datePickerTitle, { color: colors.foreground }]}>
                        {pickerMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                      </Text>
                    </View>
                    <Pressable onPress={() => setPickerMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}>
                      <Feather name="chevron-right" size={20} color={colors.foreground} />
                    </Pressable>
                  </View>
                  <View style={styles.datePickerWeekRow}>
                    {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                      <Text key={i} style={[styles.datePickerWeekDay, { color: colors.mutedForeground }]}>{d}</Text>
                    ))}
                  </View>
                  <View style={styles.datePickerGrid}>
                    {(() => {
                      const year = pickerMonth.getFullYear();
                      const month = pickerMonth.getMonth();
                      const firstDayOfWeek = new Date(year, month, 1).getDay();
                      const daysInMonth = new Date(year, month + 1, 0).getDate();
                      const today = new Date(); today.setHours(0, 0, 0, 0);
                      const cells: (number | null)[] = [...Array(firstDayOfWeek).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
                      return cells.map((day, idx) => {
                        if (day === null) return <View key={idx} style={styles.datePickerCell} />;
                        const cellDate = new Date(year, month, day);
                        const isPast = cellDate < today;
                        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                        const isBeforeFrom = datePickerField === "to" && !!neededFromDate && dateStr < neededFromDate;
                        const isDisabled = isPast || isBeforeFrom;
                        const isSelected = datePickerField === "from" ? neededFromDate === dateStr : neededToDate === dateStr;
                        return (
                          <Pressable key={idx} style={[styles.datePickerCell, isSelected ? { backgroundColor: colors.primary, borderRadius: 8 } : null]} disabled={isDisabled} onPress={() => pickDate(day)}>
                            <Text style={[styles.datePickerDayText, { color: isSelected ? colors.primaryForeground : isDisabled ? colors.border : colors.foreground }]}>{day}</Text>
                          </Pressable>
                        );
                      });
                    })()}
                  </View>
                </Pressable>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={!!editItem} animationType="slide" transparent onRequestClose={() => setEditItem(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit Wishlist Item</Text>
              <Pressable onPress={() => setEditItem(null)}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[styles.label, { color: colors.foreground }]}>What are you looking for?</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
                placeholder="e.g. Pressure washer"
                placeholderTextColor={colors.mutedForeground}
                value={editItemName}
                onChangeText={setEditItemName}
              />
              <Text style={[styles.label, { color: colors.foreground }]}>Details (optional)</Text>
              <TextInput
                style={[styles.input, styles.textArea, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
                placeholder="Any specifics that would help neighbours..."
                placeholderTextColor={colors.mutedForeground}
                value={editDescription}
                onChangeText={setEditDescription}
                multiline
                numberOfLines={3}
              />
              <Text style={[styles.label, { color: colors.foreground }]}>I want to</Text>
              <Text style={[styles.helperNote, { color: colors.mutedForeground }]}>Select one or more options</Text>
              <View style={styles.wantGrid}>
                {NEED_TYPE_OPTIONS.map((t) => {
                  const active = editNeedTypes.includes(t.key);
                  const isGift = t.key === "gift";
                  const activeColor = isGift ? "#ec4899" : colors.primary;
                  const inactiveBg = colors.muted;
                  const inactiveBorder = colors.border;
                  const inactiveText = colors.mutedForeground;
                  return (
                    <Pressable
                      key={t.key}
                      style={[styles.wantBtn, { backgroundColor: active ? activeColor : inactiveBg, borderColor: active ? "transparent" : inactiveBorder, borderWidth: active ? 0 : 1.5 }]}
                      onPress={() => toggleEditNeedType(t.key)}
                    >
                      {t.mci ? (
                        <MaterialCommunityIcons name={t.icon as any} size={14} color={active ? "#fff" : inactiveText} />
                      ) : (
                        <Feather name={t.icon as any} size={14} color={active ? "#fff" : inactiveText} />
                      )}
                      <Text style={[styles.wantBtnText, { color: active ? "#fff" : inactiveText }]}>{t.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.label, { color: colors.foreground }]}>Needed by</Text>
              <View style={styles.neededByRow}>
                <Pressable
                  style={[styles.neededByChipDate, { backgroundColor: editUrgency !== "normal" ? colors.primary : colors.muted, borderColor: editUrgency !== "normal" ? "transparent" : colors.border }]}
                  onPress={() => { if (editUrgency === "normal") setEditUrgency("soon"); }}
                >
                  <Text style={[styles.neededByChipLabel, { color: editUrgency !== "normal" ? colors.primaryForeground : colors.mutedForeground }]}>From</Text>
                  <Pressable
                    style={[styles.dateBtnCompact, { backgroundColor: "#fff", borderColor: "transparent" }]}
                    onPress={() => { if (editUrgency === "normal") setEditUrgency("soon"); openDatePicker("from", "edit"); }}
                  >
                    <Feather name="calendar" size={12} color={editUrgency !== "normal" ? "#111827" : colors.mutedForeground} />
                    <Text style={[styles.dateBtnCompactText, { color: editUrgency !== "normal" ? "#111827" : colors.mutedForeground }]} numberOfLines={1}>
                      {editNeededFromDate ? formatNeededDate(editNeededFromDate) : "Select"}
                    </Text>
                  </Pressable>
                  <Text style={[styles.neededByChipLabel, { color: editUrgency !== "normal" ? colors.primaryForeground : colors.mutedForeground }]}>To</Text>
                  <Pressable
                    style={[styles.dateBtnCompact, { backgroundColor: "#fff", borderColor: "transparent" }]}
                    onPress={() => { if (editUrgency === "normal") setEditUrgency("soon"); openDatePicker("to", "edit"); }}
                  >
                    <Feather name="calendar" size={12} color={editUrgency !== "normal" ? "#111827" : colors.mutedForeground} />
                    <Text style={[styles.dateBtnCompactText, { color: editUrgency !== "normal" ? "#111827" : colors.mutedForeground }]} numberOfLines={1}>
                      {editNeededToDate ? formatNeededDate(editNeededToDate) : "Select"}
                    </Text>
                  </Pressable>
                </Pressable>
                <Pressable
                  style={[styles.neededByChip, { backgroundColor: editUrgency === "normal" ? colors.primary : colors.muted, borderColor: editUrgency === "normal" ? "transparent" : colors.border }]}
                  onPress={() => { setEditUrgency("normal"); setEditNeededFromDate(""); setEditNeededToDate(""); }}
                >
                  <Text style={[styles.neededByChipText, { color: editUrgency === "normal" ? colors.primaryForeground : colors.mutedForeground }]}>Whenever</Text>
                </Pressable>
              </View>
              <Text style={[styles.label, { color: colors.foreground }]}>Preferred Location</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }]}
                placeholder="e.g. Downtown, Westside…"
                placeholderTextColor={colors.mutedForeground}
                value={editPreferredLocation}
                onChangeText={setEditPreferredLocation}
              />
              <Pressable
                style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: updateMutation.isPending ? 0.7 : 1 }]}
                onPress={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.submitBtnText, { color: colors.primaryForeground }]}>Save Changes</Text>
                )}
              </Pressable>
            </ScrollView>

            {/* Inline calendar — avoids stacking two Modals which breaks touches on iOS */}
            {showDatePicker && datePickerContext === "edit" && (
              <Pressable style={styles.inlineDatePickerOverlay} onPress={() => setShowDatePicker(false)}>
                <Pressable style={[styles.datePickerCard, { backgroundColor: colors.card }]} onPress={() => {}}>
                  <View style={styles.datePickerHeader}>
                    <Pressable onPress={() => setPickerMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}>
                      <Feather name="chevron-left" size={20} color={colors.foreground} />
                    </Pressable>
                    <View style={{ alignItems: "center" }}>
                      <Text style={[styles.datePickerSubtitle, { color: colors.mutedForeground }]}>
                        {datePickerField === "from" ? "Select start date" : "Select end date"}
                      </Text>
                      <Text style={[styles.datePickerTitle, { color: colors.foreground }]}>
                        {pickerMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                      </Text>
                    </View>
                    <Pressable onPress={() => setPickerMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}>
                      <Feather name="chevron-right" size={20} color={colors.foreground} />
                    </Pressable>
                  </View>
                  <View style={styles.datePickerWeekRow}>
                    {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                      <Text key={i} style={[styles.datePickerWeekDay, { color: colors.mutedForeground }]}>{d}</Text>
                    ))}
                  </View>
                  <View style={styles.datePickerGrid}>
                    {(() => {
                      const year = pickerMonth.getFullYear();
                      const month = pickerMonth.getMonth();
                      const firstDayOfWeek = new Date(year, month, 1).getDay();
                      const daysInMonth = new Date(year, month + 1, 0).getDate();
                      const today = new Date(); today.setHours(0, 0, 0, 0);
                      const cells: (number | null)[] = [...Array(firstDayOfWeek).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
                      return cells.map((day, idx) => {
                        if (day === null) return <View key={idx} style={styles.datePickerCell} />;
                        const cellDate = new Date(year, month, day);
                        const isPast = cellDate < today;
                        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                        const isBeforeFrom = datePickerField === "to" && !!editNeededFromDate && dateStr < editNeededFromDate;
                        const isDisabled = isPast || isBeforeFrom;
                        const isSelected = datePickerField === "from" ? editNeededFromDate === dateStr : editNeededToDate === dateStr;
                        return (
                          <Pressable key={idx} style={[styles.datePickerCell, isSelected ? { backgroundColor: colors.primary, borderRadius: 8 } : null]} disabled={isDisabled} onPress={() => pickDate(day)}>
                            <Text style={[styles.datePickerDayText, { color: isSelected ? colors.primaryForeground : isDisabled ? colors.border : colors.foreground }]}>{day}</Text>
                          </Pressable>
                        );
                      });
                    })()}
                  </View>
                </Pressable>
              </Pressable>
            )}
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
  filterRow: {
    flexDirection: "row",
    gap: 5,
    paddingTop: 10,
    paddingRight: 4,
  },
  filterChip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 11,
  },
  communitySubtitle: {
    paddingBottom: 4,
  },
  communityBannerTitle: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },
  communityBannerSub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    gap: 5,
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
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  urgentText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  itemDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    marginVertical: 3,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  needPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 6,
  },
  needText: {
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
  },
  metaText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  deleteBtn: {
    position: "absolute",
    top: 8,
    right: 8,
  },
  commCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  commAccent: {
    height: 4,
  },
  commBody: {
    padding: 10,
    gap: 6,
  },
  commBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    flexWrap: "nowrap",
  },
  commInfoList: {
    gap: 6,
  },
  commInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  commIconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  commAvatarCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
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
    marginTop: 2,
    paddingVertical: 8,
    borderRadius: 10,
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
    maxHeight: "85%",
  },
  modalScroll: {
    flexShrink: 1,
  },
  modalScrollContent: {
    gap: 10,
    paddingBottom: 12,
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
    borderWidth: 1,
  },
  wantBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  helperNote: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 0,
    lineHeight: 14,
  },
  privateRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  privateRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  privateRowTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  privateRowHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
  },
  neededByRow: {
    flexDirection: "column",
    gap: 8,
  },
  neededByChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  neededByChipText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  neededByChipDate: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  neededByChipLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    flexShrink: 0,
  },
  dateBtnCompact: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 0,
  },
  dateBtnCompactText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    flexShrink: 1,
  },
  dateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  dateBtnText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    flexShrink: 1,
  },
  inlineDatePickerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    borderRadius: 16,
    zIndex: 20,
  },
  datePickerCard: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 16,
    padding: 16,
  },
  datePickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  datePickerSubtitle: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  datePickerTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  datePickerWeekRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  datePickerWeekDay: {
    flex: 1,
    textAlign: "center",
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  datePickerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  datePickerCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  datePickerDayText: {
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
