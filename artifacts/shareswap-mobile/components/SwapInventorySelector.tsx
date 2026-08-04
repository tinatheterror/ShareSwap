import React, { useState, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { ArrowLeftRight, Camera, Check, Coins, Package } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { apiGet, photoUrl } from "@/lib/api";

// ── Swap calculator (mirrors web lib) ─────────────────────────────────────────
const TIER_SC: Record<number, number> = { 1: 5, 2: 10, 3: 20, 4: 40 };
const MAX_SWAP_OFFSET = 20;
function getTierSC(tier?: number | null): number {
  return TIER_SC[tier ?? 2] ?? 10;
}
function calcSwap(yourSC: number, theirSC: number) {
  const offset = Math.abs(yourSC - theirSC);
  const exceedsMax = offset > MAX_SWAP_OFFSET;
  const offsetDirection: "none" | "you_pay" | "you_receive" =
    offset === 0 ? "none" : yourSC < theirSC ? "you_pay" : "you_receive";
  return { offset, exceedsMax, offsetDirection, isFair: offset === 0 };
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface SwapItem {
  id: number;
  name?: string;
  title?: string;
  photos?: string[];
  imageUrl?: string;
  tier?: number;
  isSwappable?: boolean;
  isAvailable?: boolean;
}

export interface TargetItem {
  id: number;
  name?: string;
  title?: string;
  photos?: string[];
  imageUrl?: string;
  tier?: number;
  ownerId?: number;
}

interface Props {
  targetItem: TargetItem;
  isOpen: boolean;
  onClose: () => void;
  /** Called when user taps Send Request. Parent handles the API call. */
  onConfirm: (
    offeredItemIds: number[],
    requestedOwnerItemIds: number[],
    message: string,
  ) => Promise<void>;
}

const PRIMARY = "#0DCEA1";
const H_PAD = 20;
const GAP = 6;
const COLS = 3;

export function SwapInventorySelector({ targetItem, isOpen, onClose, onConfirm }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { width: screenWidth } = useWindowDimensions();

  const [step, setStep] = useState<"select" | "message">("select");
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [selectedOwnerItemIds, setSelectedOwnerItemIds] = useState<number[]>([]);
  const [showAllOwner, setShowAllOwner] = useState(false);
  const [message, setMessage] = useState("");
  const [conditionConfirmed, setConditionConfirmed] = useState(false);
  const [sending, setSending] = useState(false);

  // Reset every time the sheet opens
  useEffect(() => {
    if (isOpen) {
      setStep("select");
      setSelectedItemIds([]);
      setSelectedOwnerItemIds([]);
      setShowAllOwner(false);
      setMessage("");
      setConditionConfirmed(false);
      setSending(false);
    }
  }, [isOpen]);

  // ── Data fetching ─────────────────────────────────────────────────────────
  const { data: myItemsRaw = [], isLoading: myLoading } = useQuery<SwapItem[]>({
    queryKey: ["/api/my-items"],
    queryFn: () => apiGet<SwapItem[]>("/api/my-items"),
    enabled: isOpen,
    staleTime: 0,
  });

  const { data: ownerItemsRaw = [] } = useQuery<SwapItem[]>({
    queryKey: ["/api/swap-eligible-items", "owner", targetItem.ownerId],
    queryFn: () =>
      apiGet<SwapItem[]>(`/api/swap-eligible-items?partnerId=${targetItem.ownerId}`),
    enabled: isOpen && !!targetItem.ownerId,
    staleTime: 0,
  });

  // ── Derived data ──────────────────────────────────────────────────────────
  const swappableItems = myItemsRaw.filter(
    (i) => i.id !== targetItem.id && i.isSwappable && i.isAvailable !== false,
  );
  const ownerExtraItems = (Array.isArray(ownerItemsRaw) ? ownerItemsRaw : []).filter(
    (i) => i.id !== targetItem.id,
  );
  // 5 additional items shown by default (+ 1 locked target = 6 visible)
  const visibleOwnerItems = showAllOwner ? ownerExtraItems : ownerExtraItems.slice(0, 5);

  const targetSC = getTierSC(targetItem.tier);
  const yourSC = selectedItemIds.reduce((sum, id) => {
    const item = swappableItems.find((i) => i.id === id);
    return sum + getTierSC(item?.tier);
  }, 0);
  const ownerExtraSC = selectedOwnerItemIds.reduce((sum, id) => {
    const item = ownerExtraItems.find((i) => i.id === id);
    return sum + getTierSC(item?.tier);
  }, 0);
  const theirSC = targetSC + ownerExtraSC;
  const valuation = calcSwap(yourSC, theirSC);
  const canContinue = selectedItemIds.length > 0 && !valuation.exceedsMax;
  const anySelected = selectedItemIds.length > 0 || selectedOwnerItemIds.length > 0;

  // ── Item card dimensions (3-col grid) ────────────────────────────────────
  const itemW = (screenWidth - H_PAD * 2 - GAP * (COLS - 1)) / COLS;
  const itemImgH = itemW * (4 / 5);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function itemPhoto(item: SwapItem | TargetItem): string | null {
    const p = item.photos?.[0] ?? (item as any).imageUrl;
    return p ? photoUrl(p) : null;
  }

  function toggleItem(id: number) {
    setSelectedItemIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }
  function toggleOwnerItem(id: number) {
    setSelectedOwnerItemIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleContinue() {
    if (!canContinue) return;
    if (valuation.offsetDirection === "you_pay" && valuation.offset > 0) {
      const balance = Number((user as any)?.shareCoins ?? 0);
      if (balance < valuation.offset) {
        Alert.alert(
          "Insufficient ShareCoins",
          `This swap requires ${valuation.offset} ShareCoins to balance, but you only have ${balance}.\n\nEarn more by completing borrows and swaps.`,
        );
        return;
      }
    }
    setStep("message");
  }

  async function handleSend() {
    setSending(true);
    try {
      await onConfirm(selectedItemIds, selectedOwnerItemIds, message.trim());
    } catch {
      // Parent handles specific error alerts / navigation; nothing extra needed here.
    } finally {
      setSending(false);
    }
  }

  // ── Fairness summary colours ──────────────────────────────────────────────
  let fc = { bg: "#fefce8", border: "#fcd34d", text: "#92400e" }; // yellow = offset
  if (valuation.exceedsMax) fc = { bg: "#fef2f2", border: "#fecaca", text: "#b91c1c" };
  else if (valuation.isFair) fc = { bg: "#f0fdf4", border: "#86efac", text: "#15803d" };

  function fairnessMsg() {
    if (valuation.isFair) return "Fair swap";
    if (valuation.exceedsMax)
      return `Offset is ${valuation.offset} ShareCoins — maximum allowed is ${MAX_SWAP_OFFSET}`;
    if (valuation.offsetDirection === "you_pay")
      return `You pay ${valuation.offset} ShareCoins to balance`;
    return `You receive +${valuation.offset} ShareCoins to balance`;
  }

  const targetName = targetItem.name ?? (targetItem as any).title ?? "Item";
  const targetPhoto = itemPhoto(targetItem);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      {/* Backdrop — only tappable on select step */}
      <Pressable
        style={s.backdrop}
        onPress={step === "select" ? onClose : undefined}
      />

      <View
        style={[
          s.sheet,
          { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 },
        ]}
      >
        <View style={[s.handle, { backgroundColor: colors.border }]} />

        {/* ════════════════ STEP 1 — Item selection ════════════════ */}
        {step === "select" && (
          <>
            {/* Hero */}
            <View style={s.hero}>
              <View style={s.heroImgWrap}>
                {targetPhoto ? (
                  <Image
                    source={{ uri: targetPhoto }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                  />
                ) : (
                  <Camera size={22} color="rgba(255,255,255,0.5)" strokeWidth={1.5} />
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.heroName} numberOfLines={2}>
                  {targetName}
                </Text>
                <View style={s.heroRow}>
                  <Coins size={13} color="rgba(255,255,255,0.8)" strokeWidth={2} />
                  <Text style={s.heroSub}>{targetSC} ShareCoins</Text>
                </View>
              </View>
            </View>

            {/* Scrollable body */}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={s.bodyContent}
              showsVerticalScrollIndicator={false}
            >
              {/* ── Your Swap Items ── */}
              <View>
                <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>
                  Your Swap Items
                </Text>

                {myLoading ? (
                  <View style={s.centered}>
                    <ActivityIndicator color={PRIMARY} />
                  </View>
                ) : swappableItems.length === 0 ? (
                  <View style={s.empty}>
                    <Package size={32} color={colors.mutedForeground} strokeWidth={1.5} />
                    <Text style={[s.emptyTitle, { color: colors.foreground }]}>
                      No eligible items
                    </Text>
                    <Text style={[s.emptyBody, { color: colors.mutedForeground }]}>
                      Add items and mark them as swappable
                    </Text>
                  </View>
                ) : (
                  <View style={s.grid}>
                    {swappableItems.map((item) => {
                      const sel = selectedItemIds.includes(item.id);
                      const uri = itemPhoto(item);
                      return (
                        <Pressable
                          key={item.id}
                          style={[
                            s.card,
                            {
                              width: itemW,
                              borderColor: sel ? PRIMARY : colors.border,
                              backgroundColor: sel ? "#E6FBF5" : colors.background,
                            },
                          ]}
                          onPress={() => toggleItem(item.id)}
                        >
                          <View
                            style={[
                              s.cardImg,
                              { height: itemImgH, backgroundColor: colors.muted },
                            ]}
                          >
                            {uri ? (
                              <Image
                                source={{ uri }}
                                style={StyleSheet.absoluteFill}
                                resizeMode="cover"
                              />
                            ) : (
                              <Camera size={14} color={colors.mutedForeground} strokeWidth={1.5} />
                            )}
                            {sel && (
                              <View style={s.checkOverlay}>
                                <Check size={16} color="#fff" strokeWidth={2.5} />
                              </View>
                            )}
                          </View>
                          <View style={s.cardInfo}>
                            <Text
                              style={[s.cardName, { color: colors.foreground }]}
                              numberOfLines={2}
                            >
                              {item.name ?? item.title}
                            </Text>
                            <View style={s.cardScRow}>
                              <Coins size={9} color={colors.mutedForeground} strokeWidth={2} />
                              <Text style={[s.cardSc, { color: colors.mutedForeground }]}>
                                {getTierSC(item.tier)} SC
                              </Text>
                            </View>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>

              {/* ── Their Swap Items ── */}
              {ownerExtraItems.length > 0 && (
                <View>
                  <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>
                    Their Swap Items
                  </Text>
                  <Text style={[s.sectionHint, { color: colors.mutedForeground }]}>
                    Select additional items you'd like
                  </Text>
                  <View style={[s.grid, { marginTop: 8 }]}>
                    {/* Target item — locked / always selected */}
                    <View
                      style={[
                        s.card,
                        {
                          width: itemW,
                          borderColor: "#f59e0b",
                          backgroundColor: "#fffbeb",
                        },
                      ]}
                    >
                      <View
                        style={[s.cardImg, { height: itemImgH, backgroundColor: "#fef3c7" }]}
                      >
                        {targetPhoto ? (
                          <Image
                            source={{ uri: targetPhoto }}
                            style={StyleSheet.absoluteFill}
                            resizeMode="cover"
                          />
                        ) : (
                          <Camera size={14} color="#a16207" strokeWidth={1.5} />
                        )}
                        <View style={[s.checkOverlay, { backgroundColor: "rgba(245,158,11,0.3)" }]}>
                          <Check size={16} color="#92400e" strokeWidth={2.5} />
                        </View>
                      </View>
                      <View style={s.cardInfo}>
                        <Text
                          style={[s.cardName, { color: "#78350f" }]}
                          numberOfLines={2}
                        >
                          {targetName}
                        </Text>
                        <View style={s.cardScRow}>
                          <Coins size={9} color="#a16207" strokeWidth={2} />
                          <Text style={[s.cardSc, { color: "#a16207" }]}>
                            {targetSC} SC
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Additional owner items */}
                    {visibleOwnerItems.map((item) => {
                      const sel = selectedOwnerItemIds.includes(item.id);
                      const uri = itemPhoto(item);
                      return (
                        <Pressable
                          key={item.id}
                          style={[
                            s.card,
                            {
                              width: itemW,
                              borderColor: sel ? "#f59e0b" : colors.border,
                              backgroundColor: sel ? "#fffbeb" : colors.background,
                            },
                          ]}
                          onPress={() => toggleOwnerItem(item.id)}
                        >
                          <View
                            style={[
                              s.cardImg,
                              { height: itemImgH, backgroundColor: colors.muted },
                            ]}
                          >
                            {uri ? (
                              <Image
                                source={{ uri }}
                                style={StyleSheet.absoluteFill}
                                resizeMode="cover"
                              />
                            ) : (
                              <Camera size={14} color={colors.mutedForeground} strokeWidth={1.5} />
                            )}
                            {sel && (
                              <View
                                style={[
                                  s.checkOverlay,
                                  { backgroundColor: "rgba(245,158,11,0.3)" },
                                ]}
                              >
                                <Check size={16} color="#92400e" strokeWidth={2.5} />
                              </View>
                            )}
                          </View>
                          <View style={s.cardInfo}>
                            <Text
                              style={[s.cardName, { color: colors.foreground }]}
                              numberOfLines={2}
                            >
                              {item.name ?? item.title}
                            </Text>
                            <View style={s.cardScRow}>
                              <Coins size={9} color={colors.mutedForeground} strokeWidth={2} />
                              <Text style={[s.cardSc, { color: colors.mutedForeground }]}>
                                {getTierSC(item.tier)} SC
                              </Text>
                            </View>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>

                  {ownerExtraItems.length > 5 && (
                    <Pressable
                      style={s.showMore}
                      onPress={() => setShowAllOwner((v) => !v)}
                    >
                      <Feather
                        name={showAllOwner ? "chevron-up" : "chevron-down"}
                        size={13}
                        color={PRIMARY}
                      />
                      <Text style={s.showMoreText}>
                        {showAllOwner
                          ? "Show less"
                          : `View all ${ownerExtraItems.length} swap items`}
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}

              {/* ── Fairness summary ── */}
              {anySelected && (
                <View
                  style={[
                    s.fairness,
                    { backgroundColor: fc.bg, borderColor: fc.border },
                  ]}
                >
                  <View style={s.fairnessRow}>
                    <View style={s.fairnessSide}>
                      <Text style={[s.fairnessSub, { color: fc.text }]}>Your offer</Text>
                      <Text style={[s.fairnessBig, { color: fc.text }]}>{yourSC}</Text>
                      <Text style={[s.fairnessSub, { color: fc.text }]}>ShareCoin</Text>
                    </View>
                    <ArrowLeftRight size={16} color={fc.text} strokeWidth={2} />
                    <View style={s.fairnessSide}>
                      <Text style={[s.fairnessSub, { color: fc.text }]}>Their offer</Text>
                      <Text style={[s.fairnessBig, { color: fc.text }]}>{theirSC}</Text>
                      <Text style={[s.fairnessSub, { color: fc.text }]}>ShareCoin</Text>
                    </View>
                  </View>
                  <View style={[s.fairnessDivider, { borderColor: fc.border }]} />
                  <View style={s.fairnessMsgRow}>
                    <Feather
                      name={valuation.exceedsMax ? "alert-triangle" : "info"}
                      size={11}
                      color={fc.text}
                      style={{ marginTop: 1 }}
                    />
                    <Text style={[s.fairnessMsgText, { color: fc.text }]}>
                      {fairnessMsg()}
                    </Text>
                  </View>
                </View>
              )}

              {/* ── Hint when nothing selected ── */}
              {!anySelected && (
                <View style={s.hint}>
                  <Feather name="info" size={12} color={colors.mutedForeground} />
                  <Text style={[s.hintText, { color: colors.mutedForeground }]}>
                    Value differences are settled with ShareCoins
                  </Text>
                </View>
              )}
            </ScrollView>

            {/* Footer */}
            {swappableItems.length > 0 && (
              <View style={[s.footer, { borderTopColor: colors.border }]}>
                <Pressable
                  style={[
                    s.footerBtn,
                    { borderColor: colors.border, backgroundColor: colors.background },
                  ]}
                  onPress={onClose}
                >
                  <Text style={[s.footerBtnLabel, { color: colors.foreground }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    s.footerBtn,
                    {
                      backgroundColor: canContinue ? PRIMARY : colors.muted,
                      borderColor: "transparent",
                    },
                  ]}
                  onPress={handleContinue}
                  disabled={!canContinue}
                >
                  <ArrowLeftRight
                    size={15}
                    color={canContinue ? "#fff" : colors.mutedForeground}
                    strokeWidth={2}
                  />
                  <Text
                    style={[
                      s.footerBtnLabel,
                      { color: canContinue ? "#fff" : colors.mutedForeground },
                    ]}
                  >
                    Swap
                  </Text>
                </Pressable>
              </View>
            )}
          </>
        )}

        {/* ════════════════ STEP 2 — Confirm & send ════════════════ */}
        {step === "message" && (() => {
          const offerItems = swappableItems.filter(i => selectedItemIds.includes(i.id));
          const extraOwnerItems = ownerExtraItems.filter(i => selectedOwnerItemIds.includes(i.id));
          const theirItems = [targetItem as SwapItem, ...extraOwnerItems];
          const offerSC = offerItems.reduce((s, i) => s + getTierSC(i.tier), 0);
          const theirSC2 = theirItems.reduce((s, i) => s + getTierSC(i.tier), 0);
          const v2 = calcSwap(offerSC, theirSC2);
          const multiItem = offerItems.length > 1;

          return (
            <>
              {/* Back row + title */}
              <View style={s.msgHeader}>
                <Pressable style={s.backBtn} onPress={() => setStep("select")}>
                  <Feather name="arrow-left" size={16} color={colors.mutedForeground} />
                  <Text style={[s.backLabel, { color: colors.mutedForeground }]}>
                    Back to item selection
                  </Text>
                </Pressable>
                <Text style={[s.msgTitle, { color: colors.foreground }]} numberOfLines={2}>
                  Request to swap {targetName}
                </Text>
              </View>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: H_PAD, paddingBottom: 12, gap: 14 }}
                showsVerticalScrollIndicator={false}
              >
                {/* ── Swap Summary card ── */}
                <View style={s.summaryCard}>
                  <View style={s.summaryHeader}>
                    <ArrowLeftRight size={16} color="#0BB88C" strokeWidth={2} />
                    <Text style={s.summaryTitle}>Swap Summary</Text>
                  </View>

                  <View style={s.summaryCols}>
                    {/* Your side */}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.summaryColLabel}>You're offering:</Text>
                      {offerItems.map(oi => {
                        const uri = itemPhoto(oi);
                        return (
                          <View key={oi.id} style={s.summaryItem}>
                            <View style={s.summaryThumb}>
                              {uri
                                ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                                : <Camera size={10} color="#9ca3af" strokeWidth={1.5} />}
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={[s.summaryItemName, { color: colors.foreground }]} numberOfLines={1}>
                                {oi.name ?? oi.title}
                              </Text>
                              <View style={s.summaryScRow}>
                                <Coins size={10} color="#0BB88C" strokeWidth={2} />
                                <Text style={s.summaryScText}>{getTierSC(oi.tier)}</Text>
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </View>

                    <ArrowLeftRight size={18} color={`${PRIMARY}99`} strokeWidth={2} style={{ marginTop: 20, flexShrink: 0 }} />

                    {/* Their side */}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.summaryColLabel}>For their:</Text>
                      {theirItems.map(ti => {
                        const uri = itemPhoto(ti as SwapItem);
                        return (
                          <View key={ti.id} style={s.summaryItem}>
                            <View style={s.summaryThumb}>
                              {uri
                                ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                                : <Camera size={10} color="#9ca3af" strokeWidth={1.5} />}
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={[s.summaryItemName, { color: colors.foreground }]} numberOfLines={1}>
                                {(ti as any).name ?? (ti as any).title}
                              </Text>
                              <View style={s.summaryScRow}>
                                <Coins size={10} color="#0BB88C" strokeWidth={2} />
                                <Text style={s.summaryScText}>{getTierSC(ti.tier)}</Text>
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </View>

                  {/* Offset line */}
                  {!v2.isFair && (
                    <View style={s.summaryOffset}>
                      <Coins size={14} color={v2.offsetDirection === "you_pay" ? "#b45309" : "#16a34a"} strokeWidth={2} />
                      <Text style={[s.summaryOffsetText, {
                        color: v2.offsetDirection === "you_pay" ? "#b45309" : "#16a34a",
                      }]}>
                        {v2.offsetDirection === "you_pay"
                          ? `You pay ${v2.offset} ShareCoins to balance the swap`
                          : `You receive ${v2.offset} ShareCoins`}
                      </Text>
                    </View>
                  )}
                </View>

                {/* ── Condition checkbox ── */}
                <Pressable
                  style={[s.checkboxRow, { borderColor: colors.border }]}
                  onPress={() => setConditionConfirmed(v => !v)}
                >
                  <View style={[s.checkbox, {
                    borderColor: conditionConfirmed ? PRIMARY : colors.border,
                    backgroundColor: conditionConfirmed ? PRIMARY : "transparent",
                  }]}>
                    {conditionConfirmed && <Feather name="check" size={11} color="#fff" />}
                  </View>
                  <Text style={[s.checkboxLabel, { color: colors.foreground }]}>
                    I confirm {multiItem ? "these items match" : "this item matches"} the condition stated.
                  </Text>
                </Pressable>

                {/* ── Note to owner ── */}
                <View style={{ gap: 6 }}>
                  <View style={s.noteLabelRow}>
                    <Text style={[s.noteLabel, { color: colors.foreground }]}>
                      Note to owner{" "}
                      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>(optional)</Text>
                    </Text>
                    <Text style={[s.noteCounter, {
                      color: message.length > 120 ? "#f97316" : colors.mutedForeground,
                    }]}>
                      {message.length}/140
                    </Text>
                  </View>
                  <TextInput
                    style={[s.msgInput, {
                      backgroundColor: colors.muted,
                      borderColor: colors.border,
                      color: colors.foreground,
                    }]}
                    placeholder="Anything the owner should know?"
                    placeholderTextColor={colors.mutedForeground}
                    value={message}
                    onChangeText={setMessage}
                    maxLength={140}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                  />
                </View>
              </ScrollView>

              <View style={[s.footer, { borderTopColor: colors.border }]}>
                <Pressable
                  style={[s.footerBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
                  onPress={() => setStep("select")}
                >
                  <Text style={[s.footerBtnLabel, { color: colors.foreground }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[s.footerBtn, {
                    backgroundColor: PRIMARY,
                    borderColor: "transparent",
                    opacity: sending ? 0.7 : 1,
                  }]}
                  onPress={handleSend}
                  disabled={sending}
                >
                  {sending ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Feather name="send" size={14} color="#fff" />
                      <Text style={[s.footerBtnLabel, { color: "#fff" }]}>Send Request</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </>
          );
        })()}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "90%",
    overflow: "hidden",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 4,
  },
  // Hero
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: PRIMARY,
    padding: 14,
    paddingRight: 20,
  },
  heroImgWrap: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.15)",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  heroName: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    lineHeight: 17,
  },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  heroSub: {
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    fontFamily: "Inter_400Regular",
  },
  // Body
  bodyContent: {
    padding: H_PAD,
    paddingTop: 14,
    gap: 18,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginBottom: 8,
  },
  sectionHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: -6,
    marginBottom: 0,
  },
  centered: { alignItems: "center", justifyContent: "center", paddingVertical: 24 },
  empty: { alignItems: "center", paddingVertical: 24, gap: 6 },
  emptyTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  emptyBody: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  // Grid + cards
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  card: { borderRadius: 8, borderWidth: 1, overflow: "hidden" },
  cardImg: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  checkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(13,206,161,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardInfo: { padding: 5 },
  cardName: { fontSize: 10, fontFamily: "Inter_500Medium", lineHeight: 13 },
  cardScRow: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 },
  cardSc: { fontSize: 9, fontFamily: "Inter_400Regular" },
  // Show more
  showMore: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  showMoreText: { fontSize: 13, color: PRIMARY, fontFamily: "Inter_500Medium" },
  // Fairness
  fairness: { borderRadius: 10, padding: 12, borderWidth: 1 },
  fairnessRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  fairnessSide: { flex: 1, alignItems: "center" },
  fairnessSub: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    opacity: 0.8,
    marginBottom: 2,
  },
  fairnessBig: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    lineHeight: 28,
  },
  fairnessDivider: { borderTopWidth: 1, opacity: 0.2 },
  fairnessMsgRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 8,
  },
  fairnessMsgText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 16,
  },
  // Hint
  hint: { flexDirection: "row", alignItems: "center", gap: 6 },
  hintText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  // Footer
  footer: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
  },
  footerBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
  },
  footerBtnLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  // Step 2 — message
  msgHeader: {
    paddingHorizontal: H_PAD,
    paddingTop: 4,
    paddingBottom: 8,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 14,
  },
  backLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  msgTitle: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 4, lineHeight: 22 },
  msgInput: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    minHeight: 80,
  },
  // Swap Summary card
  summaryCard: {
    backgroundColor: "#E6FBF5",
    borderWidth: 1,
    borderColor: "rgba(13,206,161,0.3)",
    borderRadius: 10,
    padding: 14,
    gap: 12,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  summaryTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#0BB88C",
  },
  summaryCols: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  summaryItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  summaryThumb: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: "#e5e7eb",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  summaryColLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#0DCEA1",
    marginBottom: 8,
  },
  summaryItemName: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    lineHeight: 14,
  },
  summaryScRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginTop: 1,
  },
  summaryScText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: "#0BB88C",
  },
  summaryOffset: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 4,
  },
  summaryOffsetText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  // Condition checkbox
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    flexShrink: 0,
  },
  checkboxLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 18,
  },
  // Note to owner
  noteLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  noteLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  noteCounter: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
