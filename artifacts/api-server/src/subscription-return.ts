import type { Request, Response } from "express";
import type Stripe from "stripe";
import { db } from "@workspace/db";
import { users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { tierOfSubscription } from "./subscription-upgrade";

export const APP_SCHEME = "shareswap";
export const RETURN_PATH = "/api/subscription/return";
const DEFAULT_APP_LINKS = {
  success: `${APP_SCHEME}://subscription?sub_success=true`,
  canceled: `${APP_SCHEME}://subscription?sub_canceled=true`,
  done: `${APP_SCHEME}://subscription`,
} as const;
export type ReturnResult = keyof typeof DEFAULT_APP_LINKS;

const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]{1,200}$/;
const OWN_HOSTS = ["shareswap.app", "www.shareswap.app"];

/** Our own domains: the production ones plus the Replit hostnames this workspace is served from. */
export function ownHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const hosts = new Set(OWN_HOSTS);
  const extra = [env.REPLIT_DEV_DOMAIN, ...(env.REPLIT_DOMAINS ?? "").split(",")];
  for (const h of extra) if (h?.trim()) hosts.add(h.trim().toLowerCase());
  return hosts;
}

function parse(raw: unknown): URL | null {
  if (typeof raw !== "string" || !raw || raw.length > 2048) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** True for our own app scheme or an https link on one of our own domains. Nothing else may be redirected to. */
export function isAllowedAppLink(raw: unknown, hosts: Set<string> = ownHosts()): boolean {
  const url = parse(raw);
  if (!url || url.username || url.password) return false;
  if (url.protocol === `${APP_SCHEME}:`) return true;
  return url.protocol === "https:" && hosts.has(url.hostname.toLowerCase());
}

/**
 * The URL Stripe is given for one side of checkout. Stripe only accepts http(s), so an app link (or anything
 * else the client sends) goes through the return route, which carries an allowed app link through. An https
 * link on our own domains is used as is; anything else falls back to `fallback`.
 */
export function stripeReturnUrl(opts: {
  clientUrl: unknown;
  result: ReturnResult;
  baseUrl: string;
  fallback: string;
  hosts?: Set<string>;
}): string {
  const hosts = opts.hosts ?? ownHosts();
  const url = parse(opts.clientUrl);
  if (!url || !isAllowedAppLink(opts.clientUrl, hosts)) return opts.fallback;
  if (url.protocol === "https:") return url.href;
  let out = `${opts.baseUrl}${RETURN_PATH}?result=${opts.result}&app=${encodeURIComponent(url.href)}`;
  // Stripe substitutes this placeholder, so it must stay unencoded.
  if (opts.result === "success") out += "&session_id={CHECKOUT_SESSION_ID}";
  return out;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Where the bounce page sends the browser, or null when the request is malformed. */
export function resolveReturnTarget(query: Record<string, unknown>, hosts: Set<string> = ownHosts()): string | null {
  const result = query.result;
  if (result !== "success" && result !== "canceled" && result !== "done") return null;
  const app = parse(query.app);
  const target = app && isAllowedAppLink(query.app, hosts) ? app : new URL(DEFAULT_APP_LINKS[result]);
  const sessionId = query.session_id;
  if (result === "success" && typeof sessionId === "string" && CHECKOUT_SESSION_ID.test(sessionId)) {
    target.searchParams.set("session_id", sessionId);
  }
  return target.href;
}

/** GET handler: redirects to the app, with an HTML page holding an "Open ShareSwap" link in case that is blocked. */
export function subscriptionReturnHandler(deps: { getHosts?: () => Set<string> } = {}) {
  return (req: Request, res: Response): void => {
    const target = resolveReturnTarget(req.query as Record<string, unknown>, (deps.getHosts ?? ownHosts)());
    if (!target) {
      res.status(400).type("text/plain").send("Invalid return link");
      return;
    }
    const href = escapeHtml(target);
    res
      .status(302)
      .set({ Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" })
      .type("html")
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
          `<meta name="viewport" content="width=device-width,initial-scale=1"><title>Back to ShareSwap</title></head>` +
          `<body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 16px">` +
          `<p>Returning to ShareSwap…</p>` +
          `<p><a href="${href}" style="display:inline-block;padding:12px 24px;border-radius:8px;background:#0d9488;color:#fff;text-decoration:none">Open ShareSwap</a></p>` +
          `</body></html>`,
      );
  };
}

export type ConfirmStripe = {
  checkout: { sessions: Pick<Stripe["checkout"]["sessions"], "retrieve"> };
  subscriptions: Pick<Stripe["subscriptions"], "retrieve">;
};

export interface ConfirmStore {
  getStripeCustomerId(userId: number): Promise<string | null>;
  setSubscription(userId: number, fields: { subscriptionTier: string; stripeSubscriptionId: string | null; stripeSubscriptionStatus: string }): Promise<void>;
}

export const dbConfirmStore: ConfirmStore = {
  async getStripeCustomerId(userId) {
    const [row] = await db.select({ id: users.stripeCustomerId }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.id ?? null;
  },
  async setSubscription(userId, fields) {
    await db.update(users).set(fields as any).where(eq(users.id, userId));
  },
};

export type ConfirmOutcome =
  | { status: 200; body: { confirmed: true; tier: string } | { confirmed: false; reason: string } }
  | { status: 400 | 403; body: { message: string } };

/**
 * Reads the Checkout session back from Stripe and, if it is a completed, paid session that belongs to this user,
 * sets their tier. The webhook stays the main path; this makes the upgrade show at once, and works where
 * webhooks do not arrive. Both paths write the same fields, so running both is harmless.
 */
export async function confirmCheckoutSession(
  stripe: ConfirmStripe,
  store: ConfirmStore,
  userId: number,
  sessionId: unknown,
): Promise<ConfirmOutcome> {
  if (typeof sessionId !== "string" || !CHECKOUT_SESSION_ID.test(sessionId)) {
    return { status: 400, body: { message: "Invalid session id" } };
  }
  // Stripe allows four levels of expansion, and the product is five below a session, so the subscription is read separately.
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const ownedByMetadata = session.metadata?.userId === String(userId);
  const ownedByCustomer = !!customerId && customerId === (await store.getStripeCustomerId(userId));
  if (!ownedByMetadata || !ownedByCustomer) {
    return { status: 403, body: { message: "This checkout session does not belong to you" } };
  }

  if (session.mode !== "subscription") return { status: 200, body: { confirmed: false, reason: "not_subscription" } };
  if (session.status !== "complete") return { status: 200, body: { confirmed: false, reason: "not_complete" } };
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    return { status: 200, body: { confirmed: false, reason: "not_paid" } };
  }
  // The tier is what the session's subscription is on now, not what the session recorded when it was created:
  // an old session must not be able to put a user back on a plan they have since left.
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  const subscription = subscriptionId
    ? await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price.product"] })
    : null;
  const tier = subscription ? tierOfSubscription(subscription) : null;
  if (!subscription || !tier) return { status: 200, body: { confirmed: false, reason: "unknown_tier" } };
  if (!["active", "trialing", "past_due"].includes(subscription.status)) {
    return { status: 200, body: { confirmed: false, reason: subscription.status } };
  }
  await store.setSubscription(userId, {
    subscriptionTier: tier,
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
  });
  return { status: 200, body: { confirmed: true, tier } };
}
