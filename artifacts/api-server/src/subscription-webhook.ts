import type { Request, Response } from "express";
import type Stripe from "stripe";
import { db } from "@workspace/db";
import { users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getUncachableStripeClient } from "./stripe.server";
import { grantsTier } from "./subscription-upgrade";

export type SubscriptionWebhookStripe = Pick<Stripe, "webhooks" | "prices">;

export interface SubscriptionWebhookStore {
  setSubscription(customerId: string, fields: { subscriptionTier: string; stripeSubscriptionId: string | null; stripeSubscriptionStatus: string }): Promise<void>;
}

const dbStore: SubscriptionWebhookStore = {
  async setSubscription(customerId, fields) {
    await db.update(users).set(fields as any).where(eq(users.stripeCustomerId, customerId));
  },
};

export interface SubscriptionWebhookDeps {
  getStripe?: () => Promise<SubscriptionWebhookStripe>;
  store?: SubscriptionWebhookStore;
  getSecret?: () => string | undefined;
}

export const SUBSCRIPTION_WEBHOOK_SECRET_ENV = "STRIPE_SUBSCRIPTION_WEBHOOK_SECRET";

/** Boot check: a deployment without the signing secret must not start. Names only, never values. */
export function requireSubscriptionWebhookSecret(env: NodeJS.ProcessEnv = process.env) {
  if (!env[SUBSCRIPTION_WEBHOOK_SECRET_ENV]?.trim()) {
    throw new Error(
      `Missing required environment variable: ${SUBSCRIPTION_WEBHOOK_SECRET_ENV}. ` +
        `Set it in Replit Secrets to the signing secret of the Stripe webhook endpoint for /api/stripe/subscription-webhook.`,
    );
  }
}

/**
 * Fails closed: without the secret, a signature header, and a valid signature the request is rejected with 400
 * and nothing is changed. There is no unverified path. Expects the raw body (see app.ts).
 */
export function subscriptionWebhookHandler(deps: SubscriptionWebhookDeps = {}) {
  const getStripe = deps.getStripe ?? getUncachableStripeClient;
  const store = deps.store ?? dbStore;
  const getSecret = deps.getSecret ?? (() => process.env[SUBSCRIPTION_WEBHOOK_SECRET_ENV]);

  return async (req: Request, res: Response) => {
    const secret = getSecret()?.trim();
    const sig = req.headers["stripe-signature"];

    if (!secret) {
      console.error(`Subscription webhook rejected: ${SUBSCRIPTION_WEBHOOK_SECRET_ENV} is not set.`);
      return res.status(400).json({ error: "Webhook not configured" });
    }
    if (typeof sig !== "string" || !sig) {
      console.error("Subscription webhook rejected: missing stripe-signature header.");
      return res.status(400).json({ error: "Missing signature" });
    }
    if (!Buffer.isBuffer(req.body)) {
      console.error("Subscription webhook rejected: body was not the raw request body.");
      return res.status(400).json({ error: "Invalid body" });
    }

    let stripe: SubscriptionWebhookStripe;
    let event: Stripe.Event;
    try {
      stripe = await getStripe();
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err: any) {
      console.error("Subscription webhook rejected: signature verification failed:", err?.message);
      return res.status(400).json({ error: "Invalid signature" });
    }

    try {
      if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
        const subscription = event.data.object as any;
        const customerId = subscription.customer as string;

        let tier = "free";
        const priceId = subscription.items?.data?.[0]?.price?.id;
        if (priceId) {
          const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
          const product = price.product as any;
          tier = product?.metadata?.tier || "free";
        }
        // Only a paid-up (or grace-period) subscription grants its tier: an incomplete one is still waiting on the card.
        if (!grantsTier(subscription.status)) tier = "free";

        await store.setSubscription(customerId, {
          subscriptionTier: tier,
          stripeSubscriptionId: subscription.id,
          stripeSubscriptionStatus: subscription.status,
        });
        console.log(`✅ Subscription updated for customer ${customerId}: tier=${tier}, status=${subscription.status}`);
      }

      if (event.type === "customer.subscription.deleted") {
        const customerId = (event.data.object as any).customer as string;
        await store.setSubscription(customerId, {
          subscriptionTier: "free",
          stripeSubscriptionId: null,
          stripeSubscriptionStatus: "canceled",
        });
        console.log(`🔴 Subscription canceled for customer ${customerId}`);
      }

      return res.json({ received: true });
    } catch (error) {
      console.error("Subscription webhook processing error:", error);
      return res.status(500).json({ error: "Webhook processing failed" });
    }
  };
}
