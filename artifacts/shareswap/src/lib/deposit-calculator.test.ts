import { describe, expect, it } from "vitest";
import { calculateSecurityDeposit, getTrustScoreDiscount } from "./deposit-calculator";

// Mirrors the server (api-server trust-deposit-discount.ts): the discount comes from the trust level.
describe("trust level discounts", () => {
  it("Newcomer 0, Neighbour 10, Trusted Member 20, Community Pillar 40, ShareSwap Champion 60, at each boundary", () => {
    const cases: [number, number][] = [
      [0, 0], [49, 0], [50, 10], [149, 10], [150, 20], [299, 20], [300, 40], [499, 40], [500, 60], [900, 60],
    ];
    for (const [score, percent] of cases) expect(getTrustScoreDiscount(score).percentage).toBe(percent);
    expect(getTrustScoreDiscount(undefined as any).percentage).toBe(0);
  });
});

describe("calculateSecurityDeposit", () => {
  it("takes the trust score in points and discounts by its level", () => {
    const result = calculateSecurityDeposit(3, "$300–$1,000", 350);
    expect(result).toMatchObject({ baseDeposit: 195, discountPercentage: 40, finalDeposit: 117, trustScore: 350 });
  });
});
