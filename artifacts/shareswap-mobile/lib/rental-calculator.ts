// Rental Rate and Security Deposit Calculator (synced from web lib)

const CATEGORY_RENTAL_RATES: Record<string, number> = {
  "Baby & Kids": 0.05,
  "Electronics": 0.07,
  "Tools & Equipment": 0.06,
  "Home & Kitchen": 0.05,
  "Clothing & Accessories": 0.08,
  "Hobbies & Collectibles": 0.04,
};
const DEFAULT_RENTAL_RATE = 0.05;

const TIER_RENTAL_DEPOSIT_PERCENTAGES: Record<number, number> = {
  1: 0.25,
  2: 0.30,
  3: 0.35,
  4: 0.40,
};

export interface RentalRateCalculation {
  weeklyRate: number;
  dailyRate: number;
  itemValue: number;
}

export interface RentalDepositCalculation {
  deposit: number;
  tier: number;
  itemValue: number;
}

export interface RentalPriceResult {
  days: number;
  weeklyRate: number;
  dailyRate: number;
  subtotal: number;
  discountPct: number;
  discountAmount: number;
  total: number;
}

export function calculateRentalRate(itemValue: number, category: string): RentalRateCalculation {
  const rate = CATEGORY_RENTAL_RATES[category] || DEFAULT_RENTAL_RATE;
  const weeklyRate = Math.max(3, Math.round(itemValue * rate));
  const dailyRate = Math.max(1, Math.round(weeklyRate / 7));
  return { weeklyRate, dailyRate, itemValue };
}

export function calculateRentalDeposit(itemValue: number, tier: number): RentalDepositCalculation {
  const depositPercentage = TIER_RENTAL_DEPOSIT_PERCENTAGES[tier] || 0.50;
  const deposit = Math.max(10, Math.round(itemValue * depositPercentage));
  return { deposit, tier, itemValue };
}

export function getDiscountPct(days: number): number {
  if (days >= 28) return 20;
  if (days >= 14) return 10;
  return 0;
}

export function getDiscountLabel(days: number): string {
  if (days >= 28) return "20% off — monthly rate";
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
