import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Stripe from "stripe";
import { cardIsUsableBeforeCharge, type CardFields, type CardStore } from "./card-sync";
import { createLazyStripe } from "./stripe-lazy-client";

// The REAL Stripe SDK client (the same class getUncachableStripeClient builds), with only the network replaced by a fetch that
// answers like the Stripe API. So a method the routes' lazy client forgets, or a call the SDK would reject, fails here.
function realClient(answer: (method: string, path: string) => { status: number; body: unknown }) {
  const requests: string[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    requests.push(`${init?.method ?? "GET"} ${path}`);
    const { status, body } = answer(init?.method ?? "GET", path);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });
  }) as typeof fetch;
  const stripe = new Stripe("sk_test_not_a_real_key", { httpClient: Stripe.createFetchHttpClient(fetchFn), maxNetworkRetries: 0 });
  return { stripe, requests };
}

const pm = { id: "pm_1", object: "payment_method", customer: "cus_1", card: { last4: "4242", brand: "visa", exp_month: 12, exp_year: 2030 } };
const customer = { id: "cus_1", object: "customer", invoice_settings: { default_payment_method: "pm_1" } };
const stored: CardFields = { stripePaymentMethodId: "pm_1", paymentMethodLast4: "4242", paymentMethodBrand: "visa", paymentMethodExpMonth: 12, paymentMethodExpYear: 2030 };
function store() {
  const calls = { cleared: 0 };
  const s: CardStore = { get: async () => ({ stripeCustomerId: "cus_1", card: stored }), update: async () => {}, clear: async () => void calls.cleared++ };
  return { s, calls };
}

const errors: string[] = [];
const original = console.error;
afterEach(() => { console.error = original; errors.length = 0; });
const captureErrors = () => { console.error = (...args: unknown[]) => void errors.push(args.map(String).join(" ")); };

test("the routes' lazy client exposes every method the pre-charge card check calls, and the check really runs against the real client", async () => {
  const { stripe, requests } = realClient((_m, path) => ({ status: 200, body: path.startsWith("/v1/customers/") ? customer : pm }));
  const lazy = createLazyStripe(async () => stripe);
  assert.equal(typeof lazy.customers.retrieve, "function");
  assert.equal(typeof lazy.paymentMethods.retrieve, "function");

  captureErrors();
  const { s, calls } = store();
  assert.equal(await cardIsUsableBeforeCharge(lazy as any, s, 1), true);
  assert.deepEqual(errors, [], "the check ran; it was not skipped");
  assert.deepEqual(requests, ["GET /v1/customers/cus_1", "GET /v1/payment_methods/pm_1"], "both Stripe lookups were made");
  assert.equal(calls.cleared, 0);
});

test("through the same real client, a card Stripe no longer has is found out before the charge, cleared, and refused", async () => {
  const gone = { status: 404, body: { error: { type: "invalid_request_error", code: "resource_missing", message: "No such PaymentMethod: 'pm_1'" } } };
  const { stripe } = realClient((_m, path) => (path.startsWith("/v1/customers/") ? { status: 200, body: customer } : gone));
  captureErrors();
  const { s, calls } = store();
  assert.equal(await cardIsUsableBeforeCharge(createLazyStripe(async () => stripe) as any, s, 1), false);
  assert.equal(calls.cleared, 1);
  assert.deepEqual(errors, []);
});

test("a skipped pre-charge check is logged at error level with the user and the reason, and the charge still goes ahead", async () => {
  captureErrors();
  const noRetrieve = { customers: {}, paymentMethods: {} };
  assert.equal(await cardIsUsableBeforeCharge(noRetrieve as any, store().s, 42), true);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /PRE-CHARGE CARD CHECK SKIPPED for user 42/);
  assert.match(errors[0], /not a function/);

  errors.length = 0;
  const { stripe } = realClient(() => ({ status: 500, body: { error: { type: "api_error", message: "stripe is down" } } }));
  assert.equal(await cardIsUsableBeforeCharge(createLazyStripe(async () => stripe) as any, store().s, 7), true);
  assert.match(errors[0] ?? "", /SKIPPED for user 7/);
});
