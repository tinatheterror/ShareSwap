import { borrowTrustDepositQuote, calculateSecurityDeposit, getTrustScoreDiscount } from "../deposit-calculator";

// Mirrors the server (api-server trust-deposit-discount.ts and computeAuthoritativeBorrowDeposit): same table,
// same rounding. The discount comes from the trust level.
describe("trust level discounts", () => {
  it("Newcomer 0, Neighbour 10, Trusted Member 20, Community Pillar 40, ShareSwap Champion 60, at each boundary", () => {
    const cases: [number, number][] = [
      [0, 0], [49, 0], [50, 10], [149, 10], [150, 20], [299, 20], [300, 40], [499, 40], [500, 60], [900, 60],
    ];
    for (const [score, percent] of cases) expect(getTrustScoreDiscount(score).percentage).toBe(percent);
    expect(getTrustScoreDiscount(undefined as any).percentage).toBe(0);
  });
});

describe("borrowTrustDepositQuote", () => {
  const dress = { tier: 3, originalValue: "$300–$1,000" }; // $650 midpoint, 30% => $195 base

  it("applies the level discount to the base deposit", () => {
    expect(borrowTrustDepositQuote(dress, 0)).toEqual({ base: 195, amount: 195, discountPercentage: 0 });
    expect(borrowTrustDepositQuote(dress, 60)).toEqual({ base: 195, amount: 176, discountPercentage: 10 });
    expect(borrowTrustDepositQuote(dress, 200)).toEqual({ base: 195, amount: 156, discountPercentage: 20 });
    expect(borrowTrustDepositQuote(dress, 350)).toEqual({ base: 195, amount: 117, discountPercentage: 40 });
    expect(borrowTrustDepositQuote(dress, 500)).toEqual({ base: 195, amount: 78, discountPercentage: 60 });
  });

  it("no score means no discount", () => {
    expect(borrowTrustDepositQuote(dress, null)).toEqual({ base: 195, amount: 195, discountPercentage: 0 });
  });

  it("a minimum deposit is never discounted", () => {
    expect(borrowTrustDepositQuote({ tier: 1, originalValue: "Under $50" }, 500)).toEqual({ base: 5, amount: 5, discountPercentage: 0 });
  });

  it("falls back to the replacement value, then to $100, and to tier 2", () => {
    expect(borrowTrustDepositQuote({ tier: 2, replacementValue: 350 }, 0).base).toBe(70);
    expect(borrowTrustDepositQuote({}, 0).base).toBe(20);
  });
});

describe("calculateSecurityDeposit", () => {
  it("takes the trust score in points and discounts by its level", () => {
    const result = calculateSecurityDeposit(3, "$300–$1,000", 350);
    expect(result).toMatchObject({ baseDeposit: 195, discountPercentage: 40, finalDeposit: 117, trustScore: 350 });
  });
});
