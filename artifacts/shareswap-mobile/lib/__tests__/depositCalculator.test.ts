import { borrowTrustDepositQuote } from "../deposit-calculator";

// Mirrors the server's computeAuthoritativeBorrowDeposit (api-server routes.ts): same numbers, same rounding.
describe("borrowTrustDepositQuote", () => {
  const dress = { tier: 3, originalValue: "$300\u2013$1,000" }; // $650 midpoint, 30% => $195 base

  it("a high trust score discounts the base deposit", () => {
    expect(borrowTrustDepositQuote(dress, 400)).toEqual({ base: 195, amount: 78, discountPercentage: 60 }); // trust 100
    expect(borrowTrustDepositQuote(dress, 100)).toEqual({ base: 195, amount: 117, discountPercentage: 40 }); // trust 70
  });

  it("a score that earns no discount pays the base", () => {
    const item = { tier: 3, originalValue: "$300\u2013$1,000" };
    // The server adds 50 to the 0-100 score, so even a brand-new account is at 50 and gets 20%.
    expect(borrowTrustDepositQuote(item, 0)).toEqual({ base: 195, amount: 156, discountPercentage: 20 });
    expect(borrowTrustDepositQuote(item, null)).toEqual({ base: 195, amount: 156, discountPercentage: 20 });
  });

  it("a minimum deposit is never discounted", () => {
    expect(borrowTrustDepositQuote({ tier: 1, originalValue: "Under $50" }, 500)).toEqual({ base: 5, amount: 5, discountPercentage: 0 });
  });

  it("falls back to the replacement value, then to $100, and to tier 2", () => {
    expect(borrowTrustDepositQuote({ tier: 2, replacementValue: 350 }, 500).base).toBe(70);
    expect(borrowTrustDepositQuote({}, 500).base).toBe(20);
  });
});
