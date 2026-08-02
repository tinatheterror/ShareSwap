import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
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
import { apiGet, apiRequest, photoUrl } from "@/lib/api";
import { NotificationBell } from "@/components/NotificationBell";

// ─── Types ─────────────────────────────────────────────────────────────────────

type StatusKey = "available" | "unavailable" | "lent_out" | "rented_out" | "gifted" | "swapped";
type FilterGroup = "all" | StatusKey;

interface InventoryStatus {
  status: StatusKey;
  label: string;
  canDelete: boolean;
  deleteLabel: string;
  isDisputed?: boolean;
}

interface MyItem {
  id: number;
  name: string;
  description?: string | null;
  photos: string[];
  isAvailable?: boolean;
  isLendable?: boolean;
  isRentable?: boolean;
  isSwappable?: boolean;
  isGift?: boolean;
  isSwapped?: boolean;
  condition?: string | null;
  conditionRating?: number | null;
  tier?: number | null;
  listingExpiresAt?: string | null;
  activeRequest?: {
    status: string;
    requestType: string;
  } | null;
}

// ─── Status logic (mirrors web app exactly) ────────────────────────────────────

const ACTIVE_STATUSES = ["IN_PROGRESS", "HANDOFF_CONFIRMED", "DEPOSIT_CONFIRMED", "AWAITING_HANDOFF_CONFIRM"];

function isListingExpired(item: MyItem): boolean {
  return !!item.listingExpiresAt && new Date(item.listingExpiresAt) <= new Date();
}

function getInventoryStatus(item: MyItem): InventoryStatus {
  if (item.isSwapped) {
    return { status: "swapped", label: "Swapped", canDelete: true, deleteLabel: "Remove from history" };
  }
  const req = item.activeRequest;
  if (req) {
    const s = req.status;
    const t = req.requestType;
    if (s === "HANDOFF_DISPUTED" || s === "DISPUTED") {
      if (t === "RENT") return { status: "rented_out", label: "Rented Out", canDelete: false, deleteLabel: "", isDisputed: true };
      return { status: "lent_out", label: "Lent Out", canDelete: false, deleteLabel: "", isDisputed: true };
    }
    if (ACTIVE_STATUSES.includes(s)) {
      if (t === "RENT") return { status: "rented_out", label: "Rented Out", canDelete: false, deleteLabel: "" };
      return { status: "lent_out", label: "Lent Out", canDelete: false, deleteLabel: "" };
    }
    if (s === "ACCEPTED" || s === "PENDING") {
      return { status: "available", label: "Available", canDelete: false, deleteLabel: "" };
    }
    if (s === "COMPLETED" || s === "COMPLETED_EARLY") {
      if (t === "GIFT") return { status: "gifted", label: "Gifted", canDelete: true, deleteLabel: "Remove from history" };
      if (t === "SWAP") return { status: "swapped", label: "Swapped", canDelete: true, deleteLabel: "Remove from history" };
    }
  }
  if (item.isAvailable && !isListingExpired(item)) {
    return { status: "available", label: "Available", canDelete: true, deleteLabel: "Remove item" };
  }
  return { status: "unavailable", label: "Unavailable", canDelete: true, deleteLabel: "Remove item" };
}

function getStatusColors(status: InventoryStatus): { bg: string; dot: string } {
  if (status.isDisputed) return { bg: "#b91c1c", dot: "#fca5a5" };
  switch (status.status) {
    case "available":    return { bg: "#15803d", dot: "#4ade80" };
    case "unavailable":  return { bg: "#9f1239", dot: "#fb7185" };
    case "lent_out":     return { bg: "#b45309", dot: "#fde68a" };
    case "rented_out":   return { bg: "#92400e", dot: "#fde68a" };
    default:             return { bg: "#4b5563", dot: "#d1d5db" };
  }
}

const TIER_SHARECOINS: Record<number, number> = { 1: 5, 2: 10, 3: 20, 4: 40 };

const STATUS_ORDER: Record<StatusKey, number> = {
  available: 0, lent_out: 1, rented_out: 2, unavailable: 3, gifted: 4, swapped: 5,
};

const STATUS_FILTERS: { key: FilterGroup; label: string }[] = [
  { key: "all", label: "All" },
  { key: "available", label: "Available" },
  { key: "unavailable", label: "Unavailable" },
  { key: "lent_out", label: "Lent Out" },
  { key: "rented_out", label: "Rented Out" },
  { key: "gifted", label: "Gifted" },
  { key: "swapped", label: "Swapped" },
];

const RELIST_OPTIONS = [
  { key: "indefinitely", label: "Indefinitely" },
  { key: "1month", label: "1 month" },
  { key: "3months", label: "3 months" },
  { key: "6months", label: "6 months" },
  { key: "1year", label: "1 year" },
] as const;
type RelistOption = (typeof RELIST_OPTIONS)[number]["key"];

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function MySharedItemsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<FilterGroup>("all");
  const [relistItem, setRelistItem] = useState<MyItem | null>(null);
  const [relistOption, setRelistOption] = useState<RelistOption>("indefinitely");

  const { data: items = [], isLoading } = useQuery<MyItem[]>({
    queryKey: ["/api/my-items"],
    queryFn: () => apiGet<MyItem[]>("/api/my-items"),
    enabled: !!user,
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: number) => apiRequest("DELETE", `/api/items/${itemId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/my-items"] }),
    onError: (err: Error) => Alert.alert("Cannot remove item", err.message || "Please try again."),
  });

  const relistItemMutation = useMutation({
    mutationFn: ({ itemId, availableToDate }: { itemId: number; availableToDate?: string }) =>
      apiRequest("POST", `/api/items/${itemId}/relist`, { availableToDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-items"] });
      setRelistItem(null);
      Alert.alert("Item relisted", "Your item is now live and available to neighbours.");
    },
    onError: (err: Error) => Alert.alert("Could not relist", err.message || "Please try again."),
  });

  function confirmDelete(item: MyItem) {
    const status = getInventoryStatus(item);
    const isPassedOn = status.status === "gifted" || status.status === "swapped";
    Alert.alert(
      isPassedOn ? "Remove from History" : "Remove Item",
      isPassedOn
        ? `Remove "${item.name}" from your history? Transaction records are preserved.`
        : `Remove "${item.name}" from circulation? Transaction history is preserved.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isPassedOn ? "Remove from History" : "Remove Item",
          style: "destructive",
          onPress: () => deleteItemMutation.mutate(item.id),
        },
      ],
    );
  }

  function getRelistExpiry(): string | undefined {
    if (relistOption === "indefinitely") return undefined;
    const end = new Date();
    if (relistOption === "1month") end.setMonth(end.getMonth() + 1);
    else if (relistOption === "3months") end.setMonth(end.getMonth() + 3);
    else if (relistOption === "6months") end.setMonth(end.getMonth() + 6);
    else if (relistOption === "1year") end.setFullYear(end.getFullYear() + 1);
    return end.toISOString().split("T")[0];
  }

  // Counts per status
  const counts: Record<FilterGroup, number> = { all: items.length } as any;
  for (const s of ["available", "unavailable", "lent_out", "rented_out", "gifted", "swapped"] as StatusKey[]) {
    counts[s] = items.filter((i) => getInventoryStatus(i).status === s).length;
  }

  const visibleFilters = STATUS_FILTERS.filter(
    ({ key }) => key === "all" || (counts[key] ?? 0) > 0,
  );

  const filteredItems = items
    .filter((item) => filter === "all" || getInventoryStatus(item).status === filter)
    .sort((a, b) => {
      if (filter !== "all") return 0;
      return STATUS_ORDER[getInventoryStatus(a).status] - STATUS_ORDER[getInventoryStatus(b).status];
    });

  // ─── Render item card ──────────────────────────────────────────────────────

  function renderItem({ item }: { item: MyItem }) {
    const status = getInventoryStatus(item);
    const statusColors = getStatusColors(status);
    const isPassed = status.status === "gifted" || status.status === "swapped";
    const isExpired = status.status === "unavailable" && isListingExpired(item);
    const firstPhoto = item.photos?.[0] ? photoUrl(item.photos[0]) : undefined;

    const caps: string[] = [];
    if (item.isLendable) caps.push("Borrow");
    if (item.isRentable) caps.push("Rent");
    if (item.isSwappable) caps.push("Swap");
    if (item.isGift) caps.push("Gift");

    return (
      <Pressable
        style={[s.card, { backgroundColor: colors.card, opacity: isPassed ? 0.75 : 1 }]}
        onPress={() => !isPassed && router.push(`/item/${item.id}` as never)}
      >
        {/* Thumbnail */}
        <View style={s.thumb}>
          {firstPhoto ? (
            <Image source={{ uri: firstPhoto }} style={s.thumbImg} />
          ) : (
            <View style={[s.thumbPlaceholder, { backgroundColor: colors.muted }]}>
              <Feather name="package" size={32} color={colors.mutedForeground} />
            </View>
          )}

          {/* Edit / Delete overlays — top left */}
          <View style={s.thumbActions}>
            {!isPassed && (
              <Pressable
                style={[s.thumbBtn, { backgroundColor: "rgba(255,255,255,0.92)" }]}
                onPress={() => router.push(`/item/${item.id}` as never)}
                hitSlop={6}
              >
                <Feather name="edit-2" size={13} color="#374151" />
              </Pressable>
            )}
            {status.canDelete && (
              <Pressable
                style={[s.thumbBtn, { backgroundColor: "rgba(255,255,255,0.92)" }]}
                onPress={() => confirmDelete(item)}
                hitSlop={6}
              >
                <Feather name="trash-2" size={13} color="#ef4444" />
              </Pressable>
            )}
          </View>

          {/* Status badge — top right */}
          <View style={[s.statusBadge, { backgroundColor: statusColors.bg }]}>
            <View style={[s.statusDot, { backgroundColor: statusColors.dot }]} />
            <Text style={s.statusLabel}>{status.label}</Text>
          </View>
        </View>

        {/* Card body */}
        <View style={s.body}>
          <Text style={[s.itemName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
          {item.description ? (
            <Text style={[s.itemDesc, { color: colors.mutedForeground }]} numberOfLines={2}>{item.description}</Text>
          ) : null}

          {/* Capabilities */}
          {caps.length > 0 && (
            <View style={s.capRow}>
              {caps.map((c) => (
                <View key={c} style={[s.capChip, { borderColor: colors.border }]}>
                  <Text style={[s.capText, { color: colors.foreground }]}>{c}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Condition */}
          {(item.condition || item.conditionRating) ? (
            <View style={s.metaRow}>
              <Text style={[s.metaLabel, { color: colors.mutedForeground }]}>Condition: </Text>
              <View style={[s.metaChip, { backgroundColor: colors.muted }]}>
                <Text style={[s.metaChipText, { color: colors.foreground }]}>
                  {item.condition || `${item.conditionRating}/10`}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Tier / ShareCoins */}
          {item.tier ? (
            <View style={[s.tierRow, { backgroundColor: colors.muted }]}>
              <Image source={require("../assets/icons/sharecoin.png")} style={s.coinIcon} resizeMode="contain" />
              <Text style={[s.tierCoins, { color: colors.foreground }]}>{TIER_SHARECOINS[item.tier] ?? 5}</Text>
              <Text style={[s.tierLabel, { color: colors.mutedForeground }]}> ShareCoins/week</Text>
              <View style={s.aiBadge}>
                <Feather name="zap" size={10} color="#f59e0b" />
                <Text style={s.aiText}>AI</Text>
              </View>
            </View>
          ) : null}

          {/* Relist prompt */}
          {status.status === "unavailable" && (
            <Pressable
              style={[s.relistRow, { backgroundColor: isExpired ? "#fffbeb" : colors.muted, borderColor: isExpired ? "#fcd34d" : colors.border }]}
              onPress={() => { setRelistOption("indefinitely"); setRelistItem(item); }}
            >
              <View style={{ flex: 1 }}>
                {isExpired ? (
                  <>
                    <Text style={s.relistTitle}>Listing expired</Text>
                    <Text style={s.relistSub}>
                      {new Date(item.listingExpiresAt!).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </Text>
                  </>
                ) : (
                  <Text style={[s.relistTitle, { color: colors.mutedForeground }]}>Ready to share again?</Text>
                )}
              </View>
              <View style={[s.relistBtn, { backgroundColor: "#0DCEA1" }]}>
                <Feather name="refresh-cw" size={11} color="#fff" />
                <Text style={s.relistBtnText}>Relist</Text>
              </View>
            </Pressable>
          )}

          {/* Locked notice */}
          {!status.canDelete && (
            <View style={s.lockedRow}>
              <Feather name="alert-triangle" size={12} color={colors.mutedForeground} />
              <Text style={[s.lockedText, { color: colors.mutedForeground }]}>
                {status.isDisputed
                  ? "Locked — dispute in progress"
                  : status.status === "lent_out" || status.status === "rented_out"
                    ? "Locked while out with a neighbour"
                    : "Locked — active request pending"}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  }

  const topPad = insets.top;

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: topPad + 12, backgroundColor: colors.primary }]}>
        <View style={s.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={s.backBtn}>
            <Feather name="chevron-left" size={24} color="#fff" />
          </Pressable>
          <Text style={[s.headerTitle, { color: "#fff", flex: 1 }]}>My Shared Items</Text>
          <NotificationBell />
        </View>
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filterRow}
        style={[s.filterBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
      >
        {visibleFilters.map(({ key, label }) => (
          <Pressable
            key={key}
            style={[s.filterChip, filter === key && { backgroundColor: colors.primary }]}
            onPress={() => setFilter(key)}
          >
            <Text style={[s.filterChipText, { color: filter === key ? "#fff" : colors.foreground }]}>
              {label} ({counts[key] ?? 0})
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* List */}
      {isLoading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : filteredItems.length === 0 ? (
        <View style={s.centered}>
          <Feather name="package" size={48} color={colors.mutedForeground} />
          <Text style={[s.emptyTitle, { color: colors.foreground }]}>
            {filter === "all" ? "Your ShareChest is empty" : `No ${filter.replace(/_/g, " ")} items`}
          </Text>
          <Text style={[s.emptyDesc, { color: colors.mutedForeground }]}>
            {filter === "all"
              ? "Start sharing by listing your first item."
              : "You don't have any items in this category right now."}
          </Text>
          {filter === "all" && (
            <Pressable
              style={[s.addBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.back()}
            >
              <Text style={s.addBtnText}>List an Item</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Relist modal */}
      <Modal
        visible={!!relistItem}
        transparent
        animationType="slide"
        onRequestClose={() => setRelistItem(null)}
      >
        <View style={s.modalOverlay}>
          <Pressable style={s.modalBackdrop} onPress={() => setRelistItem(null)} />
          <View style={[s.modalSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
            <View style={s.modalHandle} />
            <Text style={[s.modalTitle, { color: colors.foreground }]}>Relist Item</Text>
            <Text style={[s.modalSub, { color: colors.mutedForeground }]}>
              How long to make <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{relistItem?.name}</Text> available?
            </Text>

            <View style={s.optionGrid}>
              {RELIST_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.key}
                  style={[
                    s.optionChip,
                    { borderColor: relistOption === opt.key ? colors.primary : colors.border },
                    relistOption === opt.key && { backgroundColor: colors.primary },
                  ]}
                  onPress={() => setRelistOption(opt.key)}
                >
                  <Text style={[s.optionChipText, { color: relistOption === opt.key ? "#fff" : colors.foreground }]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={s.modalActions}>
              <Pressable
                style={[s.modalCancelBtn, { borderColor: colors.border }]}
                onPress={() => setRelistItem(null)}
              >
                <Text style={[s.modalCancelText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.modalConfirmBtn, { backgroundColor: colors.primary, opacity: relistItemMutation.isPending ? 0.7 : 1 }]}
                disabled={relistItemMutation.isPending}
                onPress={() => relistItem && relistItemMutation.mutate({ itemId: relistItem.id, availableToDate: getRelistExpiry() })}
              >
                {relistItemMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={s.modalConfirmText}>Relist Item</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  backBtn: {
    width: 32,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.4,
  },
  filterBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  filterChipText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  list: {
    padding: 16,
    gap: 16,
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
  emptyDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  addBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  addBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  // ── Card ──
  card: {
    borderRadius: 16,
    overflow: "hidden",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8 },
      android: { elevation: 3 },
    }),
    marginBottom: 0,
  },
  thumb: {
    width: "100%",
    aspectRatio: 16 / 9,
    position: "relative",
  },
  thumbImg: {
    width: "100%",
    height: "100%",
  },
  thumbPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbActions: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    gap: 4,
  },
  thumbBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  statusBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  body: {
    padding: 14,
    gap: 8,
  },
  itemName: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  itemDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  capRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  capChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  capText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  metaLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  metaChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  metaChipText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  coinIcon: {
    width: 14,
    height: 14,
  },
  tierCoins: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  tierLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  aiBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginLeft: 4,
  },
  aiText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: "#f59e0b",
  },
  relistRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  relistTitle: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#92400e",
  },
  relistSub: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: "#b45309",
    marginTop: 1,
  },
  relistBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  relistBtnText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  lockedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: -2,
  },
  lockedText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },

  // ── Relist modal ──
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingTop: 12,
    gap: 14,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
    alignSelf: "center",
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  modalSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    marginTop: -6,
  },
  optionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    minWidth: "30%",
    alignItems: "center",
  },
  optionChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  modalCancelText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  modalConfirmBtn: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
  },
  modalConfirmText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
});
