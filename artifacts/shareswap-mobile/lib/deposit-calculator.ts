// Trust-Based Security Deposit Calculator (synced from web lib)

const TIER_DEPOSIT_PERCENTAGES: Record<number, number> = {
  1: 0.10,
  2: 0.20,
  3: 0.30,
  4: 0.40,
};

const TRUST_SCORE_DISCOUNTS: { minScore: number; maxScore: number; discount: number }[] = [
  { minScore: 90, maxScore: 100, discount: 0.60 },
  { minScore: 70, maxScore: 89, discount: 0.40 },
  { minScore: 50, maxScore: 69, discount: 0.20 },
  { minScore: 0, maxScore: 49, discount: 0 },
];

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
  trustScore = 0,
  customItemValue?: number,
): DepositCalculation {
  const itemValue = customItemValue || VALUE_RANGE_MIDPOINTS[originalValue] || 100;
  const depositPercentage = TIER_DEPOSIT_PERCENTAGES[tier] || 0.20;
  const baseDeposit = itemValue * depositPercentage;

  if (Math.round(baseDeposit) <= 5) {
    return { baseDeposit: 5, trustDiscount: 0, discountPercentage: 0, finalDeposit: 5, trustScore };
  }

  const { discount, percentage } = getTrustScoreDiscount(trustScore);
  const trustDiscount = baseDeposit * discount;
  const discountedAmount = Math.round(baseDeposit - trustDiscount);
  const finalDeposit = Math.max(5, discountedAmount);
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
