import assert from "node:assert/strict";
import { test } from "node:test";
import type Stripe from "stripe";
import { PLATFORM_CURRENCY } from "@workspace/db";
import { ensureUsableCustomer } from "./stripe-customer.js";

function fakeStripe(retrieve: (id: string) => Promise<unknown>) {
  const created: Stripe.CustomerCreateParams[] = [];
  const stripe = {
    customers: {
      retrieve,
      create: async (params: Stripe.CustomerCreateParams) => {
        created.push(params);
        return { id: `cus_new_${created.length}` };
      },
    },
  } as unknown as Stripe;
  return { stripe, created };
}

const PARAMS: Stripe.CustomerCreateParams = { email: "a@example.com", metadata: { userId: "7" } };

test("keeps a stored customer that exists with no currency or the platform currency", async () => {
  for (const currency of [undefined, PLATFORM_CURRENCY]) {
    const { stripe, created } = fakeStripe(async (id) => ({ id, currency }));
    assert.deepEqual(await ensureUsableCustomer(stripe, "cus_ok", PARAMS), { customerId: "cus_ok", created: false, replaced: "none" });
    assert.equal(created.length, 0);
  }
});

test("creates a customer when none is stored, without retrieving", async () => {
  const { stripe, created } = fakeStripe(async () => { throw new Error("must not retrieve"); });
  assert.deepEqual(await ensureUsableCustomer(stripe, null, PARAMS), { customerId: "cus_new_1", created: true, replaced: "none" });
  assert.deepEqual(created, [PARAMS]);
});

test("replaces a customer missing from the current Stripe account", async () => {
  for (const error of [{ statusCode: 404 }, { code: "resource_missing" }]) {
    const { stripe, created } = fakeStripe(async () => { throw error; });
    assert.deepEqual(await ensureUsableCustomer(stripe, "cus_gone", PARAMS), { customerId: "cus_new_1", created: true, replaced: "missing" });
    assert.deepEqual(created, [PARAMS]);
  }
});

test("replaces a deleted customer", async () => {
  const { stripe } = fakeStripe(async (id) => ({ id, deleted: true }));
  assert.deepEqual(await ensureUsableCustomer(stripe, "cus_del", PARAMS), { customerId: "cus_new_1", created: true, replaced: "deleted" });
});

test("replaces a customer locked to a non-platform currency", async () => {
  const { stripe } = fakeStripe(async (id) => ({ id, currency: "usd" }));
  assert.deepEqual(await ensureUsableCustomer(stripe, "cus_usd", PARAMS), { customerId: "cus_new_1", created: true, replaced: "currency_locked" });
});

test("rethrows other Stripe errors instead of replacing the customer", async () => {
  const { stripe, created } = fakeStripe(async () => { throw Object.assign(new Error("boom"), { statusCode: 500, code: "api_error" }); });
  await assert.rejects(ensureUsableCustomer(stripe, "cus_x", PARAMS), /boom/);
  assert.equal(created.length, 0);
});
