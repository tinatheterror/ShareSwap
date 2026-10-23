import assert from "node:assert/strict";
import { test } from "node:test";
import { attachAsDefault, CardOwnershipError, cardIsUsableBeforeCharge, syncCardWithStripe, type CardFields, type CardStore } from "./card-sync";

const missing = Object.assign(new Error("No such PaymentMethod"), { statusCode: 404, code: "resource_missing" });
const card = (id: string, last4: string, customer: string | null = "cus_1") => ({ id, customer, card: { last4, brand: "visa", exp_month: 12, exp_year: 2030 } });
const fields = (id: string, last4: string): CardFields => ({ stripePaymentMethodId: id, paymentMethodLast4: last4, paymentMethodBrand: "visa", paymentMethodExpMonth: 12, paymentMethodExpYear: 2030 });

function setup(opts: { stored?: CardFields | null; customerId?: string | null; customer?: unknown; pms?: Record<string, unknown>; customerError?: Error }) {
  const calls = { cleared: 0, updated: [] as CardFields[], attached: [] as unknown[], customerUpdates: [] as unknown[], detached: [] as string[] };
  const store: CardStore = {
    get: async () => ({ stripeCustomerId: opts.customerId === undefined ? "cus_1" : opts.customerId, card: opts.stored === undefined ? fields("pm_old", "4242") : opts.stored }),
    update: async (_u, c) => void calls.updated.push(c),
    clear: async () => void calls.cleared++,
  };
  const stripe = {
    customers: {
      retrieve: async () => {
        if (opts.customerError) throw opts.customerError;
        return opts.customer ?? { id: "cus_1", invoice_settings: { default_payment_method: null } };
      },
      update: async (id: string, params: unknown) => void calls.customerUpdates.push({ id, params }),
    },
    paymentMethods: {
      retrieve: async (id: string) => {
        const pm = (opts.pms ?? { pm_old: card("pm_old", "4242") })[id];
        if (!pm) throw missing;
        return pm;
      },
      attach: async (id: string, params: unknown) => void calls.attached.push({ id, params }),
      detach: async (id: string) => void calls.detached.push(id),
    },
  } as any;
  return { stripe, store, calls };
}

test("a stored card Stripe no longer has is cleared (card fields and verified status)", async () => {
  const { stripe, store, calls } = setup({ pms: {} });
  assert.deepEqual(await syncCardWithStripe(stripe, store, 1), { state: "cleared" });
  assert.equal(calls.cleared, 1);
});

test("a card detached, or attached to another customer, is cleared", async () => {
  for (const pm of [card("pm_old", "4242", null), card("pm_old", "4242", "cus_other")]) {
    const { stripe, store, calls } = setup({ pms: { pm_old: pm } });
    assert.equal((await syncCardWithStripe(stripe, store, 1)).state, "cleared");
    assert.equal(calls.cleared, 1);
  }
});

test("a deleted or missing customer clears the card; so does a card with no customer on file", async () => {
  for (const o of [{ customer: { id: "cus_1", deleted: true } }, { customerError: missing }, { customerId: null }]) {
    const { stripe, store, calls } = setup(o);
    assert.equal((await syncCardWithStripe(stripe, store, 1)).state, "cleared");
    assert.equal(calls.cleared, 1);
  }
});

test("a current card is left alone; changed expiry is refreshed", async () => {
  const same = setup({});
  assert.deepEqual(await syncCardWithStripe(same.stripe, same.store, 1), { state: "ok" });
  assert.equal(same.calls.cleared + same.calls.updated.length, 0);
  const renewed = setup({ pms: { pm_old: { ...card("pm_old", "4242"), card: { last4: "4242", brand: "visa", exp_month: 1, exp_year: 2032 } } } });
  assert.equal((await syncCardWithStripe(renewed.stripe, renewed.store, 1)).state, "updated");
});

test("a card changed in the billing portal (a different default) replaces the stored card", async () => {
  const { stripe, store, calls } = setup({
    customer: { id: "cus_1", invoice_settings: { default_payment_method: "pm_new" } },
    pms: { pm_old: card("pm_old", "4242"), pm_new: card("pm_new", "1881") },
  });
  const r = await syncCardWithStripe(stripe, store, 1);
  assert.deepEqual(r, { state: "updated", card: fields("pm_new", "1881") });
  assert.deepEqual(calls.updated, [fields("pm_new", "1881")]);
  assert.equal(calls.cleared, 0);
});

test("a default that is not a usable card does not replace the stored one", async () => {
  const { stripe, store, calls } = setup({
    customer: { id: "cus_1", invoice_settings: { default_payment_method: "pm_other" } },
    pms: { pm_old: card("pm_old", "4242"), pm_other: card("pm_other", "0000", "cus_elsewhere") },
  });
  assert.equal((await syncCardWithStripe(stripe, store, 1)).state, "ok");
  assert.equal(calls.updated.length, 0);
});

test("a Stripe outage never wipes the card, and the pre-charge check lets the charge proceed", async () => {
  const outage = Object.assign(new Error("connection reset"), { statusCode: 500 });
  const a = setup({ customerError: outage });
  await assert.rejects(syncCardWithStripe(a.stripe, a.store, 1));
  assert.equal(a.calls.cleared, 0);
  assert.equal(await cardIsUsableBeforeCharge(a.stripe, a.store, 1), true);
  const b = setup({ pms: {} });
  assert.equal(await cardIsUsableBeforeCharge(b.stripe, b.store, 1), false);
});

test("saving a new card attaches it to the customer, makes it the default, and detaches the old one", async () => {
  const { stripe, calls } = setup({});
  await attachAsDefault(stripe, "cus_1", card("pm_new", "1881", null) as any, "pm_old");
  assert.deepEqual(calls.attached, [{ id: "pm_new", params: { customer: "cus_1" } }]);
  assert.deepEqual(calls.customerUpdates, [{ id: "cus_1", params: { invoice_settings: { default_payment_method: "pm_new" } } }]);
  assert.deepEqual(calls.detached, ["pm_old"]);
});

test("an already-attached card is not re-attached; another customer's card is refused", async () => {
  const { stripe, calls } = setup({});
  await attachAsDefault(stripe, "cus_1", card("pm_new", "1881", "cus_1") as any, null);
  assert.equal(calls.attached.length, 0);
  assert.equal(calls.customerUpdates.length, 1);
  await assert.rejects(attachAsDefault(stripe, "cus_1", card("pm_x", "1", "cus_other") as any, null), CardOwnershipError);
  assert.equal(calls.customerUpdates.length, 1);
});
