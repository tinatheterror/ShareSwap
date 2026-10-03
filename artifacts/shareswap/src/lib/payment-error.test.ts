import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { paymentErrorMessage, PAYMENT_ERROR_FALLBACK } from "./payment-error";

describe("user-facing payment errors", () => {
  it.each([
    "Failed to create deposit hold: Keys for idempotent requests can only be used with the same parameters. Try a key other than borrow-deposit-hold-2468-4200",
    "No such customer: cus_private",
    "Stripe API failed: pi_private_secret_test",
    "502: <html>Bad gateway</html>",
    "No such payment_method: pm_private",
  ])("hides technical details: %s", message => {
    expect(paymentErrorMessage(new Error(message))).toBe(PAYMENT_ERROR_FALLBACK);
  });

  it.each([
    [{ code: "card_declined" }, /card was declined/],
    [{ code: "card_declined", decline_code: "insufficient_funds" }, /insufficient funds/],
    [{ code: "expired_card" }, /card has expired/],
    [{ code: "incorrect_cvc" }, /security code/],
    [{ code: "invalid_number" }, /card number/],
    [{ requiresAction: true }, /authentication/],
    [{ code: "authentication_required" }, /authentication/],
    [{ selectionState: "payment_pending" }, /still pending/],
    [{ status: 401 }, /sign in again/],
    [new Error("No payment method on file. Please add a card in Settings."), /No payment card is saved/],
    [new Error("insufficient_sharecoins"), /enough ShareCoins/],
    [new Error("Your card was declined."), /card was declined/],
    [new Error("insufficient funds"), /insufficient funds/],
    [{ type: "validation_error" }, /check your payment details/],
  ])("preserves useful guidance for %j", (error, message) => {
    expect(paymentErrorMessage(error)).toMatch(message as RegExp);
  });

  it.each([null, undefined, "", {}, { message: 42 }, { code: "constructor" }, { code: "__proto__" }])(
    "fails safely for malformed or unknown errors: %j", error => {
      expect(paymentErrorMessage(error)).toBe(PAYMENT_ERROR_FALLBACK);
    },
  );

  it("keeps web and native error wording and classification identical", () => {
    const web = readFileSync("src/lib/payment-error.ts", "utf8");
    const native = readFileSync("../shareswap-mobile/lib/payment-error.ts", "utf8");
    expect(native).toBe(web);
  });
});