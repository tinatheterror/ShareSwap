import type { Express, NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { aiConsents, db } from "@workspace/db";
import { csrfProtection } from "./csrf";

/**
 * Every place ShareSwap sends something to OpenAI, what is sent, and what happens without consent. This is the one list: the
 * consent prompts in the web and mobile apps render it, the Privacy Policy describes it (a test keeps them in step), and the
 * server refuses to call OpenAI for a person who has not agreed to the feature.
 *
 * Bump AI_CONSENT_VERSION when what is shared or who receives it changes, so everyone is asked again.
 */
export const AI_CONSENT_VERSION = "2026-11-03";

export const AI_PROVIDER = "OpenAI";

export type AiFeatureDefinition = {
  key: string;
  /** Short name shown on the prompt. */
  title: string;
  /** What the feature does for the person. */
  purpose: string;
  /** Exactly what is sent to OpenAI, in plain words. */
  shared: string;
  /** What is never sent. */
  notShared: string;
  /** What happens if the person says no. */
  withoutConsent: string;
  /** "unavailable": the route refuses. "no-ai": the feature still works, without OpenAI. */
  fallback: "unavailable" | "no-ai";
};

const NEVER = "Your name, email address and account details are never sent.";

export const AI_FEATURES = [
  {
    key: "profile_photo_check",
    title: "Profile photo check",
    purpose: "Checks that a new profile photo shows a clear human face.",
    shared: "The profile photo you upload, which shows your face.",
    notShared: NEVER,
    withoutConsent: "Your photo is saved without the check.",
    fallback: "no-ai",
  },
  {
    key: "smartscan",
    title: "SmartScan",
    purpose: "Identifies an item from photos and fills in its name, description, category, brand and condition.",
    shared: "The item photos you give SmartScan.",
    notShared: NEVER,
    withoutConsent: "SmartScan is unavailable. You can fill in the listing yourself.",
    fallback: "unavailable",
  },
  {
    key: "listing_autofill",
    title: "Listing autofill from photos",
    purpose: "Suggests a title, description, condition, category, brand, model and price from your item photos.",
    shared: "Up to 3 item photos.",
    notShared: NEVER,
    withoutConsent: "Autofill is unavailable. You can fill in the listing yourself.",
    fallback: "unavailable",
  },
  {
    key: "screenshot_import",
    title: "Import from a screenshot",
    purpose: "Reads a marketplace listing screenshot and copies its details into a ShareSwap listing.",
    shared: "The screenshots you upload (up to 5). They can show whatever the original listing showed, such as names, prices and photos.",
    notShared: NEVER,
    withoutConsent: "Import is unavailable. You can fill in the listing yourself.",
    fallback: "unavailable",
  },
  {
    key: "category_suggestion",
    title: "Category suggestion",
    purpose: "Suggests a category from the item name.",
    shared: "The item name you type.",
    notShared: NEVER,
    withoutConsent: "No category is suggested. You can choose one yourself.",
    fallback: "unavailable",
  },
] as const satisfies readonly AiFeatureDefinition[];

export type AiFeatureKey = (typeof AI_FEATURES)[number]["key"];
export const AI_FEATURE_KEYS: readonly string[] = AI_FEATURES.map((feature) => feature.key);
export const isAiFeatureKey = (value: unknown): value is AiFeatureKey => typeof value === "string" && AI_FEATURE_KEYS.includes(value);

export const AI_CONSENT_REQUIRED_CODE = "AI_CONSENT_REQUIRED";
// Free of the words "csrf" and "token": both apps retry a 403 whose body mentions them.
export const aiConsentRequiredMessage = (feature: AiFeatureDefinition) =>
  `${feature.title} sends your content to ${AI_PROVIDER}. Please allow that first. ${feature.withoutConsent}`;

/** The features this person has agreed to, at the current wording. */
export async function consentedAiFeatures(userId: number): Promise<AiFeatureKey[]> {
  const rows = await db.select({ feature: aiConsents.feature, version: aiConsents.version }).from(aiConsents).where(eq(aiConsents.userId, userId));
  return rows.filter((row) => row.version === AI_CONSENT_VERSION && isAiFeatureKey(row.feature)).map((row) => row.feature as AiFeatureKey);
}

export async function hasAiConsent(userId: number, feature: AiFeatureKey): Promise<boolean> {
  return (await consentedAiFeatures(userId)).includes(feature);
}

/** For routes whose whole point is the AI call: refuse with a specific code, so the app can show the consent prompt. */
export function requireAiConsent(feature: AiFeatureKey) {
  const definition = AI_FEATURES.find((candidate) => candidate.key === feature)!;
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated() || !req.user) return res.sendStatus(401);
    try {
      if (await hasAiConsent((req.user as { id: number }).id, feature)) return next();
    } catch (error) {
      return next(error);
    }
    return res.status(403).json({ code: AI_CONSENT_REQUIRED_CODE, feature, message: aiConsentRequiredMessage(definition) });
  };
}

export function registerAiConsentRoutes(app: Express) {
  // Public: the text every consent prompt shows.
  app.get("/api/ai-consent/features", (_req, res) => {
    res.json({ provider: AI_PROVIDER, version: AI_CONSENT_VERSION, features: AI_FEATURES });
  });

  app.get("/api/ai-consent", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.sendStatus(401);
    return res.json({ version: AI_CONSENT_VERSION, consented: await consentedAiFeatures((req.user as { id: number }).id) });
  });

  // Agreeing to one feature (or several at once, for a prompt that covers more than one).
  app.post("/api/ai-consent", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.sendStatus(401);
    const requested: unknown[] = Array.isArray(req.body?.features) ? req.body.features : [req.body?.feature];
    if (requested.length === 0 || requested.length > AI_FEATURES.length || !requested.every(isAiFeatureKey)) {
      return res.status(400).json({ message: "Unknown AI feature." });
    }
    const userId = (req.user as { id: number }).id;
    for (const feature of new Set(requested as AiFeatureKey[])) {
      await db
        .insert(aiConsents)
        .values({ userId, feature, version: AI_CONSENT_VERSION })
        .onConflictDoUpdate({ target: [aiConsents.userId, aiConsents.feature], set: { version: AI_CONSENT_VERSION, consentedAt: new Date() } });
    }
    return res.json({ version: AI_CONSENT_VERSION, consented: await consentedAiFeatures(userId) });
  });

  // Withdrawing: from then on the feature is unavailable or works without OpenAI again.
  app.delete("/api/ai-consent/:feature", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.sendStatus(401);
    const feature = req.params.feature;
    if (!isAiFeatureKey(feature)) return res.status(400).json({ message: "Unknown AI feature." });
    const userId = (req.user as { id: number }).id;
    await db.delete(aiConsents).where(and(eq(aiConsents.userId, userId), eq(aiConsents.feature, feature)));
    return res.json({ version: AI_CONSENT_VERSION, consented: await consentedAiFeatures(userId) });
  });
}
