// Trust-Based Security Deposit Calculator (synced from web lib)

const TIER_DEPOSIT_PERCENTAGES: Record<number, number> = {
  1: 0.10,
  2: 0.20,
  3: 0.30,
  4: 0.40,
};

// Trust Deposit discount by trust level. The level comes straight from the trust score (the same thresholds as
// the levels on the achievements screen and in the API's trust-score-service.ts). The API applies the same table
// (api-server trust-deposit-discount.ts) and decides the amount actually held, so keep the two in step.
const TRUST_LEVEL_DISCOUNTS: { name: string; minScore: number; discount: number }[] = [
  { name: "ShareSwap Champion", minScore: 500, discount: 0.60 },
  { name: "Community Pillar", minScore: 300, discount: 0.40 },
  { name: "Trusted Member", minScore: 150, discount: 0.20 },
  { name: "Neighbour", minScore: 50, discount: 0.10 },
  { name: "Newcomer", minScore: 0, discount: 0 },
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

/** The discount for a trust score (points, not a percentage): its level's discount. */
export function getTrustScoreDiscount(trustScore: number): { discount: number; percentage: number } {
  const level = TRUST_LEVEL_DISCOUNTS.find((l) => (trustScore || 0) >= l.minScore);
  const discount = level?.discount ?? 0;
  return { discount, percentage: Math.round(discount * 100) };
}

export function calculateSecurityDeposit(
  tier: number,
  originalValue: string,
  trustScore = 0, // the borrower's trust score in points; its level sets the discount
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

export interface TrustDepositQuote {
  /** Before the trust score discount. */
  base: number;
  /** What the borrower pays. */
  amount: number;
  /** 0 when there is no discount. */
  discountPercentage: number;
}

/**
 * The Trust Deposit a borrower pays for an item, as the item card shows it. This mirrors the server's
 * computeAuthoritativeBorrowDeposit (api-server routes.ts), which decides the amount actually held or charged, so the
 * card and the checkout agree: the discount is the one for the borrower's trust level.
 */
export function borrowTrustDepositQuote(
  item: { tier?: number | null; originalValue?: string | null; replacementValue?: number | string | null },
  trustScore: number | null | undefined,
): TrustDepositQuote {
  const value = VALUE_RANGE_MIDPOINTS[item.originalValue ?? ""] ?? (Number(item.replacementValue) || 100);
  const base = Math.max(5, Math.round(value * (TIER_DEPOSIT_PERCENTAGES[item.tier ?? 2] ?? 0.2)));
  const discount = getTrustScoreDiscount(trustScore ?? 0).percentage;
  const amount = base <= 5 ? 5 : Math.max(5, Math.round(base * (1 - discount / 100)));
  return { base, amount, discountPercentage: amount < base ? discount : 0 };
}
