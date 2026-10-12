import { db, rentalPayouts, requestRefunds, type itemRequests } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { DepositRelease, DepositRenewalStripeClient } from "./deposit-renewal-service";

// The up-front charges of a BORROW/RENT request, other than the deposit itself, that are given
// back when the request is cancelled or expires before the handoff:
//
//   - the platform fee (request.platformFeeChargeId)
//   - the rental payment of a RENT (a held rental_payouts row, its own PaymentIntent)
//
// What is refunded comes from the charges that actually exist on the request, never from its type:
// a waived platform fee has no id, so nothing is attempted for it. The deposit (a hold to cancel, or
// a refundable charge to refund) is released by resolveClaimedDepositIntents, not here.
//
// Stripe's processing fee is not netted out of a refund: the borrower gets the whole amount back.
// Every call carries a deterministic idempotency key, and "already refunded" counts as done, so the
// caller can run this again after a failure and get the same result.

export type RefundKeyPrefix = "expire" | "cancel";

export interface UpfrontRefund {
  kind: "platform_fee_refund" | "rental_refund";
  /** The Stripe object that was refunded (a PaymentIntent, or a charge for ids that name one). */
  stripeId: string;
  /** Null when Stripe said the charge was already refunded. */
  refundId: string | null;
  /** What Stripe reports it refunded, in cents; null when it did not say or was already refunded. */
  amountCents: number | null;
}

export type RefundableRequest = Pick<
  typeof itemRequests.$inferSelect,
  "id" | "depositPaymentIntentId" | "platformFeeChargeId"
>;

/** Seeded and demo requests use ids that never reached Stripe. */
const isSimulated = (id: string) => id.startsWith("simulated-");

/**
 * Stripe refund parameters for a stored id. A platform fee id is a PaymentIntent in practice
 * (charge-platform-fee returns paymentIntent.id), but a charge id (ch_ / py_) is also accepted.
 */
export function stripeRefundTarget(id: string): { payment_intent: string } | { charge: string } {
  return id.startsWith("ch_") || id.startsWith("py_") ? { charge: id } : { payment_intent: id };
}

/** Stripe reports an already-refunded charge as an error; for us that is the goal state. */
export function isAlreadyRefunded(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "charge_already_refunded";
}

interface Target {
  kind: UpfrontRefund["kind"];
  stripeId: string;
}

/** The charges that exist on this request and are not the deposit. */
export async function upfrontRefundTargets(request: RefundableRequest): Promise<Target[]> {
  const targets: Target[] = [];
  const seen = new Set<string>();
  const add = (kind: Target["kind"], stripeId: string | null | undefined) => {
    if (!stripeId || isSimulated(stripeId) || seen.has(stripeId)) return;
    // The deposit PaymentIntent is released with the deposit, never refunded here. A payout that
    // points at it is the legacy single-charge shape.
    if (stripeId === request.depositPaymentIntentId) return;
    seen.add(stripeId);
    targets.push({ kind, stripeId });
  };

  // Rental fee (+ processing fee) is its own PaymentIntent, recorded on the held payout.
  const payouts = await db
    .select({ paymentIntentId: rentalPayouts.stripePaymentIntentId })
    .from(rentalPayouts)
    .where(and(eq(rentalPayouts.requestId, request.id), eq(rentalPayouts.status, "held")));
  for (const payout of payouts) add("rental_refund", payout.paymentIntentId);

  add("platform_fee_refund", request.platformFeeChargeId);
  return targets;
}

/**
 * Refunds every up-front charge that exists, in full. Throws on the first Stripe failure (nothing
 * after it is attempted); calling it again repeats the same keys, so the charges already refunded
 * are no-ops and the rest go through.
 */
export async function refundUpfrontCharges(
  request: RefundableRequest,
  stripe: DepositRenewalStripeClient,
  options: { keyPrefix: RefundKeyPrefix },
): Promise<UpfrontRefund[]> {
  const targets = await upfrontRefundTargets(request);
  if (targets.length === 0) return [];
  if (!stripe.refunds) throw new Error("Stripe refunds are unavailable");

  const refunds: UpfrontRefund[] = [];
  for (const target of targets) {
    try {
      const refund = await stripe.refunds.create(stripeRefundTarget(target.stripeId), {
        idempotencyKey: `${options.keyPrefix}-refund-${request.id}-${target.stripeId}`,
      });
      const amount = (refund as { amount?: unknown } | null)?.amount;
      refunds.push({ ...target, refundId: refund?.id ?? null, amountCents: typeof amount === "number" ? amount : null });
    } catch (error) {
      if (!isAlreadyRefunded(error)) throw error;
      refunds.push({ ...target, refundId: null, amountCents: null });
    }
  }
  return refunds;
}

// ── The refund ledger (request_refunds) ──────────────────────────────────────

export type RefundTrigger = "cancel" | "expiry";

export interface LedgerRow {
  kind: "deposit_hold_release" | "deposit_refund" | "platform_fee_refund" | "rental_refund";
  stripePaymentIntentId: string | null;
  stripeRefundId: string | null;
  amountCents: number | null;
  /** The processing fee Stripe took on the original charge, for the refunded share. 0 for a released hold. */
  chargeFeeCents: number | null;
  /** Fee Stripe handed back on the refund (read from the refund's balance transaction), when it did. */
  feeReturnedCents: number | null;
  /** What the platform absorbed: charge fee minus fee returned. Null when Stripe could not be read. */
  absorbedFeeCents: number | null;
}

type Obj = Record<string, any>;

/**
 * Reads the processing fee Stripe kept on a charge that was refunded, from Stripe's own balance
 * transactions (nothing is assumed). Best effort: any failure gives nulls and never blocks a cancel.
 * A refund that does not report a returned fee counts as returning none.
 */
async function readAbsorbedFee(
  stripe: DepositRenewalStripeClient,
  paymentIntentId: string,
  refundId: string | null,
  refundedCents: number | null,
): Promise<Pick<LedgerRow, "chargeFeeCents" | "feeReturnedCents" | "absorbedFeeCents">> {
  const unknown = { chargeFeeCents: null, feeReturnedCents: null, absorbedFeeCents: null };
  try {
    const intent = (await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge.balance_transaction"],
    })) as Obj;
    const charge = intent?.latest_charge as Obj | undefined;
    const balanceTransaction = charge?.balance_transaction as Obj | undefined;
    if (!charge || typeof charge !== "object" || !balanceTransaction || typeof balanceTransaction !== "object") return unknown;
    const chargeAmount = Number(charge.amount);
    const fee = Number(balanceTransaction.fee);
    if (!Number.isFinite(chargeAmount) || chargeAmount <= 0 || !Number.isFinite(fee)) return unknown;

    const refunded = refundedCents ?? chargeAmount;
    const chargeFeeCents = Math.round(fee * Math.min(1, refunded / chargeAmount));

    let feeReturnedCents = 0;
    const retrieveRefund = (stripe.refunds as Obj | undefined)?.retrieve;
    if (refundId && typeof retrieveRefund === "function") {
      const refund = (await retrieveRefund.call(stripe.refunds, refundId, { expand: ["balance_transaction"] })) as Obj;
      const refundBalance = refund?.balance_transaction as Obj | undefined;
      const refundFee = Number(refundBalance?.fee);
      if (refundBalance && typeof refundBalance === "object" && Number.isFinite(refundFee) && refundFee < 0) {
        feeReturnedCents = -refundFee;
      }
    }
    return { chargeFeeCents, feeReturnedCents, absorbedFeeCents: Math.max(0, chargeFeeCents - feeReturnedCents) };
  } catch (error) {
    console.error(`[refund-ledger] could not read the processing fee for ${paymentIntentId}:`, error);
    return unknown;
  }
}

/**
 * One ledger row per thing that was released or refunded: the up-front refunds and the deposit
 * release. A hold that was cancelled cost nothing; a card refund records the fee Stripe kept.
 * Anything already released by an earlier attempt (no refund id, no action now) is not recorded.
 */
export async function buildRefundLedgerRows(
  stripe: DepositRenewalStripeClient,
  request: Pick<typeof itemRequests.$inferSelect, "depositPaymentIntentId" | "trustDepositAmount">,
  upfront: UpfrontRefund[],
  releases: DepositRelease[],
): Promise<LedgerRow[]> {
  const rows: LedgerRow[] = [];
  for (const refund of upfront) {
    if (!refund.refundId) continue;
    rows.push({
      kind: refund.kind,
      stripePaymentIntentId: refund.stripeId.startsWith("ch_") || refund.stripeId.startsWith("py_") ? null : refund.stripeId,
      stripeRefundId: refund.refundId,
      amountCents: refund.amountCents,
      ...(await readAbsorbedFee(stripe, refund.stripeId, refund.refundId, refund.amountCents)),
    });
  }
  for (const release of releases) {
    if (release.action === "cancelled") {
      const isCurrent = release.paymentIntentId === request.depositPaymentIntentId;
      const declared = request.trustDepositAmount === null ? null : Math.round(Number(request.trustDepositAmount) * 100);
      rows.push({
        kind: "deposit_hold_release",
        stripePaymentIntentId: release.paymentIntentId,
        stripeRefundId: null,
        amountCents: release.amountCents ?? (isCurrent && Number.isFinite(declared) ? declared : null),
        chargeFeeCents: 0,
        feeReturnedCents: 0,
        absorbedFeeCents: 0,
      });
    } else if (release.action === "refunded") {
      rows.push({
        kind: "deposit_refund",
        stripePaymentIntentId: release.paymentIntentId,
        stripeRefundId: release.refundId ?? null,
        amountCents: release.amountCents ?? null,
        ...(await readAbsorbedFee(stripe, release.paymentIntentId, release.refundId ?? null, release.amountCents ?? null)),
      });
    }
  }
  return rows;
}

/** Inside the cancel/expiry transaction. A refund id already in the ledger is left as it is. */
export async function insertRefundLedger(tx: any, requestId: number, trigger: RefundTrigger, rows: LedgerRow[]) {
  if (rows.length === 0) return;
  await tx
    .insert(requestRefunds)
    .values(
      rows.map((row) => ({
        requestId,
        trigger,
        kind: row.kind,
        stripePaymentIntentId: row.stripePaymentIntentId,
        stripeRefundId: row.stripeRefundId,
        amountCents: row.amountCents,
        chargeFeeCents: row.chargeFeeCents,
        feeReturnedCents: row.feeReturnedCents,
        absorbedFeeCents: row.absorbedFeeCents,
      })),
    )
    .onConflictDoNothing();
}
