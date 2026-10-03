/**
 * PayRentalSheet
 *
 * Bottom-sheet modal for the RENT + ACCEPTED payment flow on native.
 * Mirrors the web RentalDepositModal.
 *
 * Flow:
 *  1. Call /api/rentals/create-payment-hold with confirmIfSaved: true.
 *  2. If hasSavedCard: backend confirms immediately (off-session) →
 *     we call /api/requests/:id/confirm-rental-deposit → DEPOSIT_CONFIRMED.
 *  3. If no saved card: show instructions to add a card in Settings.
 *
 * No Stripe SDK needed for the saved-card path — all payment operations
 * are handled server-side.
 */

import React, { useState, useCallback } from "react";
import { holdTitle, holdPendingNote, holdReleaseExplainer, holdPlacedMessage, HOLD_COVERAGE_NOTE, NOT_CHARGED_UNLESS_CLAIM, DEPOSIT_HOLD_FAILURE_NOTE } from "@/lib/depositCopy";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { CreditCard, CheckCircle, Shield, Tag, Truck, AlertCircle } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { apiPost } from "@/lib/api";
import { paymentErrorMessage } from "@/lib/payment-error";
import {
  calculateRentalRate,
  calculateRentalDeposit,
  calculateRentalPrice,
  getDiscountLabel,
} from "@/lib/rental-calculator";

const PRIMARY_GREEN = "#16a34a";

// ── Helpers ────────────────────────────────────────────────────────────────────

type PaymentApiError = Error & {
  selectionState?: string;
  consentRequired?: boolean;
  consentMessage?: string;
  consentEndpoint?: string;
  depositAmount?: number;
  requiresAction?: boolean;
};

function parseDays(startDate: string | null, endDate: string | null): number {
  if (!startDate || !endDate) return 7;
  return Math.max(
    1,
    Math.ceil(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) /
        (1000 * 60 * 60 * 24),
    ) + 1,
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────

export interface PayRentalSheetProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  requestId: number;
  item: {
    name: string;
    tier: number | null;
    category: string | null;
    replacementValue: number | null;
    dollarsPrice: string | null;
    securityDeposit: number | null;
  };
  startDate: string | null;
  endDate: string | null;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function PayRentalSheet({
  visible,
  onClose,
  onSuccess,
  requestId,
  item,
  startDate,
  endDate,
}: PayRentalSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const router = useRouter();

  const [processing, setProcessing] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [succeededRefundable, setSucceededRefundable] = useState(false);
  const [noSavedCard, setNoSavedCard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refundableConsent, setRefundableConsent] = useState<{
    message: string;
    endpoint: string;
    amount: number;
  } | null>(null);

  // ── Rental pricing ────────────────────────────────────────────────────────────

  const itemValue = item.replacementValue ?? 100;
  const depositCalc = calculateRentalDeposit(itemValue, item.tier ?? 2);
  const rentalCalc = calculateRentalRate(itemValue, item.category ?? "Home & Kitchen");
  const lenderDeposit = item.securityDeposit ? Number(item.securityDeposit) : null;

  const days = parseDays(startDate, endDate);
  const weeklyRate = item.dollarsPrice ? parseFloat(item.dollarsPrice) : rentalCalc.weeklyRate;
  const pricing = calculateRentalPrice(weeklyRate, days);

  const rentalPrice = pricing.total;
  const rentalSubtotal = pricing.subtotal;
  const discountPct = pricing.discountPct;
  const discountAmount = pricing.discountAmount;
  const depositAmount = lenderDeposit && lenderDeposit > 0 ? lenderDeposit : depositCalc.deposit;
  const processingFee = Math.round((rentalPrice + depositAmount) * 0.03 * 100) / 100;
  const dailyRate = days > 0 ? rentalSubtotal / days : 0;
  // The security deposit is a temporary hold (not a charge), so it is not part of what is charged today.
  const totalDueToday = rentalPrice + processingFee;
  const discountLabel = getDiscountLabel(days);

  // ── Pay handler ──────────────────────────────────────────────────────────────

  const handlePay = useCallback(async () => {
    setProcessing(true);
    setError(null);
    try {
      // Create the payment hold — backend auto-confirms if saved card present
      const holdData = await apiPost<{
        clientSecret: string;
        paymentIntentId: string;
        hasSavedCard: boolean;
        alreadyConfirmed?: boolean;
      }>("/api/rentals/create-payment-hold", {
        requestId,
        depositAmount,
        rentalAmount: rentalPrice,
        processingFee,
        platformFee: 0,
        confirmIfSaved: true,
      });

      if (!holdData.hasSavedCard) {
        setNoSavedCard(true);
        setProcessing(false);
        return;
      }

      // Payment was confirmed off-session on the server — record it
      await apiPost(`/api/requests/${requestId}/confirm-rental-deposit`, {
        paymentIntentId: holdData.paymentIntentId,
        depositAmount,
        rentalAmount: rentalPrice,
        processingFee,
        platformFee: 0,
      });

      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      setSucceededRefundable(false);
      setSucceeded(true);
      onSuccess();
    } catch (e: unknown) {
      const paymentError = e as PaymentApiError;
      if (paymentError.selectionState === "consent_required" && paymentError.consentRequired && paymentError.consentEndpoint) {
        setRefundableConsent({
          message: paymentError.consentMessage || "This deposit needs to be collected as a refundable payment.",
          endpoint: paymentError.consentEndpoint,
          amount: Number(paymentError.depositAmount ?? depositAmount),
        });
      } else if (paymentError.selectionState === "payment_pending" || paymentError.requiresAction) {
        setError(paymentError.requiresAction
          ? "Your card needs additional authentication. Update or authenticate your card in Payment Settings, then try again."
          : "Your refundable deposit payment is still pending. Check Payment Settings and try again once it is complete.");
      } else {
        const message = paymentErrorMessage(paymentError);
        if (message.startsWith("No payment card is saved.")) setNoSavedCard(true);
        else setError(message);
      }
    } finally {
      setProcessing(false);
    }
  }, [requestId, depositAmount, rentalPrice, processingFee, qc, onSuccess]);

  const handleConfirmRefundablePayment = useCallback(async () => {
    if (!refundableConsent) return;
    setProcessing(true);
    setError(null);
    try {
      const result = await apiPost<{ selectionState?: string; requiresAction?: boolean }>(refundableConsent.endpoint, {});
      if (result.selectionState === "payment_pending" || result.requiresAction) {
        setError(result.requiresAction
          ? "Your card needs additional authentication. Update or authenticate your card in Payment Settings, then try again."
          : "Your refundable deposit payment is still pending. Check Payment Settings and try again once it is complete.");
        return;
      }
      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      setRefundableConsent(null);
      setSucceededRefundable(true);
      setSucceeded(true);
      onSuccess();
    } catch (e: unknown) {
      const paymentError = e as PaymentApiError;
      setError(paymentError.requiresAction
        ? "Your card needs additional authentication. Update or authenticate your card in Payment Settings, then try again."
        : paymentErrorMessage(paymentError));
    } finally {
      setProcessing(false);
    }
  }, [refundableConsent, qc, onSuccess]);

  // ── Reset on close ────────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    if (processing) return;
    setSucceeded(false);
    setSucceededRefundable(false);
    setNoSavedCard(false);
    setError(null);
    setRefundableConsent(null);
    onClose();
  }, [processing, onClose]);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <Pressable style={s.backdrop} onPress={handleClose} />
      <View style={[s.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
        <View style={[s.handle, { backgroundColor: colors.border }]} />

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* ── Success ──────────────────────────────────────────────────────── */}
          {succeeded ? (
            <View style={s.centeredWrap}>
              <CheckCircle size={48} color={PRIMARY_GREEN} strokeWidth={1.5} />
              <Text style={[s.successTitle, { color: colors.foreground }]}>Booking confirmed!</Text>
              <Text style={[s.successSub, { color: colors.mutedForeground }]}>
                Your rental of{" "}
                <Text style={{ fontFamily: "Inter_600SemiBold" }}>{item.name}</Text>
                {" "}is booked.
              </Text>
              <Text style={[s.nextStepText, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                {succeededRefundable
                  ? `Your ${depositAmount.toFixed(2)} refundable deposit was charged to your card. It is refunded after the item is returned in good condition.`
                  : `${holdPlacedMessage(depositAmount.toFixed(2))} ${holdReleaseExplainer(depositAmount.toFixed(2))}`}
              </Text>
              <Text style={[s.nextStepText, { color: colors.mutedForeground }]}>
                Coordinate pickup with the owner. Return here on the rental start date to confirm handoff.
              </Text>
              <Pressable style={[s.primaryBtn, { backgroundColor: PRIMARY_GREEN }]} onPress={handleClose}>
                <Text style={s.primaryBtnText}>Done</Text>
              </Pressable>
            </View>

          /* ── Explicit refundable-payment consent ───────────────────────── */
          ) : refundableConsent ? (
            <View style={s.centeredWrap}>
              <Shield size={40} color={PRIMARY_GREEN} strokeWidth={1.5} />
              <Text style={[s.successTitle, { color: colors.foreground }]}>Confirm refundable deposit</Text>
              <Text style={[s.nextStepText, { color: colors.foreground, textAlign: "center", fontFamily: "Inter_500Medium" }]}>
                This is a real, refundable charge to your card, not a temporary hold.
              </Text>
              <Text style={[s.nextStepText, { color: colors.mutedForeground, textAlign: "center" }]}>
                {refundableConsent.message}{"\n\n"}
                <Text style={{ fontFamily: "Inter_700Bold", color: colors.foreground }}>
                  ${refundableConsent.amount.toFixed(2)} refundable payment
                </Text>
              </Text>
              {error && <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>}
              <Pressable style={[s.primaryBtn, { backgroundColor: PRIMARY_GREEN, opacity: processing ? 0.7 : 1 }]} onPress={handleConfirmRefundablePayment} disabled={processing}>
                {processing ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.primaryBtnText}>Confirm refundable payment</Text>}
              </Pressable>
              {error && <Pressable style={[s.primaryBtn, { backgroundColor: colors.muted }]} onPress={() => router.push("/payment-methods" as never)} disabled={processing}>
                <Text style={[s.primaryBtnText, { color: colors.foreground }]}>Open Payment Settings</Text>
              </Pressable>}
              <Pressable style={s.cancelBtn} onPress={handleClose} disabled={processing}>
                <Text style={[s.cancelBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
            </View>

          /* ── No saved card ──────────────────────────────────────────────── */
          ) : noSavedCard ? (
            <View style={s.centeredWrap}>
              <AlertCircle size={40} color="#f59e0b" strokeWidth={1.5} />
              <Text style={[s.successTitle, { color: colors.foreground }]}>Payment card required</Text>
              <Text style={[s.nextStepText, { color: colors.mutedForeground, textAlign: "center" }]}>
                To pay for your rental on the app, please add a payment card first.{"\n\n"}
                Go to{" "}
                <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.foreground }}>
                  Settings → Payment Method
                </Text>
                {" "}on the ShareSwap web app to add your card, then return here.
              </Text>
              <Pressable style={[s.primaryBtn, { backgroundColor: colors.muted }]} onPress={handleClose}>
                <Text style={[s.primaryBtnText, { color: colors.foreground }]}>Got it</Text>
              </Pressable>
            </View>

          /* ── Payment screen ──────────────────────────────────────────────── */
          ) : (
            <View style={s.content}>
              <View style={s.headerRow}>
                <CreditCard size={20} color={PRIMARY_GREEN} strokeWidth={2} />
                <Text style={[s.title, { color: colors.foreground }]}>Confirm Your Rental</Text>
              </View>
              <Text style={[s.subtitle, { color: colors.mutedForeground }]}>
                Renting{" "}
                <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.foreground }}>
                  {item.name}
                </Text>
              </Text>

              {/* Breakdown */}
              <View style={[s.breakdownBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                {/* Rental */}
                <View style={s.breakdownRow}>
                  <Text style={[s.breakdownLabel, { color: colors.mutedForeground }]}>
                    Rental ({days} day{days !== 1 ? "s" : ""} × ${dailyRate.toFixed(2)}/day)
                  </Text>
                  <Text style={[s.breakdownValue, { color: colors.foreground }]}>
                    ${rentalSubtotal.toFixed(2)}
                  </Text>
                </View>

                {/* Discount */}
                {discountPct > 0 && (
                  <View style={s.breakdownRow}>
                    <View style={s.discountLabelRow}>
                      <Tag size={11} color="#0d9488" strokeWidth={2} />
                      <Text style={[s.breakdownLabel, { color: "#0d9488" }]}>{discountLabel}</Text>
                    </View>
                    <Text style={[s.breakdownValue, { color: "#0d9488" }]}>
                      −${discountAmount.toFixed(2)}
                    </Text>
                  </View>
                )}

                {/* Rental total */}
                <View style={[s.breakdownRow, s.subtotalRow]}>
                  <Text style={[s.breakdownLabel, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                    Rental total
                  </Text>
                  <Text style={[s.breakdownValue, { color: "#0d9488", fontFamily: "Inter_700Bold" }]}>
                    ${rentalPrice.toFixed(2)}
                  </Text>
                </View>

                {/* Platform fee */}
                <View style={s.breakdownRow}>
                  <Text style={[s.breakdownLabel, { color: colors.mutedForeground }]}>
                    Platform fee (3%)
                  </Text>
                  <Text style={[s.breakdownValue, { color: colors.mutedForeground }]}>
                    ${processingFee.toFixed(2)}
                  </Text>
                </View>

                {/* Security deposit */}
                <View style={[s.depositBlock]}>
                  <View style={s.breakdownRow}>
                    <View style={s.discountLabelRow}>
                      <Shield size={11} color={colors.mutedForeground} strokeWidth={2} />
                      <Text style={[s.breakdownLabel, { color: colors.mutedForeground }]}>
                        Security deposit
                      </Text>
                    </View>
                    <Text style={[s.breakdownValue, { color: colors.foreground }]}>
                      ${depositAmount.toFixed(2)}
                    </Text>
                  </View>
                  <Text style={[s.breakdownNote, { color: colors.mutedForeground }]}>
                    {holdTitle(depositAmount.toFixed(2))} — not charged. {NOT_CHARGED_UNLESS_CLAIM}
                  </Text>
                </View>

                {/* Total */}
                <View style={[s.breakdownRow, s.subtotalRow]}>
                  <Text style={[s.breakdownLabel, { color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 14 }]}>
                    Charged today
                  </Text>
                  <Text style={[s.breakdownValue, { color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 15 }]}>
                    ${totalDueToday.toFixed(2)}
                  </Text>
                </View>
              </View>

              {/* Hold clarification */}
              <View style={s.holdNote}>
                <AlertCircle size={12} color="#2563eb" strokeWidth={2} />
                <Text style={s.holdNoteText}>
                  <Text style={{ fontFamily: "Inter_600SemiBold" }}>
                    ${holdTitle(depositAmount.toFixed(2))}
                  </Text>
                  {". "}{holdPendingNote(depositAmount.toFixed(2))}{" "}{holdReleaseExplainer(depositAmount.toFixed(2))}{" "}{HOLD_COVERAGE_NOTE}{" "}
                  The{" "}
                  <Text style={{ fontFamily: "Inter_600SemiBold" }}>
                    ${rentalPrice.toFixed(2)} rental fee
                  </Text>
                  {" "}is charged now.
                </Text>
              </View>

              {/* Error */}
              {error && (
                <View style={s.errorBox}>
                  <Text style={s.errorText}>{error}</Text>
                  <Text style={[s.errorText, { marginTop: 4 }]}>{DEPOSIT_HOLD_FAILURE_NOTE}</Text>
                </View>
              )}

              {/* CTA */}
              <View style={s.btnRow}>
                <Pressable
                  style={[s.cancelOutlineBtn, { borderColor: colors.border }]}
                  onPress={handleClose}
                  disabled={processing}
                >
                  <Text style={[s.cancelOutlineBtnText, { color: colors.foreground }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[s.primaryBtn, { flex: 1, backgroundColor: PRIMARY_GREEN, opacity: processing ? 0.7 : 1 }]}
                  onPress={handlePay}
                  disabled={processing}
                >
                  {processing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <CreditCard size={15} color="#fff" strokeWidth={2} style={{ marginRight: 5 }} />
                      <Text style={s.primaryBtnText}>Pay ${totalDueToday.toFixed(2)} + place hold</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "90%",
    paddingTop: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  centeredWrap: {
    paddingHorizontal: 24,
    paddingBottom: 8,
    alignItems: "center",
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  title: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginBottom: 16,
  },
  breakdownBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  breakdownLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
    paddingRight: 8,
  },
  breakdownValue: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    flexShrink: 0,
  },
  breakdownNote: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  discountLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flex: 1,
  },
  subtotalRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.1)",
    paddingTop: 8,
    marginTop: 2,
  },
  depositBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.1)",
    paddingTop: 8,
    marginTop: 2,
    gap: 2,
  },
  holdNote: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: "#eff6ff",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 14,
  },
  holdNoteText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#1d4ed8",
    flex: 1,
    lineHeight: 16,
  },
  errorBox: {
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#dc2626",
    textAlign: "center",
  },
  btnRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingVertical: 13,
    gap: 5,
  },
  primaryBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  cancelOutlineBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelOutlineBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  cancelBtn: {
    paddingVertical: 8,
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  successTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  successSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  nextStepText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
});
