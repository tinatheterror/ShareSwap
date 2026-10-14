import { trustLevelForScore } from "./trust-score-service";

// The Trust Deposit discount a borrower gets, by trust level (the levels in trust-score-service.ts).
// The level comes straight from the trust score; there is no separate rescaled "trust" number.
//
// The web and mobile apps show the same table (lib/deposit-calculator.ts in each); keep the three in step.
export const TRUST_DEPOSIT_DISCOUNT_BY_LEVEL: Record<string, number> = {
  Newcomer: 0,
  Neighbour: 10,
  "Trusted Member": 20,
  "Community Pillar": 40,
  "ShareSwap Champion": 60,
};

/** Percent off the base Trust Deposit for this trust score. */
export function trustDepositDiscountPercent(trustScore: number | null | undefined): number {
  return TRUST_DEPOSIT_DISCOUNT_BY_LEVEL[trustLevelForScore(trustScore ?? 0)] ?? 0;
}
