import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { confirmSubscriptionPayment, subscribeWithSavedCard, type UpgradeStore } from "./subscription-upgrade";
import type { CardStore } from "./card-sync";

const warn = console.warn;
console.warn = () => {};
process.on("exit", () => (console.warn = warn));

const PRICES: Record<string, string> = { member: "price_member", pro: "price_pro" };
const card = (customer: string | null = "cus_1") => ({ id: "pm_1", customer, card: { last4: "4242", brand: "visa", exp_month: 12, exp_year: 2030 } });

interface Opts {
  storedCard?: boolean;
  pm?: unknown;
  existingSub?: any;
  createStatus?: string;
  intentStatus?: string;
  customerCurrency?: string;
}

function setup(o: Opts = {}) {
  const log = { created: [] as any[], updated: [] as any[], cancelled: [] as string[], store: [] as any[], cleared: 0, customersCreated: 0 };
  const keys = new Map<string, any>();
  const subs = new Map<string, any>();
  if (o.existingSub) subs.set(o.existingSub.id, o.existingSub);
  let n = 0;
  const stripe = {
    customers: {
      retrieve: async (id: string) => ({ id, currency: o.customerCurrency ?? null }),
      create: async () => ({ id: `cus_new_${++log.customersCreated}` }),
    },
    paymentMethods: { retrieve: async (id: string) => { if (!o.pm && o.pm !== undefined) throw Object.assign(new Error("gone"), { statusCode: 404 }); return o.pm ?? card(); } },
    products: { search: async (q: { query: string }) => ({ data: [{ id: `prod_${/\['tier'\]:'(\w+)'/.exec(q.query)![1]}` }] }) },
    prices: { list: async ({ product, currency }: any) => { assert.equal(currency, "cad"); return { data: [{ id: PRICES[product.replace("prod_", "")] }] }; } },
    paymentIntents: { retrieve: async (id: string) => ({ id, status: o.intentStatus ?? "requires_action", last_payment_error: o.intentStatus === "requires_payment_method" ? { message: "Your card was declined." } : null }) },
    subscriptions: {
      retrieve: async (id: string) => { const s = subs.get(id); if (!s) throw Object.assign(new Error("none"), { statusCode: 404 }); return s; },
      create: async (params: any, opts: { idempotencyKey: string }) => {
        if (keys.has(opts.idempotencyKey)) return keys.get(opts.idempotencyKey);
        log.created.push({ params, key: opts.idempotencyKey });
        await new Promise((r) => setTimeout(r, 5));
        const status = o.createStatus ?? "active";
        const sub = {
          id: `sub_${++n}`, status, customer: params.customer, metadata: params.metadata,
          items: { data: [{ id: "si_1", price: { id: params.items[0].price } }] },
          latest_invoice: { hosted_invoice_url: "https://invoice.stripe.test/i", confirmation_secret: { client_secret: `pi_${n}_secret_abc` } },
        };
        subs.set(sub.id, sub);
        keys.set(opts.idempotencyKey, sub);
        return sub;
      },
      update: async (id: string, params: any) => {
        log.updated.push({ id, params });
        const s = subs.get(id);
        s.items.data[0].price.id = params.items[0].price;
        return s;
      },
      cancel: async (id: string) => { log.cancelled.push(id); subs.get(id).status = "canceled"; return subs.get(id); },
    },
  } as any;
  let current = { stripeCustomerId: "cus_1" as string | null, email: "a@b.c", fullName: "A B", stripeSubscriptionId: (o.existingSub?.id ?? null) as string | null };
  const store: UpgradeStore = {
    getUser: async () => ({ ...current }),
    setCustomer: async (_u, id) => void (current.stripeCustomerId = id),
    setSubscription: async (_u, f) => { log.store.push(f); current.stripeSubscriptionId = f.stripeSubscriptionId; },
  };
  const cards: CardStore = {
    get: async () => ({ stripeCustomerId: current.stripeCustomerId, card: o.storedCard === false ? null : { stripePaymentMethodId: "pm_1", paymentMethodLast4: "4242", paymentMethodBrand: "visa", paymentMethodExpMonth: 12, paymentMethodExpYear: 2030 } }),
    update: async () => {},
    clear: async () => void log.cleared++,
  };
  return { deps: { stripe, store, cards }, log, subs };
}

test("success: creates one CAD subscription with the saved card and sets the tier at once", async () => {
  const { deps, log } = setup();
  const r = await subscribeWithSavedCard(deps, 7, "pro");
  assert.equal(r.status, 200);
  assert.deepEqual((r.body as any).tier, "pro");
  assert.equal(log.created.length, 1);
  const { params, key } = log.created[0];
  assert.equal(params.customer, "cus_1");
  assert.equal(params.default_payment_method, "pm_1");
  assert.equal(params.currency, "cad");
  assert.deepEqual(params.items, [{ price: "price_pro" }]);
  assert.equal(key, "sub:7:pro:none");
  assert.deepEqual(log.store.at(-1), { subscriptionTier: "pro", stripeSubscriptionId: "sub_1", stripeSubscriptionStatus: "active" });
});

test("requires_action: returns the client secret and leaves the tier alone", async () => {
  const { deps, log } = setup({ createStatus: "incomplete", intentStatus: "requires_action" });
  const r = await subscribeWithSavedCard(deps, 7, "member");
  assert.equal(r.status, 402);
  const body = r.body as any;
  assert.equal(body.requiresAction, true);
  assert.equal(body.clientSecret, "pi_1_secret_abc");
  assert.equal(body.subscriptionId, "sub_1");
  assert.equal(body.hostedInvoiceUrl, "https://invoice.stripe.test/i");
  assert.ok(log.store.every((f) => !("subscriptionTier" in f)));
  assert.deepEqual(log.cancelled, []);
});

test("a declined card reports PAYMENT_FAILED and cancels the unpaid subscription", async () => {
  const { deps, log } = setup({ createStatus: "incomplete", intentStatus: "requires_payment_method" });
  const r = await subscribeWithSavedCard(deps, 7, "member");
  assert.equal(r.status, 402);
  assert.equal((r.body as any).code, "PAYMENT_FAILED");
  assert.deepEqual(log.cancelled, ["sub_1"]);
  assert.ok(log.store.every((f) => !("subscriptionTier" in f)));
});

test("no saved card: asks for a card and creates nothing (no Checkout fallback)", async () => {
  const { deps, log } = setup({ storedCard: false });
  const r = await subscribeWithSavedCard(deps, 7, "pro");
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { code: "CARD_REQUIRED", reason: "missing", message: "Please add a card" });
  assert.equal(log.created.length, 0);
});

test("stale card (gone, or on another customer): asks for a card, clears the stored one, creates nothing", async () => {
  for (const pm of [null, card("cus_other"), card(null)]) {
    const { deps, log } = setup({ pm: pm as any });
    const r = await subscribeWithSavedCard(deps, 7, "pro");
    assert.equal(r.status, 409);
    assert.equal((r.body as any).reason, "stale");
    assert.equal(log.cleared, 1);
    assert.equal(log.created.length, 0);
  }
});

test("a replaced Stripe customer means the old card is stale", async () => {
  const { deps, log } = setup({ customerCurrency: "usd" });
  const r = await subscribeWithSavedCard(deps, 7, "pro");
  assert.equal(r.status, 409);
  assert.equal(log.customersCreated, 1);
  assert.equal(log.created.length, 0);
});

test("a double tap creates only one subscription", async () => {
  const { deps, log } = setup();
  const [a, b] = await Promise.all([subscribeWithSavedCard(deps, 7, "pro"), subscribeWithSavedCard(deps, 7, "pro")]);
  assert.equal(log.created.length, 1);
  assert.deepEqual(a, b);
  const c = await subscribeWithSavedCard(deps, 7, "pro");
  assert.equal(log.created.length, 1);
  assert.equal((c.body as any).changed, false);
});

test("Member to Pro changes the existing subscription's price with default proration, no second subscription", async () => {
  const existing = { id: "sub_9", status: "active", customer: "cus_1", metadata: { userId: "7", tier: "member" }, items: { data: [{ id: "si_1", price: { id: "price_member" } }] } };
  const { deps, log } = setup({ existingSub: existing });
  const r = await subscribeWithSavedCard(deps, 7, "pro");
  assert.equal(r.status, 200);
  assert.equal(log.created.length, 0);
  assert.equal(log.updated.length, 1);
  assert.deepEqual(log.updated[0].params.items, [{ id: "si_1", price: "price_pro" }]);
  assert.ok(!("proration_behavior" in log.updated[0].params));
  assert.deepEqual(log.store.at(-1), { subscriptionTier: "pro", stripeSubscriptionId: "sub_9", stripeSubscriptionStatus: "active" });
  const back = await subscribeWithSavedCard(deps, 7, "member");
  assert.equal((back.body as any).tier, "member");
  assert.equal(log.created.length, 0);
  assert.equal(log.updated.length, 2);
});

test("a retry after a declined attempt is a new Stripe request, not the cached one", async () => {
  const first = setup({ createStatus: "incomplete", intentStatus: "requires_payment_method" });
  await subscribeWithSavedCard(first.deps, 7, "member");
  await subscribeWithSavedCard(first.deps, 7, "member");
  assert.deepEqual(first.log.created.map((c) => c.key), ["sub:7:member:none", "sub:7:member:sub_1"]);
});

test("invalid tiers are rejected", async () => {
  const { deps } = setup();
  assert.equal((await subscribeWithSavedCard(deps, 7, "free")).status, 400);
  assert.equal((await subscribeWithSavedCard(deps, 7, undefined)).status, 400);
});

test("after in-app authentication, confirm grants the tier only for the user's own live subscription", async () => {
  const sub = (over: any = {}) => ({ id: "sub_1", status: "active", customer: "cus_1", metadata: { userId: "7", tier: "pro" }, ...over });
  const run = async (s: any, id: unknown = "sub_1") => {
    const writes: any[] = [];
    const store: UpgradeStore = { getUser: async () => ({ stripeCustomerId: "cus_1", email: null, fullName: null, stripeSubscriptionId: "sub_1" }), setCustomer: async () => {}, setSubscription: async (_u, f) => void writes.push(f) };
    return { r: await confirmSubscriptionPayment({ subscriptions: { retrieve: async () => s } } as any, store, 7, id), writes };
  };
  const ok = await run(sub());
  assert.deepEqual(ok.r, { status: 200, body: { confirmed: true, tier: "pro" } });
  assert.equal(ok.writes.length, 1);
  assert.equal((await run(sub({ status: "incomplete" }))).writes.length, 0);
  assert.equal((await run(sub({ customer: "cus_other" }))).r.status, 403);
  assert.equal((await run(sub({ metadata: { userId: "8", tier: "pro" } }))).r.status, 403);
  assert.equal((await run(sub(), "cs_x")).r.status, 400);
});
