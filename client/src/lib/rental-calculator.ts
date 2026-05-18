// Rental Rate and Security Deposit Calculator

// Category-based weekly rental rate percentages (of item value)
const CATEGORY_RENTAL_RATES: Record<string, number> = {
  "Baby & Kids": 0.05,
  "Electronics": 0.07,
  "Tools & Equipment": 0.06,
  "Home & Kitchen": 0.05,
  "Clothing & Accessories": 0.08,
  "Hobbies & Collectibles": 0.04,
};

const DEFAULT_RENTAL_RATE = 0.05;

// Tier-based rental security deposit percentages
const TIER_RENTAL_DEPOSIT_PERCENTAGES: Record<number, number> = {
  1: 0.25,
  2: 0.30,
  3: 0.35,
  4: 0.40,
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
  const categoryPercentage = CATEGORY_RENTAL_RATES[category] || DEFAULT_RENTAL_RATE;
  const weeklyRate = Math.max(3, Math.round(itemValue * categoryPercentage));
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
  const depositPercentage = TIER_RENTAL_DEPOSIT_PERCENTAGES[tier] || 0.50;
  const deposit = Math.max(10, Math.round(itemValue * depositPercentage));

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

  if (Math.abs(percentageDiff) > 30) {
    const direction = percentageDiff > 0 ? "higher" : "lower";
    return {
      isValid: true,
      warning: `Your rate is ${Math.abs(Math.round(percentageDiff))}% ${direction} than the suggested rate`,
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

  const minDeposit = Math.round(suggestedDeposit * 0.5);
  const maxDeposit = Math.round(suggestedDeposit * 1.5);

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
  const rate = CATEGORY_RENTAL_RATES[category] || DEFAULT_RENTAL_RATE;
  return {
    percentage: rate * 100,
    description: `${rate * 100}% of item value per week`,
  };
}

// --- Duration-based discount calculator (dollar rentals only) ---

export interface RentalPriceResult {
  days: number;
  weeklyRate: number;
  dailyRate: number;
  subtotal: number;
  discountPct: number;
  discountAmount: number;
  total: number;
}

export function getDiscountPct(days: number): number {
  if (days >= 28) return 20;
  if (days >= 14) return 10;
  return 0;
}

export function getDiscountLabel(days: number): string {
  if (days >= 28) return "20% off — long-term";
  if (days >= 14) return "10% off — multi-week";
  return "";
}

export function calculateRentalPrice(weeklyRate: number, rentalDays: number): RentalPriceResult {
  const days = Math.max(1, rentalDays);
  const dailyRate = weeklyRate / 7;
  const subtotal = Math.round(dailyRate * days * 100) / 100;
  const discountPct = getDiscountPct(days);
  const discountAmount = Math.round(subtotal * discountPct) / 100;
  const total = Math.round((subtotal - discountAmount) * 100) / 100;
  return { days, weeklyRate, dailyRate, subtotal, discountPct, discountAmount, total };
}

export const DISCOUNT_TIERS = [
  { label: "Under 14 days", discountPct: 0 },
  { label: "14–27 days", discountPct: 10 },
  { label: "28+ days", discountPct: 20 },
];
