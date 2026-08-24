import React, { useState, useRef, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
import { apiGet, apiPost } from "@/lib/api";

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
  pinUsed?: boolean;
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
  pinUsed,
}: HandoffSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [showDenyView, setShowDenyView] = useState(false);
  const [pinDigits, setPinDigits] = useState(["", "", "", ""]);
  const [borrowerView, setBorrowerView] = useState<BorrowerView>("pin");
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [ownerPin, setOwnerPin] = useState<{ pin: string | null; pinUsed: boolean; expired: boolean } | null>(null);
  const [ownerPinLoading, setOwnerPinLoading] = useState(false);
  const [ownerPinError, setOwnerPinError] = useState<string | null>(null);

  const ref0 = useRef<TextInput>(null);
  const ref1 = useRef<TextInput>(null);
  const ref2 = useRef<TextInput>(null);
  const ref3 = useRef<TextInput>(null);
  const inputRefs = [ref0, ref1, ref2, ref3];

  const isPinExpired = pinExpiresAt ? new Date(pinExpiresAt) < new Date() : false;
  const isCourier = deliveryMethod === "courier";

  const isRental = requestType === "RENT";
  const isGift = requestType === "GIFT";
  const isSwap = requestType === "SWAP";
  const otherParty = isRental ? "renter" : isGift ? "receiver" : isSwap ? "partner" : "borrower";
  const OtherParty = otherParty.charAt(0).toUpperCase() + otherParty.slice(1);

  useEffect(() => {
    if (visible) {
      setPinDigits(["", "", "", ""]);
      setBorrowerView(isPinExpired ? "expired" : "pin");
      setShowDenyView(false);
      setAttemptsRemaining(null);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || userRole !== "owner") return;

    let cancelled = false;
    setOwnerPin(null);
    setOwnerPinError(null);
    setOwnerPinLoading(true);

    apiGet<{ pin: string | null; pinUsed: boolean; expired: boolean }>(`/api/requests/${requestId}/handoff-pin`)
      .then((data) => {
        if (!cancelled) setOwnerPin(data);
      })
      .catch((error: any) => {
        if (!cancelled) setOwnerPinError(error?.message || "Could not load the handoff code");
      })
      .finally(() => {
        if (!cancelled) setOwnerPinLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, requestId, userRole]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/requests"] });
    qc.invalidateQueries({ queryKey: ["/api/user"] });
    qc.invalidateQueries({ queryKey: ["/api/messages"] });
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
        setPinDigits(["", "", "", ""]);
      } else if (err?.expired) {
        setBorrowerView("expired");
        setPinDigits(["", "", "", ""]);
      } else if (err?.incorrect) {
        setBorrowerView("wrong_pin");
        setAttemptsRemaining(err.attemptsRemaining ?? null);
        // Keep digits visible (user sees what they typed) — "Try again" clears them
      } else {
        setBorrowerView("wrong_pin");
      }
    },
  });

  const confirmHandoffMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/requests/${requestId}/handoff`, { confirmedBy: userRole }),
    onSuccess: (data: any) => {
      invalidate();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (data?.disputeTriggered) {
        Alert.alert("Dispute opened", "We've paused this transaction while we review.");
      } else if (data?.bothConfirmed) {
        Alert.alert("Handoff complete", "Borrow period has started.");
      }
      onSuccess();
    },
    onError: (err: any) => {
      Alert.alert("Handoff failed", err?.message || "Failed to confirm handoff. Please try again.");
    },
  });

  const denyHandoffMutation = useMutation({
    mutationFn: () => apiPost(`/api/requests/${requestId}/deny-handoff`, {}),
    onSuccess: (data: any) => {
      invalidate();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (data?.disputeTriggered) {
        Alert.alert("Dispute opened", "We've paused this transaction while both sides are reviewed.");
      } else {
        Alert.alert("Reported", "The other party has 24 hours to respond, then this will be flagged for review.");
      }
      onSuccess();
    },
    onError: (err: any) => {
      Alert.alert("Error", err?.message || "Failed to report issue");
    },
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

  const resetPin = () => {
    setPinDigits(["", "", "", ""]);
    setBorrowerView("pin");
    setTimeout(() => ref0.current?.focus(), 50);
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
          <View style={ss.titleRow}>
            <Text style={ss.keyIcon}>🔑</Text>
            <Text style={[ss.title, { color: colors.foreground }]}>Handoff code</Text>
          </View>
          <Text style={[ss.sub, { color: colors.mutedForeground }]}>
            Show this code to the borrower after {itemName} has been handed off.
          </Text>
          <View style={[ss.ownerCodeBox, { backgroundColor: "#eef2ff", borderColor: "#c7d2fe" }]}>
            {ownerPinLoading ? (
              <ActivityIndicator color="#4f46e5" />
            ) : ownerPinError ? (
              <Text style={{ color: "#b91c1c", fontSize: 13, textAlign: "center" }}>{ownerPinError}</Text>
            ) : ownerPin?.pin ? (
              <>
                <Text style={ss.ownerCodeLabel}>HANDOFF CODE</Text>
                <Text style={ss.ownerCode}>{ownerPin.pin}</Text>
              </>
            ) : ownerPin?.pinUsed ? (
              <Text style={{ color: "#047857", fontSize: 13, textAlign: "center" }}>This handoff code has already been used.</Text>
            ) : ownerPin?.expired ? (
              <Text style={{ color: "#92400e", fontSize: 13, textAlign: "center" }}>This handoff code has expired.</Text>
            ) : (
              <Text style={{ color: "#92400e", fontSize: 13, textAlign: "center" }}>No handoff code is available for this request.</Text>
            )}
          </View>
          <Text style={[ss.footNote, { color: colors.mutedForeground }]}>
            The borrower enters this code to start the borrow period.
          </Text>
          <Pressable
            style={[ss.btn, { borderColor: colors.border, marginTop: 4 }]}
            onPress={onClose}
            disabled={isProcessing}
          >
            <Text style={[ss.btnTxt, { color: colors.foreground }]}>Done</Text>
          </Pressable>
          <Pressable onPress={() => setShowDenyView(true)} style={{ marginTop: 8 }}>
            <Text style={ss.redLink}>Item was not handed off?</Text>
          </Pressable>
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
            <View style={ss.coConfirmRow}>
              <Text style={ss.coConfirmTick}>✓</Text>
              <Text style={ss.coConfirmText}>
                Owner has already confirmed. Your confirmation will complete the handoff.
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
            <Text style={ss.redLink}>Item was not received?</Text>
          </Pressable>
          <Text style={[ss.footNote, { color: colors.mutedForeground }]}>
            If only one person confirms, we'll complete this automatically in 24 hours.
          </Text>
        </View>
      </Modal>
    );
  }

  // ── BORROWER PIN entry view (default) ──────────────────────────────────────
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={ss.backdrop} onPress={onClose} />
      <View
        style={[ss.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 }]}
      >
        <View style={[ss.handle, { backgroundColor: colors.border }]} />

        {/* Title row with key icon */}
        <View style={ss.titleRow}>
          <Text style={ss.keyIcon}>🔑</Text>
          <Text style={[ss.title, { color: colors.foreground }]}>Enter handoff code</Text>
        </View>

        {/* PIN boxes — hidden when expired or rate-limited */}
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
              <View style={{ alignItems: "center", gap: 4 }}>
                <Text style={{ color: "#ef4444", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                  That code didn't match.
                </Text>
                {attemptsRemaining !== null && attemptsRemaining <= 2 && (
                  <Text style={{ color: "#ef4444", fontSize: 12 }}>
                    {attemptsRemaining} attempt{attemptsRemaining !== 1 ? "s" : ""} remaining
                  </Text>
                )}
                <Pressable onPress={resetPin} style={{ marginTop: 2 }}>
                  <Text style={{ color: "#6366f1", fontSize: 13 }}>Try again</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center" }}>
                Enter the code after you've checked and received the item.
              </Text>
            )}
          </>
        )}

        {/* Expired state */}
        {borrowerView === "expired" && (
          <View style={[ss.warnBox, { backgroundColor: "#fffbeb", borderColor: "#fde68a" }]}>
            <Text style={{ color: "#92400e", fontSize: 14, fontFamily: "Inter_600SemiBold", textAlign: "center" }}>
              This code has expired
            </Text>
            <Text style={{ color: "#b45309", fontSize: 12, textAlign: "center", marginTop: 2 }}>
              Ask the owner to confirm manually, or confirm below.
            </Text>
          </View>
        )}

        {/* Rate limited state */}
        {borrowerView === "rate_limited" && (
          <View style={[ss.warnBox, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
            <Text style={{ color: "#991b1b", fontSize: 14, fontFamily: "Inter_600SemiBold", textAlign: "center" }}>
              Too many attempts
            </Text>
            <Text style={{ color: "#b91c1c", fontSize: 12, textAlign: "center", marginTop: 2 }}>
              Please use the manual confirmation option below.
            </Text>
          </View>
        )}

        <View style={{ gap: 10, marginTop: 4 }}>
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
            <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center" }}>
              Didn't get a code? Confirm without code →
            </Text>
          </Pressable>
          <Pressable onPress={() => setShowDenyView(true)} disabled={isProcessing}>
            <Text style={ss.redLink}>Item was not received?</Text>
          </Pressable>
        </View>
      </View>
      </KeyboardAvoidingView>
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
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  keyIcon: { fontSize: 16 },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 13, lineHeight: 18 },
  warnBox: { borderRadius: 10, padding: 12, borderWidth: 1, gap: 2 },
  coConfirmRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  coConfirmTick: {
    color: "#15803d",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginTop: 1,
  },
  coConfirmText: {
    color: "#15803d",
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  ownerCodeBox: {
    minHeight: 118,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 6,
  },
  ownerCodeLabel: {
    color: "#4f46e5",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 2,
  },
  ownerCode: {
    color: "#312e81",
    fontSize: 36,
    fontFamily: "Inter_700Bold",
    letterSpacing: 12,
    paddingLeft: 12,
  },
  btnRow: { flexDirection: "row", gap: 10 },
  btn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  btnTxt: { fontSize: 14, fontFamily: "Inter_500Medium" },
  redLink: { color: "#ef4444", fontSize: 12, textAlign: "center" },
  footNote: { fontSize: 11, textAlign: "center", marginTop: -4 },
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
