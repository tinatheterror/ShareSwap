// Replacement Value (RV) Calculator - Server Side
// RV is the maximum amount that may be charged if a borrowed item is not returned

// Tier boundaries based on item value (in dollars)
export const TIER_BOUNDARIES = [
  { tier: 1, min: 0, max: 50 },
  { tier: 2, min: 50, max: 200 },
  { tier: 3, min: 200, max: 500 },
  { tier: 4, min: 500, max: 2000 },
];

// Midpoints for each original value range (used when no AI estimate)
export const VALUE_RANGE_MIDPOINTS: Record<string, number> = {
  "Under $50": 25,
  "$50–$199": 125,
  "$200–$499": 350,
  "$500–$2,000": 1250,
  "$50–$150": 100,
  "$150–$300": 225,
  "$300–$1,000": 650,
  "$300+": 650,
};

// Default replacement value for fallback scenarios (lowest tier midpoint)
export const DEFAULT_REPLACEMENT_VALUE = 25;

// Legacy tier-based caps (kept for reference, no longer primary logic)
export const LEGACY_TIER_CAPS: Record<number, number> = {
  1: 50,
  2: 200,
  3: 500,
  4: 2000,
};

/**
 * Get the midpoint value for an original value range string.
 * @param originalValue - The original value range string (e.g., "$50–$150")
 * @returns The midpoint value in dollars
 */
export function getValueRangeMidpoint(originalValue: string | null | undefined): number {
  if (!originalValue) {
    return DEFAULT_REPLACEMENT_VALUE;
  }
  return VALUE_RANGE_MIDPOINTS[originalValue] || DEFAULT_REPLACEMENT_VALUE;
}

/**
 * Calculate tier from a dollar value.
 * @param value - The dollar value
 * @returns The tier (1-4)
 */
export function getTierFromValue(value: number): number {
  for (const boundary of TIER_BOUNDARIES) {
    if (value >= boundary.min && value < boundary.max) {
      return boundary.tier;
    }
  }
  return 1; // Fallback to tier 1
}

/**
 * Parse an estimated value string to a number.
 * Handles formats like "$125.00", "125.00", "125", etc.
 * @param estimatedValue - The estimated value string
 * @returns The parsed number or null if invalid
 */
export function parseEstimatedValue(estimatedValue: string | null | undefined): number | null {
  if (!estimatedValue) {
    return null;
  }
  
  // Remove currency symbols, commas, and whitespace
  const cleaned = estimatedValue.replace(/[$,\s]/g, '');
  const parsed = parseFloat(cleaned);
  
  if (isNaN(parsed) || parsed <= 0) {
    return null;
  }
  
  return parsed;
}

/**
 * Calculate replacement value and tier based on priority:
 * 1. If AI estimated value exists: use it as replacement value, calculate tier from it
 * 2. If no AI: use midpoint of original value range as replacement value, calculate tier from that
 * 
 * @param estimatedValue - AI estimated value (e.g., "$125.00" or "125")
 * @param originalValue - Original value range string (e.g., "$50–$150")
 * @param condition - Item condition for tier adjustment
 * @returns Object with replacementValue, tier, and source indicator
 */
export function calculateReplacementValueAndTier(
  estimatedValue: string | null | undefined,
  originalValue: string | null | undefined,
  condition?: string | null
): {
  replacementValue: number;
  tier: number;
  source: 'ai' | 'range';
} {
  let dollarValue: number;
  let source: 'ai' | 'range';
  
  // Priority 1: Use AI estimated value if available
  const parsedAI = parseEstimatedValue(estimatedValue);
  if (parsedAI !== null) {
    dollarValue = parsedAI;
    source = 'ai';
  } else {
    // Priority 2: Use midpoint of original value range
    dollarValue = getValueRangeMidpoint(originalValue);
    source = 'range';
  }
  
  // Calculate tier from the dollar value
  let tier = getTierFromValue(dollarValue);
  
  // Apply condition modifier: Fair or Well Loved reduces tier by 1
  if (condition === "Fair" || condition === "Well Loved") {
    tier = Math.max(1, tier - 1);
  }
  
  return {
    replacementValue: Math.round(dollarValue * 100) / 100, // Round to 2 decimal places
    tier,
    source,
  };
}

/**
 * Legacy function - Calculate replacement value from tier only.
 * @deprecated Use calculateReplacementValueAndTier instead
 * @param tier - The item's tier (1-6)
 * @returns The replacement value based on tier boundaries
 */
export function calculateReplacementValue(tier: number | null | undefined): number {
  if (!tier || tier < 1) {
    return DEFAULT_REPLACEMENT_VALUE;
  }
  
  const boundary = TIER_BOUNDARIES.find(b => b.tier === tier);
  if (!boundary) {
    return DEFAULT_REPLACEMENT_VALUE;
  }
  
  // Return the midpoint of the tier's range
  if (boundary.max === Infinity) {
    return 1000;
  }
  
  return Math.round((boundary.min + boundary.max) / 2);
}
