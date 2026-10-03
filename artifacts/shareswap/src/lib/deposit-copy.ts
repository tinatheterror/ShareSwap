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

export function formatMoney(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (n == null || !Number.isFinite(n)) return "$0.00";
  const rounded = Math.round(n * 100) / 100;
  return `$${rounded.toFixed(2)}`;
}

export function toAmount(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

export interface DepositLike {
  mode?: string | null;
  status?: string | null;
  amount?: string | number | null;
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

export const HOLD_EXPLAINER_SHORT = "This is a temporary hold, not a charge.";
export const NOT_CHARGED_UNLESS_CLAIM = "Not charged unless a claim is opened.";

export function holdPendingNotice(amount: number | string | null | undefined): string {
  return `This is a temporary hold, not a charge. Your card may show ${formatMoney(amount)} as pending or temporarily unavailable.`;
}

export function holdReleaseExplainer(amount: number | string | null | undefined): string {
  const a = formatMoney(amount);
  return `After the item is returned normally, the ${a} hold is released. If a claim is opened, the deposit may be charged while the claim is reviewed.`;
}

export function temporaryHoldLabel(amount: number | string | null | undefined): string {
  return `${formatMoney(amount)} temporary card hold`;
}

export const HOLD_COVERAGE_NOTE =
  "The hold covers your scheduled return date plus one extra day for return processing.";

export const REFUNDABLE_CHARGE_NOTE =
  "This is a real, refundable charge (not a temporary hold). It is refunded after the item is returned safely unless a claim is opened.";

export function holdReleasedTitle(): string {
  return "Deposit hold released";
}

export function holdReleasedBody(amount: number | string | null | undefined): string {
  return `${formatMoney(amount)} temporary hold released. You were not charged.`;
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
  const amt = formatMoney(amount);
  const refundable = isRefundableChargeMode(deposit?.mode);
  const who = viewer === "owner" ? "The borrower's" : "Your";
  switch (phase) {
    case "hold":
      return {
        label: "Temporary hold",
        description:
          viewer === "owner"
            ? `${amt} temporary card hold on the borrower's card. Not charged unless a claim is opened.`
            : `${temporaryHoldLabel(amount)}. ${NOT_CHARGED_UNLESS_CLAIM}`,
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
export const CLAIM_CHARGED_HEADLINE = "Security deposit charged";

export function claimOpenedChargedLine(amount: number | string | null | undefined, cardLast4?: string | null): string {
  return `${formatMoney(amount)} has been charged to your card${cardSuffix(cardLast4)}.`;
}

export const CLAIM_OPENED_CONVERSION =
  "The temporary hold has been converted into an actual charge while the claim is reviewed.";
export const CLAIM_OPENED_REFUND_NOTE =
  "If the claim is resolved in your favor, the charged amount will be refunded.";

export function claimOpenedOwnerLine(amount: number | string | null | undefined): string {
  return `Claim opened and under review, ${formatMoney(amount)} security deposit has been charged`;
}

/* ---------- Claim review (borrower) ---------- */

export const CLAIM_REVIEW_WHY_TITLE = "Why was I charged?";
export const CLAIM_REVIEW_WHY_BODY =
  "A claim was opened for this transaction, so the temporary security-deposit hold was converted into an actual charge.";
export const CLAIM_REVIEW_NEXT_TITLE = "What happens next?";
export const CLAIM_REVIEW_NEXT_BODY =
  "Your claim will be reviewed. If you are found responsible, some or all of the charge may be kept. If you are not responsible, the applicable amount will be refunded.";

/* ---------- Claim resolved ---------- */

export interface ClaimAmounts {
  chargedAmount?: number | string | null;
  refundedAmount?: number | string | null;
  retainedAmount?: number | string | null;
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
  if (outcome === "refunded_full") return `${formatMoney(refunded || charged)} refunded.`;
  if (outcome === "refunded_partial") {
    return `${formatMoney(refunded)} refunded. ${formatMoney(retained)} retained based on the claim outcome.`;
  }
  return `${formatMoney(retained)} of the ${formatMoney(charged ?? retained)} security deposit was retained based on the claim outcome.`;
}

/** Borrower: refund line, e.g. "$105 refunded to your card •••• 4242." */
export function claimRefundedLine(refunded: number | string | null | undefined, cardLast4?: string | null): string {
  return `${formatMoney(refunded)} refunded to your card${cardSuffix(cardLast4)}.`;
}

export function claimRetainedLine(retained: number | string | null | undefined): string {
  return `${formatMoney(retained)} retained based on the claim outcome.`;
}

export const CLAIM_RESOLVED_PREVIOUSLY_CHARGED =
  "The security deposit was previously charged because a claim was opened. The applicable amount has now been refunded.";

export function claimResolvedOwnerLine(a: ClaimAmounts): string {
  return `Claim has been resolved. ${formatMoney(a.refundedAmount ?? 0)} refunded · ${formatMoney(a.retainedAmount ?? 0)} retained`;
}

/* ---------- Chat event stamps ---------- */

export const EVENT_ICONS = {
  claim_opened: "🚩",
  claim_resolved: "⚖️",
  deposit_released: "✅",
  deposit_confirmed: "🔒",
} as const;

export function depositConfirmedStampLabel(opts?: { mode?: string | null; refundable?: boolean }): string {
  return opts?.refundable || isRefundableChargeMode(opts?.mode)
    ? "🔒 Refundable deposit charged"
    : "🔒 Temporary hold placed";
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
