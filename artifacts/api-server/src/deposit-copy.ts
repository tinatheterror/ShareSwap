import { LEGACY_PAYMENT_CURRENCY, PLATFORM_CURRENCY } from "@workspace/db/currency";

/**
 * Single source of truth for every server-generated sentence about a security
 * deposit. Keep the terminology strict:
 *
 *   Temporary hold  - card authorization, NOT charged
 *   Charged         - captured because a claim was opened
 *   Refunded        - only when previously charged money is returned
 *   Hold released   - authorization released, never a charge
 *   Claim opened    - explicit trigger that converts the hold into a charge
 *   Awarded to owner - charged money a resolved claim pays out to the owner (never "kept", "retained" or "paid")
 *
 * Never use "secured", "processed", "funds secured", "Payment completed" or
 * "Authorization expires" in user-facing copy.
 */

export type DepositPhase = "none" | "hold" | "charged" | "released" | "resolved";
export type ClaimOutcome = "refunded_full" | "refunded_partial" | "retained_full";

/**
 * "$20" for the platform currency (prices are in CAD, noted once at checkout), "US$20" for a request that
 * is still in USD, and the code for any other currency, so an amount is never mistaken for another currency.
 */
export function currencySymbol(currency: string = PLATFORM_CURRENCY): string {
  const code = currency.trim().toLowerCase();
  if (code === PLATFORM_CURRENCY) return "$";
  if (code === LEGACY_PAYMENT_CURRENCY) return "US$";
  return `${code.toUpperCase()} `;
}

export function formatMoney(value: number | string | null | undefined, currency: string = PLATFORM_CURRENCY): string {
  const symbol = currencySymbol(currency);
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return `${symbol}0`;
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? `${symbol}${rounded}` : `${symbol}${rounded.toFixed(2)}`;
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
  "This is a deposit hold, not a charge. Your card may show the amount as pending or temporarily unavailable.";
export const HOLD_RELEASE_EXPLAINER =
  "After the item is returned normally, the hold is released. If a claim is opened, the deposit may be charged while the claim is reviewed.";
export const NOT_CHARGED_UNLESS_CLAIM = "Not charged unless a claim is opened.";

export function outcomeFor(chargedAmount: number, refundedAmount: number, retainedAmount: number): ClaimOutcome {
  if (retainedAmount <= 0) return "refunded_full";
  if (refundedAmount <= 0) return "retained_full";
  return "refunded_partial";
}

// ── Chat event stamps ──────────────────────────────────────────────────────

const REFUND_TIMING = "It may take 5–10 business days to show on your card.";

export function holdPlacedChat(_amount?: number | string): string {
  return "🔒 Deposit hold authorized. It’s only charged if a claim is opened.";
}
export function refundableChargedChat(_amount?: number | string): string {
  return "🔒 Deposit charged. Refunded after the item is returned.";
}
export function holdReleasedChat(_amount?: number | string): string {
  return "✅ Deposit hold released. You weren’t charged.";
}
export function refundableRefundedChat(_amount?: number | string): string {
  return `✅ Deposit refunded. ${REFUND_TIMING}`;
}
export function claimOpenedChat(_amount: number | string, refundable = false): string {
  return refundable
    ? "⚠️ Claim opened. Deposit held while it’s reviewed."
    : "⚠️ Claim opened. Deposit charged while it’s reviewed.";
}
/** What actually happened to the money when a claim was resolved. */
export type ClaimResolvedOutcome = "refunded_full" | "refunded_partial" | "awarded_full" | "hold_released";

export interface ClaimResolvedMoney {
  /** Returned to the borrower's card. */
  refunded: number | string;
  /** Paid out to the owner. */
  awarded: number | string;
  /** False when the deposit was only ever a hold and the hold was cancelled: no money moved. */
  captured: boolean;
}

export interface ClaimResolvedStamp {
  content: string;
  /** Spread into the chat event's metadata; one distinct `outcome` per case. */
  metadata: {
    eventType: "claim_resolved";
    outcome: ClaimResolvedOutcome;
    chargedAmount: number;
    refundedAmount: number;
    awardedAmount: number;
    /** Same value as awardedAmount, for chat events and clients written before the wording changed. */
    retainedAmount: number;
  };
}

const roundCents = (value: number | string) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

/**
 * The one chat stamp for a resolved claim, built from the money that really moved. Only amounts above zero
 * are mentioned, and money is "refunded" (to the borrower) or "awarded to owner", never "kept" or "paid".
 *   $100 refunded  |  $100 awarded to owner  |  $40 refunded · $60 awarded to owner  |  Deposit hold released
 */
export function claimResolvedStamp(money: ClaimResolvedMoney): ClaimResolvedStamp {
  if (!money.captured) {
    return {
      content: "Claim resolved · Deposit hold released",
      metadata: { eventType: "claim_resolved", outcome: "hold_released", chargedAmount: 0, refundedAmount: 0, awardedAmount: 0, retainedAmount: 0 },
    };
  }
  const refunded = Math.max(0, roundCents(money.refunded));
  const awarded = Math.max(0, roundCents(money.awarded));
  const parts = ["Claim resolved"];
  if (refunded > 0) parts.push(`${formatMoney(refunded)} refunded`);
  if (awarded > 0) parts.push(`${formatMoney(awarded)} awarded to owner`);
  const outcome: ClaimResolvedOutcome = refunded > 0 && awarded > 0 ? "refunded_partial" : awarded > 0 ? "awarded_full" : "refunded_full";
  return {
    content: parts.join(" · "),
    metadata: {
      eventType: "claim_resolved", outcome,
      chargedAmount: roundCents(refunded + awarded), refundedAmount: refunded, awardedAmount: awarded, retainedAmount: awarded,
    },
  };
}

// ── Notifications ──────────────────────────────────────────────────────────

export function depositChargedBorrower(amount: number | string, itemName?: string | null, refundable = false) {
  if (refundable) {
    return {
      type: "security_deposit_charged",
      title: "Claim opened — deposit held",
      message: `A claim was opened for your ${shortItemName(itemName)}. Your ${formatMoney(amount)} security deposit is held while the claim is reviewed and may be refunded depending on the outcome.`,
    };
  }
  return {
    type: "security_deposit_charged",
    title: "Claim opened — deposit charged",
    message: `A claim was opened for your ${shortItemName(itemName)}. Your ${formatMoney(amount)} security deposit was charged to your card while the claim is reviewed and may be refunded depending on the outcome.`,
  };
}
export function claimOpenedOwner(amount: number | string, itemName?: string | null, refundable = false) {
  return {
    type: "security_claim_opened_owner",
    title: refundable ? "Claim opened — deposit held" : "Claim opened — deposit charged",
    message: `Your claim for ${shortItemName(itemName)} is under review. The borrower's ${formatMoney(amount)} security deposit ${refundable ? "is held" : "was charged to their card"} while the claim is reviewed.`,
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
    message: `${formatMoney(amount)} deposit hold released. You were not charged.`,
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
      title: "Security deposit awarded to owner",
      message: `${formatMoney(a.retained)} of your ${formatMoney(a.charged)} security deposit was awarded to owner based on the claim outcome. Charged: ${formatMoney(a.charged)}, refunded: ${formatMoney(0)}, awarded to owner: ${formatMoney(a.retained)}.`,
    };
  }
  if (outcome === "refunded_partial") {
    return {
      type: "security_deposit_refunded",
      title: "Security deposit partly refunded",
      message: `${formatMoney(a.refunded)} refunded to ${cardLabel(last4)}. ${formatMoney(a.retained)} of your ${formatMoney(a.charged)} security deposit was awarded to owner based on the claim outcome.`,
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
      title: "Security deposit awarded to owner",
      message: `Claim resolved. ${formatMoney(a.retained)} of the borrower's ${formatMoney(a.charged)} security deposit was awarded to owner.`,
    };
  }
  return {
    type: "security_deposit_refunded",
    title: outcome === "refunded_partial" ? "Security deposit partly refunded" : "Security deposit refunded",
    message: outcome === "refunded_partial"
      ? `Claim resolved. ${formatMoney(a.refunded)} refunded to the borrower · ${formatMoney(a.retained)} awarded to owner.`
      : `Claim resolved. ${formatMoney(a.refunded)} refunded to the borrower.`,
  };
}
export function rejectedHoldReleasedBorrower(amount: number | string) {
  return {
    type: "security_claim_rejected",
    title: "Claim rejected — hold released",
    message: `The claim was rejected. Your ${formatMoney(amount)} deposit hold was released. You were not charged.`,
  };
}
export function rejectedHoldReleasedOwner(amount: number | string) {
  return {
    type: "security_claim_rejected",
    title: "Claim rejected",
    message: `The claim was rejected. The borrower's ${formatMoney(amount)} deposit hold was released.`,
  };
}

// ── Return / renewal / dispute copy ────────────────────────────────────────

export const DEPOSIT_RELEASED_TITLE = "Deposit hold released";
export function returnHoldReleasedNotice(itemName: string, partial = false) {
  return partial
    ? `"${itemName}" — part of the deposit hold was released; return confirmation is pending while we release the rest.`
    : `"${itemName}" — deposit hold released; return confirmation is pending while we finish updating your request.`;
}
export function returnConfirmedNotice(itemName: string, hasPlatformDeposit: boolean, refundable = false) {
  if (!hasPlatformDeposit) return `"${itemName}" returned to owner.`;
  return refundable
    ? `"${itemName}" returned to owner. Refundable deposit refunded.`
    : `"${itemName}" returned to owner. Deposit hold released.`;
}
export function returnConfirmedChat(hasPlatformDeposit: boolean, refundable = false, inPersonDeposit = false) {
  // Cash handed over in person: there is no hold or refund to report; the lender has to hand it back.
  if (inPersonDeposit) return "✅ Item returned in good condition. In-person deposit can be returned.";
  if (!hasPlatformDeposit) return "✅ Item returned in good condition.";
  return refundable
    ? `✅ Item returned in good condition. Deposit refunded. ${REFUND_TIMING}`
    : "✅ Item returned in good condition. Deposit hold released.";
}
export const CANCELLED_HOLD_RELEASED_CHAT = "✅ Deposit hold released. You weren’t charged.";
export function renewalFailedBorrowerBody(itemName: string) {
  return `We couldn't extend the deposit hold for "${itemName}". Retry now or update your saved payment method. You are not charged unless a claim is opened.`;
}
export function renewalFailedOwnerBody(itemName: string) {
  return `The deposit hold for "${itemName}" could not be extended. The borrower has been asked to update their payment method.`;
}
export const RENEWAL_CARD_ERROR = "Your saved card could not extend the deposit hold.";
export const RENEWAL_GENERIC_ERROR = "The deposit hold could not be extended automatically.";
export const HOLD_EXPIRED_TITLE = "Deposit hold expired";
export const HOLD_EXPIRED_BODY =
  "The deposit hold expired and was not renewed or charged. Any claim requires manual review.";
export function disputeOpenedNotice(itemName: string) {
  return `"${itemName}" — a claim was opened and is under review.`;
}
export const IN_PERSON_DEPOSIT_NO_CLAIM =
  "This deposit was paid in person, so it can’t be charged through ShareSwap. Please settle any damage with the borrower directly.";
export const DISPUTE_OPENED_CHAT =
  "🚩 Claim opened — our team will contact both parties within 24 hours.";
export const DISPUTE_OPENED_RESPONSE = "Claim opened and under review.";
export const RETURN_RECORDED_WITH_CLAIM = "Return recorded. The existing claim remains under review.";
export const TRANSACTION_EXPIRED_HOLD_CHAT = "⏰ Transaction expired. The deposit hold was not placed in time.";
export function transactionExpiredHoldBody(itemShort: string) {
  return `"${itemShort}" — the deposit hold was not placed in time.`;
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
  return `A deposit hold isn’t available for this ${reason}. Your ${what} will be charged now and refunded after return.`;
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
