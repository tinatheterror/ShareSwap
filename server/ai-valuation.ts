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
}

export async function calculateAIValuation(
  item: ItemValuationInput
): Promise<ValuationResult> {
  const tier = item.tier;
  const band = TIER_BANDS[tier] || TIER_BANDS[1];
  
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

    const prompt = `You are an expert item valuation AI for a peer-to-peer sharing marketplace. Your task is to determine the exact ShareCoin value for an item within a specific tier band.
${hasPhotos ? "\nIMPORTANT: Analyze the provided photo(s) carefully to assess the actual condition, brand quality, and item characteristics." : ""}

TIER BAND: ${band.min} to ${band.max} ShareCoins (weekly rate)
BAND RANGE: ${bandRange} ShareCoins

ITEM DETAILS:
- Name: ${item.name}
- Category/Type: ${item.itemType || "Unknown"}
- Brand: ${item.brand || "Unknown/Generic"}
- Condition (stated): ${item.condition} (Rating: ${item.conditionRating}/10)
- Original Value: ${item.originalValue || "Unknown"}
- Estimated Market Value: ${item.estimatedValue || "Unknown"}
- Description: ${item.description || "No description provided"}

VALUATION RULES:
1. Condition Impact (applied as % shift within the band):
   - Like New/New: +20% towards max
   - Good: +10% towards max
   - Used/Fair: -10% towards min
   - Heavily Used/Well Loved: -20% towards min
${hasPhotos ? "   - IMPORTANT: Verify condition from photos - if actual condition differs from stated, adjust accordingly" : ""}

2. Brand Impact:
   - High-end/Premium brands (Apple, Dyson, KitchenAid, etc.): shift towards max
   - Mid-tier brands: stay centered in band
   - Generic/Unknown/Off-brand: shift towards min
${hasPhotos ? "   - Look for brand logos/labels in photos to verify brand quality" : ""}

3. Category/Demand Factors:
   - Baby gear: tends towards LOWER end of band (high depreciation, safety concerns)
   - Tools & Equipment: stable MIDDLE of band (utility-focused)
   - Electronics: tends towards HIGHER end (high demand, tech value)
   - Seasonal items: consider current market relevance

4. Additional Considerations:
   - Local marketplace demand for this type of item
   - Typical depreciation rates for this category
   - Rarity or uniqueness of the item
${hasPhotos ? "   - Assess overall presentation quality from photos" : ""}

Based on these factors${hasPhotos ? " and the photo analysis" : ""}, calculate the exact ShareCoin value. Return ONLY a JSON object with this structure:

{
  "shareCoinsValue": <integer between ${band.min} and ${band.max}>,
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
    };
  } catch (error) {
    console.error("AI valuation error:", error);
    return calculateFallbackValuation(item, band);
  }
}

function calculateFallbackValuation(
  item: ItemValuationInput,
  band: { min: number; max: number }
): ValuationResult {
  const bandRange = band.max - band.min;
  let baseValue = (band.min + band.max) / 2;

  const conditionMod = CONDITION_MODIFIERS[item.condition] || 0;
  baseValue += bandRange * conditionMod;

  let brandMod = 0;
  const brand = (item.brand || "").toLowerCase();
  const premiumBrands = ["apple", "dyson", "kitchenaid", "samsung", "sony", "bose", "dewalt", "makita", "bosch"];
  const budgetIndicators = ["generic", "unknown", "off-brand", "no-name", "unbranded"];
  
  if (premiumBrands.some(b => brand.includes(b))) {
    brandMod = 0.15;
  } else if (budgetIndicators.some(b => brand.includes(b)) || !item.brand) {
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
    categoryMod = -0.05;
  }
  baseValue += bandRange * categoryMod;

  const shareCoinsValue = Math.round(Math.max(band.min, Math.min(band.max, baseValue)));

  return {
    shareCoinsValue,
    tierBand: band,
    reasoning: "Valuation based on condition, brand, and category factors.",
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
