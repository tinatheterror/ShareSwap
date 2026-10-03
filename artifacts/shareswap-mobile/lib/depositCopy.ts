/**
 * Security-deposit terminology helpers (pure, no React Native imports).
 *
 * Distinct states:
 *  - hold      temporary card authorization, NOT charged
 *  - charged   captured because a claim was opened (real charge)
 *  - released  hold released without ever being charged
 *  - resolved  claim resolved after a charge (charged / refunded / retained)
 */

export type DepositPhase = "none" | "hold" | "charged" | "released" | "resolved";

export interface DepositLike {
  mode?: string | null;
  status?: string | null;
  amount?: number | string | null;
  phase?: string | null;
  chargedAmount?: number | string | null;
  refundedAmount?: number | string | null;
  retainedAmount?: number | string | null;
  cardLast4?: string | null;
  cardBrand?: string | null;
}

export function formatMoney(value: number | string | null | undefined): string {
  const n = Number(value);
  if (value == null || value === "" || !Number.isFinite(n)) return "$0";
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
}

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
  opts: { amount?: number | string | null; refundable?: boolean; chargedAmount?: number | string | null } = {},
): string {
  const amt = formatMoney(opts.amount);
  switch (phase) {
    case "hold":
      return `${amt} temporary card hold. Not charged unless a claim is opened.`;
    case "charged":
      return opts.refundable
        ? `${amt} refundable deposit charge. Refunded after the item is returned in good condition.`
        : `${formatMoney(opts.chargedAmount ?? opts.amount)} charged because a claim was opened. It may be refunded depending on the outcome.`;
    case "released":
      return `${amt} temporary hold released. You were not charged.`;
    case "resolved":
      return "The claim was resolved. See the refund and retained amounts below.";
    default:
      return "";
  }
}

/** Short stage-card line, e.g. "Deposit: $105 · Temporary hold". */
export function depositSummaryLine(deposit: DepositLike | null | undefined, fallbackAmount?: number | null): string | null {
  const amount = num(deposit?.amount) ?? fallbackAmount ?? null;
  if (amount == null) return null;
  const refundable = deposit?.mode === "refundable_charge";
  const phase = resolveDepositPhase(deposit);
  const amt = formatMoney(amount);
  switch (phase) {
    case "hold": return `Deposit: ${amt} · Temporary hold (not charged)`;
    case "charged": return refundable ? `Deposit: ${amt} · Refundable charge` : `Deposit: ${formatMoney(deposit?.chargedAmount ?? amount)} · Charged (claim open)`;
    case "released": return `Deposit: ${amt} · Hold released`;
    case "resolved": return `Deposit: ${formatMoney(deposit?.chargedAmount ?? amount)} charged · ${formatMoney(deposit?.refundedAmount ?? 0)} refunded · ${formatMoney(deposit?.retainedAmount ?? 0)} retained`;
    default: return `Deposit: ${amt}`;
  }
}

// ── Hold explainer constants / builders ─────────────────────────────────────
export const HOLD_NOT_A_CHARGE = "This is a temporary hold, not a charge.";
export const NOT_CHARGED_UNLESS_CLAIM = "Not charged unless a claim is opened.";
export const HOLD_COVERAGE_NOTE = "The hold covers your return date plus one extra day for return processing.";

export function holdTitle(amount: number | string | null | undefined): string {
  return `${formatMoney(amount)} temporary card hold`;
}
export function holdPendingNote(amount: number | string | null | undefined): string {
  return `${HOLD_NOT_A_CHARGE} Your card may show ${formatMoney(amount)} as pending or temporarily unavailable.`;
}
export function holdReleaseExplainer(amount: number | string | null | undefined): string {
  return `After the item is returned normally, the ${formatMoney(amount)} hold is released. If a claim is opened, the deposit may be charged while the claim is reviewed.`;
}
export function holdPlacedMessage(amount: number | string | null | undefined): string {
  return `Your ${formatMoney(amount)} temporary hold is in place. You have not been charged. ${NOT_CHARGED_UNLESS_CLAIM}`;
}
export function holdReleasedMessage(amount: number | string | null | undefined): string {
  return `${formatMoney(amount)} temporary hold released. You were not charged.`;
}
export const CANCEL_BOOKING_MESSAGE = "Your temporary hold will be released. You will not be charged.";

// ── Claim copy ──────────────────────────────────────────────────────────────
export function claimOpenedBorrowerCopy(p: { amount: number | string | null | undefined; cardLast4?: string | null }) {
  return {
    eyebrow: "Claim opened",
    title: "Security deposit charged",
    body: `${formatMoney(p.amount)} has been charged to your card${cardSuffix(p.cardLast4)}.`,
    detail: "The temporary hold has been converted into an actual charge while the claim is reviewed.",
    footer: "If the claim is resolved in your favor, the charged amount will be refunded.",
  };
}

export function claimOpenedOwnerLine(amount: number | string | null | undefined): string {
  return `Claim opened and under review, ${formatMoney(amount)} security deposit has been charged`;
}

export const CLAIM_REVIEW_TOP = {
  heading: "Security deposit",
  whyTitle: "Why was I charged?",
  whyBody: "A claim was opened for this transaction, so the temporary security-deposit hold was converted into an actual charge.",
  nextTitle: "What happens next?",
  nextBody: "Your claim will be reviewed. If you are found responsible, some or all of the charge may be kept. If you are not responsible, the applicable amount will be refunded.",
};
export function claimReviewChargedLabel(amount: number | string | null | undefined): string {
  return `${formatMoney(amount)} charged`;
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
}) {
  const charged = num(p.chargedAmount) ?? 0;
  const refunded = num(p.refundedAmount) ?? 0;
  const retained = num(p.retainedAmount) ?? Math.max(0, charged - refunded);
  const outcome = (p.outcome as ClaimOutcome | null | undefined) ?? deriveClaimOutcome(charged, refunded, retained);
  const rows = [
    { label: "Charged", value: formatMoney(charged) },
    { label: "Refunded", value: formatMoney(refunded) },
    { label: "Retained", value: formatMoney(retained) },
  ];
  if (outcome === "retained_full" || (outcome === "refunded_partial" && false)) {
    return {
      eyebrow: "Claim resolved",
      title: "Security deposit retained",
      body: `${formatMoney(retained)} of your ${formatMoney(charged)} security deposit was retained based on the claim outcome.`,
      detail: "",
      rows,
    };
  }
  if (outcome === "refunded_partial") {
    return {
      eyebrow: "Claim resolved",
      title: "Security deposit partly refunded",
      body: `${formatMoney(refunded)} refunded to your card${cardSuffix(p.cardLast4)}.`,
      detail: `${formatMoney(retained)} retained based on the claim outcome. The security deposit was previously charged because a claim was opened.`,
      rows,
    };
  }
  return {
    eyebrow: "Claim resolved",
    title: "Security deposit refunded",
    body: `${formatMoney(refunded)} refunded to your card${cardSuffix(p.cardLast4)}.`,
    detail: "The security deposit was previously charged because a claim was opened. The applicable amount has now been refunded.",
    rows,
  };
}

export function claimResolvedOwnerLine(refunded: number | string | null | undefined, retained: number | string | null | undefined): string {
  return `Claim has been resolved. ${formatMoney(refunded)} refunded · ${formatMoney(retained)} retained`;
}

export function depositReleasedCopy(amount: number | string | null | undefined) {
  return {
    title: "Deposit hold released",
    body: holdReleasedMessage(amount),
  };
}

// ── Chat event stamps ───────────────────────────────────────────────────────
export function depositConfirmedStamp(meta?: { mode?: string | null; depositMode?: string | null } | null): string {
  const mode = meta?.mode ?? meta?.depositMode;
  return mode === "refundable_charge" ? "🔒 Refundable deposit charged" : "🔒 Temporary hold placed";
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

export const DEPOSIT_HOLD_FAILURE_NOTE = "No temporary hold was placed and your security deposit was not charged.";
export const REFUNDABLE_CHARGE_NOTE =
  "This is a real, refundable charge (not a temporary hold). It is refunded after the item is returned in good condition.";
