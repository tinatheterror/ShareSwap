import { db, rentalPayouts, type itemRequests } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { DepositRenewalStripeClient } from "./deposit-renewal-service";

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
      refunds.push({ ...target, refundId: refund?.id ?? null });
    } catch (error) {
      if (!isAlreadyRefunded(error)) throw error;
      refunds.push({ ...target, refundId: null });
    }
  }
  return refunds;
}
