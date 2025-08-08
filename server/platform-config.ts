// Platform Configuration - Easy to modify commission rates and fees
export const platformConfig = {
  // Commission rates (0.05 = 5%)
  rentalCommissionRate: 0.05, // 5% commission on rentals
  
  // Commission split breakdown
  commissionSplit: {
    platformSustainability: 0.03, // 3% for platform operations
    userRewardFund: 0.02, // 2% converted to ShareCoins for users
    total: 0.05 // Total 5% commission
  },
  
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
    successfulRental: 1, // 1 ShareCoin to both users when item is returned
    firstTimeRenter: 2,
    firstTimeLender: 2,
  },
  
  // ShareCoin conversion for user reward fund
  shareCoinsPerDollar: 1, // 1 ShareCoin per $1 from user reward fund
  
  // Platform messaging
  messaging: {
    commission: "Only pay when you earn — our platform grows with you.",
    shareCoinsReward: "Earn ShareCoins when items are successfully returned!",
    commissionBreakdown: "3% supports platform growth, 2% rewards our community with ShareCoins"
  }
};

export function calculateCommission(
  amount: number, 
  transactionType: 'RENTAL' | 'SWAP', 
  isPremiumUser: boolean = false
): { 
  commissionAmount: number, 
  rate: number,
  platformAmount: number,
  userRewardAmount: number,
  shareCoinsFromReward: number
} {
  
  if (platformConfig.flatFees.enabled && !isPremiumUser) {
    const flatFee = transactionType === 'RENTAL' 
      ? platformConfig.flatFees.rentalFee 
      : platformConfig.flatFees.swapFee;
    return { 
      commissionAmount: flatFee, 
      rate: 0,
      platformAmount: flatFee,
      userRewardAmount: 0,
      shareCoinsFromReward: 0
    };
  }
  
  let rate = platformConfig.rentalCommissionRate;
  if (isPremiumUser) {
    rate = platformConfig.premiumBenefits.reducedCommission;
  }
  
  const commissionAmount = amount * rate;
  
  // Don't charge commission if it's below minimum
  if (commissionAmount < platformConfig.minimumCommission) {
    return { 
      commissionAmount: 0, 
      rate: 0,
      platformAmount: 0,
      userRewardAmount: 0,
      shareCoinsFromReward: 0
    };
  }
  
  // Calculate split for rentals
  if (transactionType === 'RENTAL') {
    const platformAmount = amount * platformConfig.commissionSplit.platformSustainability;
    const userRewardAmount = amount * platformConfig.commissionSplit.userRewardFund;
    const shareCoinsFromReward = Math.floor(userRewardAmount * platformConfig.shareCoinsPerDollar);
    
    return { 
      commissionAmount, 
      rate,
      platformAmount,
      userRewardAmount,
      shareCoinsFromReward
    };
  }
  
  return { 
    commissionAmount, 
    rate,
    platformAmount: commissionAmount,
    userRewardAmount: 0,
    shareCoinsFromReward: 0
  };
}