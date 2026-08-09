import React, { useState, useRef, useEffect } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { apiPost } from "@/lib/api";

interface HandoffSheetProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  requestId: number;
  userRole: "owner" | "borrower";
  itemName: string;
  requestType?: string;
  deliveryMethod?: string | null;
  otherPartyConfirmed?: boolean;
  pinExpiresAt?: string | null;
}

type BorrowerView = "pin" | "manual" | "wrong_pin" | "expired" | "rate_limited";

export function HandoffSheet({
  visible,
  onClose,
  onSuccess,
  requestId,
  userRole,
  itemName,
  requestType = "BORROW",
  deliveryMethod,
  otherPartyConfirmed = false,
  pinExpiresAt,
}: HandoffSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [showDenyView, setShowDenyView] = useState(false);
  const [pinDigits, setPinDigits] = useState(["", "", "", ""]);
  const [borrowerView, setBorrowerView] = useState<BorrowerView>("pin");
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);

  const ref0 = useRef<TextInput>(null);
  const ref1 = useRef<TextInput>(null);
  const ref2 = useRef<TextInput>(null);
  const ref3 = useRef<TextInput>(null);
  const inputRefs = [ref0, ref1, ref2, ref3];

  const isPinExpired = pinExpiresAt ? new Date(pinExpiresAt) < new Date() : false;
  const isCourier = deliveryMethod === "courier";
  const otherParty =
    requestType === "RENT" ? "renter" : requestType === "GIFT" ? "receiver" : "borrower";
  const OtherParty = otherParty.charAt(0).toUpperCase() + otherParty.slice(1);

  useEffect(() => {
    if (visible) {
      setPinDigits(["", "", "", ""]);
      setBorrowerView(isPinExpired ? "expired" : "pin");
      setShowDenyView(false);
      setAttemptsRemaining(null);
      if (userRole === "borrower") {
        setTimeout(() => ref0.current?.focus(), 200);
      }
    }
  }, [visible]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/requests"] });
    qc.invalidateQueries({ queryKey: ["/api/user"] });
    qc.invalidateQueries({ queryKey: ["/api/inbox"] });
  };

  const verifyPinMutation = useMutation({
    mutationFn: (pin: string) => apiPost(`/api/requests/${requestId}/verify-pin`, { pin }),
    onSuccess: () => {
      invalidate();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess();
    },
    onError: (err: any) => {
      if (err?.rateLimited) {
        setBorrowerView("rate_limited");
      } else if (err?.expired) {
        setBorrowerView("expired");
      } else if (err?.incorrect) {
        setBorrowerView("wrong_pin");
        setAttemptsRemaining(err.attemptsRemaining ?? null);
        setPinDigits(["", "", "", ""]);
        setTimeout(() => ref0.current?.focus(), 100);
      } else {
        setBorrowerView("wrong_pin");
        setPinDigits(["", "", "", ""]);
        setTimeout(() => ref0.current?.focus(), 100);
      }
    },
  });

  const confirmHandoffMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/requests/${requestId}/handoff`, { confirmedBy: userRole }),
    onSuccess: () => {
      invalidate();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess();
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to confirm handoff";
      setPinDigits(["", "", "", ""]);
      setBorrowerView("manual");
      setTimeout(() => {}, 0);
    },
  });

  const denyHandoffMutation = useMutation({
    mutationFn: () => apiPost(`/api/requests/${requestId}/deny-handoff`, {}),
    onSuccess: () => {
      invalidate();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      onSuccess();
    },
    onError: (err: any) => {},
  });

  const isProcessing =
    verifyPinMutation.isPending ||
    confirmHandoffMutation.isPending ||
    denyHandoffMutation.isPending;

  const handleDigitChange = (i: number, val: string) => {
    const digit = val.replace(/\D/g, "").slice(-1);
    const next = [...pinDigits];
    next[i] = digit;
    setPinDigits(next);
    if (digit && i < 3) inputRefs[i + 1].current?.focus();
    if (next.every((d) => d !== "")) {
      verifyPinMutation.mutate(next.join(""));
    }
  };

  const handleKeyPress = (i: number, key: string) => {
    if (key === "Backspace" && !pinDigits[i] && i > 0) {
      inputRefs[i - 1].current?.focus();
    }
  };

  // ── Deny view (shared between owner and borrower) ──────────────────────────
  if (showDenyView) {
    const isOwnerDeny = userRole === "owner";
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={ss.backdrop} onPress={onClose} />
        <View
          style={[ss.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 }]}
        >
          <View style={[ss.handle, { backgroundColor: colors.border }]} />
          <Text style={[ss.title, { color: "#ef4444" }]}>
            {isOwnerDeny ? "Item not handed off?" : "Item not received?"}
          </Text>
          <Text style={[ss.sub, { color: colors.mutedForeground }]}>
            {isOwnerDeny
              ? otherPartyConfirmed
                ? `The ${otherParty} already confirmed. Reporting this will open a dispute.`
                : `The ${otherParty} will have 24 hours to respond.`
              : otherPartyConfirmed
              ? "The owner already confirmed. Reporting this will open a dispute."
              : "The owner will have 24 hours to respond."}
          </Text>
          <View style={[ss.warnBox, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
            <Text style={{ color: "#991b1b", fontSize: 13 }}>
              {otherPartyConfirmed
                ? "⚠️ This will open a dispute. Both parties must submit proof within 24 hours."
                : isOwnerDeny
                ? `We'll notify the ${otherParty} and wait for their response.`
                : "We'll notify the owner and wait for their response before taking action."}
            </Text>
          </View>
          <View style={ss.btnRow}>
            <Pressable
              style={[ss.btn, { flex: 1, borderColor: colors.border }]}
              onPress={() => setShowDenyView(false)}
              disabled={isProcessing}
            >
              <Text style={[ss.btnTxt, { color: colors.foreground }]}>Go back</Text>
            </Pressable>
            <Pressable
              style={[ss.btn, { flex: 1, backgroundColor: "#ef4444", borderColor: "#ef4444" }]}
              onPress={() => denyHandoffMutation.mutate()}
              disabled={isProcessing}
            >
              {denyHandoffMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[ss.btnTxt, { color: "#fff" }]}>Report issue</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  // ── OWNER view ─────────────────────────────────────────────────────────────
  if (userRole === "owner") {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={ss.backdrop} onPress={onClose} />
        <View
          style={[ss.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 }]}
        >
          <View style={[ss.handle, { backgroundColor: colors.border }]} />
          <Text style={[ss.title, { color: colors.foreground }]}>
            {isCourier ? "Confirm Item Sent" : "Confirm Item Handoff"}
          </Text>
          <Text style={[ss.sub, { color: colors.mutedForeground }]}>
            Confirm that {itemName} has been handed off.
          </Text>
          {otherPartyConfirmed && (
            <View style={[ss.warnBox, { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" }]}>
              <Text style={{ color: "#15803d", fontSize: 13 }}>
                ✓ {OtherParty} has already confirmed. Your confirmation will complete the handoff.
              </Text>
            </View>
          )}
          <View style={[ss.warnBox, { backgroundColor: "#fffbeb", borderColor: "#fde68a" }]}>
            <Text style={{ color: "#92400e", fontSize: 13 }}>
              ⚠ Only confirm once you've physically handed off the item.
            </Text>
          </View>
          <View style={ss.btnRow}>
            <Pressable
              style={[ss.btn, { flex: 1, borderColor: colors.border }]}
              onPress={onClose}
              disabled={isProcessing}
            >
              <Text style={[ss.btnTxt, { color: colors.foreground }]}>Not yet</Text>
            </Pressable>
            <Pressable
              style={[ss.btn, { flex: 1, backgroundColor: "#0d9488", borderColor: "#0d9488" }]}
              onPress={() => confirmHandoffMutation.mutate()}
              disabled={isProcessing}
            >
              {confirmHandoffMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[ss.btnTxt, { color: "#fff" }]}>Confirm handoff</Text>
              )}
            </Pressable>
          </View>
          <Pressable onPress={() => setShowDenyView(true)} style={{ marginTop: 8 }}>
            <Text style={{ color: "#ef4444", fontSize: 12, textAlign: "center" }}>
              Item was not handed off?
            </Text>
          </Pressable>
          <Text
            style={{ color: colors.mutedForeground, fontSize: 11, textAlign: "center", marginTop: 4 }}
          >
            If only one person confirms, we'll complete this automatically in 24 hours.
          </Text>
        </View>
      </Modal>
    );
  }

  // ── BORROWER manual confirm view ───────────────────────────────────────────
  if (borrowerView === "manual") {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={ss.backdrop} onPress={onClose} />
        <View
          style={[ss.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 }]}
        >
          <View style={[ss.handle, { backgroundColor: colors.border }]} />
          <Text style={[ss.title, { color: colors.foreground }]}>Confirm Item Received</Text>
          <Text style={[ss.sub, { color: colors.mutedForeground }]}>
            Confirm you've received {itemName}.
          </Text>
          {otherPartyConfirmed && (
            <View style={[ss.warnBox, { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" }]}>
              <Text style={{ color: "#15803d", fontSize: 13 }}>
                ✓ Owner has already confirmed. Your confirmation will complete the handoff.
              </Text>
            </View>
          )}
          <View style={[ss.warnBox, { backgroundColor: "#fffbeb", borderColor: "#fde68a" }]}>
            <Text style={{ color: "#92400e", fontSize: 13 }}>
              ⚠ Only confirm once you've physically received the item.
            </Text>
          </View>
          <View style={ss.btnRow}>
            <Pressable
              style={[ss.btn, { flex: 1, borderColor: colors.border }]}
              onPress={() => setBorrowerView("pin")}
              disabled={isProcessing}
            >
              <Text style={[ss.btnTxt, { color: colors.foreground }]}>Back</Text>
            </Pressable>
            <Pressable
              style={[ss.btn, { flex: 1, backgroundColor: "#0d9488", borderColor: "#0d9488" }]}
              onPress={() => confirmHandoffMutation.mutate()}
              disabled={isProcessing}
            >
              {confirmHandoffMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[ss.btnTxt, { color: "#fff" }]}>Confirm received</Text>
              )}
            </Pressable>
          </View>
          <Pressable onPress={() => setShowDenyView(true)} style={{ marginTop: 8 }}>
            <Text style={{ color: "#ef4444", fontSize: 12, textAlign: "center" }}>
              Item was not received?
            </Text>
          </Pressable>
          <Text
            style={{ color: colors.mutedForeground, fontSize: 11, textAlign: "center", marginTop: 4 }}
          >
            If only one person confirms, we'll complete this automatically in 24 hours.
          </Text>
        </View>
      </Modal>
    );
  }

  // ── BORROWER PIN entry view (default) ──────────────────────────────────────
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={ss.backdrop} onPress={onClose} />
      <View
        style={[ss.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 }]}
      >
        <View style={[ss.handle, { backgroundColor: colors.border }]} />
        <Text style={[ss.title, { color: colors.foreground }]}>Enter handoff code</Text>

        {borrowerView !== "expired" && borrowerView !== "rate_limited" && (
          <>
            <View style={ss.pinRow}>
              {pinDigits.map((digit, i) => (
                <TextInput
                  key={i}
                  ref={inputRefs[i]}
                  style={[
                    ss.pinBox,
                    {
                      borderColor:
                        borrowerView === "wrong_pin"
                          ? "#ef4444"
                          : digit
                          ? "#6366f1"
                          : colors.border,
                      backgroundColor:
                        borrowerView === "wrong_pin" ? "#fef2f2" : colors.muted,
                      color:
                        borrowerView === "wrong_pin" ? "#ef4444" : colors.foreground,
                    },
                  ]}
                  value={digit}
                  onChangeText={(val) => handleDigitChange(i, val)}
                  onKeyPress={({ nativeEvent }) => handleKeyPress(i, nativeEvent.key)}
                  keyboardType="number-pad"
                  maxLength={1}
                  textAlign="center"
                  editable={!isProcessing}
                  selectTextOnFocus
                />
              ))}
            </View>
            {verifyPinMutation.isPending ? (
              <View style={ss.centered}>
                <ActivityIndicator size="small" color="#6366f1" />
                <Text style={{ color: "#6366f1", fontSize: 13 }}>Checking code…</Text>
              </View>
            ) : borrowerView === "wrong_pin" ? (
              <View style={{ alignItems: "center", gap: 2 }}>
                <Text style={{ color: "#ef4444", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                  That code didn't match.
                </Text>
                {attemptsRemaining !== null && attemptsRemaining <= 2 && (
                  <Text style={{ color: "#ef4444", fontSize: 12 }}>
                    {attemptsRemaining} attempt{attemptsRemaining !== 1 ? "s" : ""} remaining
                  </Text>
                )}
              </View>
            ) : (
              <Text
                style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center" }}
              >
                Enter the code after you've checked and received the item.
              </Text>
            )}
          </>
        )}

        {borrowerView === "expired" && (
          <View style={[ss.warnBox, { backgroundColor: "#fffbeb", borderColor: "#fde68a" }]}>
            <Text style={{ color: "#92400e", fontSize: 13, textAlign: "center" }}>
              This code has expired. Ask the owner to confirm manually, or confirm below.
            </Text>
          </View>
        )}

        {borrowerView === "rate_limited" && (
          <View style={[ss.warnBox, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
            <Text style={{ color: "#991b1b", fontSize: 13, textAlign: "center" }}>
              Too many attempts. Please use the manual confirmation option below.
            </Text>
          </View>
        )}

        <View style={{ gap: 10, marginTop: 12 }}>
          {borrowerView !== "expired" && borrowerView !== "rate_limited" && (
            <Pressable
              style={[ss.btn, { borderColor: colors.border }]}
              onPress={onClose}
              disabled={isProcessing}
            >
              <Text style={[ss.btnTxt, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
          )}
          <Pressable onPress={() => setBorrowerView("manual")} disabled={isProcessing}>
            <Text
              style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center" }}
            >
              Didn't get a code? Confirm without code →
            </Text>
          </Pressable>
          <Pressable onPress={() => setShowDenyView(true)} disabled={isProcessing}>
            <Text style={{ color: "#ef4444", fontSize: 12, textAlign: "center" }}>
              Item was not received?
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const ss = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 4,
  },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 13, lineHeight: 18 },
  warnBox: { borderRadius: 10, padding: 12, borderWidth: 1 },
  btnRow: { flexDirection: "row", gap: 10 },
  btn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  btnTxt: { fontSize: 14, fontFamily: "Inter_500Medium" },
  pinRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  pinBox: {
    width: 56,
    height: 64,
    borderRadius: 12,
    borderWidth: 2,
    fontSize: 28,
    fontFamily: "Inter_700Bold",
  },
  centered: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
});
