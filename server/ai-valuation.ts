import OpenAI from "openai";

const TIER_BANDS: Record<number, { min: number; max: number }> = {
  1: { min: 5, max: 5 },
  2: { min: 10, max: 15 },
  3: { min: 20, max: 30 },
  4: { min: 40, max: 60 },
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
  tierBand: { min: number; max: number };
  reasoning: string;
  factors: {
    conditionAdjustment: number;
    brandAdjustment: number;
    categoryAdjustment: number;
    demandAdjustment: number;
  };
  // Internal item value for rental calculations (not displayed to users)
  internalItemValue: number;
}

export async function calculateAIValuation(
  item: ItemValuationInput
): Promise<ValuationResult> {
  const tier = item.tier;
  const band = TIER_BANDS[tier] || TIER_BANDS[1];
  
  // Estimate internal item value based on original value range
  const getBaseItemValue = (originalValue: string | null | undefined): number => {
    const valueMap: Record<string, number> = {
      "Under $50": 30,
      "$50–$150": 100,
      "$150–$300": 225,
      "$300+": 500,
    };
    return valueMap[originalValue || ""] || 100;
  };

  if (band.min === band.max) {
    return {
      shareCoinsValue: band.min,
      tierBand: band,
      reasoning: "Tier 1 items have a fixed value of 5 ShareCoins.",
      factors: {
        conditionAdjustment: 0,
        brandAdjustment: 0,
        categoryAdjustment: 0,
        demandAdjustment: 0,
      },
      internalItemValue: getBaseItemValue(item.originalValue),
    };
  }

  try {
    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    const bandRange = band.max - band.min;
    const conditionMod = CONDITION_MODIFIERS[item.condition] || 0;
    const categoryHint = CATEGORY_RATE_HINTS[item.itemType || ""] || "middle";

    const hasPhotos = item.photos && item.photos.length > 0;
    
    // Detect luxury brand and high value
    const itemBrand = (item.brand || item.name || "").toLowerCase();
    const isLuxuryBrand = LUXURY_BRANDS.some(b => itemBrand.includes(b));
    const isHighValue = item.originalValue === "$300+" || 
      (item.estimatedValue && parseFloat(item.estimatedValue.replace(/[^0-9.]/g, '')) >= 1000);
    const isExcellentCondition = item.condition === "New / Like New" || 
      item.condition === "Like New" || 
      (item.condition === "Good" && item.conditionRating >= 8);

    const prompt = `You are an expert item valuation AI for a peer-to-peer sharing marketplace. Your task is to determine the exact ShareCoin value for an item within a specific tier band.
${hasPhotos ? "\nIMPORTANT: Analyze the provided photo(s) carefully to assess the actual condition, brand quality, and item characteristics." : ""}
${isLuxuryBrand && isHighValue ? "\n⚠️ HIGH-VALUE LUXURY ITEM DETECTED: This appears to be a luxury/designer brand item worth significantly more than the tier minimum. Unless there is visible damage or wear concerns, this should be valued at or very near the MAXIMUM of the band." : ""}

TIER BAND: ${band.min} to ${band.max} ShareCoins (weekly rate)
BAND RANGE: ${bandRange} ShareCoins

ITEM DETAILS:
- Name: ${item.name}
- Category/Type: ${item.itemType || "Unknown"}
- Brand: ${item.brand || "Unknown/Generic"}${isLuxuryBrand ? " ⭐ LUXURY/DESIGNER BRAND" : ""}
- Condition (stated): ${item.condition} (Rating: ${item.conditionRating}/10)
- Original Value: ${item.originalValue || "Unknown"}
- Estimated Market Value: ${item.estimatedValue || "Unknown"}
- Features & Details: ${item.description || "No description provided"}

VALUATION RULES:

0. Features & Details Analysis (CRITICAL for accurate valuation):
   - CAREFULLY analyze the Features & Details text for value-adding information:
     ➤ Premium materials (leather, solid wood, stainless steel, etc.) → increase value
     ➤ Special editions, limited releases, or collectibles → significantly increase value
     ➤ Additional accessories or complete sets → increase value
     ➤ Professional-grade or commercial quality → increase value
     ➤ Age, vintage status, or antique value → may increase value for collectibles
     ➤ Warranty or recent service/maintenance → increase value
     ➤ Defects, damage, or missing parts mentioned → decrease value
   - Use these details to refine your estimated item value

1. Condition Impact (applied as % shift within the band):
   - Like New/New: +20% towards max
   - Good: +10% towards max
   - Used/Fair: -10% towards min
   - Heavily Used/Well Loved: -20% towards min
${hasPhotos ? "   - IMPORTANT: Verify condition from photos - if actual condition differs from stated, adjust accordingly" : ""}

2. Brand Impact (CRITICAL for accurate valuation):
   - ULTRA-LUXURY/DESIGNER brands (Chanel, Louis Vuitton, Hermès, Gucci, Prada, Rolex, Cartier, etc.): 
     ➤ These should ANCHOR AT THE MAXIMUM of the band (${band.max}) unless there is visible wear/damage
     ➤ Only reduce from max if condition issues are apparent
   - Premium tech/tool brands (Apple, Dyson, DeWalt, etc.): shift towards upper portion of band
   - Mid-tier brands: stay centered in band
   - Generic/Unknown/Off-brand: shift towards min
${hasPhotos ? "   - Look for brand logos/labels, authenticity cues (stitching, hardware, materials)" : ""}

3. Value Signal:
   - Items worth significantly more than $300 (especially $1000+) should be valued at the TOP of Tier 4
   - High original/market value is a strong indicator for maximum band value

4. Category/Demand Factors:
   - Baby gear: tends towards LOWER end of band (high depreciation, safety concerns)
   - Tools & Equipment: stable MIDDLE of band (utility-focused)
   - Electronics: tends towards HIGHER end (high demand, tech value)
   - Luxury fashion/accessories: tends towards MAXIMUM of band (prestige, resale value)

5. Additional Considerations:
   - Rarity or exclusivity of the item
   - Current market demand for luxury/designer items
${hasPhotos ? "   - Assess overall presentation quality and authenticity from photos" : ""}

Based on these factors${hasPhotos ? " and the photo analysis" : ""}, calculate the exact ShareCoin value AND estimate the current market value of the item in USD. Return ONLY a JSON object with this structure:

{
  "shareCoinsValue": <integer between ${band.min} and ${band.max}>,
  "estimatedItemValue": <integer in USD - your best estimate of current market value based on condition, brand, photos, and market demand>,
  "conditionAdjustment": <percentage as decimal, e.g., 0.20 for +20%>,
  "brandAdjustment": <percentage as decimal>,
  "categoryAdjustment": <percentage as decimal>,
  "demandAdjustment": <percentage as decimal>,
  "reasoning": "<brief 1-2 sentence explanation of the valuation${hasPhotos ? ", mentioning what you observed in the photos" : ""}>"
}`;

    // Build message content with optional images
    const messageContent: any[] = [{ type: "text", text: prompt }];
    
    // Add photos if available (for GPT-4 Vision)
    if (hasPhotos && item.photos) {
      for (const photo of item.photos.slice(0, 3)) { // Limit to 3 photos
        messageContent.push({
          type: "image_url",
          image_url: {
            url: photo,
            detail: "low", // Use low detail for faster processing
          },
        });
      }
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a precise item valuation expert${hasPhotos ? " with visual analysis capabilities" : ""}. Return only valid JSON with the exact ShareCoin value within the specified band.`,
        },
        {
          role: "user",
          content: messageContent,
        },
      ],
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const aiResponse = response.choices[0]?.message?.content;
    if (!aiResponse) {
      throw new Error("No response from AI");
    }

    const parsed = JSON.parse(aiResponse);
    
    let shareCoinsValue = Math.round(parsed.shareCoinsValue);
    shareCoinsValue = Math.max(band.min, Math.min(band.max, shareCoinsValue));
    
    // Use AI estimated value or fallback to base value
    // Ensure minimum value based on original value range
    const baseValue = getBaseItemValue(item.originalValue);
    const aiEstimate = parsed.estimatedItemValue ? Math.round(parsed.estimatedItemValue) : baseValue;
    const internalItemValue = Math.max(aiEstimate, baseValue);

    return {
      shareCoinsValue,
      tierBand: band,
      reasoning: parsed.reasoning || "AI-calculated valuation based on item characteristics.",
      factors: {
        conditionAdjustment: parsed.conditionAdjustment || 0,
        brandAdjustment: parsed.brandAdjustment || 0,
        categoryAdjustment: parsed.categoryAdjustment || 0,
        demandAdjustment: parsed.demandAdjustment || 0,
      },
      internalItemValue,
    };
  } catch (error) {
    console.error("AI valuation error:", error);
    return calculateFallbackValuation(item, band, getBaseItemValue);
  }
}

function calculateFallbackValuation(
  item: ItemValuationInput,
  band: { min: number; max: number },
  getBaseItemValue: (originalValue: string | null | undefined) => number
): ValuationResult {
  const bandRange = band.max - band.min;
  const baseItemValue = getBaseItemValue(item.originalValue);
  
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

  // Analyze description for premium features
  const descriptionText = (item.description || "").toLowerCase();
  const premiumMaterials = ["leather", "solid wood", "stainless steel", "titanium", "carbon fiber", "gold", "silver"];
  const premiumFeatures = ["limited edition", "special edition", "collector", "professional", "commercial grade", "complete set", "with accessories", "warranty"];
  const negativeIndicators = ["damaged", "broken", "missing", "defect", "scratch", "dent", "crack", "worn"];
  
  const hasPremiumMaterials = premiumMaterials.some(m => descriptionText.includes(m));
  const hasPremiumFeatures = premiumFeatures.some(f => descriptionText.includes(f));
  const hasNegativeIndicators = negativeIndicators.some(n => descriptionText.includes(n));

  // Calculate internal item value with adjustments
  let internalItemValue = baseItemValue;
  if (isLuxuryBrand) {
    internalItemValue = baseItemValue * 2; // Luxury items worth more
  } else if (isPremiumBrand) {
    internalItemValue = baseItemValue * 1.3;
  }
  // Condition adjustment
  if (isExcellentCondition) {
    internalItemValue *= 1.1;
  } else if (item.condition === "Fair" || item.condition === "Well Loved") {
    internalItemValue *= 0.7;
  }
  
  // Description-based adjustments
  if (hasPremiumMaterials) {
    internalItemValue *= 1.15; // Premium materials add 15% value
  }
  if (hasPremiumFeatures) {
    internalItemValue *= 1.2; // Premium features add 20% value
  }
  if (hasNegativeIndicators) {
    internalItemValue *= 0.85; // Negative indicators reduce 15% value
  }

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
      internalItemValue: Math.round(internalItemValue),
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

  // Description-based adjustments for ShareCoin value
  let descriptionMod = 0;
  if (hasPremiumMaterials) {
    descriptionMod += 0.10; // Premium materials add 10% towards max
  }
  if (hasPremiumFeatures) {
    descriptionMod += 0.15; // Premium features add 15% towards max
  }
  if (hasNegativeIndicators) {
    descriptionMod -= 0.15; // Negative indicators reduce 15% towards min
  }
  baseValue += bandRange * descriptionMod;

  const shareCoinsValue = Math.round(Math.max(band.min, Math.min(band.max, baseValue)));

  // Build reasoning message
  let reasoning = isLuxuryBrand 
    ? `Luxury/designer brand item valued at upper range of band.`
    : "Valuation based on condition, brand, and category factors.";
  if (hasPremiumMaterials || hasPremiumFeatures) {
    reasoning += " Premium features/materials detected in description.";
  }

  return {
    shareCoinsValue,
    tierBand: band,
    reasoning,
    factors: {
      conditionAdjustment: conditionMod,
      brandAdjustment: brandMod,
      categoryAdjustment: categoryMod,
      demandAdjustment: descriptionMod,
    },
    internalItemValue: Math.round(internalItemValue),
  };
}

export function getTierBand(tier: number): { min: number; max: number } {
  return TIER_BANDS[tier] || TIER_BANDS[1];
}
