// Swap Calculator - Tier-based fairness with ShareCoin offsets

// Fixed ShareCoin values per tier
const TIER_SHARECOIN_VALUES: Record<number, number> = {
  1: 5,   // Tier 1: Under $50
  2: 10,  // Tier 2: $50-$150
  3: 20,  // Tier 3: $150-$300
  4: 40,  // Tier 4: $300+
};

export type SwapFairness = 'fair' | 'offset_required' | 'not_allowed';

export interface SwapCalculation {
  fairness: SwapFairness;
  tierDifference: number;
  offsetRequired: number; // ShareCoins needed from lower-tier side
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

export function getTierShareCoins(tier: number): number {
  return TIER_SHARECOIN_VALUES[tier] || 10;
}

export function getSwapEligibility(tier: number): SwapEligibility {
  const yourShareCoins = getTierShareCoins(tier);
  
  // Can swap with same tier or ±1 tier
  const acceptableTiers: number[] = [];
  if (tier > 1) acceptableTiers.push(tier - 1);
  acceptableTiers.push(tier);
  if (tier < 4) acceptableTiers.push(tier + 1);
  
  // Build fair swap message
  const sameTierMsg = `Tier ${tier} items`;
  const lowerTierMsg = tier > 1 ? `Tier ${tier - 1} (+${yourShareCoins - getTierShareCoins(tier - 1)} SC offset)` : null;
  const higherTierMsg = tier < 4 ? `Tier ${tier + 1} (−${getTierShareCoins(tier + 1) - yourShareCoins} SC offset)` : null;
  
  let fairSwapMessage = `Fair swap: ${sameTierMsg}`;
  if (lowerTierMsg) fairSwapMessage += `, or ${lowerTierMsg}`;
  if (higherTierMsg) fairSwapMessage += `, or ${higherTierMsg}`;
  
  return {
    canSwap: true,
    acceptableTiers,
    yourTier: tier,
    yourShareCoins,
    fairSwapMessage,
  };
}

export function calculateSwap(yourTier: number, theirTier: number): SwapCalculation {
  const yourShareCoins = getTierShareCoins(yourTier);
  const theirShareCoins = getTierShareCoins(theirTier);
  const tierDifference = Math.abs(yourTier - theirTier);
  const shareCoinsGap = Math.abs(yourShareCoins - theirShareCoins);
  
  // Same tier = fair swap, no offset
  if (tierDifference === 0) {
    return {
      fairness: 'fair',
      tierDifference: 0,
      offsetRequired: 0,
      offsetDirection: 'none',
      yourTier,
      theirTier,
      yourShareCoins,
      theirShareCoins,
      message: 'Fair swap! No offset needed.',
    };
  }
  
  // 1 tier difference = allowed with ShareCoin offset
  if (tierDifference === 1) {
    const offsetDirection = yourTier < theirTier ? 'you_pay' : 'they_pay';
    const offsetAmount = shareCoinsGap;
    
    return {
      fairness: 'offset_required',
      tierDifference: 1,
      offsetRequired: offsetAmount,
      offsetDirection,
      yourTier,
      theirTier,
      yourShareCoins,
      theirShareCoins,
      message: offsetDirection === 'you_pay' 
        ? `You add +${offsetAmount} ShareCoins to balance the swap`
        : `They add +${offsetAmount} ShareCoins to balance the swap`,
    };
  }
  
  // 2+ tier difference = not allowed
  return {
    fairness: 'not_allowed',
    tierDifference,
    offsetRequired: 0,
    offsetDirection: 'none',
    yourTier,
    theirTier,
    yourShareCoins,
    theirShareCoins,
    message: `Swap not allowed. Maximum 1-tier difference permitted (${tierDifference} tier gap).`,
  };
}

export function getSwapTierLabel(tier: number): string {
  return `Tier ${tier}`;
}

export function getAcceptableSwapsLabel(tier: number): string {
  const eligibility = getSwapEligibility(tier);
  const labels = eligibility.acceptableTiers.map(t => {
    if (t === tier) return `Tier ${t}`;
    const offset = Math.abs(getTierShareCoins(tier) - getTierShareCoins(t));
    const direction = t < tier ? '+' : '−';
    return `Tier ${t} (${direction}${offset} SC)`;
  });
  return labels.join(' • ');
}
