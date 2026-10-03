const publicCodes = new Set([
  "card_declined", "insufficient_funds", "expired_card", "incorrect_cvc", "invalid_cvc",
  "incorrect_number", "invalid_number", "authentication_required",
]);

/** Provider diagnostics belong in server logs, not API responses. */
export function publicPaymentFailure(error: unknown): { error: string; code?: string } {
  const failure = (error && typeof error === "object" ? error : {}) as {
    code?: string; decline_code?: string;
  };
  const code = [failure.decline_code, failure.code].find(value => value && publicCodes.has(value));
  return {
    error: "We couldn’t complete this payment step. Please try again shortly. If this continues, contact support.",
    ...(code ? { code } : {}),
  };
}