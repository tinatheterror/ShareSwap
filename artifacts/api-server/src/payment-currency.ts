import { db, itemRequests, LEGACY_PAYMENT_CURRENCY, PLATFORM_CURRENCY } from "@workspace/db";
import { eq } from "drizzle-orm";

// A PaymentIntent keeps its currency for life and a refund must match it, so a request is charged in one
// currency from its first Stripe object to its last. The request records that currency
// (item_requests.payment_currency); new charges read it here, and releases, refunds, captures and the
// refund ledger use the same stored value. Only a request with no Stripe object yet takes the platform
// currency, and that is stamped on the row before the first PaymentIntent is created.

export interface PaymentCurrencyRecord {
  paymentCurrency?: string | null;
  depositPaymentIntentId?: string | null;
  depositHoldAttemptId?: string | null;
  depositPreviousPaymentIntentId?: string | null;
  platformFeeChargeId?: string | null;
}

/** The currency this request's Stripe objects are in. Rows that never recorded one are legacy requests. */
export function recordCurrency(record: Pick<PaymentCurrencyRecord, "paymentCurrency">): string {
  return record.paymentCurrency?.trim().toLowerCase() || LEGACY_PAYMENT_CURRENCY;
}

/** True once any PaymentIntent or charge has been created for the request, whatever happened to it. */
export function hasStripeObjects(record: PaymentCurrencyRecord): boolean {
  return Boolean(
    record.depositPaymentIntentId ||
      record.depositHoldAttemptId ||
      record.depositPreviousPaymentIntentId ||
      record.platformFeeChargeId,
  );
}

/**
 * The currency for the next charge on this request: the recorded one when the request already has Stripe
 * objects (it may be a USD request in progress), the platform currency when it has none.
 */
export function currencyForNewCharge(record: PaymentCurrencyRecord): string {
  return hasStripeObjects(record) ? recordCurrency(record) : PLATFORM_CURRENCY;
}

/** Writes the currency onto the request when it differs. Call under the request's row lock, before creating the charge. */
export async function stampPaymentCurrency(
  executor: Pick<typeof db, "update">,
  requestId: number,
  record: PaymentCurrencyRecord,
  currency: string,
): Promise<void> {
  if (record.paymentCurrency === currency) return;
  await executor.update(itemRequests).set({ paymentCurrency: currency }).where(eq(itemRequests.id, requestId));
}
