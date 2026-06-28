// Replacement Value (RV) Calculator
// RV is the maximum amount that may be charged if a borrowed item is not returned

// Configurable tier-based replacement value caps
export const REPLACEMENT_VALUE_CAPS: Record<number, number> = {
  1: 75,   // Tier 1: Up to $75
  2: 150,  // Tier 2: Up to $150
  3: 300,  // Tier 3: Up to $300
  4: 600,  // Tier 4: Up to $600
};

// Default RV for items without a tier (fallback)
export const DEFAULT_REPLACEMENT_VALUE = 75;

/**
 * Calculate the Replacement Value cap for an item based on its tier.
 * RV is locked at time of listing and cannot be changed.
 * @param tier - The item's tier (1-4)
 * @returns The maximum replacement value cap for the item
 */
export function calculateReplacementValue(tier: number | null | undefined): number {
  if (!tier || tier < 1 || tier > 4) {
    return DEFAULT_REPLACEMENT_VALUE;
  }
  return REPLACEMENT_VALUE_CAPS[tier];
}

/**
 * Format the replacement value for display
 * @param replacementValue - The replacement value in dollars
 * @returns Formatted string like "Up to $150"
 */
export function formatReplacementValue(replacementValue: number): string {
  return `Up to $${replacementValue}`;
}

/**
 * Check if an item has a valid replacement value for borrowing
 * @param replacementValue - The item's replacement value
 * @returns True if the item can be borrowed
 */
export function hasValidReplacementValue(replacementValue: number | null | undefined): boolean {
  return replacementValue !== null && replacementValue !== undefined && replacementValue > 0;
}

/**
 * Calculate the remaining charge after applying security deposit
 * Used when an item is not returned
 * @param replacementValue - The maximum RV cap
 * @param securityDeposit - The security deposit already held
 * @returns The remaining amount to charge (never more than RV - deposit)
 */
export function calculateRemainingCharge(
  replacementValue: number,
  securityDeposit: number
): number {
  const remaining = replacementValue - securityDeposit;
  return Math.max(0, remaining);
}
