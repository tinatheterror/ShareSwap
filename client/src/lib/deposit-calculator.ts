// Trust-Based Security Deposit Calculator

// Deposit = full replacement value, trust score then discounts it for reliable users
const TIER_DEPOSIT_PERCENTAGES: Record<number, number> = {
  1: 1.00, // 100% for Tier 1 (Under $50)
  2: 1.00, // 100% for Tier 2 ($50-$199)
  3: 1.00, // 100% for Tier 3 ($200-$499)
  4: 1.00, // 100% for Tier 4 ($500-$2,000)
};

// Trust score discount tiers
const TRUST_SCORE_DISCOUNTS: { minScore: number; maxScore: number; discount: number }[] = [
  { minScore: 90, maxScore: 100, discount: 0.60 }, // 60% off
  { minScore: 70, maxScore: 89, discount: 0.40 },  // 40% off
  { minScore: 50, maxScore: 69, discount: 0.20 },  // 20% off
  { minScore: 0, maxScore: 49, discount: 0 },      // No discount
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

export function getTrustScoreDiscount(trustScore: number): { discount: number; percentage: number } {
  for (const tier of TRUST_SCORE_DISCOUNTS) {
    if (trustScore >= tier.minScore && trustScore <= tier.maxScore) {
      return { discount: tier.discount, percentage: tier.discount * 100 };
    }
  }
  return { discount: 0, percentage: 0 };
}

export function calculateSecurityDeposit(
  tier: number,
  originalValue: string,
  trustScore: number = 0,
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
  return `$${amount.toLocaleString()}`;
}
