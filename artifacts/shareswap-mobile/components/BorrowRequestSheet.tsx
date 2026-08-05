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
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Feather } from "@expo/vector-icons";
import { Calendar, Coins, Shield, MapPin } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

// ── Deposit calculator (mirrors web lib) ─────────────────────────────────────
const TIER_DEPOSIT_PCT: Record<number, number> = {
  1: 0.10, 2: 0.20, 3: 0.30, 4: 0.40,
};
const TRUST_DISCOUNTS = [
  { min: 90, discount: 0.60 },
  { min: 70, discount: 0.40 },
  { min: 50, discount: 0.20 },
  { min: 0,  discount: 0 },
];
const VALUE_MIDPOINTS: Record<string, number> = {
  "Under $50": 25, "$50–$199": 125, "$200–$499": 350, "$500–$2,000": 1250,
  "$50–$150": 100, "$150–$300": 225, "$300–$1,000": 650, "$300+": 500,
};

interface DepositCalc {
  baseDeposit: number;
  discountPercentage: number;
  finalDeposit: number;
}

function calcDeposit(tier: number, originalValue: string, trustScore: number): DepositCalc {
  const itemValue = VALUE_MIDPOINTS[originalValue] ?? 100;
  const pct = TIER_DEPOSIT_PCT[tier] ?? 0.20;
  const base = itemValue * pct;
  if (Math.round(base) <= 5) return { baseDeposit: 5, discountPercentage: 0, finalDeposit: 5 };
  let discount = 0;
  for (const t of TRUST_DISCOUNTS) {
    if (trustScore >= t.min) { discount = t.discount; break; }
  }
  const discPct = Math.round(discount * 100);
  const discounted = Math.round(base * (1 - discount));
  const final = Math.max(5, discounted);
  return {
    baseDeposit: Math.round(base),
    discountPercentage: final === 5 && discounted < 5 ? 0 : discPct,
    finalDeposit: final,
  };
}

function hasValidReplacementValue(val: any): boolean {
  return val !== null && val !== undefined && Number(val) > 0;
}

function toApiStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDisplayStr(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function calcBorrowDaysFromDates(start: Date | null, end: Date | null): number {
  if (!start || !end) return 0;
  const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface BorrowRequestData {
  startDate: string;
  endDate: string;
  depositMethod: "in_app" | "in_person";
  replacementValueAcknowledged: boolean;
  message: string;
}

export interface BorrowTargetItem {
  id: number;
  name?: string | null;
  title?: string | null;
  shareCoinPrice?: number | string | null;
  replacementValue?: number | null;
  tier?: number | null;
  originalValue?: string | null;
}

interface Props {
  targetItem: BorrowTargetItem;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: BorrowRequestData) => Promise<void>;
}

const PRIMARY = "#0DCEA1";
const H_PAD = 20;

// ── Component ─────────────────────────────────────────────────────────────────
export function BorrowRequestSheet({ targetItem, isOpen, onClose, onConfirm }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [startDateObj, setStartDateObj] = useState<Date | null>(null);
  const [endDateObj, setEndDateObj] = useState<Date | null>(null);
  // "start" | "end" = picker open on iOS (shown inline); null = closed
  const [activePicker, setActivePicker] = useState<"start" | "end" | null>(null);
  const [depositMethod, setDepositMethod] = useState<"in_app" | "in_person">("in_app");
  const [replacementValueAcknowledged, setReplacementValueAcknowledged] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStartDateObj(null);
      setEndDateObj(null);
      setActivePicker(null);
      setDepositMethod("in_app");
      setReplacementValueAcknowledged(false);
      setMessage("");
      setSending(false);
    }
  }, [isOpen]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function onDateChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === "android") {
      // Android: picker dismisses itself after any interaction
      if (event.type === "set" && selected) {
        if (activePicker === "start") {
          setStartDateObj(selected);
          // Auto-clear end if it's now before start
          if (endDateObj && endDateObj <= selected) setEndDateObj(null);
        } else if (activePicker === "end") {
          setEndDateObj(selected);
        }
      }
      setActivePicker(null);
    } else {
      // iOS: picker is always visible while open; update on every scroll
      if (selected) {
        if (activePicker === "start") {
          setStartDateObj(selected);
          if (endDateObj && endDateObj <= selected) setEndDateObj(null);
        } else if (activePicker === "end") {
          setEndDateObj(selected);
        }
      }
    }
  }

  // ── Computed values ────────────────────────────────────────────────────────
  const borrowDays = calcBorrowDaysFromDates(startDateObj, endDateObj);
  const weeklyPrice = parseFloat(String(targetItem.shareCoinPrice ?? 0)) || 5;
  const proratedCost = borrowDays > 0
    ? Math.max(1, Math.ceil((weeklyPrice / 7) * borrowDays))
    : weeklyPrice;

  const reputationScore = (user as any)?.reputationScore ?? 0;
  const trustScore = Math.min(100, Math.round((reputationScore / 500) * 100));
  const depositCalc = calcDeposit(
    targetItem.tier ?? 2,
    targetItem.originalValue ?? "$50–$199",
    trustScore,
  );
  const hasDeposit = hasValidReplacementValue(targetItem.replacementValue);
  const processingFee = (depositCalc.finalDeposit * 0.03).toFixed(2);
  const datesSelected = startDateObj !== null && endDateObj !== null;
  const canSubmit = datesSelected && (!hasDeposit || replacementValueAcknowledged);
  const targetName = targetItem.name ?? (targetItem as any).title ?? "Item";

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSend() {
    const balance = Number((user as any)?.shareCoins ?? 0);
    if (balance < proratedCost) {
      Alert.alert(
        "Insufficient ShareCoins",
        `This borrow requires ${proratedCost} ShareCoins, but you only have ${balance}. Earn more by completing swaps and borrows.`,
      );
      return;
    }
    setSending(true);
    try {
      await onConfirm({
        startDate: startDateObj ? toApiStr(startDateObj) : "",
        endDate: endDateObj ? toApiStr(endDateObj) : "",
        depositMethod,
        replacementValueAcknowledged,
        message: message.trim(),
      });
    } catch {
      // Parent handles specific error alerts / navigation
    } finally {
      setSending(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  // Stable "today" reference so minimumDate doesn't thrash on every render
  const pickerToday = React.useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const pickerValue =
    activePicker === "start"
      ? (startDateObj ?? pickerToday)
      : (endDateObj ?? (startDateObj ? new Date(startDateObj.getTime() + 86400000) : pickerToday));

  const pickerMin =
    activePicker === "start"
      ? pickerToday
      : (startDateObj ? new Date(startDateObj.getTime() + 86400000) : pickerToday);

  return (
    <Modal visible={isOpen} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
        <View style={[s.handle, { backgroundColor: colors.border }]} />

        {/* Header */}
        <View style={s.header}>
          <Text style={[s.title, { color: colors.foreground }]} numberOfLines={2}>
            Request to Borrow {targetName}
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Date row ── */}
          <View>
            <View style={s.dateLabelRow}>
              <View style={s.dateLabelLeft}>
                <Calendar size={14} color={colors.foreground} strokeWidth={2} />
                <Text style={[s.dateLabelText, { color: colors.foreground }]}>Start Date</Text>
              </View>
              <Text style={[s.dateLabelText, { color: colors.foreground }]}>Return Date</Text>
            </View>
            <View style={s.dateRow}>
              {/* Start date button */}
              <Pressable
                style={[s.datePressable, {
                  borderColor: activePicker === "start" ? PRIMARY : colors.border,
                  backgroundColor: colors.background,
                }]}
                onPress={() => setActivePicker(activePicker === "start" ? null : "start")}
              >
                <Calendar size={13} color={activePicker === "start" ? PRIMARY : colors.mutedForeground} strokeWidth={2} />
                <Text style={[s.datePressableText, {
                  color: startDateObj ? colors.foreground : colors.mutedForeground,
                }]}>
                  {startDateObj ? toDisplayStr(startDateObj) : "Select date"}
                </Text>
              </Pressable>

              {/* Return date button */}
              <Pressable
                style={[s.datePressable, {
                  borderColor: activePicker === "end" ? PRIMARY : colors.border,
                  backgroundColor: colors.background,
                }]}
                onPress={() => setActivePicker(activePicker === "end" ? null : "end")}
              >
                <Calendar size={13} color={activePicker === "end" ? PRIMARY : colors.mutedForeground} strokeWidth={2} />
                <Text style={[s.datePressableText, {
                  color: endDateObj ? colors.foreground : colors.mutedForeground,
                }]}>
                  {endDateObj ? toDisplayStr(endDateObj) : "Select date"}
                </Text>
              </Pressable>
            </View>

            {/* Android: DateTimePicker renders as a native dialog when activePicker is set */}
            {Platform.OS === "android" && activePicker !== null && (
              <DateTimePicker
                value={
                  activePicker === "start"
                    ? (startDateObj ?? today)
                    : (endDateObj ?? (startDateObj ? new Date(startDateObj.getTime() + 86400000) : today))
                }
                mode="date"
                minimumDate={activePicker === "start" ? today : (startDateObj ? new Date(startDateObj.getTime() + 86400000) : today)}
                onChange={onDateChange}
              />
            )}
          </View>

          {/* ── Cost Breakdown ── */}
          <View style={[s.grayCard, { borderColor: colors.border, backgroundColor: colors.muted }]}>
            <Text style={[s.cardTitle, { color: colors.foreground }]}>Cost Breakdown</Text>

            {borrowDays > 0 ? (
              <View style={{ gap: 5, marginTop: 6 }}>
                <View style={s.splitRow}>
                  <View style={s.rowLeft}>
                    <Coins size={12} color={PRIMARY} strokeWidth={2} />
                    <Text style={[s.rowLabel, { color: colors.mutedForeground }]}>
                      ShareCoins ({borrowDays} {borrowDays === 1 ? "day" : "days"})
                    </Text>
                  </View>
                  <Text style={[s.rowValue, { color: colors.foreground }]}>
                    {proratedCost} ShareCoins
                  </Text>
                </View>
                <Text style={[s.micro, { color: colors.mutedForeground }]}>
                  {weeklyPrice} ShareCoins/week × {borrowDays} {borrowDays === 1 ? "day" : "days"} ÷ 7
                </Text>

                {hasDeposit && (
                  <View style={[s.depositBreakdown, { borderTopColor: colors.border }]}>
                    <View style={s.splitRow}>
                      <View style={s.rowLeft}>
                        <Shield size={12} color={colors.mutedForeground} strokeWidth={2} />
                        <Text style={[s.rowLabel, { color: colors.mutedForeground }]}>Trust-deposit</Text>
                      </View>
                      {depositCalc.discountPercentage > 0 ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={[s.rowValue, { color: colors.mutedForeground, textDecorationLine: "line-through" }]}>
                            ${depositCalc.baseDeposit}
                          </Text>
                          <Text style={[s.rowValue, { color: PRIMARY }]}>${depositCalc.finalDeposit}</Text>
                        </View>
                      ) : (
                        <Text style={[s.rowValue, { color: colors.foreground }]}>${depositCalc.finalDeposit}</Text>
                      )}
                    </View>
                    {depositCalc.discountPercentage > 0 && (
                      <Text style={[s.micro, { color: PRIMARY }]}>
                        {depositCalc.discountPercentage}% discount from your trust score
                      </Text>
                    )}
                    <Text style={[s.micro, { color: colors.mutedForeground }]}>
                      Held securely, auto-refunded on return
                    </Text>
                    <Text style={[s.micro, { color: colors.mutedForeground }]}>
                      Processing fee: ${processingFee}
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <Text style={[s.micro, { color: colors.mutedForeground, marginTop: 4 }]}>
                Select dates to see cost breakdown
              </Text>
            )}
          </View>

          {/* ── Deposit method ── */}
          <View style={{ gap: 8 }}>
            <Text style={[s.sectionTitle, { color: colors.foreground }]}>
              How would you like to handle the deposit?
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {/* Handle In-app */}
              <Pressable
                style={[s.depositCard, {
                  flex: 1,
                  backgroundColor: depositMethod === "in_app" ? PRIMARY : colors.background,
                  borderColor: depositMethod === "in_app" ? PRIMARY : colors.border,
                }]}
                onPress={() => setDepositMethod("in_app")}
              >
                <View style={s.depositCardTop}>
                  <Shield
                    size={15}
                    color={depositMethod === "in_app" ? "#fff" : colors.mutedForeground}
                    strokeWidth={2}
                  />
                  <Text style={[s.depositCardTitle, {
                    color: depositMethod === "in_app" ? "#fff" : colors.foreground,
                  }]}>Handle In-app</Text>
                </View>
                <Text style={[s.depositCardSub, {
                  color: depositMethod === "in_app" ? "rgba(255,255,255,0.9)" : PRIMARY,
                }]}>Recommended</Text>
                <Text style={[s.depositCardFee, {
                  color: depositMethod === "in_app" ? "rgba(255,255,255,0.8)" : colors.mutedForeground,
                }]}>Processing fee: ${processingFee}</Text>
              </Pressable>

              {/* Exchange In Person */}
              <Pressable
                style={[s.depositCard, {
                  flex: 1,
                  backgroundColor: depositMethod === "in_person" ? PRIMARY : colors.background,
                  borderColor: depositMethod === "in_person" ? PRIMARY : colors.border,
                }]}
                onPress={() => setDepositMethod("in_person")}
              >
                <View style={s.depositCardTop}>
                  <MapPin
                    size={15}
                    color={depositMethod === "in_person" ? "#fff" : colors.mutedForeground}
                    strokeWidth={2}
                  />
                  <Text style={[s.depositCardTitle, {
                    color: depositMethod === "in_person" ? "#fff" : colors.foreground,
                  }]}>Exchange In Person</Text>
                </View>
                <Text style={[s.depositCardSub, {
                  color: depositMethod === "in_person" ? "rgba(255,255,255,0.9)" : colors.mutedForeground,
                }]}>Do it yourself</Text>
                <Text style={[s.depositCardFee, {
                  color: depositMethod === "in_person" ? "rgba(255,255,255,0.8)" : colors.mutedForeground,
                }]}>No processing fee</Text>
              </Pressable>
            </View>

            {depositMethod === "in_person" && (
              <View style={s.warning}>
                <Text style={s.warningText}>
                  ⚠️ ShareSwap is not responsible for in-person deposits. You assume full responsibility for collection, return, and any disputes — no platform protection applies.
                </Text>
              </View>
            )}
          </View>

          {/* ── Non-return charge acknowledgment ── */}
          {hasDeposit && (
            <View style={[s.grayCard, { borderColor: colors.border, backgroundColor: colors.background, gap: 8 }]}>
              <Text style={[s.cardTitle, { color: colors.foreground }]}>
                Maximum Charge if Item Is Not Returned: ${targetItem.replacementValue}
              </Text>

              <View style={[s.innerCard, { backgroundColor: colors.muted }]}>
                <View style={s.chargeRow}>
                  <Text style={s.chargeEmoji}>🟢</Text>
                  <Text style={[s.chargeText, { color: colors.mutedForeground }]}>
                    <Text style={{ fontFamily: "Inter_600SemiBold" }}>Trust Deposit</Text>
                    {" "}— authorization hold, lifted after a safe return
                  </Text>
                </View>
                <View style={s.chargeRow}>
                  <Text style={s.chargeEmoji}>🟠</Text>
                  <Text style={[s.chargeText, { color: colors.mutedForeground }]}>
                    <Text style={{ fontFamily: "Inter_600SemiBold" }}>Non-Return Charge</Text>
                    {" "}— only applied if item is not returned
                  </Text>
                </View>
              </View>

              <Pressable
                style={s.checkboxRow}
                onPress={() => setReplacementValueAcknowledged((v) => !v)}
              >
                <View style={[s.checkbox, {
                  borderColor: replacementValueAcknowledged ? PRIMARY : colors.border,
                  backgroundColor: replacementValueAcknowledged ? PRIMARY : "transparent",
                }]}>
                  {replacementValueAcknowledged && (
                    <Feather name="check" size={10} color="#fff" />
                  )}
                </View>
                <Text style={[s.checkboxLabel, { color: colors.foreground }]}>
                  I understand I may be charged up to ${targetItem.replacementValue} if I don't return the item.
                </Text>
              </Pressable>
            </View>
          )}

          {/* ── Note to owner ── */}
          <View style={{ gap: 6 }}>
            <View style={s.noteLabelRow}>
              <Text style={[s.noteLabel, { color: colors.foreground }]}>
                Note to owner{" "}
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                  (optional)
                </Text>
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

        {/* Footer */}
        <View style={[s.footer, { borderTopColor: colors.border }]}>
          <Pressable
            style={[s.footerBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
            onPress={onClose}
          >
            <Text style={[s.footerBtnLabel, { color: colors.foreground }]}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[s.footerBtn, {
              backgroundColor: canSubmit ? PRIMARY : colors.muted,
              borderColor: "transparent",
              opacity: sending ? 0.7 : 1,
            }]}
            onPress={handleSend}
            disabled={!canSubmit || sending}
          >
            {sending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Feather name="send" size={14} color={canSubmit ? "#fff" : colors.mutedForeground} />
                <Text style={[s.footerBtnLabel, {
                  color: canSubmit ? "#fff" : colors.mutedForeground,
                }]}>Send Request</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>

      {/* iOS date picker — absolute overlay inside this Modal but OUTSIDE the
          overflow:hidden sheet so the native UIDatePicker isn't clipped */}
      {Platform.OS === "ios" && activePicker !== null && (
        <View style={s.iosOverlayWrap} pointerEvents="box-none">
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => setActivePicker(null)}
          />
          <View style={[s.iosOverlayCard, { backgroundColor: colors.card, paddingBottom: insets.bottom + 8 }]}>
            <View style={[s.iosOverlayHeader, { borderBottomColor: colors.border }]}>
              <Text style={[s.iosOverlayLabel, { color: colors.mutedForeground }]}>
                {activePicker === "start" ? "Start Date" : "Return Date"}
              </Text>
              <Pressable
                onPress={() => setActivePicker(null)}
                hitSlop={{ top: 12, bottom: 12, left: 20, right: 20 }}
              >
                <Text style={[s.iosOverlayDone, { color: PRIMARY }]}>Done</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={pickerValue}
              mode="date"
              display="inline"
              minimumDate={pickerMin}
              onChange={onDateChange}
              style={s.iosPickerSelf}
            />
          </View>
        </View>
      )}
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: "92%", overflow: "hidden",
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    alignSelf: "center", marginTop: 10, marginBottom: 4,
  },
  header: { paddingHorizontal: H_PAD, paddingTop: 4, paddingBottom: 10 },
  title: { fontSize: 17, fontFamily: "Inter_700Bold", lineHeight: 22 },
  body: { paddingHorizontal: H_PAD, paddingTop: 4, paddingBottom: 16, gap: 16 },
  // Dates
  dateLabelRow: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 8,
  },
  dateLabelLeft: { flexDirection: "row", alignItems: "center", gap: 4 },
  dateLabelText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  dateRow: { flexDirection: "row", gap: 10 },
  datePressable: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 11, paddingVertical: 12,
  },
  datePressableText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  // iOS date-picker — absolute overlay inside the sheet Modal, outside overflow:hidden
  iosOverlayWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  iosOverlayCard: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
  },
  iosOverlayHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1,
  },
  iosOverlayLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  iosOverlayDone: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  iosPickerSelf: { width: "100%" },
  // Cards
  grayCard: { borderWidth: 1, borderRadius: 10, padding: 12 },
  cardTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  innerCard: { borderRadius: 8, padding: 10, gap: 6 },
  // Rows
  splitRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  rowValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  micro: { fontSize: 10, fontFamily: "Inter_400Regular" },
  depositBreakdown: {
    marginTop: 6, paddingTop: 8, borderTopWidth: 1, gap: 3,
  },
  // Deposit method
  sectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  depositCard: { borderWidth: 1, borderRadius: 14, padding: 14 },
  depositCardTop: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  depositCardTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", flex: 1, lineHeight: 16 },
  depositCardSub: { fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 2 },
  depositCardFee: { fontSize: 11, fontFamily: "Inter_400Regular" },
  // Warning
  warning: {
    borderWidth: 1, borderRadius: 10, padding: 10,
    borderColor: "#fcd34d", backgroundColor: "#fffbeb",
  },
  warningText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#92400e" },
  // Charge rows
  chargeRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  chargeEmoji: { fontSize: 11, marginTop: 1 },
  chargeText: { fontSize: 10, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 14 },
  // Checkbox
  checkboxRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkbox: {
    width: 16, height: 16, borderRadius: 3, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
    marginTop: 1, flexShrink: 0,
  },
  checkboxLabel: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 15 },
  // Note to owner
  noteLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noteLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  noteCounter: { fontSize: 11, fontFamily: "Inter_400Regular" },
  msgInput: {
    borderRadius: 10, borderWidth: 1, padding: 12,
    fontSize: 14, fontFamily: "Inter_400Regular", minHeight: 80,
  },
  // Footer
  footer: { flexDirection: "row", gap: 10, padding: 16, borderTopWidth: 1 },
  footerBtn: {
    flex: 1, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 6,
    paddingVertical: 13, borderRadius: 10, borderWidth: 1,
  },
  footerBtnLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
