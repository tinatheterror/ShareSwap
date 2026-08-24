/**
 * CounterProposalSheet
 * Matches web requests-page.tsx "Propose New Terms" modal + SwapCounterModal logic.
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
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

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

// ── Item chip for SWAP picker ─────────────────────────────────────────────────

function SwapItemChip({
  item,
  selected,
  onToggle,
  variant,
}: {
  item: SwapEligibleItem;
  selected: boolean;
  onToggle: (id: number) => void;
  variant: "mine" | "theirs";
}) {
  const colors = useColors();
  const photo = item.photos?.[0];
  const activeBorder = variant === "mine" ? PRIMARY : "#f59e0b";
  const activeBg = variant === "mine" ? "#e6fbf5" : "#fef3c7";

  return (
    <Pressable
      onPress={() => onToggle(item.id)}
      style={[
        chipStyles.chip,
        {
          borderColor: selected ? activeBorder : colors.border,
          backgroundColor: selected ? activeBg : colors.background,
        },
      ]}
    >
      {photo ? (
        <Image source={{ uri: photo }} style={chipStyles.photo} contentFit="cover" />
      ) : (
        <View style={[chipStyles.photoPlaceholder, { backgroundColor: colors.muted }]}>
          <Text style={{ fontSize: 18 }}>📦</Text>
        </View>
      )}
      <Text style={[chipStyles.name, { color: colors.foreground }]} numberOfLines={2}>
        {item.name}
      </Text>
      {selected && (
        <View style={[chipStyles.checkBadge, { backgroundColor: activeBorder }]}>
          <Text style={{ color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" }}>✓</Text>
        </View>
      )}
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    width: "47%",
    borderWidth: 1.5,
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 8,
  },
  photo: { width: "100%", aspectRatio: 4 / 3 },
  photoPlaceholder: {
    width: "100%",
    aspectRatio: 4 / 3,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    padding: 6,
    lineHeight: 15,
  },
  checkBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
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
  const [counterNote, setCounterNote] = useState("");

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
      setCounterNote(request.counterNote ?? "");
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
        counterNote: counterNote.trim(),
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
                            {m === "in_app" ? "In-app (secure payment hold)" : "In-person (cash at handoff)"}
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
                    <Text style={[ss.sectionLabel, { color: colors.foreground }]}>
                      {isOwner ? "Your items to offer" : "Your items to offer"}
                    </Text>
                    {ownerPanelItems.length === 0 ? (
                      <Text style={[ss.emptyText, { color: colors.mutedForeground }]}>
                        No swap-eligible items in your ShareChest.
                      </Text>
                    ) : (
                      <View style={ss.itemGrid}>
                        {ownerPanelItems.map((item) => (
                          <SwapItemChip
                            key={item.id}
                            item={item}
                            selected={ownerItemIds.includes(item.id)}
                            onToggle={(id) =>
                              setOwnerItemIds((prev) =>
                                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                              )
                            }
                            variant="mine"
                          />
                        ))}
                      </View>
                    )}
                  </View>

                  {/* Their items */}
                  <View style={ss.section}>
                    <Text style={[ss.sectionLabel, { color: colors.foreground }]}>
                      {isOwner ? "Their items (what you'd receive)" : "Their items (what you'd receive)"}
                    </Text>
                    {requesterPanelItems.length === 0 ? (
                      <Text style={[ss.emptyText, { color: colors.mutedForeground }]}>
                        No swap-eligible items found.
                      </Text>
                    ) : (
                      <View style={ss.itemGrid}>
                        {requesterPanelItems.map((item) => (
                          <SwapItemChip
                            key={item.id}
                            item={item}
                            selected={requesterItemIds.includes(item.id)}
                            onToggle={(id) =>
                              setRequesterItemIds((prev) =>
                                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                              )
                            }
                            variant="theirs"
                          />
                        ))}
                      </View>
                    )}
                  </View>

                  {/* Counter note */}
                  <View style={ss.section}>
                    <Text style={[ss.sectionLabel, { color: colors.foreground }]}>
                      Note (optional)
                    </Text>
                    <TextInput
                      value={counterNote}
                      onChangeText={(t) => setCounterNote(t.slice(0, 300))}
                      placeholder="Add context for your counter offer…"
                      placeholderTextColor={colors.mutedForeground}
                      multiline
                      numberOfLines={3}
                      style={[
                        ss.noteInput,
                        { borderColor: colors.border, backgroundColor: colors.background, color: colors.foreground },
                      ]}
                    />
                    <Text style={[ss.charCount, { color: colors.mutedForeground }]}>
                      {counterNote.length}/300
                    </Text>
                  </View>
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
    gap: 8,
  },
  emptyText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
  },
  // Note input
  noteInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    minHeight: 80,
    textAlignVertical: "top",
  },
  charCount: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "right",
    marginTop: -4,
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
