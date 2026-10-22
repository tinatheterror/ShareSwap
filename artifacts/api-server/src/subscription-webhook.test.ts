import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { subscriptionWebhookHandler, requireSubscriptionWebhookSecret, type SubscriptionWebhookStore } from "./subscription-webhook";

const SECRET = "whsec_test_secret_value";
const stripe = new Stripe("sk_test_dummy");

const realError = console.error;
const realLog = console.log;
const logged: string[] = [];
console.error = (...a: unknown[]) => void logged.push(a.join(" "));
console.log = () => {};
afterEach(() => (logged.length = 0));
process.on("exit", () => {
  console.error = realError;
  console.log = realLog;
});

function setup(secret: string | undefined = SECRET) {
  const writes: unknown[] = [];
  const store: SubscriptionWebhookStore = { setSubscription: async (customerId, fields) => void writes.push({ customerId, ...fields }) };
  const handler = subscriptionWebhookHandler({
    getSecret: () => secret,
    store,
    getStripe: async () => ({
      webhooks: stripe.webhooks,
      prices: { retrieve: async () => ({ product: { metadata: { tier: "pro" } } }) },
    }) as any,
  });
  return { handler, writes };
}

async function call(handler: ReturnType<typeof subscriptionWebhookHandler>, body: Buffer | object, signature?: string) {
  let status = 0;
  let json: any;
  const res: any = {
    status(code: number) { status = code; return res; },
    json(payload: unknown) { json = payload; if (!status) status = 200; return res; },
  };
  await handler({ headers: signature ? { "stripe-signature": signature } : {}, body } as any, res);
  return { status, json };
}

const payload = Buffer.from(JSON.stringify({
  id: "evt_1", object: "event", type: "customer.subscription.updated",
  data: { object: { id: "sub_1", customer: "cus_1", status: "active", items: { data: [{ price: { id: "price_1" } }] } } },
}));
const sign = (body: Buffer, secret = SECRET) => stripe.webhooks.generateTestHeaderString({ payload: body.toString(), secret });

test("a missing secret is rejected, logged, and changes nothing", async () => {
  const { handler, writes } = setup("  ");
  const r = await call(handler, payload, sign(payload));
  assert.equal(r.status, 400);
  assert.deepEqual(writes, []);
  assert.match(logged.join("\n"), /STRIPE_SUBSCRIPTION_WEBHOOK_SECRET is not set/);
});

test("a missing signature is rejected and changes nothing, even with a well-formed event", async () => {
  const { handler, writes } = setup();
  const r = await call(handler, payload);
  assert.equal(r.status, 400);
  assert.deepEqual(writes, []);
  assert.match(logged.join("\n"), /missing stripe-signature/);
});

test("a bad signature is rejected, logged without secrets, and changes nothing", async () => {
  const { handler, writes } = setup();
  for (const sig of ["t=1,v1=deadbeef", sign(payload, "whsec_other"), "garbage"]) {
    const r = await call(handler, payload, sig);
    assert.equal(r.status, 400);
  }
  assert.deepEqual(writes, []);
  assert.doesNotMatch(logged.join("\n"), /whsec_/);
});

test("a body that is not the raw bytes is rejected", async () => {
  const { handler, writes } = setup();
  const r = await call(handler, JSON.parse(payload.toString()), sign(payload));
  assert.equal(r.status, 400);
  assert.deepEqual(writes, []);
});

test("a valid signed event updates the tier", async () => {
  const { handler, writes } = setup();
  const r = await call(handler, payload, sign(payload));
  assert.equal(r.status, 200);
  assert.deepEqual(writes, [{ customerId: "cus_1", subscriptionTier: "pro", stripeSubscriptionId: "sub_1", stripeSubscriptionStatus: "active" }]);
});

test("a valid signed cancellation downgrades to free", async () => {
  const { handler, writes } = setup();
  const body = Buffer.from(JSON.stringify({ id: "evt_2", object: "event", type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1" } } }));
  const r = await call(handler, body, sign(body));
  assert.equal(r.status, 200);
  assert.deepEqual(writes, [{ customerId: "cus_1", subscriptionTier: "free", stripeSubscriptionId: null, stripeSubscriptionStatus: "canceled" }]);
});

test("boot requires the secret, naming it and not any value", () => {
  assert.throws(() => requireSubscriptionWebhookSecret({}), /STRIPE_SUBSCRIPTION_WEBHOOK_SECRET/);
  assert.throws(() => requireSubscriptionWebhookSecret({ STRIPE_SUBSCRIPTION_WEBHOOK_SECRET: "  " }), /STRIPE_SUBSCRIPTION_WEBHOOK_SECRET/);
  assert.doesNotThrow(() => requireSubscriptionWebhookSecret({ STRIPE_SUBSCRIPTION_WEBHOOK_SECRET: SECRET }));
});
