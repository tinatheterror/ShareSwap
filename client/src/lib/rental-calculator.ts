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

export interface RentalRateCalculation {
  weeklyRate: number;
  dailyRate: number;
  categoryPercentage: number;
  itemValue: number;
}

export interface RentalDepositCalculation {
  deposit: number;
  depositPercentage: number;
  tier: number;
  itemValue: number;
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
  tier: number
): RentalDepositCalculation {
  // Get tier-based deposit percentage
  const depositPercentage = TIER_RENTAL_DEPOSIT_PERCENTAGES[tier] || 0.30;
  
  // Calculate deposit (no trust score discount for rentals)
  const deposit = Math.max(5, Math.round(itemValue * depositPercentage));
  
  return {
    deposit,
    depositPercentage: depositPercentage * 100,
    tier,
    itemValue,
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
