import {
  CLAIM_REVIEW_NEXT_BODY,
  CLAIM_REVIEW_NEXT_TITLE,
  CLAIM_REVIEW_WHY_BODY,
  CLAIM_REVIEW_WHY_TITLE,
  CLAIM_RESOLVED_PREVIOUSLY_CHARGED,
  HOLD_COVERAGE_NOTE,
  NOT_CHARGED_UNLESS_CLAIM,
  REFUNDABLE_CHARGE_NOTE,
  claimOpenedOwnerLine,
  claimOutcome,
  claimResolvedOwnerLine,
  claimResolvedSummary,
  claimResolvedTitle,
  formatMoney,
  holdPendingNotice,
  holdReleaseExplainer,
  holdReleasedBody,
  holdReleasedTitle,
  isRefundableChargeMode,
  resolveDepositPhase,
  toAmount,
  type DepositLike,
} from "@/lib/deposit-copy";

export type DepositStatusCardProps = {
  deposit: DepositLike & { protectionReviewRequired?: boolean };
  role: "owner" | "borrower";
  /** Fallback used when the backend has not reported amounts yet (e.g. approved claim amount). */
  fallbackRetainedAmount?: number | string | null;
};

/**
 * Deposit state card shown in the lifecycle / claim review panel. Never uses "held" once the deposit is charged,
 * and never says "refunded" for a hold that was only released.
 */
export function DepositStatusCard({ deposit, role, fallbackRetainedAmount }: DepositStatusCardProps) {
  const phase = resolveDepositPhase(deposit);
  const amount = toAmount(deposit.amount);
  const charged = toAmount(deposit.chargedAmount) ?? amount;
  const refundable = isRefundableChargeMode(deposit.mode);
  const isBorrower = role === "borrower";
  const base = "rounded-lg border p-3 text-xs space-y-1.5";

  if (phase === "none") {
    return (
      <div className={`${base} bg-muted/30`} data-testid="deposit-card-none">
        <p><span className="font-medium">Security deposit:</span> {amount != null ? formatMoney(amount) : "none"}</p>
      </div>
    );
  }

  if (phase === "hold") {
    return (
      <div className={`${base} border-blue-200 bg-blue-50 text-blue-900`} data-testid="deposit-card-hold">
        <p className="font-semibold">Security deposit</p>
        <p className="text-sm font-semibold">{formatMoney(amount)} temporary card hold</p>
        <p>{isBorrower ? holdPendingNotice(amount) : "This is a temporary hold on the borrower's card, not a charge."}</p>
        <p>{holdReleaseExplainer(amount)}</p>
        <p className="opacity-80">{HOLD_COVERAGE_NOTE} {NOT_CHARGED_UNLESS_CLAIM}</p>
        {deposit.protectionReviewRequired && (
          <p className="font-medium text-amber-800" data-testid="deposit-card-protection-review">
            Deposit protection review required — the hold may not cover the full period.
          </p>
        )}
      </div>
    );
  }

  if (phase === "released") {
    return (
      <div className={`${base} border-green-200 bg-green-50 text-green-900`} data-testid="deposit-card-released">
        <p className="font-semibold">{holdReleasedTitle()}</p>
        <p>{holdReleasedBody(amount)}</p>
      </div>
    );
  }

  if (phase === "charged" && refundable) {
    return (
      <div className={`${base} border-teal-200 bg-teal-50 text-teal-900`} data-testid="deposit-card-refundable">
        <p className="font-semibold">Security deposit</p>
        <p className="text-sm font-semibold">{formatMoney(charged)} refundable deposit charged</p>
        <p>{REFUNDABLE_CHARGE_NOTE}</p>
      </div>
    );
  }

  if (phase === "charged") {
    if (!isBorrower) {
      return (
        <div className={`${base} border-red-200 bg-red-50 text-red-900`} data-testid="deposit-card-charged-owner">
          <p className="font-semibold">Security deposit</p>
          <p className="text-sm font-semibold">{formatMoney(charged)} charged</p>
          <p>{claimOpenedOwnerLine(charged)}</p>
        </div>
      );
    }
    return (
      <div className={`${base} border-red-200 bg-red-50 text-red-900`} data-testid="deposit-card-charged-borrower">
        <p className="font-semibold">Security deposit</p>
        <p className="text-base font-bold">{formatMoney(charged)} charged</p>
        <div>
          <p className="font-semibold">{CLAIM_REVIEW_WHY_TITLE}</p>
          <p>{CLAIM_REVIEW_WHY_BODY}</p>
        </div>
        <div>
          <p className="font-semibold">{CLAIM_REVIEW_NEXT_TITLE}</p>
          <p>{CLAIM_REVIEW_NEXT_BODY}</p>
        </div>
      </div>
    );
  }

  // resolved
  let refunded = toAmount(deposit.refundedAmount);
  let retained = toAmount(deposit.retainedAmount);
  if (refunded == null && retained == null) {
    retained = toAmount(fallbackRetainedAmount) ?? 0;
    refunded = Math.max(0, (charged ?? 0) - retained);
  } else {
    refunded = refunded ?? Math.max(0, (charged ?? 0) - (retained ?? 0));
    retained = retained ?? Math.max(0, (charged ?? 0) - refunded);
  }
  const outcome = claimOutcome({ refundedAmount: refunded, retainedAmount: retained });
  const tone = outcome === "retained_full" ? "border-orange-200 bg-orange-50 text-orange-900" : "border-green-200 bg-green-50 text-green-900";
  return (
    <div className={`${base} ${tone}`} data-testid="deposit-card-resolved">
      <p className="font-semibold">Claim resolved</p>
      <p className="text-sm font-semibold">{claimResolvedTitle(outcome)}</p>
      <p>
        {isBorrower
          ? claimResolvedSummary({ chargedAmount: charged, refundedAmount: refunded, retainedAmount: retained })
          : claimResolvedOwnerLine({ refundedAmount: refunded, retainedAmount: retained })}
      </p>
      {isBorrower && <p className="opacity-80">{CLAIM_RESOLVED_PREVIOUSLY_CHARGED}</p>}
      <dl className="pt-1 space-y-0.5">
        <div className="flex justify-between"><dt>Charged</dt><dd className="font-medium">{formatMoney(charged)}</dd></div>
        <div className="flex justify-between"><dt>Refunded</dt><dd className="font-medium">{formatMoney(refunded)}</dd></div>
        <div className="flex justify-between"><dt>Retained</dt><dd className="font-medium">{formatMoney(retained)}</dd></div>
      </dl>
    </div>
  );
}

