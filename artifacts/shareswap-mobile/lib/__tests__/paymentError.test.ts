import { paymentErrorMessage, PAYMENT_ERROR_FALLBACK } from "../payment-error";

describe("native payment error messages", () => {
  test("never displays Stripe retry details or internal payment keys", () => {
    expect(paymentErrorMessage(new Error(
      "Failed to create deposit hold: Keys for idempotent requests can only be used with the same parameters: borrow-deposit-hold-2468-4200",
    ))).toBe(PAYMENT_ERROR_FALLBACK);
  });
  test("does not confuse insufficient card funds with ShareCoins", () => {
    expect(paymentErrorMessage({ code: "insufficient_funds" })).toMatch(/card has insufficient funds/);
    expect(paymentErrorMessage(new Error("insufficient_sharecoins"))).toMatch(/enough ShareCoins/);
  });
  test("preserves authentication and pending-payment guidance", () => {
    expect(paymentErrorMessage({ requiresAction: true })).toMatch(/authentication/);
    expect(paymentErrorMessage({ selectionState: "payment_pending" })).toMatch(/still pending/);
  });
});