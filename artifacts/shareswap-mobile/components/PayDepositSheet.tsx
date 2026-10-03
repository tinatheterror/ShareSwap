/**
 * PayDepositSheet
 *
 * Bottom-sheet modal for the BORROW + in_app deposit flow on native.
 * Mirrors the web TrustDepositModal: charge platform fee → place temporary deposit
 * hold (off-session using saved card) → record in DB.
 *
 * No Stripe SDK needed — all payment operations are off-session and
 * handled server-side using the user's saved card.
 */

import React, { useState, useCallback } from "react";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Shield, Lock, Coins, CheckCircle } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { apiPost, apiGet } from "@/lib/api";
import { calculateSecurityDeposit } from "@/lib/deposit-calculator";
import { paymentErrorMessage } from "@/lib/payment-error";
import { holdTitle, holdPendingNote, holdReleaseExplainer, holdPlacedMessage, HOLD_COVERAGE_NOTE, DEPOSIT_HOLD_FAILURE_NOTE } from "@/lib/depositCopy";

const PRIMARY = "#0d9488";

type PaymentApiError = Error & {
  status?: number;
  selectionState?: string;
  consentRequired?: boolean;
  consentMessage?: string;
  consentEndpoint?: string;
  depositAmount?: number;
  requiresAction?: boolean;
  stripeStatus?: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("T")[0].split("-").map(Number);
  return new Date(y, m - 1, d);
}

function computeShareCoins(
  startDate: string | null,
  endDate: string | null,
  rawSCPrice: number,
): number {
  if (!startDate || !endDate) return Math.max(1, Math.ceil(rawSCPrice));
  const s = parseLocalDate(startDate);
  const e = parseLocalDate(endDate);
  const days = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / 86_400_000));
  return Math.max(1, Math.ceil((rawSCPrice / 7) * days));
}

// ── Props ──────────────────────────────────────────────────────────────────────

export interface PayDepositSheetProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  requestId: number;
  item: {
    name: string;
    tier: number | null;
    originalValue: string | null;
    shareCoinPrice: number | null;
  };
  startDate: string | null;
  endDate: string | null;
  /** User's reputation score — used to compute the trust discount. */
  reputationScore: number;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function PayDepositSheet({
  visible,
  onClose,
  onSuccess,
  requestId,
  item,
  startDate,
  endDate,
  reputationScore,
}: PayDepositSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const router = useRouter();

  const [processing, setProcessing] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [succeededRefundable, setSucceededRefundable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refundableConsent, setRefundableConsent] = useState<{
    message: string;
    endpoint: string;
    amount: number;
  } | null>(null);

  // ── Calculations ─────────────────────────────────────────────────────────────

  const trustScore = Math.min(100, Math.round((reputationScore / 500) * 100) + 50);
  const depositCalc = calculateSecurityDeposit(
    item.tier ?? 2,
    item.originalValue ?? "$50–$150",
    trustScore,
  );
  const depositAmount = depositCalc.finalDeposit;
  const shareCoins = computeShareCoins(startDate, endDate, item.shareCoinPrice ?? 5);

  // Fee waiver check
  const { data: feeWaiver } = useQuery<{
    feeWaived: boolean;
    completedCount: number;
    remainingFree: number;
    totalFree: number;
  }>({
    queryKey: ["/api/user/fee-waiver-status"],
    queryFn: () => apiGet("/api/user/fee-waiver-status"),
    enabled: visible,
  });

  const STRIPE_MIN_CHARGE = 0.50;
  const rawFee = Math.round(depositAmount * 0.03 * 100) / 100;
  const atMinimum = rawFee < STRIPE_MIN_CHARGE;
  const platformFeeDisplay = Math.max(STRIPE_MIN_CHARGE, rawFee);
  const platformFeeLabel = atMinimum ? "Platform fee (min. $0.50)" : "Platform fee (3%)";
  const feeWaived = feeWaiver?.feeWaived ?? true; // optimistic: show $0 while loading
  const platformFee = feeWaived ? 0 : platformFeeDisplay;
  const feeWaiverLabel = feeWaiver
    ? `Transaction ${feeWaiver.completedCount + 1} of ${feeWaiver.totalFree} free`
    : "Loading…";

  // ── Pay handler ──────────────────────────────────────────────────────────────

  const handlePay = useCallback(async () => {
    setProcessing(true);
    setError(null);
    try {
      // Prepare the hold first. The API can require an explicit confirmation
      // before changing this into a refundable charge.
      const holdData = await apiPost<{ paymentIntentId: string }>(
        "/api/stripe/create-deposit-hold",
        { depositAmount, requestId },
      );

      // Charge the platform fee only after the chosen deposit mode is prepared.
      let chargeId: string | null = null;
      if (platformFee > 0) {
        const feeData = await apiPost<{ chargeId: string | null; waived?: boolean }>(
          "/api/stripe/charge-platform-fee",
          { platformFeeAmount: platformFee, requestId },
        );
        chargeId = feeData.chargeId;
      }

      // Record the authorization hold and advance to DEPOSIT_CONFIRMED.
      await apiPost(`/api/requests/${requestId}/pay-deposit`, {
        depositAmount,
        processingFee: platformFee,
        totalAmount: depositAmount + platformFee,
        baseDepositAmount: depositCalc.baseDeposit,
        discountPercentage: depositCalc.discountPercentage,
        trustScore,
        paymentIntentId: holdData.paymentIntentId,
        platformFeeChargeId: chargeId,
        shareCoinAmount: shareCoins,
      });

      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      setSucceededRefundable(false);
      setSucceeded(true);
      onSuccess();
    } catch (e: unknown) {
      const paymentError = e as PaymentApiError;
      if (
        paymentError.selectionState === "consent_required" &&
        paymentError.consentRequired &&
        paymentError.consentEndpoint
      ) {
        setRefundableConsent({
          message: paymentError.consentMessage ||
            `Your trust deposit requires a refundable payment of $${Number(paymentError.depositAmount ?? depositAmount).toFixed(2)} because your card’s authorization window doesn’t provide enough coverage for this borrow.`,
          endpoint: paymentError.consentEndpoint,
          amount: Number(paymentError.depositAmount ?? depositAmount),
        });
        return;
      }
      if (paymentError.selectionState === "payment_pending" || paymentError.requiresAction) {
        setError(
          paymentError.requiresAction
            ? "Your card needs additional authentication. Update or authenticate your card in Payment Settings, then try again."
            : "Your refundable deposit payment is still pending. Check Payment Settings and try again once it is complete.",
        );
        return;
      }
      setError(paymentErrorMessage(paymentError));
    } finally {
      setProcessing(false);
    }
  }, [platformFee, depositAmount, requestId, depositCalc, trustScore, shareCoins, qc, onSuccess]);

  const handleConfirmRefundablePayment = useCallback(async () => {
    if (!refundableConsent) return;
    setProcessing(true);
    setError(null);
    try {
      const result = await apiPost<{ selectionState?: string; requiresAction?: boolean }>(
        refundableConsent.endpoint,
        {},
      );
      if (result.selectionState === "payment_pending" || result.requiresAction) {
        setError(
          result.requiresAction
            ? "Your card needs additional authentication. Update or authenticate your card in Payment Settings, then try again."
            : "Your refundable deposit payment is still pending. Check Payment Settings and try again once it is complete.",
        );
        return;
      }
      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      setRefundableConsent(null);
      setSucceededRefundable(true);
      setSucceeded(true);
      onSuccess();
    } catch (e: unknown) {
      const paymentError = e as PaymentApiError;
      if (paymentError.selectionState === "payment_pending" || paymentError.requiresAction) {
        setError(
          paymentError.requiresAction
            ? "Your card needs additional authentication. Update or authenticate your card in Payment Settings, then try again."
            : "Your refundable deposit payment is still pending. Check Payment Settings and try again once it is complete.",
        );
      } else {
        setError(paymentErrorMessage(paymentError));
      }
    } finally {
      setProcessing(false);
    }
  }, [refundableConsent, qc, onSuccess]);

  // ── Reset on close ────────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    if (processing) return;
    setSucceeded(false);
    setSucceededRefundable(false);
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

        {/* Handle bar */}
        <View style={[s.handle, { backgroundColor: colors.border }]} />

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {succeeded ? (
            /* ── Success ─────────────────────────────────────────────────────── */
            <View style={s.successWrap}>
              <CheckCircle size={48} color={PRIMARY} strokeWidth={1.5} />
              <Text style={[s.successTitle, { color: colors.foreground }]}>{succeededRefundable ? "Refundable deposit charged" : "Temporary hold placed"}</Text>
              <Text style={[s.successSub, { color: colors.mutedForeground }]}>
                Your borrow of{" "}
                <Text style={{ fontFamily: "Inter_600SemiBold" }}>{item.name}</Text>
                {" "}is confirmed.{" "}
                {succeededRefundable
                  ? `Your ${"$" + depositAmount.toFixed(2)} refundable deposit was charged to your card.`
                  : holdPlacedMessage(depositAmount.toFixed(2))}
              </Text>

              <View style={[s.breakdownBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <View style={s.breakdownRow}>
                  <Text style={[s.breakdownLabel, { color: colors.mutedForeground }]}>{platformFeeLabel}</Text>
                  {feeWaived
                    ? <Text style={[s.breakdownValue, { color: "#16a34a" }]}>{feeWaiverLabel} — $0.00</Text>
                    : <Text style={[s.breakdownValue, { color: colors.foreground }]}>${platformFee.toFixed(2)} charged</Text>
                  }
                </View>
                <View style={[s.divider, { backgroundColor: colors.border }]} />
                <View style={s.breakdownRow}>
                   <Text style={[s.breakdownLabel, { color: colors.mutedForeground }]}>{succeededRefundable ? "Refundable deposit" : "Trust deposit"}</Text>
                  <Text style={[s.breakdownValue, { color: "#2563eb" }]}>{succeededRefundable ? `${depositAmount.toFixed(2)} charged` : `${depositAmount.toFixed(2)} temporary hold`}</Text>
                </View>
                <Text style={[s.breakdownNote, { color: colors.mutedForeground }]}>
                  {succeededRefundable ? "Refunded after the item is returned in good condition." : holdReleaseExplainer(depositAmount.toFixed(2))}
                </Text>
              </View>

              <Text style={[s.nextStepLabel, { color: PRIMARY }]}>Next step</Text>
              <Text style={[s.nextStepText, { color: colors.foreground }]}>
                Coordinate pickup with the owner
              </Text>
              <Text style={[s.coinNote, { color: colors.mutedForeground }]}>
                {Math.round(shareCoins)} ShareCoins will be charged at handoff
              </Text>

              <Pressable style={[s.primaryBtn, { backgroundColor: PRIMARY }]} onPress={handleClose}>
                <Text style={s.primaryBtnText}>Done</Text>
              </Pressable>
            </View>
          ) : refundableConsent ? (
            <View style={s.content}>
              <Text style={[s.subtitle, { color: PRIMARY }]}>Refundable payment confirmation</Text>
              <Text style={[s.title, { color: colors.foreground }]}>Confirm refundable deposit</Text>
              <View style={[s.breakdownBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <View style={s.breakdownRow}>
                  <Text style={[s.breakdownLabel, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                    Refundable security deposit
                  </Text>
                  <Text style={[s.breakdownValue, { color: colors.foreground }]}>
                    ${refundableConsent.amount.toFixed(2)}
                  </Text>
                </View>
                <Text style={[s.breakdownNote, { color: colors.mutedForeground }]}>
                  {refundableConsent.message}
                </Text>
              </View>
              {error && <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>}
              <Pressable
                style={[s.primaryBtn, { backgroundColor: PRIMARY, opacity: processing ? 0.7 : 1 }]}
                onPress={handleConfirmRefundablePayment}
                disabled={processing}
              >
                {processing ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.primaryBtnText}>Confirm refundable payment</Text>}
              </Pressable>
              {error && (
                <Pressable style={[s.primaryBtn, { backgroundColor: colors.muted }]} onPress={() => router.push("/payment-methods" as never)} disabled={processing}>
                  <Text style={[s.primaryBtnText, { color: colors.foreground }]}>Open Payment Settings</Text>
                </Pressable>
              )}
              <Pressable style={s.cancelBtn} onPress={handleClose} disabled={processing}>
                <Text style={[s.cancelBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            /* ── Payment screen ──────────────────────────────────────────────── */
            <View style={s.content}>
              <Text style={[s.subtitle, { color: PRIMARY }]}>Confirm your borrow</Text>
              <Text style={[s.title, { color: colors.foreground }]}>{item.name}</Text>

              {/* Breakdown */}
              <View style={[s.breakdownBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <View style={s.breakdownRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.breakdownLabel, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                      {platformFeeLabel}
                    </Text>
                    {feeWaived
                      ? <Text style={[s.breakdownNote, { color: "#16a34a", marginTop: 2 }]}>{feeWaiverLabel} 🎉</Text>
                      : <Text style={[s.breakdownNote, { color: "#16a34a", marginTop: 2 }]}>Charged now</Text>
                    }
                  </View>
                  <Text style={[s.breakdownValue, { color: feeWaived ? "#16a34a" : colors.foreground }]}>
                    {feeWaived ? "$0.00" : `$${platformFeeDisplay.toFixed(2)}`}
                  </Text>
                </View>
                <View style={[s.divider, { backgroundColor: colors.border }]} />
                <View style={s.breakdownRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.breakdownLabel, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                       Trust deposit
                    </Text>
                    <Text style={[s.breakdownNote, { color: "#2563eb", marginTop: 2 }]}>
                      {holdTitle(depositAmount.toFixed(2))}. {holdPendingNote(depositAmount.toFixed(2))}
                    </Text>
                  </View>
                  <Text style={[s.breakdownValue, { color: colors.foreground }]}>
                    ${depositAmount.toFixed(2)}
                  </Text>
                </View>
                <Text style={[s.breakdownNote, { color: colors.mutedForeground }]}>
                  {holdReleaseExplainer(depositAmount.toFixed(2))} {HOLD_COVERAGE_NOTE}
                </Text>
              </View>

              {/* ShareCoins note */}
              <View style={s.coinRow}>
                <Coins size={12} color="#0d9488" strokeWidth={2} />
                <Text style={[s.coinNote, { color: colors.mutedForeground }]}>
                  {Math.round(shareCoins)} ShareCoins charged at pickup
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
              <Pressable
                style={[s.primaryBtn, { backgroundColor: PRIMARY, opacity: processing ? 0.7 : 1 }]}
                onPress={handlePay}
                disabled={processing}
              >
                {processing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Lock size={16} color="#fff" strokeWidth={2} style={{ marginRight: 6 }} />
                    <Text style={s.primaryBtnText}>
                      {feeWaived
                        ? `Place ${holdTitle(depositAmount.toFixed(2))} — ${feeWaiverLabel.toLowerCase()}`
                        : `Pay ${platformFee.toFixed(2)} + place temporary hold`}
                    </Text>
                  </>
                )}
              </Pressable>

              <Pressable style={s.cancelBtn} onPress={handleClose} disabled={processing}>
                <Text style={[s.cancelBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
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
    maxHeight: "85%",
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
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  subtitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 1,
    textAlign: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginBottom: 20,
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
    gap: 8,
  },
  breakdownLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  breakdownValue: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    flexShrink: 0,
  },
  breakdownNote: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  holdNote: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: "#eff6ff",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  holdNoteText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#1d4ed8",
    flex: 1,
    lineHeight: 16,
  },
  coinRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    justifyContent: "center",
    marginBottom: 16,
  },
  coinNote: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
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
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 8,
    gap: 6,
  },
  primaryBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  secureNote: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginBottom: 8,
  },
  cancelBtn: {
    paddingVertical: 8,
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  // Success
  successWrap: {
    paddingHorizontal: 24,
    paddingBottom: 8,
    alignItems: "center",
  },
  successTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    marginTop: 12,
    marginBottom: 4,
  },
  successSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginBottom: 20,
  },
  nextStepLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
    alignSelf: "flex-start",
  },
  nextStepText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginBottom: 4,
    alignSelf: "flex-start",
  },
});
