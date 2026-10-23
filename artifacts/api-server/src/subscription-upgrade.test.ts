import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { confirmSubscriptionPayment, pendingPlanChange, previewPlanChange, subscribeWithSavedCard, type UpgradeStore } from "./subscription-upgrade";
import type { CardStore } from "./card-sync";

const warn = console.warn;
console.warn = () => {};
process.on("exit", () => (console.warn = warn));

const PRICES: Record<string, string> = { member: "price_member", pro: "price_pro" };
const AMOUNTS: Record<string, number> = { member: 499, pro: 999 };
const card = (customer: string | null = "cus_1") => ({ id: "pm_1", customer, card: { last4: "4242", brand: "visa", exp_month: 12, exp_year: 2030 } });

interface Opts {
  updateError?: Error;
  previewError?: Error;
  storedCard?: boolean;
  pm?: unknown;
  existingSub?: any;
  createStatus?: string;
  intentStatus?: string;
  customerCurrency?: string;
}

function setup(o: Opts = {}) {
  const log = { created: [] as any[], updated: [] as any[], cancelled: [] as string[], store: [] as any[], cleared: 0, customersCreated: 0, schedules: [] as any[], scheduleUpdates: [] as any[], released: [] as string[], previews: [] as any[] };
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
    prices: { list: async ({ product, currency }: any) => { assert.equal(currency, "cad"); const t = product.replace("prod_", ""); return { data: [{ id: PRICES[t], unit_amount: AMOUNTS[t] }] }; } },
    paymentIntents: { retrieve: async (id: string) => ({ id, status: o.intentStatus ?? "requires_action", last_payment_error: o.intentStatus === "requires_payment_method" ? { message: "Your card was declined." } : null }) },
    subscriptionSchedules: {
      create: async (params: any) => { log.schedules.push(params); return { id: "sched_1", phases: [{ start_date: 1000, end_date: 2000 }] }; },
      update: async (id: string, params: any) => void log.scheduleUpdates.push({ id, params }),
      release: async (id: string) => void log.released.push(id),
    },
    invoices: {
      createPreview: async (params: any) => { if (o.previewError) throw o.previewError; log.previews.push(params); return { amount_due: 321 }; },
    },
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
        if (o.updateError) throw o.updateError;
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
  const existing = { id: "sub_9", status: "active", customer: "cus_1", metadata: { userId: "7", tier: "member" }, items: { data: [{ id: "si_1", price: { id: "price_member", unit_amount: 499 }, current_period_end: 2000 }] } };
  const { deps, log } = setup({ existingSub: existing });
  const r = await subscribeWithSavedCard(deps, 7, "pro");
  assert.equal(r.status, 200);
  assert.equal(log.created.length, 0);
  assert.equal(log.updated.length, 1);
  assert.deepEqual(log.updated[0].params.items, [{ id: "si_1", price: "price_pro" }]);
  // The prorated difference is charged now, and a declined charge must not change the plan.
  assert.equal(log.updated[0].params.proration_behavior, "always_invoice");
  assert.equal(log.updated[0].params.payment_behavior, "error_if_incomplete");
  assert.deepEqual(log.store.at(-1), { subscriptionTier: "pro", stripeSubscriptionId: "sub_9", stripeSubscriptionStatus: "active" });
});

test("Pro to Member waits for the end of the period: a schedule, no update, no refund, the tier stays Pro", async () => {
  const existing = { id: "sub_9", status: "active", customer: "cus_1", metadata: { userId: "7", tier: "pro" }, items: { data: [{ id: "si_1", price: { id: "price_pro", unit_amount: 999 }, current_period_end: 2000 }] } };
  const { deps, log } = setup({ existingSub: existing });
  const r = await subscribeWithSavedCard(deps, 7, "member");
  assert.equal(r.status, 200);
  assert.equal((r.body as any).scheduledFor, new Date(2000 * 1000).toISOString());
  assert.equal(log.updated.length, 0);
  assert.equal(log.created.length, 0);
  assert.deepEqual(log.schedules, [{ from_subscription: "sub_9" }]);
  const { phases, end_behavior } = log.scheduleUpdates[0].params;
  assert.equal(end_behavior, "release");
  assert.deepEqual(phases.map((p: any) => p.items[0].price), ["price_pro", "price_member"]);
  assert.ok(phases.every((p: any) => p.proration_behavior === "none"));
  assert.equal(phases[0].end_date, 2000);
  assert.ok(log.store.every((f) => !("subscriptionTier" in f)), "the tier is not changed now; the webhook moves it when the phase starts");
});

test("choosing the current plan again drops a pending end-of-period change", async () => {
  const existing = { id: "sub_9", status: "active", customer: "cus_1", schedule: "sched_7", metadata: { userId: "7", tier: "pro" }, items: { data: [{ id: "si_1", price: { id: "price_pro", unit_amount: 999 }, current_period_end: 2000 }] } };
  const { deps, log } = setup({ existingSub: existing });
  const r = await subscribeWithSavedCard(deps, 7, "pro");
  assert.deepEqual(log.released, ["sched_7"]);
  assert.equal((r.body as any).changed, false);
  assert.equal(log.schedules.length, 0);
});

test("a declined card on an upgrade reports PAYMENT_FAILED and leaves the plan alone", async () => {
  const existing = { id: "sub_9", status: "active", customer: "cus_1", metadata: { userId: "7", tier: "member" }, items: { data: [{ id: "si_1", price: { id: "price_member", unit_amount: 499 }, current_period_end: 2000 }] } };
  const { deps, log } = setup({ existingSub: existing, updateError: Object.assign(new Error("Your card was declined."), { type: "StripeCardError" }) });
  const r = await subscribeWithSavedCard(deps, 7, "pro");
  assert.equal(r.status, 402);
  assert.equal((r.body as any).code, "PAYMENT_FAILED");
  assert.deepEqual(log.store, []);
});

test("preview: new subscription, upgrade (Stripe's amount due now), downgrade (nothing now, date), same", async () => {
  const fresh = setup();
  const n = await previewPlanChange(fresh.deps, 7, "pro");
  assert.deepEqual(n.body, { tier: "pro", currency: "cad", priceCents: 999, change: "new", amountDueTodayCents: 999 });

  const member = { id: "sub_9", status: "active", customer: "cus_1", items: { data: [{ id: "si_1", price: { id: "price_member", unit_amount: 499 }, current_period_end: 2000 }] } };
  const up = setup({ existingSub: member });
  const u = await previewPlanChange(up.deps, 7, "pro");
  assert.deepEqual(u.body, { tier: "pro", currency: "cad", priceCents: 999, change: "upgrade", amountDueTodayCents: 321 });
  assert.equal(up.log.previews[0].subscription_details.proration_behavior, "always_invoice");
  assert.deepEqual(up.log.previews[0].subscription_details.items, [{ id: "si_1", price: "price_pro" }]);
  assert.equal(up.log.updated.length + up.log.created.length, 0, "a preview changes nothing");

  const broken = setup({ existingSub: member, previewError: new Error("stripe down") });
  assert.equal(((await previewPlanChange(broken.deps, 7, "pro")).body as any).amountDueTodayCents, null);

  const pro = { ...member, items: { data: [{ id: "si_1", price: { id: "price_pro", unit_amount: 999 }, current_period_end: 2000 }] } };
  const down = await previewPlanChange(setup({ existingSub: pro }).deps, 7, "member");
  assert.deepEqual(down.body, { tier: "member", currency: "cad", priceCents: 499, change: "downgrade", amountDueTodayCents: 0, effectiveAt: new Date(2000 * 1000).toISOString() });
  assert.equal(((await previewPlanChange(setup({ existingSub: pro }).deps, 7, "pro")).body as any).change, "same");
  assert.equal((await previewPlanChange(fresh.deps, 7, "free")).status, 400);
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

test("pendingPlanChange reports a scheduled downgrade and its date, and nothing otherwise", async () => {
  const withSchedule = (schedule: unknown) => ({ subscriptions: { retrieve: async () => ({ id: "sub_9", schedule }) } }) as any;
  const active = { status: "active", phases: [{ start_date: 1000, end_date: 2000 }, { start_date: 2000, metadata: { tier: "member" } }] };
  assert.deepEqual(await pendingPlanChange(withSchedule(active), "sub_9"), { tier: "member", effectiveAt: new Date(2000 * 1000).toISOString() });
  assert.equal(await pendingPlanChange(withSchedule(null), "sub_9"), null);
  assert.equal(await pendingPlanChange(withSchedule({ ...active, status: "released" }), "sub_9"), null);
  assert.equal(await pendingPlanChange(withSchedule({ ...active, phases: [active.phases[0]] }), "sub_9"), null);
  assert.equal(await pendingPlanChange(withSchedule(active), null), null);
  const broken = { subscriptions: { retrieve: async () => { throw new Error("stripe down"); } } } as any;
  assert.equal(await pendingPlanChange(broken, "sub_9"), null);
});
