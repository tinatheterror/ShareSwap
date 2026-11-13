/**
 * CounterProposalSheet
 * Matches the web inbox panel's (chat-widget.tsx) "Propose New Terms" modal + SwapCounterModal logic.
 *
 * BORROW  → deposit method (in_app/in_person) + date range
 * RENT    → date range only (no deposit toggle)
 * SWAP    → my items picker + their items picker + counter note
 */
import React, { useState, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Camera, Check, Coins, ExternalLink } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { apiGet, photoUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { MAX_SWAP_OFFSET, calcSwap, getTierSC } from "@/components/SwapInventorySelector";
import { SwapFairnessSummary } from "@/components/SwapFairnessSummary";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RequestItem {
  id: number;
  name: string | null;
  photos: string[] | null;
  ownerId: number | null;
  tier: number | null;
}

interface ItemRequest {
  id: number;
  requestType: string;
  depositMethod: string | null;
  deliveryMethod: string | null;
  startDate: string | null;
  endDate: string | null;
  counterDepositMethod: string | null;
  counterStartDate: string | null;
  counterEndDate: string | null;
  counterRound: number | null;
  counterProposedBy: number | null;
  swapOfferedItemIds: number[] | null;
  swapOfferedItems?: { id: number; name: string; photos: string[] | null; tier?: number | null }[];
  counterSwapOwnerItemIds: number[] | null;
  counterSwapRequesterItemIds: number[] | null;
  counterNote: string | null;
  item: RequestItem | null;
}

interface SwapEligibleItem {
  id: number;
  name: string;
  photos: string[] | null;
  tier: number | null;
}

export interface CounterPayload {
  // BORROW / RENT
  depositMethod?: string;
  deliveryMethod?: string;
  startDate?: string;
  endDate?: string;
  // SWAP
  swapOwnerItemIds?: number[];
  swapRequesterItemIds?: number[];
  counterNote?: string;
  isResponse?: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  request: ItemRequest;
  isOwner: boolean;
  partnerId: number | null;
  onSubmit: (payload: CounterPayload) => void;
  isPending: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRIMARY = "#0DCEA1";

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const datePart = s.split("T")[0];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    const day = Number(match[3]);
    const d = new Date(y, m - 1, day);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toISODateStr(d: Date): string {
  // Returns YYYY-MM-DD in local time
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── Item card for SWAP picker (same look as the swap request modal) ──────────

const GRID_GAP = 6;
const GRID_COLS = 3;

function SwapItemChip({
  item,
  selected,
  onToggle,
  onExpand,
  width,
  variant,
}: {
  item: SwapEligibleItem;
  selected: boolean;
  onToggle: (id: number) => void;
  /** Opens the item's details page (their items only, as in the swap request modal). */
  onExpand?: (id: number) => void;
  width: number;
  variant: "mine" | "theirs";
}) {
  const colors = useColors();
  const uri = photoUrl(item.photos?.[0]);
  const mine = variant === "mine";

  return (
    <Pressable
      onPress={() => onToggle(item.id)}
      style={[
        chipStyles.card,
        {
          width,
          borderColor: selected ? (mine ? PRIMARY : "#f59e0b") : colors.border,
          backgroundColor: selected ? (mine ? "#E6FBF5" : "#fffbeb") : colors.background,
        },
      ]}
    >
      <View style={[chipStyles.img, { height: width * (4 / 5), backgroundColor: colors.muted }]}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Camera size={14} color={colors.mutedForeground} strokeWidth={1.5} />
        )}
        {selected && (
          <View style={[chipStyles.checkOverlay, { backgroundColor: mine ? "rgba(13,206,161,0.3)" : "rgba(245,158,11,0.3)" }]}>
            <Check size={16} color={mine ? "#fff" : "#92400e"} strokeWidth={2.5} />
          </View>
        )}
        {onExpand && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View item details"
            hitSlop={8}
            style={chipStyles.expandBtn}
            onPress={() => onExpand(item.id)}
          >
            <ExternalLink size={10} color="#57534e" strokeWidth={2} />
          </Pressable>
        )}
      </View>
      <View style={chipStyles.info}>
        <Text style={[chipStyles.name, { color: colors.foreground }]} numberOfLines={2}>
          {item.name}
        </Text>
        <View style={chipStyles.scRow}>
          <Coins size={9} color={colors.mutedForeground} strokeWidth={2} />
          <Text style={[chipStyles.sc, { color: colors.mutedForeground }]}>{getTierSC(item.tier)} ShareCoins</Text>
        </View>
      </View>
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
  card: { borderRadius: 8, borderWidth: 1, overflow: "hidden" },
  img: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  checkOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  expandBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    padding: 3,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.85)",
  },
  info: { padding: 5 },
  name: { fontSize: 10, fontFamily: "Inter_500Medium", lineHeight: 13 },
  scRow: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 },
  sc: { fontSize: 9, fontFamily: "Inter_400Regular" },
});

// ── DateButton ────────────────────────────────────────────────────────────────

function DateButton({
  label,
  date,
  onPress,
  colors,
}: {
  label: string;
  date: Date | null;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        ss.dateBtn,
        { borderColor: colors.border, backgroundColor: colors.background },
      ]}
    >
      <Text style={[ss.dateBtnLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[ss.dateBtnValue, { color: date ? colors.foreground : colors.mutedForeground }]}>
        {date ? formatDate(date) : "Select…"}
      </Text>
    </Pressable>
  );
}

function WebDateInput({
  label,
  date,
  minimumDate,
  onChange,
  colors,
}: {
  label: string;
  date: Date | null;
  minimumDate: Date;
  onChange: (date: Date | null) => void;
  colors: ReturnType<typeof useColors>;
}) {
  if (Platform.OS !== "web") return null;

  return (
    <View
      style={[
        ss.dateBtn,
        { borderColor: colors.border, backgroundColor: colors.background },
      ]}
    >
      <Text style={[ss.dateBtnLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {React.createElement("input", {
        type: "date",
        value: date ? toISODateStr(date) : "",
        min: toISODateStr(minimumDate),
        "aria-label": `${label} date`,
        onChange: (event: { currentTarget: { value: string } }) => {
          const value = event.currentTarget.value;
          onChange(value ? new Date(`${value}T12:00:00`) : null);
        },
        style: {
          width: "100%",
          minWidth: 0,
          border: "none",
          outline: "none",
          padding: 0,
          background: "transparent",
          color: colors.foreground,
          fontFamily: "inherit",
          fontSize: "13px",
        } as any,
      })}
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CounterProposalSheet({
  visible,
  onClose,
  request,
  isOwner,
  partnerId,
  onSubmit,
  isPending,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  // Three cards a row inside the sheet's 20px padding, as in the swap request modal.
  const cardWidth = (screenWidth - 40 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
  /** Opens an item's details page; the sheet closes first so the page is not hidden behind it. */
  function openItemDetails(id: number) {
    onClose();
    router.push(`/item/${id}` as never);
  }

  const isSwap = request.requestType === "SWAP";
  const isBorrow = request.requestType === "BORROW";
  const isResponse = request.counterProposedBy !== null && request.counterProposedBy !== user?.id;
  const maxRoundsReached = (request.counterRound ?? 0) >= 2;

  // ── BORROW / RENT state ───────────────────────────────────────────────────
  const [depositMethod, setDepositMethod] = useState<"in_app" | "in_person">("in_app");
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // ── SWAP state ────────────────────────────────────────────────────────────
  const [ownerItemIds, setOwnerItemIds] = useState<number[]>([]);
  const [requesterItemIds, setRequesterItemIds] = useState<number[]>([]);

  // Pre-fill on open (matches web handleRequestChange logic)
  useEffect(() => {
    if (!visible) return;

    if (!isSwap) {
      // Pre-fill with counter terms if responding, otherwise original terms
      const depMethod = (request.counterDepositMethod || request.depositMethod || "in_app") as "in_app" | "in_person";
      setDepositMethod(depMethod);
      const sd = parseDate(request.counterStartDate || request.startDate);
      const ed = parseDate(request.counterEndDate || request.endDate);
      setStartDate(sd);
      setEndDate(ed);
    } else {
      // SWAP: pre-fill with existing counter swap selections if any
      const initOwner = request.counterSwapOwnerItemIds?.length
        ? request.counterSwapOwnerItemIds
        : request.item?.id ? [request.item.id] : [];
      const initRequester = request.counterSwapRequesterItemIds?.length
        ? request.counterSwapRequesterItemIds
        : (request.swapOfferedItemIds ?? []);
      setOwnerItemIds(initOwner);
      setRequesterItemIds(initRequester);
    }
  }, [visible, request.id]);

  // ── SWAP item queries ─────────────────────────────────────────────────────
  const { data: mySwapItems = [], isLoading: myLoading } = useQuery<SwapEligibleItem[]>({
    queryKey: ["/api/swap-eligible-items", "me"],
    queryFn: () => apiGet<SwapEligibleItem[]>("/api/swap-eligible-items"),
    enabled: visible && isSwap,
    staleTime: 30_000,
  });

  const { data: partnerSwapItems = [], isLoading: partnerLoading } = useQuery<SwapEligibleItem[]>({
    queryKey: ["/api/swap-eligible-items", partnerId],
    queryFn: () => apiGet<SwapEligibleItem[]>(`/api/swap-eligible-items?partnerId=${partnerId}`),
    enabled: visible && isSwap && !!partnerId,
    staleTime: 30_000,
  });

  // Build item panels from owner/requester perspective (mirrors web SwapCounterModal)
  const ownerItem = request.item;
  const ownerPanelItems: SwapEligibleItem[] = isOwner
    ? (ownerItem && !mySwapItems.some((i) => i.id === ownerItem.id)
        ? [{ id: ownerItem.id, name: ownerItem.name ?? "Item", photos: ownerItem.photos, tier: ownerItem.tier }, ...mySwapItems]
        : mySwapItems)
    : partnerSwapItems;

  const requesterPanelItems: SwapEligibleItem[] = isOwner ? partnerSwapItems : mySwapItems;

  // From the viewer's side, as on web: "Your Swap Items" are the owner's items when you own the listing, the requester's otherwise.
  const myPanelItems = isOwner ? ownerPanelItems : requesterPanelItems;
  const theirPanelItems = isOwner ? requesterPanelItems : ownerPanelItems;
  const mySelectedIds = isOwner ? ownerItemIds : requesterItemIds;
  const theirSelectedIds = isOwner ? requesterItemIds : ownerItemIds;
  const setMySelectedIds = isOwner ? setOwnerItemIds : setRequesterItemIds;
  const setTheirSelectedIds = isOwner ? setRequesterItemIds : setOwnerItemIds;

  // ShareCoin value of each side's selection (a selected item missing from the lists falls back to what the request carries).
  const knownItems = new Map<number, { tier?: number | null }>();
  for (const i of [...(request.swapOfferedItems ?? []), ...(request.item ? [request.item] : [])]) knownItems.set(i.id, i);
  for (const i of [...ownerPanelItems, ...requesterPanelItems]) knownItems.set(i.id, i);
  const sideValue = (ids: number[]) => ids.reduce((sum, id) => sum + (knownItems.has(id) ? getTierSC(knownItems.get(id)?.tier) : 0), 0);
  const myValue = sideValue(mySelectedIds);
  const theirValue = sideValue(theirSelectedIds);
  const showSwapSummary = isSwap && mySelectedIds.length > 0 && theirSelectedIds.length > 0;
  const swapResult = calcSwap(myValue, theirValue);

  // ── Validation & submit ───────────────────────────────────────────────────
  function handleSubmit() {
    if (isSwap) {
      if (ownerItemIds.length === 0 || requesterItemIds.length === 0) {
        Alert.alert("Select items", "Please select at least one item on each side.");
        return;
      }
      onSubmit({
        swapOwnerItemIds: ownerItemIds,
        swapRequesterItemIds: requesterItemIds,
        counterNote: "", // the sheet no longer takes a note; an empty one is what an unwritten note always sent
        isResponse,
      });
    } else {
      // BORROW / RENT: validate date order
      if (startDate && endDate && endDate < startDate) {
        Alert.alert("Invalid dates", "End date cannot be before start date.");
        return;
      }
      onSubmit({
        depositMethod: isBorrow ? depositMethod : undefined,
        deliveryMethod: "in_person",
        startDate: startDate ? toISODateStr(startDate) : undefined,
        endDate: endDate ? toISODateStr(endDate) : undefined,
      });
    }
  }

  // ── Current terms summary display ─────────────────────────────────────────
  function renderCurrentTerms() {
    const roleLabel = isResponse ? "Their proposed terms:" : "Requester's requested terms:";
    const sd = parseDate(isResponse ? request.counterStartDate : request.startDate);
    const ed = parseDate(isResponse ? request.counterEndDate : request.endDate);
    const dep = (isResponse ? request.counterDepositMethod : request.depositMethod) || null;
    return (
      <View style={[ss.currentTermsBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        <Text style={[ss.currentTermsLabel, { color: colors.mutedForeground }]}>{roleLabel}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {isBorrow && dep && (
            <View style={[ss.termsBadge, { borderColor: colors.border }]}>
              <Text style={[ss.termsBadgeText, { color: colors.foreground }]}>
                Deposit: {dep === "in_app" ? "In-app" : "In-person"}
              </Text>
            </View>
          )}
          {sd && ed && (
            <View style={[ss.termsBadge, { borderColor: colors.border }]}>
              <Text style={[ss.termsBadgeText, { color: colors.foreground }]}>
                {formatDate(sd)} – {formatDate(ed)}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Full-screen wrapper so backdrop fills everything and sheet sits at the bottom */}
      <View style={ss.modalOuter}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View
          style={[
            ss.sheet,
            { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 },
          ]}
        >
          <View style={[ss.handle, { backgroundColor: colors.border }]} />
          <Text style={[ss.title, { color: colors.foreground }]}>Propose new terms</Text>
          {/* maxHeight instead of flex:1 — parent doesn't own the full height */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 440 }}
            contentContainerStyle={{ gap: 16, paddingBottom: 8 }}
          >
          {/* ── BORROW / RENT ────────────────────────────────────────────── */}
          {!isSwap && (
            <>
              {/* Deposit method — BORROW only */}
              {isBorrow && (
                <View style={ss.section}>
                  <Text style={[ss.sectionLabel, { color: colors.foreground }]}>
                    Your deposit preference
                  </Text>
                  {(["in_app", "in_person"] as const).map((m) => {
                    const active = depositMethod === m;
                    return (
                      <Pressable
                        key={m}
                        onPress={() => setDepositMethod(m)}
                        style={[
                          ss.radioRow,
                          { borderColor: active ? PRIMARY : colors.border, backgroundColor: active ? "#f0fdf4" : colors.background },
                        ]}
                      >
                        <View style={[ss.radioCircle, { borderColor: active ? PRIMARY : colors.border }]}>
                          {active && <View style={[ss.radioDot, { backgroundColor: PRIMARY }]} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[ss.radioTitle, { color: colors.foreground }]}>
                            {m === "in_app" ? "In-app (temporary card hold)" : "In-person (cash at handoff)"}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                  {depositMethod === "in_person" && (
                    <View style={[ss.warnBox, { backgroundColor: "#fffbeb", borderColor: "#fde68a" }]}>
                      <Text style={{ color: "#92400e", fontSize: 12, lineHeight: 17 }}>
                        ⚠️ ShareSwap is not responsible for in-person deposits. You assume full responsibility for collection, return, and any disputes — no platform protection applies.
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Date range */}
              <View style={ss.section}>
                <Text style={[ss.sectionLabel, { color: colors.foreground }]}>Date range</Text>
                {Platform.OS === "web" ? (
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <WebDateInput
                      label="Start"
                      date={startDate}
                      minimumDate={today}
                      onChange={(date) => {
                        setStartDate(date);
                        if (date && endDate && date > endDate) setEndDate(null);
                      }}
                      colors={colors}
                    />
                    <WebDateInput
                      label="End"
                      date={endDate}
                      minimumDate={startDate ?? today}
                      onChange={setEndDate}
                      colors={colors}
                    />
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <DateButton
                      label="Start"
                      date={startDate}
                      onPress={() => setShowStartPicker(true)}
                      colors={colors}
                    />
                    <DateButton
                      label="End"
                      date={endDate}
                      onPress={() => setShowEndPicker(true)}
                      colors={colors}
                    />
                  </View>
                )}
              </View>

              {/* Native date pickers */}
              {Platform.OS !== "web" && showStartPicker && (
                <DateTimePicker
                  value={startDate ?? today}
                  mode="date"
                  display={Platform.OS === "ios" ? "inline" : "default"}
                  minimumDate={today}
                  onChange={(_, date) => {
                    setShowStartPicker(Platform.OS === "ios");
                    if (date) {
                      setStartDate(date);
                      // Clear end date if it's before the new start
                      if (endDate && date > endDate) setEndDate(null);
                    }
                  }}
                />
              )}
              {Platform.OS !== "web" && showEndPicker && (
                <DateTimePicker
                  value={endDate ?? startDate ?? today}
                  mode="date"
                  display={Platform.OS === "ios" ? "inline" : "default"}
                  minimumDate={startDate ?? today}
                  onChange={(_, date) => {
                    setShowEndPicker(Platform.OS === "ios");
                    if (date) setEndDate(date);
                  }}
                />
              )}
            </>
          )}

          {/* ── SWAP ─────────────────────────────────────────────────────── */}
          {isSwap && (
            <>
              {(myLoading || partnerLoading) ? (
                <View style={{ alignItems: "center", paddingVertical: 24 }}>
                  <ActivityIndicator color={PRIMARY} />
                  <Text style={[{ color: colors.mutedForeground, fontSize: 12, marginTop: 8 }]}>
                    Loading items…
                  </Text>
                </View>
              ) : maxRoundsReached ? (
                <View style={[ss.warnBox, { backgroundColor: "#fef9c3", borderColor: "#fde68a" }]}>
                  <Text style={{ color: "#92400e", fontSize: 13 }}>
                    Maximum counter rounds reached. Please accept or decline.
                  </Text>
                </View>
              ) : (
                <>
                  {/* My items */}
                  <View style={ss.section}>
                    <Text style={[ss.sectionLabel, { color: "#0f766e" }]}>
                      Your Swap Items
                    </Text>
                    {myPanelItems.length === 0 ? (
                      <Text style={[ss.emptyText, { color: colors.mutedForeground }]}>
                        No swap-eligible items in your ShareChest.
                      </Text>
                    ) : (
                      <View style={ss.itemGrid}>
                        {myPanelItems.map((item) => (
                          <SwapItemChip
                            key={item.id}
                            item={item}
                            selected={mySelectedIds.includes(item.id)}
                            onToggle={(id) =>
                              setMySelectedIds((prev) =>
                                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                              )
                            }
                            width={cardWidth}
                            variant="mine"
                          />
                        ))}
                      </View>
                    )}
                  </View>

                  {/* Their items */}
                  <View style={ss.section}>
                    <Text style={[ss.sectionLabel, { color: "#b45309" }]}>
                      Their Swap Items
                    </Text>
                    {theirPanelItems.length === 0 ? (
                      <Text style={[ss.emptyText, { color: colors.mutedForeground }]}>
                        No swap-eligible items found.
                      </Text>
                    ) : (
                      <View style={ss.itemGrid}>
                        {theirPanelItems.map((item) => (
                          <SwapItemChip
                            key={item.id}
                            item={item}
                            selected={theirSelectedIds.includes(item.id)}
                            onToggle={(id) =>
                              setTheirSelectedIds((prev) =>
                                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                              )
                            }
                            width={cardWidth}
                            onExpand={openItemDetails}
                            variant="theirs"
                          />
                        ))}
                      </View>
                    )}
                  </View>

                  {/* Swap summary, same as the swap request modal: scrolls with the items */}
                  {showSwapSummary && (
                    <SwapFairnessSummary yourSC={myValue} theirSC={theirValue} valuation={swapResult} maxOffset={MAX_SWAP_OFFSET} />
                  )}
                </>
              )}
            </>
          )}
        </ScrollView>

        {/* Footer buttons */}
        <View style={ss.footer}>
          <Pressable
            style={[ss.cancelBtn, { borderColor: colors.border }]}
            onPress={onClose}
          >
            <Text style={[ss.cancelBtnText, { color: colors.foreground }]}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[
              ss.submitBtn,
              { backgroundColor: "#f59e0b", opacity: isPending || maxRoundsReached ? 0.6 : 1 },
            ]}
            onPress={handleSubmit}
            disabled={isPending || maxRoundsReached}
          >
            {isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={ss.submitBtnText}>Send counter</Text>
            )}
          </Pressable>
        </View>
        </View>
      </View>
    </Modal>
  );
}

const ss = StyleSheet.create({
  modalOuter: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  // Keep for any legacy references (not used directly anymore)
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    maxHeight: "85%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 14,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    marginTop: -6,
  },
  // Current terms
  currentTermsBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  currentTermsLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  termsBadge: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  termsBadgeText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  // Sections
  section: { gap: 8 },
  sectionLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  // Deposit radio
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  radioTitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  warnBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  // Date buttons
  dateBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 3,
  },
  dateBtnLabel: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dateBtnValue: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  // Swap item grid
  itemGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
  },
  emptyText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
  },
  // Footer
  footer: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  submitBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  submitBtnText: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
});
