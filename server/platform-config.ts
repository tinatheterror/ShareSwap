// Platform Configuration - Easy to modify commission rates and fees
export const platformConfig = {
  // Commission rates (0.05 = 5%)
  rentalCommissionRate: 0.05, // 5% commission on rentals
  
  // Alternative commission structures
  commissionStructures: {
    free: {
      rentalCommissionRate: 0.00,
      description: "No commission - completely free platform"
    },
    low: {
      rentalCommissionRate: 0.03,
      description: "3% commission - low cost for users"
    },
    standard: {
      rentalCommissionRate: 0.05,
      description: "5% commission - balanced approach"
    },
    premium: {
      rentalCommissionRate: 0.08,
      description: "8% commission - higher revenue for platform growth"
    }
  },
  
  // Flat fee alternatives (in dollars)
  flatFees: {
    enabled: false,
    rentalFee: 2.00, // $2 flat fee per rental
    swapFee: 1.00,   // $1 flat fee per swap
  },
  
  // Premium user benefits
  premiumBenefits: {
    reducedCommission: 0.02, // 2% commission for premium users
    noFlatFees: true,
  },
  
  // Minimum commission amounts
  minimumCommission: 0.50, // Don't charge commission under $0.50
  
  // ShareCoin rewards
  shareCoinsRewards: {
    successfulSwap: 1,
    successfulRental: 0, // Could add rewards for rentals too
    firstTimeRenter: 2,
    firstTimeLender: 2,
  }
};

export function calculateCommission(
  amount: number, 
  transactionType: 'RENTAL' | 'SWAP', 
  isPremiumUser: boolean = false
): { commissionAmount: number, rate: number } {
  
  if (platformConfig.flatFees.enabled && !isPremiumUser) {
    const flatFee = transactionType === 'RENTAL' 
      ? platformConfig.flatFees.rentalFee 
      : platformConfig.flatFees.swapFee;
    return { commissionAmount: flatFee, rate: 0 };
  }
  
  let rate = platformConfig.rentalCommissionRate;
  if (isPremiumUser) {
    rate = platformConfig.premiumBenefits.reducedCommission;
  }
  
  const commissionAmount = amount * rate;
  
  // Don't charge commission if it's below minimum
  if (commissionAmount < platformConfig.minimumCommission) {
    return { commissionAmount: 0, rate: 0 };
  }
  
  return { commissionAmount, rate };
}