/**
 * Security-deposit terminology helpers (web).
 *
 * Distinguishes four states that must never be conflated:
 *  - hold      temporary card authorization, NOT charged
 *  - charged   captured because a claim was opened (real charge)
 *  - released  hold released without ever being charged
 *  - resolved  claim resolved after a charge (charged / refunded / retained)
 */

export type DepositPhase = "none" | "hold" | "charged" | "released" | "resolved";

import { formatMoney } from "./money";

export { formatMoney };

export function toAmount(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

export interface DepositLike {
  mode?: string | null;
  status?: string | null;
  amount?: string | number | null;
  /** The currency the request was charged in; absent means the platform currency. */
  currency?: string | null;
  phase?: DepositPhase | string | null;
  chargedAmount?: number | string | null;
  refundedAmount?: number | string | null;
  retainedAmount?: number | string | null;
  cardLast4?: string | null;
  cardBrand?: string | null;
}

const VALID_PHASES: DepositPhase[] = ["none", "hold", "charged", "released", "resolved"];

/** Derive a phase from a legacy depositStatus when the backend does not send `phase`. */
export function phaseFromStatus(status: string | null | undefined): DepositPhase {
  switch ((status ?? "").toLowerCase()) {
    case "authorized":
    case "held":
      return "hold";
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

/** Resolve the effective deposit phase, tolerating a backend that has not shipped `phase` yet. */
export function resolveDepositPhase(deposit: DepositLike | null | undefined): DepositPhase {
  if (!deposit) return "none";
  if (deposit.mode === "refundable_charge" && (deposit.status === "secured" || deposit.status === "captured")) {
    return "charged";
  }
  if (deposit.phase && (VALID_PHASES as string[]).includes(deposit.phase)) {
    return deposit.phase as DepositPhase;
  }
  return phaseFromStatus(deposit.status);
}

export function isRefundableChargeMode(mode: string | null | undefined): boolean {
  return mode === "refundable_charge";
}

export const HOLD_EXPLAINER_SHORT = "This is a deposit hold, not a charge.";
export const NOT_CHARGED_UNLESS_CLAIM = "Not charged unless a claim is opened.";

export function holdPendingNotice(amount: number | string | null | undefined, currency?: string | null): string {
  return `This is a deposit hold, not a charge. Your card may show ${formatMoney(amount, currency)} as pending or temporarily unavailable.`;
}

export function holdReleaseExplainer(amount: number | string | null | undefined, currency?: string | null): string {
  const a = formatMoney(amount, currency);
  return `After the item is returned normally, the ${a} hold is released. If a claim is opened, the deposit may be charged while the claim is reviewed.`;
}

export function temporaryHoldLabel(amount: number | string | null | undefined, currency?: string | null): string {
  return `${formatMoney(amount, currency)} deposit hold`;
}

export const HOLD_COVERAGE_NOTE =
  "The hold covers your scheduled return date plus one extra day for return processing.";

export const REFUNDABLE_CHARGE_NOTE =
  "This is a real, refundable charge (not a deposit hold). It is refunded after the item is returned safely unless a claim is opened.";

export function holdReleasedTitle(): string {
  return "Deposit hold released";
}

export function holdReleasedBody(amount: number | string | null | undefined, currency?: string | null): string {
  return `${formatMoney(amount, currency)} deposit hold released. You were not charged.`;
}

export function cardSuffix(cardLast4?: string | null): string {
  return cardLast4 ? ` ${"••••"} ${cardLast4}` : "";
}

export function cardPhrase(cardLast4?: string | null): string {
  return cardLast4 ? `your card${cardSuffix(cardLast4)}` : "your card";
}

/* ---------- Phase label / description ---------- */

export interface PhaseCopy {
  label: string;
  description: string;
  tone: "neutral" | "hold" | "charged" | "released" | "resolved";
}

export function depositPhaseCopy(deposit: DepositLike | null | undefined, opts?: { viewer?: "borrower" | "owner" }): PhaseCopy {
  const viewer = opts?.viewer ?? "borrower";
  const phase = resolveDepositPhase(deposit);
  const amount = toAmount(deposit?.chargedAmount) ?? toAmount(deposit?.amount);
  const amt = formatMoney(amount, deposit?.currency);
  const refundable = isRefundableChargeMode(deposit?.mode);
  const who = viewer === "owner" ? "The borrower's" : "Your";
  switch (phase) {
    case "hold":
      return {
        label: "Temporary hold",
        description:
          viewer === "owner"
            ? `${amt} deposit hold on the borrower's card. Not charged unless a claim is opened.`
            : `${temporaryHoldLabel(amount, deposit?.currency)}. ${NOT_CHARGED_UNLESS_CLAIM}`,
        tone: "hold",
      };
    case "charged":
      if (refundable) {
        return {
          label: "Refundable deposit charged",
          description: `${who} ${amt} refundable deposit was charged. It is refunded after a safe return unless a claim is opened.`,
          tone: "charged",
        };
      }
      return {
        label: "Charged",
        description:
          viewer === "owner"
            ? `Claim under review. The borrower's ${amt} security deposit has been charged.`
            : `${amt} charged because a claim was opened. It may be refunded depending on the claim outcome.`,
        tone: "charged",
      };
    case "released":
      return {
        label: "Hold released",
        description: holdReleasedBody(amount),
        tone: "released",
      };
    case "resolved": {
      const refunded = toAmount(deposit?.refundedAmount) ?? 0;
      const retained = toAmount(deposit?.retainedAmount) ?? 0;
      return {
        label: retained > 0 && refunded > 0 ? "Partly refunded" : retained > 0 ? "Retained" : "Refunded",
        description: claimResolvedSummary({ chargedAmount: amount, refundedAmount: refunded, retainedAmount: retained }),
        tone: "resolved",
      };
    }
    default:
      return { label: "No deposit", description: "", tone: "neutral" };
  }
}

/* ---------- Claim opened ---------- */

export const CLAIM_OPENED_TITLE = "Claim opened";

/** Claim opened, borrower view. A hold is charged when a claim opens; a refundable charge was already charged, so it is held. */
export function claimOpenedHeadline(mode?: string | null): string {
  return isRefundableChargeMode(mode) ? "Security deposit held" : "Security deposit charged";
}

export function claimOpenedChargedLine(amount: number | string | null | undefined, cardLast4?: string | null, mode?: string | null, currency?: string | null): string {
  return isRefundableChargeMode(mode)
    ? `${formatMoney(amount, currency)} is held while the claim is reviewed.`
    : `${formatMoney(amount, currency)} has been charged to your card${cardSuffix(cardLast4)}.`;
}

export function claimOpenedExplainer(mode?: string | null): string {
  return isRefundableChargeMode(mode)
    ? "Your deposit was already charged. It stays held while the claim is reviewed."
    : "Your deposit hold was charged while the claim is reviewed.";
}
export const CLAIM_OPENED_REFUND_NOTE =
  "If the claim is resolved in your favor, the charged amount will be refunded.";

export function claimOpenedOwnerLine(_amount?: number | string | null, mode?: string | null): string {
  return isRefundableChargeMode(mode)
    ? "Claim opened. Deposit held while it’s reviewed."
    : "Claim opened. Deposit charged while it’s reviewed.";
}

/* ---------- Claim review (borrower) ---------- */

export function claimReviewWhy(mode?: string | null): { title: string; body: string } {
  return isRefundableChargeMode(mode)
    ? { title: "Why is my deposit held?", body: "A claim was opened for this transaction, so your refundable deposit stays held while the claim is reviewed." }
    : { title: "Why was I charged?", body: "A claim was opened for this transaction, so your security deposit hold was charged." };
}
export const CLAIM_REVIEW_NEXT_TITLE = "What happens next?";
export const CLAIM_REVIEW_NEXT_BODY =
  "Your claim will be reviewed. If you are found responsible, some or all of the charge may be kept. If you are not responsible, the applicable amount will be refunded.";

/* ---------- Claim resolved ---------- */

export interface ClaimAmounts {
  chargedAmount?: number | string | null;
  refundedAmount?: number | string | null;
  retainedAmount?: number | string | null;
  /** The currency the request was charged in; absent means the platform currency. */
  currency?: string | null;
}

export type ClaimOutcome = "refunded_full" | "refunded_partial" | "retained_full";

export function claimOutcome(a: ClaimAmounts): ClaimOutcome {
  const refunded = toAmount(a.refundedAmount) ?? 0;
  const retained = toAmount(a.retainedAmount) ?? 0;
  if (refunded <= 0 && retained > 0) return "retained_full";
  if (retained > 0 && refunded > 0) return "refunded_partial";
  return "refunded_full";
}

export function claimResolvedTitle(outcome: ClaimOutcome): string {
  return outcome === "refunded_full"
    ? "Security deposit refunded"
    : outcome === "refunded_partial"
      ? "Security deposit partly refunded"
      : "Security deposit retained";
}

export function claimResolvedSummary(a: ClaimAmounts): string {
  const charged = toAmount(a.chargedAmount);
  const refunded = toAmount(a.refundedAmount) ?? 0;
  const retained = toAmount(a.retainedAmount) ?? 0;
  const outcome = claimOutcome(a);
  const money = (value: number | string | null | undefined) => formatMoney(value, a.currency);
  if (outcome === "refunded_full") return `${money(refunded || charged)} refunded.`;
  if (outcome === "refunded_partial") {
    return `${money(refunded)} refunded. ${money(retained)} retained based on the claim outcome.`;
  }
  return `${money(retained)} of the ${money(charged ?? retained)} security deposit was retained based on the claim outcome.`;
}

/** Borrower: refund line, e.g. "$105 refunded to your card •••• 4242." */
export function claimRefundedLine(refunded: number | string | null | undefined, cardLast4?: string | null, currency?: string | null): string {
  return `${formatMoney(refunded, currency)} refunded to your card${cardSuffix(cardLast4)}.`;
}

export function claimRetainedLine(retained: number | string | null | undefined, currency?: string | null): string {
  return `${formatMoney(retained, currency)} retained based on the claim outcome.`;
}

export const CLAIM_RESOLVED_PREVIOUSLY_CHARGED =
  "The security deposit was previously charged because a claim was opened.";

export function claimResolvedOwnerLine(a: ClaimAmounts): string {
  const parts = ["Claim resolved"];
  if (Number(a.refundedAmount) > 0) parts.push(`${formatMoney(a.refundedAmount, a.currency)} refunded`);
  if (Number(a.retainedAmount) > 0) parts.push(`${formatMoney(a.retainedAmount, a.currency)} awarded to owner`);
  return parts.join(" · ");
}

/* ---------- Chat event stamps ---------- */

export const EVENT_ICONS = {
  claim_opened: "⚠️",
  claim_resolved: "⚖️",
  deposit_released: "🔓",
  deposit_confirmed: "🔒",
} as const;

/** The chat stamp for a released deposit: a hold released, or a refundable charge refunded. No amount is shown. */
export function depositReleasedStampLabel(opts: { depositMode?: string | null; amount?: number | string | null }): string {
  return isRefundableChargeMode(opts.depositMode)
    ? "✅ Deposit refunded. It may take 5–10 business days to show on your card."
    : "✅ Deposit hold released. You weren’t charged.";
}

export function depositConfirmedStampLabel(opts?: { mode?: string | null; refundable?: boolean }): string {
  return opts?.refundable || isRefundableChargeMode(opts?.mode)
    ? "🔒 Deposit charged. Refunded after the item is returned."
    : "🔒 Deposit hold authorized. It’s only charged if a claim is opened.";
}

/* ---------- Notifications ---------- */

export type DepositNotificationKind = "charged" | "refunded" | "retained" | "released" | "authorization_warning";

export function depositNotificationKind(type: string | null | undefined): DepositNotificationKind | null {
  switch (type) {
    case "security_deposit_charged":
    case "security_claim_opened_owner":
      return "charged";
    case "security_deposit_refunded":
      return "refunded";
    case "security_deposit_retained":
      return "retained";
    case "deposit_hold_released":
      return "released";
    default:
      return null;
  }
}

export const DEPOSIT_NOTIFICATION_TONE: Record<DepositNotificationKind, { bg: string; text: string }> = {
  charged: { bg: "bg-red-100", text: "text-red-600" },
  refunded: { bg: "bg-green-100", text: "text-green-600" },
  retained: { bg: "bg-orange-100", text: "text-orange-600" },
  released: { bg: "bg-blue-100", text: "text-blue-600" },
  authorization_warning: { bg: "bg-amber-100", text: "text-amber-600" },
};
