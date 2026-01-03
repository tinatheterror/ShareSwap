// Replacement Value (RV) Calculator - Server Side
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
