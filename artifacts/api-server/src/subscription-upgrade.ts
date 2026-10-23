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

export type UpgradeStripe = Pick<Stripe, "customers" | "paymentMethods" | "products" | "prices" | "subscriptions" | "paymentIntents" | "subscriptionSchedules" | "invoices">;

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
  | { status: 200; body: { tier: PaidTier; subscriptionId: string; changed: boolean; scheduledFor?: string } }
  | { status: 402; body: { requiresAction: true; clientSecret: string; subscriptionId: string; hostedInvoiceUrl: string | null; message: string } }
  | { status: 402; body: { code: "PAYMENT_FAILED"; message: string } }
  | { status: 409; body: { code: "CARD_REQUIRED"; reason: "missing" | "stale"; message: string } }
  | { status: 400 | 404; body: { message: string } };

/** The active CAD Price for a tier's product, found by product metadata. No fallback to another currency. */
export async function findTierPrice(stripe: Pick<Stripe, "products" | "prices">, tier: PaidTier): Promise<{ id: string; unitAmount: number } | null> {
  const products = await stripe.products.search({ query: `metadata['tier']:'${tier}' AND metadata['app']:'shareswap'` });
  if (!products.data.length) return null;
  const prices = await stripe.prices.list({ product: products.data[0].id, active: true, currency: PLATFORM_CURRENCY, limit: 1 });
  const price = prices.data[0];
  return price ? { id: price.id, unitAmount: price.unit_amount ?? 0 } : null;
}

/** The user's live (paid-up) subscription on their current customer, if any. */
async function liveSubscription(stripe: UpgradeStripe, subscriptionId: string | null, customerId: string) {
  if (!subscriptionId) return null;
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice.confirmation_secret"] });
    return sub.customer === customerId && LIVE_STATUSES.has(sub.status) ? sub : null;
  } catch (error) {
    const err = error as { statusCode?: number; code?: string };
    if (err?.statusCode === 404 || err?.code === "resource_missing") return null;
    throw error;
  }
}

const periodEnd = (sub: Stripe.Subscription): number | null =>
  (sub.items.data[0] as any)?.current_period_end ?? (sub as any).current_period_end ?? null;

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

  const price = await findTierPrice(stripe, tier);
  if (!price) return { status: 404, body: { message: "Subscription plan not found. Please contact support." } };
  const priceId = price.id;

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
      // A pending end-of-period change (a schedule) is dropped first: the user's latest choice wins.
      if (existing.schedule) {
        await stripe.subscriptionSchedules.release(typeof existing.schedule === "string" ? existing.schedule : existing.schedule.id);
      }
      if (item.price.id === priceId) {
        await store.setSubscription(userId, { subscriptionTier: tier, stripeSubscriptionId: existing.id, stripeSubscriptionStatus: existing.status });
        return { status: 200, body: { tier, subscriptionId: existing.id, changed: false } };
      }

      // Moving to a cheaper plan waits for the end of the paid period: nothing is refunded and the user keeps
      // what they paid for. Moving up charges the prorated difference now.
      if (price.unitAmount < (item.price.unit_amount ?? 0)) {
        const effective = periodEnd(existing);
        const schedule = await stripe.subscriptionSchedules.create({ from_subscription: existing.id });
        const current = schedule.phases[0];
        await stripe.subscriptionSchedules.update(schedule.id, {
          end_behavior: "release",
          phases: [
            { items: [{ price: item.price.id, quantity: 1 }], start_date: current.start_date, end_date: current.end_date, proration_behavior: "none" },
            { items: [{ price: priceId, quantity: 1 }], duration: { interval: "month", interval_count: 1 }, proration_behavior: "none", metadata },
          ],
        });
        return {
          status: 200,
          body: { tier, subscriptionId: existing.id, changed: true, scheduledFor: effective ? new Date(effective * 1000).toISOString() : undefined },
        };
      }

      let updated: Stripe.Subscription;
      try {
        updated = await stripe.subscriptions.update(
          existing.id,
          {
            items: [{ id: item.id, price: priceId }],
            metadata,
            default_payment_method: card.id,
            proration_behavior: "always_invoice",
            payment_behavior: "error_if_incomplete",
          },
          { idempotencyKey: `sub-change:${userId}:${existing.id}:${priceId}` },
        );
      } catch (error) {
        const err = error as { type?: string; message?: string };
        if (err?.type === "StripeCardError") {
          return { status: 402, body: { code: "PAYMENT_FAILED", message: err.message || "Your card was declined. Please try another card." } };
        }
        throw error;
      }
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

/** A plan change waiting for the end of the paid period (an active subscription schedule), if there is one. */
export async function pendingPlanChange(
  stripe: Pick<Stripe, "subscriptions">,
  subscriptionId: string | null | undefined,
): Promise<{ tier: PaidTier; effectiveAt: string } | null> {
  if (!subscriptionId) return null;
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["schedule"] });
    const schedule = sub.schedule;
    if (!schedule || typeof schedule === "string" || schedule.status !== "active" || schedule.phases.length < 2) return null;
    const next = schedule.phases[1];
    const tier = next.metadata?.tier;
    if (!isPaidTier(tier)) return null;
    const startsAt = next.start_date ?? schedule.phases[0].end_date;
    return startsAt ? { tier, effectiveAt: new Date(startsAt * 1000).toISOString() } : null;
  } catch (error) {
    console.warn("[subscription] could not read the pending plan change:", (error as Error)?.message);
    return null;
  }
}

/** Drops a plan change waiting for the end of the period ("Keep Pro"). No card needed; nothing is charged. */
export async function keepCurrentPlan(
  stripe: Pick<Stripe, "subscriptions" | "subscriptionSchedules">,
  store: UpgradeStore,
  userId: number,
): Promise<{ status: 200; body: { released: boolean } } | { status: 404; body: { message: string } }> {
  const user = await store.getUser(userId);
  if (!user?.stripeCustomerId || !user.stripeSubscriptionId) return { status: 404, body: { message: "No subscription found" } };
  const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  if (customerId !== user.stripeCustomerId) return { status: 404, body: { message: "No subscription found" } };
  if (!sub.schedule) return { status: 200, body: { released: false } };
  await stripe.subscriptionSchedules.release(typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id);
  return { status: 200, body: { released: true } };
}

export interface PlanPreview {
  tier: PaidTier;
  currency: string;
  /** The plan's monthly price, in cents. */
  priceCents: number;
  /** What this change charges right now, in cents; null if Stripe could not preview it. */
  amountDueTodayCents: number | null;
  /** "new" first subscription, "upgrade" charged now with proration, "downgrade" at the end of the period. */
  change: "new" | "upgrade" | "downgrade" | "same";
  /** When a downgrade takes effect. */
  effectiveAt?: string;
}

/** What choosing `tier` would do and cost, for the confirm sheet. Changes nothing. */
export async function previewPlanChange(
  deps: { stripe: UpgradeStripe; store: UpgradeStore },
  userId: number,
  tier: unknown,
): Promise<{ status: 200; body: PlanPreview } | { status: 400 | 404; body: { message: string } }> {
  if (!isPaidTier(tier)) return { status: 400, body: { message: "Invalid tier. Must be 'member' or 'pro'" } };
  const { stripe, store } = deps;
  const user = await store.getUser(userId);
  if (!user) return { status: 404, body: { message: "User not found" } };
  const price = await findTierPrice(stripe, tier);
  if (!price) return { status: 404, body: { message: "Subscription plan not found." } };
  const base = { tier, currency: PLATFORM_CURRENCY, priceCents: price.unitAmount };

  const existing = user.stripeCustomerId ? await liveSubscription(stripe, user.stripeSubscriptionId, user.stripeCustomerId) : null;
  if (!existing) return { status: 200, body: { ...base, change: "new", amountDueTodayCents: price.unitAmount } };

  const item = existing.items.data[0];
  const currentAmount = item.price.unit_amount ?? 0;
  if (item.price.id === price.id) return { status: 200, body: { ...base, change: "same", amountDueTodayCents: 0 } };
  if (price.unitAmount < currentAmount) {
    const end = periodEnd(existing);
    return { status: 200, body: { ...base, change: "downgrade", amountDueTodayCents: 0, effectiveAt: end ? new Date(end * 1000).toISOString() : undefined } };
  }
  try {
    const invoice = await stripe.invoices.createPreview({
      customer: user.stripeCustomerId!,
      subscription: existing.id,
      subscription_details: { items: [{ id: item.id, price: price.id }], proration_behavior: "always_invoice" },
    });
    return { status: 200, body: { ...base, change: "upgrade", amountDueTodayCents: invoice.amount_due } };
  } catch (error) {
    console.warn("[subscription] plan change preview failed:", (error as Error)?.message);
    return { status: 200, body: { ...base, change: "upgrade", amountDueTodayCents: null } };
  }
}
