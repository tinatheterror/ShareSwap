/**
 * Security-deposit terminology helpers (pure, no React Native imports).
 *
 * Distinct states:
 *  - hold      temporary card authorization, NOT charged
 *  - charged   captured because a claim was opened (real charge)
 *  - released  hold released without ever being charged
 *  - resolved  claim resolved after a charge (charged / refunded / retained)
 */

import { formatMoney } from "./money";

export type DepositPhase = "none" | "hold" | "charged" | "released" | "resolved";

export interface DepositLike {
  mode?: string | null;
  status?: string | null;
  amount?: number | string | null;
  /** The currency the request was charged in; absent means the platform currency. */
  currency?: string | null;
  phase?: string | null;
  chargedAmount?: number | string | null;
  refundedAmount?: number | string | null;
  retainedAmount?: number | string | null;
  cardLast4?: string | null;
  cardBrand?: string | null;
}

export { formatMoney };

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function cardSuffix(last4?: string | null): string {
  return last4 ? ` •••• ${last4}` : "";
}

/** Derive the phase, tolerating older backends that don't send `phase`. */
export function resolveDepositPhase(deposit: DepositLike | null | undefined): DepositPhase {
  if (!deposit) return "none";
  const p = deposit.phase;
  const refundable = deposit.mode === "refundable_charge";
  if (p === "none" || p === "hold" || p === "charged" || p === "released" || p === "resolved") {
    if (refundable && p === "hold") return "charged";
    return p;
  }
  switch (deposit.status) {
    case "authorized":
    case "held":
      return refundable ? "charged" : "hold";
    case "secured":
      return refundable ? "charged" : "hold";
    case "captured":
      return "charged";
    case "released":
      return "released";
    case "settled":
      return "resolved";
    default:
      return "none";
  }
}

export function depositPhaseLabel(phase: DepositPhase, refundable = false): string {
  switch (phase) {
    case "hold": return "Temporary hold";
    case "charged": return refundable ? "Refundable deposit charged" : "Charged (claim open)";
    case "released": return "Hold released";
    case "resolved": return "Claim resolved";
    default: return "No deposit";
  }
}

export function depositPhaseDescription(
  phase: DepositPhase,
  opts: { amount?: number | string | null; refundable?: boolean; chargedAmount?: number | string | null; currency?: string | null } = {},
): string {
  const amt = formatMoney(opts.amount, opts.currency);
  switch (phase) {
    case "hold":
      return `${amt} deposit hold. Not charged unless a claim is opened.`;
    case "charged":
      return opts.refundable
        ? `${amt} refundable deposit charge. Refunded after the item is returned in good condition.`
        : `${formatMoney(opts.chargedAmount ?? opts.amount, opts.currency)} charged because a claim was opened. It may be refunded depending on the outcome.`;
    case "released":
      return `${amt} deposit hold released. You were not charged.`;
    case "resolved":
      return "The claim was resolved. See the refund and retained amounts below.";
    default:
      return "";
  }
}

/**
 * The deposit line on the request card in chat: just the amount, e.g. "Deposit: $105". What happened to the
 * deposit (hold placed, released, charged, ...) is told by the chat event stamps, not by the card.
 */
export function depositSummaryLine(deposit: DepositLike | null | undefined, fallbackAmount?: number | null): string | null {
  const amount = num(deposit?.amount) ?? fallbackAmount ?? null;
  return amount == null ? null : `Deposit: ${formatMoney(amount, deposit?.currency)}`;
}

// ── Hold explainer constants / builders ─────────────────────────────────────
export const HOLD_NOT_A_CHARGE = "This is a deposit hold, not a charge.";
export const NOT_CHARGED_UNLESS_CLAIM = "Not charged unless a claim is opened.";
export const HOLD_COVERAGE_NOTE = "The hold covers your return date plus one extra day for return processing.";

export function holdTitle(amount: number | string | null | undefined, currency?: string | null): string {
  return `${formatMoney(amount, currency)} deposit hold`;
}
export function holdPendingNote(amount: number | string | null | undefined, currency?: string | null): string {
  return `${HOLD_NOT_A_CHARGE} Your card may show ${formatMoney(amount, currency)} as pending or temporarily unavailable.`;
}
export function holdReleaseExplainer(amount: number | string | null | undefined, currency?: string | null): string {
  return `After the item is returned normally, the ${formatMoney(amount, currency)} hold is released. If a claim is opened, the deposit may be charged while the claim is reviewed.`;
}
export function holdPlacedMessage(amount: number | string | null | undefined, currency?: string | null): string {
  return `Your ${formatMoney(amount, currency)} deposit hold is in place. You have not been charged. ${NOT_CHARGED_UNLESS_CLAIM}`;
}
export function holdReleasedMessage(amount: number | string | null | undefined, currency?: string | null): string {
  return `${formatMoney(amount, currency)} deposit hold released. You were not charged.`;
}
export const CANCEL_BOOKING_MESSAGE = "Your deposit hold will be released. You will not be charged.";

// ── Claim copy ──────────────────────────────────────────────────────────────
export function claimOpenedBorrowerCopy(p: { amount: number | string | null | undefined; cardLast4?: string | null; mode?: string | null; currency?: string | null }) {
  // A hold is charged when a claim opens; a refundable charge was already charged, so it is held.
  const held = p.mode === "refundable_charge";
  return {
    eyebrow: "Claim opened",
    title: held ? "Security deposit held" : "Security deposit charged",
    body: held
      ? `${formatMoney(p.amount, p.currency)} is held while the claim is reviewed.`
      : `${formatMoney(p.amount, p.currency)} has been charged to your card${cardSuffix(p.cardLast4)}.`,
    detail: held
      ? "Your deposit was already charged. It stays held while the claim is reviewed."
      : "Your deposit hold was charged while the claim is reviewed.",
    footer: "If the claim is resolved in your favor, the charged amount will be refunded.",
  };
}

export function claimOpenedOwnerLine(_amount?: number | string | null, mode?: string | null): string {
  return mode === "refundable_charge"
    ? "Claim opened. Deposit held while it’s reviewed."
    : "Claim opened. Deposit charged while it’s reviewed.";
}

export const CLAIM_REVIEW_TOP = {
  heading: "Security deposit",
  whyTitle: "Why was I charged?",
  whyBody: "A claim was opened for this transaction, so your security deposit hold was charged.",
  nextTitle: "What happens next?",
  nextBody: "Your claim will be reviewed. If you are found responsible, some or all of the charge may be kept. If you are not responsible, the applicable amount will be refunded.",
};
export function claimReviewChargedLabel(amount: number | string | null | undefined, currency?: string | null): string {
  return `${formatMoney(amount, currency)} charged`;
}

export type ClaimOutcome = "refunded_full" | "refunded_partial" | "retained_full";

export function deriveClaimOutcome(charged: number, refunded: number, retained: number): ClaimOutcome {
  if (retained <= 0 && refunded > 0) return "refunded_full";
  if (refunded <= 0 && retained > 0) return "retained_full";
  if (refunded > 0 && retained > 0) return "refunded_partial";
  return "refunded_full";
}

export function claimResolvedBorrowerCopy(p: {
  chargedAmount: number | string | null | undefined;
  refundedAmount: number | string | null | undefined;
  retainedAmount: number | string | null | undefined;
  cardLast4?: string | null;
  outcome?: string | null;
  currency?: string | null;
}) {
  const money = (value: number | string | null | undefined) => formatMoney(value, p.currency);
  const charged = num(p.chargedAmount) ?? 0;
  const refunded = num(p.refundedAmount) ?? 0;
  const retained = num(p.retainedAmount) ?? Math.max(0, charged - refunded);
  const outcome = (p.outcome as ClaimOutcome | null | undefined) ?? deriveClaimOutcome(charged, refunded, retained);
  const rows = [
    { label: "Charged", value: money(charged) },
    { label: "Refunded", value: money(refunded) },
    { label: "Retained", value: money(retained) },
  ];
  if (outcome === "retained_full" || (outcome === "refunded_partial" && false)) {
    return {
      eyebrow: "Claim resolved",
      title: "Security deposit retained",
      body: `${money(retained)} of your ${money(charged)} security deposit was retained based on the claim outcome.`,
      detail: "",
      rows,
    };
  }
  if (outcome === "refunded_partial") {
    return {
      eyebrow: "Claim resolved",
      title: "Security deposit partly refunded",
      body: `${money(refunded)} refunded to your card${cardSuffix(p.cardLast4)}.`,
      detail: `${money(retained)} retained based on the claim outcome. The security deposit was previously charged because a claim was opened.`,
      rows,
    };
  }
  return {
    eyebrow: "Claim resolved",
    title: "Security deposit refunded",
    body: `${money(refunded)} refunded to your card${cardSuffix(p.cardLast4)}.`,
    detail: "The security deposit was previously charged because a claim was opened. The applicable amount has now been refunded.",
    rows,
  };
}

/** What the claim-resolved chat card shows: the server's own stamp text, never a client-built "Retained" line. */
export function claimResolvedCardView(p: { content: string; outcome?: string | null; isOwnerView: boolean }) {
  const awarded = p.outcome === "awarded_full" || p.outcome === "retained_full";
  return {
    body: p.content,
    detail: !p.isOwnerView && p.outcome !== "hold_released" ? "The security deposit was previously charged because a claim was opened." : "",
    tone: p.isOwnerView ? ("owner" as const) : awarded ? ("awarded" as const) : ("refunded" as const),
  };
}

export function claimResolvedOwnerLine(refunded: number | string | null | undefined, awarded: number | string | null | undefined, currency?: string | null): string {
  const parts = ["Claim resolved"];
  if (Number(refunded) > 0) parts.push(`${formatMoney(refunded, currency)} refunded`);
  if (Number(awarded) > 0) parts.push(`${formatMoney(awarded, currency)} awarded to owner`);
  return parts.join(" · ");
}

// ── Chat event stamps ───────────────────────────────────────────────────────
/** The chat stamp for a released deposit: a hold released, or a refundable charge refunded. No amount is shown. */
export function depositReleasedStamp(meta: { depositMode?: string | null; amount?: number | string | null } | null | undefined): string {
  return meta?.depositMode === "refundable_charge"
    ? "✅ Deposit refunded. It may take 5–10 business days to show on your card."
    : "✅ Deposit hold released. You weren’t charged.";
}

export function depositConfirmedStamp(meta?: { mode?: string | null; depositMode?: string | null } | null): string {
  const mode = meta?.mode ?? meta?.depositMode;
  return mode === "refundable_charge" ? "🔒 Deposit charged. Refunded after the item is returned." : "🔒 Deposit hold authorized. It’s only charged if a claim is opened.";
}

// ── Notifications ───────────────────────────────────────────────────────────
export type DepositNotifKind = "charged" | "refunded" | "retained" | "released" | "hold" | null;

export function depositNotificationKind(type: string): DepositNotifKind {
  switch (type) {
    case "security_deposit_charged":
    case "security_claim_opened_owner":
      return "charged";
    case "security_deposit_refunded":
      return "refunded";
    case "security_deposit_retained":
      return "retained";
    case "deposit_hold_released":
    case "security_deposit_released":
      return "released";
    default:
      return null;
  }
}

export const DEPOSIT_HOLD_FAILURE_NOTE = "No deposit hold was placed and your security deposit was not charged.";
export const REFUNDABLE_CHARGE_NOTE =
  "This is a real, refundable charge (not a deposit hold). It is refunded after the item is returned in good condition.";
