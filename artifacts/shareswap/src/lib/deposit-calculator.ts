import { formatMoney } from "./money";

// Trust-Based Security Deposit Calculator

// Tier-based deposit percentages
const TIER_DEPOSIT_PERCENTAGES: Record<number, number> = {
  1: 0.10, // 10% for Tier 1 (Under $50)
  2: 0.20, // 20% for Tier 2 ($50-$199)
  3: 0.30, // 30% for Tier 3 ($200-$499)
  4: 0.40, // 40% for Tier 4 ($500-$2,000)
};

// Trust Deposit discount by trust level. The level comes straight from the trust score (the same thresholds as
// the levels on the achievements page and in the API's trust-score-service.ts). The API applies the same table
// (api-server trust-deposit-discount.ts) and decides the amount actually held, so keep the two in step.
const TRUST_LEVEL_DISCOUNTS: { name: string; minScore: number; discount: number }[] = [
  { name: "ShareSwap Champion", minScore: 500, discount: 0.60 },
  { name: "Community Pillar", minScore: 300, discount: 0.40 },
  { name: "Trusted Member", minScore: 150, discount: 0.20 },
  { name: "Neighbour", minScore: 50, discount: 0.10 },
  { name: "Newcomer", minScore: 0, discount: 0 },
];

// Estimated midpoint values for each original value range
const VALUE_RANGE_MIDPOINTS: Record<string, number> = {
  "Under $50": 25,
  "$50–$199": 125,
  "$200–$499": 350,
  "$500–$2,000": 1250,
  "$50–$150": 100,
  "$150–$300": 225,
  "$300–$1,000": 650,
  "$300+": 500,
};

export interface DepositCalculation {
  baseDeposit: number;
  trustDiscount: number;
  discountPercentage: number;
  finalDeposit: number;
  trustScore: number;
}

/** The discount for a trust score (points, not a percentage): its level's discount. */
export function getTrustScoreDiscount(trustScore: number): { discount: number; percentage: number } {
  const level = TRUST_LEVEL_DISCOUNTS.find((l) => (trustScore || 0) >= l.minScore);
  const discount = level?.discount ?? 0;
  return { discount, percentage: Math.round(discount * 100) };
}

export function calculateSecurityDeposit(
  tier: number,
  originalValue: string,
  trustScore: number = 0, // the borrower's trust score in points; its level sets the discount
  customItemValue?: number // Optional: for luxury items with known higher value
): DepositCalculation {
  // Get the estimated item value
  const itemValue = customItemValue || VALUE_RANGE_MIDPOINTS[originalValue] || 100;
  
  // Get the tier-based deposit percentage
  const depositPercentage = TIER_DEPOSIT_PERCENTAGES[tier] || 0.20;
  
  // Calculate base deposit
  const baseDeposit = itemValue * depositPercentage;
  
  // If base deposit is already at or below the $5 minimum, no discount applies
  if (Math.round(baseDeposit) <= 5) {
    return {
      baseDeposit: 5,
      trustDiscount: 0,
      discountPercentage: 0,
      finalDeposit: 5,
      trustScore,
    };
  }

  // Get trust score discount
  const { discount, percentage } = getTrustScoreDiscount(trustScore);
  
  // Calculate trust discount amount
  const trustDiscount = baseDeposit * discount;
  
  // Calculate final deposit (minimum $5)
  const discountedAmount = Math.round(baseDeposit - trustDiscount);
  const finalDeposit = Math.max(5, discountedAmount);

  // If the minimum floor kicked in, the discount wasn't actually applied — clear it
  const effectiveDiscountPercentage = finalDeposit === 5 && discountedAmount < 5 ? 0 : percentage;
  const effectiveTrustDiscount = finalDeposit === 5 && discountedAmount < 5 ? 0 : Math.round(trustDiscount);
  
  return {
    baseDeposit: Math.round(baseDeposit),
    trustDiscount: effectiveTrustDiscount,
    discountPercentage: effectiveDiscountPercentage,
    finalDeposit,
    trustScore,
  };
}

export function formatDeposit(amount: number): string {
  return formatMoney(amount);
}
