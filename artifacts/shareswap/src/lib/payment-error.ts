const messages: Record<string, string> = {
  card_declined: "Your card was declined. Try another card or contact your bank.",
  insufficient_funds: "Your card has insufficient funds. Try another card or contact your bank.",
  expired_card: "Your card has expired. Update your card in Payment Settings.",
  incorrect_cvc: "Please check your card’s security code and try again.",
  invalid_cvc: "Please check your card’s security code and try again.",
  incorrect_number: "Please check your card number and try again.",
  invalid_number: "Please check your card number and try again.",
  authentication_required: "Your card needs additional authentication. Authenticate or update your card in Payment Settings, then try again.",
};

export const PAYMENT_ERROR_FALLBACK =
  "We couldn’t complete this payment step. Please try again shortly. If this continues, contact support.";

/** Only display controlled copy, never provider messages, identifiers, or response bodies. */
export function paymentErrorMessage(error: unknown): string {
  const failure = (error && typeof error === "object" ? error : {}) as {
    code?: string; decline_code?: string; message?: string; status?: number;
    requiresAction?: boolean; selectionState?: string; type?: string;
  };
  if (failure.status === 401) return "Please sign in again before continuing with your payment.";
  if (failure.requiresAction) return messages.authentication_required;
  if (failure.selectionState === "payment_pending") {
    return "Your payment is still pending. Check Payment Settings before trying again.";
  }
  const code = failure.decline_code || failure.code;
  if (code && Object.prototype.hasOwnProperty.call(messages, code)) return messages[code];
  if (failure.type === "validation_error") return "Please check your payment details and try again.";
  const text = typeof failure.message === "string" ? failure.message.toLowerCase() : "";
  // Older APIs may still return raw provider text; never interpret it as app guidance.
  if (/idempotenc|same parameters|no such (customer|payment)|client_secret/.test(text)) return PAYMENT_ERROR_FALLBACK;
  if (/no (payment )?(card|payment method).*on file|no saved card/.test(text)) {
    return "No payment card is saved. Add a card in Payment Settings, then try again.";
  }
  if (/sharecoins/.test(text) && /insufficient|not enough|don't have enough/.test(text)) {
    return "You don’t have enough ShareCoins to confirm this borrow. Earn more by sharing your items.";
  }
  if (/card (was |has been )?declined/.test(text)) return messages.card_declined;
  if (/insufficient funds/.test(text)) return messages.insufficient_funds;
  if (/card (has )?expired/.test(text)) return messages.expired_card;
  return PAYMENT_ERROR_FALLBACK;
}