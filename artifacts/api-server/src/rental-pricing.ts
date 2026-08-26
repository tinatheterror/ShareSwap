// Authoritative server-side rental pricing.
//
// Mirrors the display-only formulas in artifacts/shareswap/src/lib/rental-calculator.ts
// (and the identical mobile copy) so the numbers a renter sees match what the server
// actually charges. This module is the SOURCE OF TRUTH for dollars-and-cents rental
// pricing — routes.ts must never use client-submitted depositAmount/rentalAmount/
// processingFee for money movement or bookkeeping. If the underlying item pricing
// formula ever changes, update it in all of: this file, the web calculator, and the
// mobile calculator.

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
const DEFAULT_TIER_DEPOSIT_PERCENTAGE = 0.50;

function getDiscountPct(days: number): number {
  if (days >= 28) return 20;
  if (days >= 14) return 10;
  return 0;
}

export interface RentalPricingItemInput {
  replacementValue: number | null | undefined;
  tier: number | null | undefined;
  category: string | null | undefined;
  securityDeposit: string | number | null | undefined; // lender-set override
  dollarsPrice: string | number | null | undefined; // lender-set weekly rate override
}

export interface RentalPricingResult {
  depositAmount: number;
  rentalAmount: number;
  processingFee: number;
  days: number;
}

/**
 * Computes the deposit, rental fee, and processing fee for a rental request, using
 * only server-held data (the item's own pricing fields and the request's finalized
 * date range) — never client-submitted dollar amounts.
 *
 * Returns null if the computed pricing is not a valid positive charge (e.g. missing
 * or corrupt item pricing data), so the caller can reject the request instead of
 * creating a PaymentIntent for an invalid amount.
 */
export function computeAuthoritativeRentalPricing(
  item: RentalPricingItemInput,
  startDate: Date | string | null | undefined,
  endDate: Date | string | null | undefined,
): RentalPricingResult | null {
  const itemValue = item.replacementValue && item.replacementValue > 0 ? item.replacementValue : 100;
  const tier = item.tier || 2;
  const category = item.category || "Home & Kitchen";

  const depositPercentage = TIER_RENTAL_DEPOSIT_PERCENTAGES[tier] || DEFAULT_TIER_DEPOSIT_PERCENTAGE;
  const formulaDeposit = Math.max(10, Math.round(itemValue * depositPercentage));

  const categoryPercentage = CATEGORY_RENTAL_RATES[category] || DEFAULT_RENTAL_RATE;
  const formulaWeeklyRate = Math.max(3, Math.round(itemValue * categoryPercentage));

  const lenderDeposit = item.securityDeposit != null ? parseFloat(item.securityDeposit.toString()) : NaN;
  const depositAmount = Number.isFinite(lenderDeposit) && lenderDeposit > 0 ? lenderDeposit : formulaDeposit;

  const lenderWeeklyRate = item.dollarsPrice != null ? parseFloat(item.dollarsPrice.toString()) : NaN;
  const weeklyRate = Number.isFinite(lenderWeeklyRate) && lenderWeeklyRate > 0 ? lenderWeeklyRate : formulaWeeklyRate;

  const rawDays = startDate && endDate
    ? Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
    : 7;
  const days = Math.max(1, Number.isFinite(rawDays) ? rawDays : 7);

  const dailyRate = weeklyRate / 7;
  const subtotal = Math.round(dailyRate * days * 100) / 100;
  const discountPct = getDiscountPct(days);
  const discountAmount = Math.round(subtotal * discountPct) / 100;
  const rentalAmount = Math.round((subtotal - discountAmount) * 100) / 100;

  const processingFee = Math.round((rentalAmount + depositAmount) * 0.03 * 100) / 100;

  if (!Number.isFinite(depositAmount) || depositAmount <= 0) return null;
  if (!Number.isFinite(rentalAmount) || rentalAmount < 0) return null;
  if (!Number.isFinite(processingFee) || processingFee < 0) return null;

  return { depositAmount, rentalAmount, processingFee, days };
}
