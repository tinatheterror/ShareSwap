import OpenAI from "openai";

const TIER_FIXED_RATES: Record<number, number> = {
  1: 5,
  2: 10,
  3: 20,
  4: 40,
};

const CONDITION_MODIFIERS: Record<string, number> = {
  "New / Like New": 0.20,
  "Like New": 0.20,
  "Good": 0.10,
  "Fair": -0.10,
  "Used": -0.10,
  "Well Loved": -0.20,
  "Heavily Used": -0.20,
};

const CATEGORY_RATE_HINTS: Record<string, string> = {
  "Baby & Kids": "lower_end",
  "Clothing & Accessories": "lower_middle",
  "Electronics": "higher_end",
  "Hobbies & Collectibles": "middle",
  "Home & Kitchen": "middle",
  "Tools & Equipment": "stable_middle",
};

// Luxury/designer brands that should anchor at top of band
const LUXURY_BRANDS = [
  "chanel", "louis vuitton", "lv", "hermes", "hermès", "gucci", "prada", 
  "dior", "fendi", "goyard", "celine", "céline", "ysl", "saint laurent",
  "balenciaga", "burberry", "loewe", "cartier", "rolex", "omega", "patek",
  "audemars", "vacheron", "breitling", "bottega veneta", "valentino",
  "givenchy", "versace", "alexander mcqueen", "tom ford", "bvlgari"
];

// Premium tech/tool brands (lower weight than luxury)
const PREMIUM_BRANDS = [
  "apple", "dyson", "kitchenaid", "samsung", "sony", "bose", "dewalt", 
  "makita", "bosch", "milwaukee", "festool", "snap-on", "leica", "hasselblad"
];

export interface ItemValuationInput {
  tier: number;
  condition: string;
  conditionRating: number;
  brand?: string | null;
  category?: string | null;
  itemType?: string | null;
  name: string;
  description?: string;
  originalValue?: string | null;
  estimatedValue?: string | null;
  photos?: string[]; // Array of base64 data URLs or image URLs
}

export interface ValuationResult {
  shareCoinsValue: number;
  reasoning: string;
}

export async function calculateAIValuation(
  item: ItemValuationInput
): Promise<ValuationResult> {
  const tier = item.tier;
  const fixedRate = TIER_FIXED_RATES[tier] || TIER_FIXED_RATES[1];
  
  // All tiers now have fixed rates - no AI calculation needed
  const tierNames: Record<number, string> = {
    1: "Budget Friendly",
    2: "Everyday Household Item", 
    3: "Premium Item",
    4: "High Value Item",
  };
  
  return {
    shareCoinsValue: fixedRate,
    reasoning: `Tier ${tier} (${tierNames[tier] || "Standard"}) items have a fixed rate of ${fixedRate} ShareCoins/week.`,
  };
}

function calculateFallbackValuation(
  item: ItemValuationInput,
  band: { min: number; max: number }
): ValuationResult {
  const bandRange = band.max - band.min;
  
  // Check for luxury brand first
  const brandText = (item.brand || item.name || "").toLowerCase();
  const isLuxuryBrand = LUXURY_BRANDS.some(b => brandText.includes(b));
  const isPremiumBrand = PREMIUM_BRANDS.some(b => brandText.includes(b));
  const budgetIndicators = ["generic", "unknown", "off-brand", "no-name", "unbranded"];
  const isBudgetBrand = budgetIndicators.some(b => brandText.includes(b)) || !item.brand;
  
  // Check for high value and excellent condition
  const isHighValue = item.originalValue === "$300+" || 
    (item.estimatedValue && parseFloat(item.estimatedValue.replace(/[^0-9.]/g, '')) >= 1000);
  const isExcellentCondition = item.condition === "New / Like New" || 
    item.condition === "Like New" || 
    (item.condition === "Good" && item.conditionRating >= 8);

  // For luxury brands in excellent condition with high value, go straight to max
  if (isLuxuryBrand && isHighValue && isExcellentCondition && item.tier === 4) {
    return {
      shareCoinsValue: band.max,
      tierBand: band,
      reasoning: `Luxury designer item (${item.brand || 'detected from name'}) in excellent condition valued at maximum.`,
      factors: {
        conditionAdjustment: 0.20,
        brandAdjustment: 0.30,
        categoryAdjustment: 0.10,
        demandAdjustment: 0.10,
      },
    };
  }

  // Standard calculation for other items
  let baseValue = (band.min + band.max) / 2;

  const conditionMod = CONDITION_MODIFIERS[item.condition] || 0;
  baseValue += bandRange * conditionMod;

  let brandMod = 0;
  if (isLuxuryBrand) {
    brandMod = 0.30; // Luxury brands get +30% towards max
  } else if (isPremiumBrand) {
    brandMod = 0.15; // Premium tech/tool brands get +15%
  } else if (isBudgetBrand) {
    brandMod = -0.10;
  }
  baseValue += bandRange * brandMod;

  let categoryMod = 0;
  const itemType = (item.itemType || "").toLowerCase();
  const category = (item.category || "").toLowerCase();
  const categoryContext = itemType + " " + category;
  
  if (categoryContext.includes("baby") || categoryContext.includes("kids")) {
    categoryMod = -0.15;
  } else if (categoryContext.includes("electronics") || categoryContext.includes("tech")) {
    categoryMod = 0.15;
  } else if (categoryContext.includes("tools") || categoryContext.includes("equipment")) {
    categoryMod = 0;
  } else if (categoryContext.includes("clothing") || categoryContext.includes("accessories")) {
    // Luxury fashion should not be penalized
    categoryMod = isLuxuryBrand ? 0.10 : -0.05;
  }
  baseValue += bandRange * categoryMod;

  const shareCoinsValue = Math.round(Math.max(band.min, Math.min(band.max, baseValue)));

  return {
    shareCoinsValue,
    tierBand: band,
    reasoning: isLuxuryBrand 
      ? `Luxury/designer brand item valued at upper range of band.`
      : "Valuation based on condition, brand, and category factors.",
    factors: {
      conditionAdjustment: conditionMod,
      brandAdjustment: brandMod,
      categoryAdjustment: categoryMod,
      demandAdjustment: 0,
    },
  };
}

export function getTierBand(tier: number): { min: number; max: number } {
  return TIER_BANDS[tier] || TIER_BANDS[1];
}
