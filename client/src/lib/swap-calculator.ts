// Swap Calculator — value-based with ShareCoin offsets, no tier restrictions

// Fixed ShareCoin values per tier
const TIER_SHARECOIN_VALUES: Record<number, number> = {
  1: 5,   // Tier 1: Under $50
  2: 10,  // Tier 2: $50–$199
  3: 20,  // Tier 3: $200–$499
  4: 40,  // Tier 4: $500–$2,000
};

// Maximum allowed ShareCoin offset between the two sides of a swap
export const MAX_SWAP_OFFSET = 50;

export function getTierShareCoins(tier: number): number {
  return TIER_SHARECOIN_VALUES[tier] || 10;
}

export interface MultiSwapResult {
  yourTotal: number;
  theirTotal: number;
  offset: number;
  offsetDirection: 'none' | 'you_pay' | 'you_receive';
  isFair: boolean;
  exceedsMax: boolean;
  message: string;
}

/** Primary calculation: compare two side totals (in ShareCoins) */
export function calculateMultiSwap(yourSC: number, theirSC: number): MultiSwapResult {
  const offset = Math.abs(yourSC - theirSC);
  const offsetDirection =
    offset === 0 ? 'none' : yourSC < theirSC ? 'you_pay' : 'you_receive';
  const exceedsMax = offset > MAX_SWAP_OFFSET;

  let message: string;
  if (offset === 0) {
    message = 'Fair swap — no ShareCoin adjustment needed';
  } else if (exceedsMax) {
    message = `Offset of ${offset} SC exceeds the ${MAX_SWAP_OFFSET} SC maximum`;
  } else if (offsetDirection === 'you_pay') {
    message = `You pay ${offset} ShareCoins to balance the swap`;
  } else {
    message = `You receive +${offset} ShareCoins to balance the swap`;
  }

  return { yourTotal: yourSC, theirTotal: theirSC, offset, offsetDirection, isFair: offset === 0, exceedsMax, message };
}

// ── Backward-compatible types & functions ────────────────────────────────────

export type SwapFairness = 'fair' | 'offset_required' | 'not_allowed';

export interface SwapCalculation {
  fairness: SwapFairness;
  tierDifference: number;
  offsetRequired: number;
  offsetDirection: 'none' | 'you_pay' | 'they_pay';
  yourTier: number;
  theirTier: number;
  yourShareCoins: number;
  theirShareCoins: number;
  message: string;
}

export interface SwapEligibility {
  canSwap: boolean;
  acceptableTiers: number[];
  yourTier: number;
  yourShareCoins: number;
  fairSwapMessage: string;
}

/** Single-item comparison — kept for any remaining callers */
export function calculateSwap(yourTier: number, theirTier: number): SwapCalculation {
  const yourShareCoins = getTierShareCoins(yourTier);
  const theirShareCoins = getTierShareCoins(theirTier);
  const tierDifference = Math.abs(yourTier - theirTier);
  const offset = Math.abs(yourShareCoins - theirShareCoins);
  const offsetDirection =
    yourShareCoins < theirShareCoins ? 'you_pay'
    : yourShareCoins > theirShareCoins ? 'they_pay'
    : 'none';
  const exceedsMax = offset > MAX_SWAP_OFFSET;
  const fairness: SwapFairness =
    exceedsMax ? 'not_allowed' : offset === 0 ? 'fair' : 'offset_required';

  return {
    fairness,
    tierDifference,
    offsetRequired: offset,
    offsetDirection,
    yourTier,
    theirTier,
    yourShareCoins,
    theirShareCoins,
    message:
      offset === 0 ? 'Fair swap! No offset needed.'
      : exceedsMax ? `Offset too large (${offset} SC exceeds max ${MAX_SWAP_OFFSET} SC)`
      : offsetDirection === 'you_pay'
        ? `You pay ${offset} ShareCoins to balance the swap`
        : `You receive +${offset} ShareCoins to balance the swap`,
  };
}

export function getSwapEligibility(tier: number): SwapEligibility {
  return {
    canSwap: true,
    acceptableTiers: [1, 2, 3, 4],
    yourTier: tier,
    yourShareCoins: getTierShareCoins(tier),
    fairSwapMessage: `Any tier — value difference settled with ShareCoins (max ${MAX_SWAP_OFFSET} SC offset)`,
  };
}

export function getSwapTierLabel(tier: number): string {
  return `Tier ${tier}`;
}

export function getAcceptableSwapsLabel(_tier: number): string {
  return `Any tier · value difference settled with ShareCoins (max ${MAX_SWAP_OFFSET} SC)`;
}
