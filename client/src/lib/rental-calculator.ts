// Rental Rate and Security Deposit Calculator

// Category-based weekly rental rate percentages (of item value)
const CATEGORY_RENTAL_RATES: Record<string, number> = {
  "Baby & Kids": 0.12,      // 12%
  "Electronics": 0.16,       // 16%
  "Tools & Equipment": 0.10, // 10%
  "Home & Kitchen": 0.10,    // 10%
  "Clothing & Accessories": 0.20, // 20%
  "Hobbies & Collectibles": 0.06, // 6%
};

// Tier-based rental security deposit percentages
const TIER_RENTAL_DEPOSIT_PERCENTAGES: Record<number, number> = {
  1: 0.20, // 20% for Tier 1
  2: 0.30, // 30% for Tier 2
  3: 0.40, // 40% for Tier 3
  4: 0.50, // 50% for Tier 4
  5: 0.60, // 60% for Tier 5 (Luxury)
  6: 0.70, // 70% for Tier 6 (Ultra Luxury)
};

// Trust score discount tiers (same as borrow flow)
const TRUST_SCORE_DISCOUNTS: { minScore: number; maxScore: number; discount: number }[] = [
  { minScore: 90, maxScore: 100, discount: 0.60 }, // 60% off
  { minScore: 70, maxScore: 89, discount: 0.40 },  // 40% off
  { minScore: 50, maxScore: 69, discount: 0.20 },  // 20% off
  { minScore: 0, maxScore: 49, discount: 0 },      // No discount
];

function getTrustScoreDiscount(trustScore: number): { discount: number; percentage: number } {
  for (const tier of TRUST_SCORE_DISCOUNTS) {
    if (trustScore >= tier.minScore && trustScore <= tier.maxScore) {
      return { discount: tier.discount, percentage: tier.discount * 100 };
    }
  }
  return { discount: 0, percentage: 0 };
}

export interface RentalRateCalculation {
  weeklyRate: number;
  dailyRate: number;
  categoryPercentage: number;
  itemValue: number;
}

export interface RentalDepositCalculation {
  baseDeposit: number;
  deposit: number;
  depositPercentage: number;
  discountPercentage: number;
  trustDiscount: number;
  tier: number;
  itemValue: number;
  trustScore: number;
}

export function calculateRentalRate(
  itemValue: number,
  category: string
): RentalRateCalculation {
  // Get category rate or default to 10%
  const categoryPercentage = CATEGORY_RENTAL_RATES[category] || 0.10;
  
  // Calculate weekly rate
  const weeklyRate = Math.max(1, Math.round(itemValue * categoryPercentage));
  
  // Calculate daily rate (weekly / 7)
  const dailyRate = Math.max(1, Math.round(weeklyRate / 7));
  
  return {
    weeklyRate,
    dailyRate,
    categoryPercentage: categoryPercentage * 100,
    itemValue,
  };
}

export function calculateRentalDeposit(
  itemValue: number,
  tier: number,
  trustScore: number = 50
): RentalDepositCalculation {
  // Get tier-based deposit percentage
  const depositPercentage = TIER_RENTAL_DEPOSIT_PERCENTAGES[tier] || 0.30;
  
  // Calculate base deposit
  const baseDeposit = Math.round(itemValue * depositPercentage);
  
  // Get trust score discount
  const { discount, percentage } = getTrustScoreDiscount(trustScore);
  
  // Calculate trust discount amount
  const trustDiscount = Math.round(baseDeposit * discount);
  
  // Calculate final deposit with trust discount
  const deposit = Math.max(5, baseDeposit - trustDiscount);
  
  return {
    baseDeposit,
    deposit,
    depositPercentage: depositPercentage * 100,
    discountPercentage: percentage,
    trustDiscount,
    tier,
    itemValue,
    trustScore,
  };
}

export function validateRentalRate(
  suggestedRate: number,
  userRate: number
): { isValid: boolean; warning: string | null; percentageDiff: number } {
  const percentageDiff = ((userRate - suggestedRate) / suggestedRate) * 100;
  
  if (userRate < 1) {
    return {
      isValid: false,
      warning: "Rental rate must be at least $1",
      percentageDiff,
    };
  }
  
  if (Math.abs(percentageDiff) > 20) {
    const direction = percentageDiff > 0 ? "higher" : "lower";
    return {
      isValid: true,
      warning: `Your rate is ${Math.abs(Math.round(percentageDiff))}% ${direction} than the AI suggested rate`,
      percentageDiff,
    };
  }
  
  return {
    isValid: true,
    warning: null,
    percentageDiff,
  };
}

export function validateRentalDeposit(
  suggestedDeposit: number,
  userDeposit: number
): { isValid: boolean; warning: string | null; percentageDiff: number } {
  const percentageDiff = ((userDeposit - suggestedDeposit) / suggestedDeposit) * 100;
  
  // Deposit can only be adjusted by ±20%
  const minDeposit = Math.round(suggestedDeposit * 0.8);
  const maxDeposit = Math.round(suggestedDeposit * 1.2);
  
  if (userDeposit < minDeposit || userDeposit > maxDeposit) {
    return {
      isValid: false,
      warning: `Deposit must be between $${minDeposit} and $${maxDeposit}`,
      percentageDiff,
    };
  }
  
  return {
    isValid: true,
    warning: null,
    percentageDiff,
  };
}

export function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString()}`;
}

export function getCategoryRateInfo(category: string): { percentage: number; description: string } {
  const rate = CATEGORY_RENTAL_RATES[category] || 0.10;
  return {
    percentage: rate * 100,
    description: `${rate * 100}% of item value per week`,
  };
}
