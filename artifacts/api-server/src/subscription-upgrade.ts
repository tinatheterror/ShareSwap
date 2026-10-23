import type Stripe from "stripe";
import { db } from "@workspace/db";
import { users } from "@workspace/db";
import { PLATFORM_CURRENCY } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ensureUsableCustomer } from "./stripe-customer.js";
import { attachedCard, type CardStore } from "./card-sync";

export type PaidTier = "member" | "pro";
export const isPaidTier = (tier: unknown): tier is PaidTier => tier === "member" || tier === "pro";

const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);
/** A tier is granted only while the subscription is paid up (or in its grace period). */
export const grantsTier = (status: string | null | undefined) => !!status && LIVE_STATUSES.has(status);

export type UpgradeStripe = Pick<Stripe, "customers" | "paymentMethods" | "products" | "prices" | "subscriptions" | "paymentIntents">;

export interface UpgradeUser {
  stripeCustomerId: string | null;
  email: string | null;
  fullName: string | null;
  stripeSubscriptionId: string | null;
}

export interface UpgradeStore {
  getUser(userId: number): Promise<UpgradeUser | null>;
  setCustomer(userId: number, customerId: string): Promise<void>;
  setSubscription(
    userId: number,
    fields: { subscriptionTier?: string; stripeSubscriptionId: string | null; stripeSubscriptionStatus: string },
  ): Promise<void>;
}

export const dbUpgradeStore: UpgradeStore = {
  async getUser(userId) {
    const [row] = await db
      .select({
        stripeCustomerId: users.stripeCustomerId,
        email: users.email,
        fullName: users.fullName,
        stripeSubscriptionId: users.stripeSubscriptionId,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  },
  async setCustomer(userId, customerId) {
    await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
  },
  async setSubscription(userId, fields) {
    await db.update(users).set(fields as any).where(eq(users.id, userId));
  },
};

export type UpgradeOutcome =
  | { status: 200; body: { tier: PaidTier; subscriptionId: string; changed: boolean } }
  | { status: 402; body: { requiresAction: true; clientSecret: string; subscriptionId: string; hostedInvoiceUrl: string | null; message: string } }
  | { status: 402; body: { code: "PAYMENT_FAILED"; message: string } }
  | { status: 409; body: { code: "CARD_REQUIRED"; reason: "missing" | "stale"; message: string } }
  | { status: 400 | 404; body: { message: string } };

/** The active CAD Price for a tier's product, found by product metadata. No fallback to another currency. */
export async function findTierPrice(stripe: Pick<Stripe, "products" | "prices">, tier: PaidTier): Promise<string | null> {
  const products = await stripe.products.search({ query: `metadata['tier']:'${tier}' AND metadata['app']:'shareswap'` });
  if (!products.data.length) return null;
  const prices = await stripe.prices.list({ product: products.data[0].id, active: true, currency: PLATFORM_CURRENCY, limit: 1 });
  return prices.data[0]?.id ?? null;
}

/** Client secret and PaymentIntent for a subscription's first invoice, when it still needs the customer. */
async function pendingPayment(stripe: UpgradeStripe, subscription: Stripe.Subscription) {
  const invoice = subscription.latest_invoice;
  if (!invoice || typeof invoice === "string") return null;
  const secret = invoice.confirmation_secret?.client_secret;
  if (!secret) return null;
  const intent = await stripe.paymentIntents.retrieve(secret.split("_secret_")[0]);
  return { intent, clientSecret: secret, hostedInvoiceUrl: invoice.hosted_invoice_url ?? null };
}

const inFlight = new Map<string, Promise<UpgradeOutcome>>();

/**
 * Subscribes (or changes the plan of) a user with their saved card, in the platform currency. No saved card,
 * or one that is not attached to the user's current Stripe customer, is reported as CARD_REQUIRED and never
 * falls back to Checkout. An existing live subscription has its price changed (Stripe's default proration)
 * instead of getting a second one. Taps that arrive while one is running share its result.
 */
export function subscribeWithSavedCard(
  deps: { stripe: UpgradeStripe; store: UpgradeStore; cards: CardStore },
  userId: number,
  tier: unknown,
): Promise<UpgradeOutcome> {
  if (!isPaidTier(tier)) return Promise.resolve({ status: 400, body: { message: "Invalid tier. Must be 'member' or 'pro'" } });
  const key = `${userId}:${tier}`;
  const running = inFlight.get(key);
  if (running) return running;
  const promise = run(deps, userId, tier).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function run(deps: { stripe: UpgradeStripe; store: UpgradeStore; cards: CardStore }, userId: number, tier: PaidTier): Promise<UpgradeOutcome> {
  const { stripe, store, cards } = deps;
  const user = await store.getUser(userId);
  if (!user) return { status: 404, body: { message: "User not found" } };

  const { customerId, created } = await ensureUsableCustomer(stripe as unknown as Stripe, user.stripeCustomerId, {
    email: user.email || undefined,
    name: user.fullName || undefined,
    metadata: { userId: String(userId) },
  });
  if (created) await store.setCustomer(userId, customerId);

  const stored = (await cards.get(userId)).card;
  if (!stored) return { status: 409, body: { code: "CARD_REQUIRED", reason: "missing", message: "Please add a card" } };
  const card = await attachedCard(stripe, customerId, stored.stripePaymentMethodId);
  if (!card) {
    await cards.clear(userId);
    return { status: 409, body: { code: "CARD_REQUIRED", reason: "stale", message: "Please add a card" } };
  }

  const priceId = await findTierPrice(stripe, tier);
  if (!priceId) return { status: 404, body: { message: "Subscription plan not found. Please contact support." } };

  const metadata = { userId: String(userId), tier };

  if (user.stripeSubscriptionId) {
    let existing: Stripe.Subscription | null = null;
    try {
      existing = await stripe.subscriptions.retrieve(user.stripeSubscriptionId, { expand: ["latest_invoice.confirmation_secret"] });
    } catch (error) {
      const err = error as { statusCode?: number; code?: string };
      if (err?.statusCode !== 404 && err?.code !== "resource_missing") throw error;
    }
    if (existing && existing.customer === customerId && LIVE_STATUSES.has(existing.status)) {
      const item = existing.items.data[0];
      if (item.price.id === priceId) {
        await store.setSubscription(userId, { subscriptionTier: tier, stripeSubscriptionId: existing.id, stripeSubscriptionStatus: existing.status });
        return { status: 200, body: { tier, subscriptionId: existing.id, changed: false } };
      }
      const updated = await stripe.subscriptions.update(
        existing.id,
        { items: [{ id: item.id, price: priceId }], metadata, default_payment_method: card.id },
        { idempotencyKey: `sub-change:${userId}:${existing.id}:${priceId}` },
      );
      await store.setSubscription(userId, { subscriptionTier: tier, stripeSubscriptionId: updated.id, stripeSubscriptionStatus: updated.status });
      return { status: 200, body: { tier, subscriptionId: updated.id, changed: true } };
    }
    if (existing?.status === "incomplete") {
      const pending = await pendingPayment(stripe, existing);
      if (pending?.intent.status === "requires_action" && existing.metadata?.tier === tier) {
        return requiresAction(existing.id, pending.clientSecret, pending.hostedInvoiceUrl);
      }
      await stripe.subscriptions.cancel(existing.id);
    }
  }

  // The key includes the subscription we are replacing, so a retry after a cancelled or declined attempt is a
  // new request to Stripe while a double tap on the same state is the same one.
  const subscription = await stripe.subscriptions.create(
    {
      customer: customerId,
      items: [{ price: priceId }],
      currency: PLATFORM_CURRENCY,
      default_payment_method: card.id,
      payment_behavior: "allow_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.confirmation_secret"],
      metadata,
    },
    { idempotencyKey: `sub:${userId}:${tier}:${user.stripeSubscriptionId ?? "none"}` },
  );

  if (LIVE_STATUSES.has(subscription.status)) {
    await store.setSubscription(userId, { subscriptionTier: tier, stripeSubscriptionId: subscription.id, stripeSubscriptionStatus: subscription.status });
    return { status: 200, body: { tier, subscriptionId: subscription.id, changed: true } };
  }

  // Not paid yet: remember the subscription (no tier) so a retry finds it, then see what the payment needs.
  await store.setSubscription(userId, { stripeSubscriptionId: subscription.id, stripeSubscriptionStatus: subscription.status });
  const pending = await pendingPayment(stripe, subscription);
  if (pending?.intent.status === "requires_action") {
    return requiresAction(subscription.id, pending.clientSecret, pending.hostedInvoiceUrl);
  }
  try {
    await stripe.subscriptions.cancel(subscription.id);
    await store.setSubscription(userId, { stripeSubscriptionId: subscription.id, stripeSubscriptionStatus: "canceled" });
  } catch (error) {
    console.error("[subscription] could not cancel the unpaid subscription:", (error as Error)?.message);
  }
  return {
    status: 402,
    body: { code: "PAYMENT_FAILED", message: pending?.intent.last_payment_error?.message || "Your card was declined. Please try another card." },
  };
}

function requiresAction(subscriptionId: string, clientSecret: string, hostedInvoiceUrl: string | null): UpgradeOutcome {
  return {
    status: 402,
    body: { requiresAction: true, clientSecret, subscriptionId, hostedInvoiceUrl, message: "Your card requires additional authentication." },
  };
}

/** After the customer authenticated the payment: if the subscription is now live, grant its tier. */
export async function confirmSubscriptionPayment(
  stripe: Pick<Stripe, "subscriptions">,
  store: UpgradeStore,
  userId: number,
  subscriptionId: unknown,
): Promise<{ status: 200; body: { confirmed: boolean; tier?: PaidTier; reason?: string } } | { status: 400 | 403; body: { message: string } }> {
  if (typeof subscriptionId !== "string" || !/^sub_[A-Za-z0-9_]{1,200}$/.test(subscriptionId)) {
    return { status: 400, body: { message: "Invalid subscription id" } };
  }
  const user = await store.getUser(userId);
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  if (!user?.stripeCustomerId || customerId !== user.stripeCustomerId || subscription.metadata?.userId !== String(userId)) {
    return { status: 403, body: { message: "This subscription does not belong to you" } };
  }
  const tier = subscription.metadata?.tier;
  if (!isPaidTier(tier)) return { status: 200, body: { confirmed: false, reason: "unknown_tier" } };
  if (!LIVE_STATUSES.has(subscription.status)) return { status: 200, body: { confirmed: false, reason: subscription.status } };
  await store.setSubscription(userId, { subscriptionTier: tier, stripeSubscriptionId: subscription.id, stripeSubscriptionStatus: subscription.status });
  return { status: 200, body: { confirmed: true, tier } };
}
