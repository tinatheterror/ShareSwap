// Trust-Based Security Deposit Calculator

// Tier-based deposit percentages
const TIER_DEPOSIT_PERCENTAGES: Record<number, number> = {
  1: 0.10, // 10% for Tier 1 (Under $50)
  2: 0.20, // 20% for Tier 2 ($50-$150)
  3: 0.30, // 30% for Tier 3 ($150-$300)
  4: 0.40, // 40% for Tier 4 ($300-$1,000)
  5: 0.50, // 50% for Tier 5 ($1,000-$5,000) - Luxury
  6: 0.60, // 60% for Tier 6 ($5,000+) - Ultra Luxury
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
  "$50–$150": 100,
  "$150–$300": 225,
  "$300–$1,000": 650,
  "$1,000–$5,000": 3000, // Luxury items
  "$5,000+": 10000, // Ultra luxury items
  "$300+": 500, // Legacy support
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
  trustScore: number = 50, // Default trust score for new users
  customItemValue?: number // Optional: for luxury items with known higher value
): DepositCalculation {
  // Get the estimated item value
  const itemValue = customItemValue || VALUE_RANGE_MIDPOINTS[originalValue] || 100;
  
  // Get the tier-based deposit percentage
  const depositPercentage = TIER_DEPOSIT_PERCENTAGES[tier] || 0.20;
  
  // Calculate base deposit
  const baseDeposit = itemValue * depositPercentage;
  
  // Get trust score discount
  const { discount, percentage } = getTrustScoreDiscount(trustScore);
  
  // Calculate trust discount amount
  const trustDiscount = baseDeposit * discount;
  
  // Calculate final deposit
  const finalDeposit = Math.max(5, Math.round(baseDeposit - trustDiscount)); // Minimum $5 deposit
  
  return {
    baseDeposit: Math.round(baseDeposit),
    trustDiscount: Math.round(trustDiscount),
    discountPercentage: percentage,
    finalDeposit,
    trustScore,
  };
}

export function formatDeposit(amount: number): string {
  return `$${amount.toLocaleString()}`;
}
