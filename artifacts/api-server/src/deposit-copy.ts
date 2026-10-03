/**
 * Single source of truth for every server-generated sentence about a security
 * deposit. Keep the terminology strict:
 *
 *   Temporary hold  - card authorization, NOT charged
 *   Charged         - captured because a claim was opened
 *   Refunded        - only when previously charged money is returned
 *   Hold released   - authorization released, never a charge
 *   Claim opened    - explicit trigger that converts the hold into a charge
 *
 * Never use "secured", "processed", "funds secured", "Payment completed" or
 * "Authorization expires" in user-facing copy.
 */

export type DepositPhase = "none" | "hold" | "charged" | "released" | "resolved";
export type ClaimOutcome = "refunded_full" | "refunded_partial" | "retained_full";

export function formatMoney(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "$0";
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
}

export function cardLabel(last4?: string | null, brand?: string | null): string {
  if (!last4) return "your card";
  return `your card •••• ${last4}`;
}

export function shortItemName(name: string | null | undefined, limit = 40): string {
  const clean = (name || "your item").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}

export const HOLD_EXPLAINER =
  "This is a temporary hold, not a charge. Your card may show the amount as pending or temporarily unavailable.";
export const HOLD_RELEASE_EXPLAINER =
  "After the item is returned normally, the hold is released. If a claim is opened, the deposit may be charged while the claim is reviewed.";
export const NOT_CHARGED_UNLESS_CLAIM = "Not charged unless a claim is opened.";

export function outcomeFor(chargedAmount: number, refundedAmount: number, retainedAmount: number): ClaimOutcome {
  if (retainedAmount <= 0) return "refunded_full";
  if (refundedAmount <= 0) return "retained_full";
  return "refunded_partial";
}

// ── Chat event stamps ──────────────────────────────────────────────────────

export function holdPlacedChat(amount: number | string): string {
  return `Temporary hold placed — ${formatMoney(amount)} on your card. This is a temporary hold, not a charge. You are not charged unless a claim is opened.`;
}
export function refundableChargedChat(amount: number | string): string {
  return `Refundable deposit charged — ${formatMoney(amount)} was charged to your card and is refunded after the item is returned normally.`;
}
export function holdReleasedChat(amount: number | string): string {
  return `Deposit hold released — ${formatMoney(amount)} temporary hold released. You were not charged.`;
}
export function refundableRefundedChat(amount: number | string): string {
  return `Refundable deposit refunded — ${formatMoney(amount)} was refunded to your card.`;
}
export function claimOpenedChat(amount: number | string): string {
  return `Claim opened and under review, ${formatMoney(amount)} security deposit has been charged`;
}
export function claimResolvedChat(refunded: number | string, retained: number | string): string {
  return `Claim has been resolved. ${formatMoney(refunded)} refunded · ${formatMoney(retained)} retained`;
}

// ── Notifications ──────────────────────────────────────────────────────────

export function depositChargedBorrower(amount: number | string, itemName?: string | null) {
  return {
    type: "security_deposit_charged",
    title: "Security deposit charged",
    message: `A ${formatMoney(amount)} security deposit was charged to your card because a claim was opened for your ${shortItemName(itemName)}. The charge will remain while the claim is reviewed and may be refunded depending on the outcome.`,
  };
}
export function claimOpenedOwner(amount: number | string, itemName?: string | null) {
  return {
    type: "security_claim_opened_owner",
    title: "Claim opened — deposit charged",
    message: `Your claim for ${shortItemName(itemName)} is under review. The borrower's ${formatMoney(amount)} security deposit was charged to their card while the claim is reviewed.`,
  };
}
export function claimOpenedPendingCharge(itemName?: string | null) {
  return {
    type: "security_claim_opened",
    title: "Security claim opened",
    message: `The owner opened a claim for ${shortItemName(itemName)}. You can respond before it is reviewed. The security deposit is not charged yet.`,
  };
}
export function depositHoldReleased(amount: number | string) {
  return {
    type: "deposit_hold_released",
    title: "Deposit hold released",
    message: `${formatMoney(amount)} temporary hold released. You were not charged.`,
  };
}
export function refundableDepositRefunded(amount: number | string) {
  return {
    type: "security_deposit_refunded",
    title: "Refundable deposit refunded",
    message: `Your ${formatMoney(amount)} refundable deposit was refunded to your card.`,
  };
}

export interface ResolutionAmounts { charged: number; refunded: number; retained: number }

export function resolutionBorrower(a: ResolutionAmounts, last4?: string | null) {
  const outcome = outcomeFor(a.charged, a.refunded, a.retained);
  if (outcome === "retained_full") {
    return {
      type: "security_deposit_retained",
      title: "Security deposit retained",
      message: `${formatMoney(a.retained)} of your ${formatMoney(a.charged)} security deposit was retained based on the claim outcome. Charged: ${formatMoney(a.charged)}, refunded: ${formatMoney(0)}, retained: ${formatMoney(a.retained)}.`,
    };
  }
  if (outcome === "refunded_partial") {
    return {
      type: "security_deposit_refunded",
      title: "Security deposit partly refunded",
      message: `${formatMoney(a.refunded)} refunded to ${cardLabel(last4)}. ${formatMoney(a.retained)} of your ${formatMoney(a.charged)} security deposit was retained based on the claim outcome.`,
    };
  }
  return {
    type: "security_deposit_refunded",
    title: "Security deposit refunded",
    message: `${formatMoney(a.refunded)} refunded to ${cardLabel(last4)}. The security deposit was charged because a claim was opened, and the applicable amount has now been refunded.`,
  };
}
export function resolutionOwner(a: ResolutionAmounts) {
  const outcome = outcomeFor(a.charged, a.refunded, a.retained);
  if (outcome === "retained_full") {
    return {
      type: "security_deposit_retained",
      title: "Security deposit retained",
      message: `Claim resolved. ${formatMoney(a.retained)} of the borrower's ${formatMoney(a.charged)} security deposit was retained.`,
    };
  }
  return {
    type: "security_deposit_refunded",
    title: outcome === "refunded_partial" ? "Security deposit partly refunded" : "Security deposit refunded",
    message: `Claim resolved. ${formatMoney(a.refunded)} refunded to the borrower · ${formatMoney(a.retained)} retained.`,
  };
}
export function rejectedHoldReleasedBorrower(amount: number | string) {
  return {
    type: "security_claim_rejected",
    title: "Claim rejected — hold released",
    message: `The claim was rejected. Your ${formatMoney(amount)} temporary hold was released. You were not charged.`,
  };
}
export function rejectedHoldReleasedOwner(amount: number | string) {
  return {
    type: "security_claim_rejected",
    title: "Claim rejected",
    message: `The claim was rejected. The borrower's ${formatMoney(amount)} temporary hold was released.`,
  };
}

// ── Return / renewal / dispute copy ────────────────────────────────────────

export const DEPOSIT_RELEASED_TITLE = "Deposit hold released";
export function returnHoldReleasedNotice(itemName: string, partial = false) {
  return partial
    ? `"${itemName}" — part of the temporary hold was released; return confirmation is pending while we release the rest.`
    : `"${itemName}" — temporary hold released; return confirmation is pending while we finish updating your request.`;
}
export function returnConfirmedNotice(itemName: string, hasPlatformDeposit: boolean, refundable = false) {
  if (!hasPlatformDeposit) return `"${itemName}" returned to owner.`;
  return refundable
    ? `"${itemName}" returned to owner. Refundable deposit refunded.`
    : `"${itemName}" returned to owner. Temporary hold released.`;
}
export function returnConfirmedChat(hasPlatformDeposit: boolean, refundable = false) {
  if (!hasPlatformDeposit) return "✅ Return confirmed — item received in good condition.";
  return refundable
    ? "✅ Return confirmed — item received in good condition. Refundable deposit refunded."
    : "✅ Return confirmed — item received in good condition. Temporary hold released. You were not charged.";
}
export const CANCELLED_HOLD_RELEASED_CHAT = "Deposit hold released — the temporary hold was released. You were not charged.";
export function renewalFailedBorrowerBody(itemName: string) {
  return `We couldn't extend the temporary deposit hold for "${itemName}". Retry now or update your saved payment method. You are not charged unless a claim is opened.`;
}
export function renewalFailedOwnerBody(itemName: string) {
  return `The temporary deposit hold for "${itemName}" could not be extended. The borrower has been asked to update their payment method.`;
}
export const RENEWAL_CARD_ERROR = "Your saved card could not extend the temporary deposit hold.";
export const RENEWAL_GENERIC_ERROR = "The temporary deposit hold could not be extended automatically.";
export const HOLD_EXPIRED_TITLE = "Temporary hold expired";
export const HOLD_EXPIRED_BODY =
  "The temporary hold expired and was not renewed or charged. Any claim requires manual review.";
export function disputeOpenedNotice(itemName: string) {
  return `"${itemName}" — a claim was opened and is under review.`;
}
export const DISPUTE_OPENED_CHAT =
  "🚩 Claim opened — our team will contact both parties within 24 hours.";
export const DISPUTE_OPENED_RESPONSE = "Claim opened and under review.";
export const RETURN_RECORDED_WITH_CLAIM = "Return recorded. The existing claim remains under review.";
export const TRANSACTION_EXPIRED_HOLD_CHAT = "⏰ Transaction expired. The temporary deposit hold was not placed in time.";
export function transactionExpiredHoldBody(itemShort: string) {
  return `"${itemShort}" — the temporary deposit hold was not placed in time.`;
}
export function disputeBorrowerResolvedNotice(itemName: string) {
  return `"${itemName}" return reviewed. No claim was upheld; you were not charged.`;
}
export function disputeOwnerResolvedNotice(itemName: string) {
  return `"${itemName}" return reviewed. No claim was upheld; the borrower's hold was released.`;
}
export const RETURN_RECONCILING_ERROR = "The deposit hold release is still being reconciled. You can safely retry.";

// ── Stripe-facing descriptions (may appear on card statements) ─────────────

export function stripeHoldDescription(requestId: number) {
  return `ShareSwap temporary deposit hold (not a charge) - request #${requestId}`;
}
export function stripeRenewedHoldDescription(requestId: number) {
  return `ShareSwap temporary deposit hold, extended (not a charge) - request #${requestId}`;
}
export function stripeRefundableChargeDescription(requestId: number) {
  return `ShareSwap refundable deposit charge - request #${requestId}`;
}

// ── Consent copy ───────────────────────────────────────────────────────────

export function refundableConsentMessage(amount: number, kind: "rental" | "borrow") {
  const what = kind === "borrow" ? "trust deposit" : "security deposit";
  const reason = kind === "borrow" ? "borrow" : "rental";
  return `Your ${what} needs a refundable deposit charge of ${formatMoney(amount)} because a temporary card hold can't cover this ${reason}. This is a real charge to your card, refunded after the item is returned normally.`;
}

// ── Lifecycle deposit view ────────────────────────────────────────────────

const REAL_CHARGE_STATUSES = ["held", "authorized", "disputed", "SECURED_REFUNDABLE", "secured_refundable", "captured"];
const HOLD_STATUSES = ["held", "authorized", "disputed"];

export interface DepositViewInput {
  mode?: string | null;
  status?: string | null;
  amount?: string | number | null;
  capturedAmount?: string | number | null;
  refundedAmount?: string | number | null;
  retainedAmount?: string | number | null;
  cardLast4?: string | null;
  cardBrand?: string | null;
}

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

export function depositLifecycleView(input: DepositViewInput) {
  const status = input.status || "";
  const amount = num(input.amount);
  let phase: DepositPhase = "none";
  let chargedAmount = num(input.capturedAmount);
  if (status === "released") phase = "released";
  else if (status === "settled") phase = "resolved";
  else if (status === "captured") phase = "charged";
  else if (input.mode === "refundable_charge" && REAL_CHARGE_STATUSES.includes(status)) phase = "charged";
  else if (HOLD_STATUSES.includes(status)) phase = "hold";
  if (phase === "charged" && chargedAmount === null) chargedAmount = amount;
  if (phase === "resolved" && chargedAmount === null && input.refundedAmount != null) chargedAmount = amount;
  return {
    phase,
    chargedAmount: phase === "charged" || phase === "resolved" ? chargedAmount : null,
    refundedAmount: phase === "resolved" ? num(input.refundedAmount) : null,
    retainedAmount: phase === "resolved" ? num(input.retainedAmount) : null,
    cardLast4: input.cardLast4 ?? null,
    cardBrand: input.cardBrand ?? null,
  };
}
