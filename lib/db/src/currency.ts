// The one place a currency code is written down for money movement.

/** Every new Stripe charge, hold, courier fee and wallet payout is created in this currency. */
export const PLATFORM_CURRENCY = "cad";

/**
 * Requests that predate the move to PLATFORM_CURRENCY were charged in this currency. It is the
 * column default for `item_requests.payment_currency` and `request_refunds.currency`, so existing
 * rows keep describing what Stripe really holds. Never use it for new charges.
 */
export const LEGACY_PAYMENT_CURRENCY = "usd";
