// Trust-based security deposit calculator

// Get the midpoint value from the original value range string
export function getItemValueMidpoint(originalValue: string | null | undefined): number {
  if (!originalValue) return 25; // Default to $25 for unknown values
  
  switch (originalValue) {
    case "Under $50":
      return 25; // Midpoint of 0-50
    case "$50–$150":
    case "$50-$150":
      return 100; // Midpoint of 50-150
    case "$150–$300":
    case "$150-$300":
      return 225; // Midpoint of 150-300
    case "$300+":
      return 500; // Conservative estimate for $300+
    default:
      // Try to parse numeric value if it's a direct number
      const numericValue = parseFloat(originalValue.replace(/[^0-9.]/g, ''));
      return isNaN(numericValue) ? 25 : numericValue;
  }
}

// Get discount percentage based on trust score (reputation score)
export function getTrustDiscount(trustScore: number): { discountPercent: number; discountLabel: string } {
  if (trustScore >= 90) {
    return { discountPercent: 60, discountLabel: "60%" };
  } else if (trustScore >= 70) {
    return { discountPercent: 40, discountLabel: "40%" };
  } else if (trustScore >= 50) {
    return { discountPercent: 20, discountLabel: "20%" };
  } else {
    return { discountPercent: 0, discountLabel: "0%" };
  }
}

// Calculate the trust-based security deposit
export function calculateTrustBasedDeposit(
  originalValue: string | null | undefined,
  trustScore: number
): {
  baseDeposit: number;
  finalDeposit: number;
  discountPercent: number;
  discountAmount: number;
} {
  // Get item value midpoint
  const itemValue = getItemValueMidpoint(originalValue);
  
  // Base deposit is 30% of item value
  const baseDeposit = itemValue * 0.30;
  
  // Get discount based on trust score
  const { discountPercent } = getTrustDiscount(trustScore);
  
  // Calculate discount amount and final deposit
  const discountAmount = baseDeposit * (discountPercent / 100);
  const finalDeposit = Math.max(baseDeposit - discountAmount, 0);
  
  return {
    baseDeposit: Math.round(baseDeposit * 100) / 100,
    finalDeposit: Math.round(finalDeposit * 100) / 100,
    discountPercent,
    discountAmount: Math.round(discountAmount * 100) / 100,
  };
}
