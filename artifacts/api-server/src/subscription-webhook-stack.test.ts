import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Stripe from "stripe";
import { pool } from "@workspace/db";
import app from "./app.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";
import { isServerToServerPath, SUBSCRIPTION_WEBHOOK_PATH } from "./server-to-server-routes.js";

// The webhook goes through the same app and middleware stack as production (app.ts, then registerRoutes: session,
// CSRF, rate limit, raw-body parser), not just the handler. Stripe sends no cookie, CSRF token or Origin.

const SECRET = "whsec_stack_test_secret";
const stripeLib = new Stripe("sk_test_dummy");

const writes: unknown[] = [];
const priceReads: { id: string; params: unknown }[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  const server = registerRoutes(app, {
    startBackgroundJobs: false,
    subscriptionWebhook: {
      getSecret: () => SECRET,
      store: { setSubscription: async (customerId, fields) => void writes.push({ customerId, ...fields }) },
      getStripe: async () =>
        ({
          webhooks: stripeLib.webhooks,
          prices: {
            // The price in the event has no metadata and only a product id; the tier is on the product itself.
            retrieve: async (id: string, params: unknown) => {
              priceReads.push({ id, params });
              return { id, product: { id: "prod_T9sample", object: "product", metadata: { app: "shareswap", tier: "pro" } } };
            },
          },
        }) as never,
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

after(async () => {
  try {
    await closeServer?.();
  } finally {
    await pool.end();
  }
});

// Shaped like a real customer.subscription.updated delivered with Stripe API version 2025-09-30.clover:
// the period dates are on the items (not the subscription), the price has no metadata, product is just an id.
function realisticEvent(over: { status?: string; type?: string } = {}) {
  return {
    id: "evt_1SMsample",
    object: "event",
    api_version: "2025-09-30.clover",
    created: 1761300000,
    livemode: true,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: over.type ?? "customer.subscription.updated",
    data: {
      object: {
        id: "sub_1SMsample",
        object: "subscription",
        customer: "cus_Tsample",
        status: over.status ?? "active",
        cancel_at_period_end: false,
        billing_cycle_anchor: 1761300000,
        currency: "cad",
        metadata: { userId: "42", tier: "member" },
        items: {
          object: "list",
          data: [
            {
              id: "si_Tsample",
              object: "subscription_item",
              current_period_start: 1761300000,
              current_period_end: 1763978400,
              metadata: {},
              quantity: 1,
              price: {
                id: "price_1Ssample",
                object: "price",
                active: true,
                currency: "cad",
                metadata: {},
                product: "prod_T9sample",
                recurring: { interval: "month", interval_count: 1 },
                unit_amount: 999,
              },
            },
          ],
          has_more: false,
        },
      },
      previous_attributes: { items: {} },
    },
  };
}

async function deliver(body: string, signature: string | undefined) {
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "Stripe/1.0 (+https://stripe.com/docs/webhooks)" };
  if (signature) headers["stripe-signature"] = signature;
  return fetch(`${baseUrl}${SUBSCRIPTION_WEBHOOK_PATH}`, { method: "POST", headers, body });
}
const sign = (body: string, secret = SECRET) => stripeLib.webhooks.generateTestHeaderString({ payload: body, secret });

test("a signed event gets 200 through the full stack and sets the tier read from the product, not the event", async () => {
  writes.length = 0;
  priceReads.length = 0;
  const body = JSON.stringify(realisticEvent());
  const response = await deliver(body, sign(body));
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { received: true });
  assert.deepEqual(priceReads, [{ id: "price_1Ssample", params: { expand: ["product"] } }]);
  assert.deepEqual(writes, [{ customerId: "cus_Tsample", subscriptionTier: "pro", stripeSubscriptionId: "sub_1SMsample", stripeSubscriptionStatus: "active" }]);
});

test("a signed event for an unpaid subscription gets 200 and grants nothing", async () => {
  writes.length = 0;
  const body = JSON.stringify(realisticEvent({ status: "incomplete", type: "customer.subscription.created" }));
  const response = await deliver(body, sign(body));
  assert.equal(response.status, 200);
  assert.deepEqual(writes, [{ customerId: "cus_Tsample", subscriptionTier: "free", stripeSubscriptionId: "sub_1SMsample", stripeSubscriptionStatus: "incomplete" }]);
});

test("a bad signature gets 400 (not a CSRF 403) and changes nothing", async () => {
  writes.length = 0;
  const body = JSON.stringify(realisticEvent());
  for (const signature of [sign(body, "whsec_someone_else"), "t=1,v1=deadbeef", undefined]) {
    const response = await deliver(body, signature);
    assert.equal(response.status, 400, String(signature));
  }
  // Signed over different bytes than were sent.
  assert.equal((await deliver(body + " ", sign(body))).status, 400);
  assert.deepEqual(writes, []);
});

test("the webhook is not counted against the per-IP rate limit, other API routes are", async () => {
  const body = JSON.stringify(realisticEvent());
  const webhook = await deliver(body, sign(body));
  assert.equal(webhook.headers.get("ratelimit-limit"), null);
  const other = await fetch(`${baseUrl}/api/csrf-token`, { headers: { "x-forwarded-proto": "https" } });
  assert.notEqual(other.headers.get("ratelimit-limit"), null);
});

test("CSRF still protects browser routes: the exemption is only for the webhook path", async () => {
  const response = await fetch(`${baseUrl}/api/subscription/portal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 403);
  assert.equal(((await response.json()) as { code: string }).code, "CSRF_INVALID");
  // A look-alike path is not exempt.
  const lookAlike = await fetch(`${baseUrl}${SUBSCRIPTION_WEBHOOK_PATH}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(lookAlike.status, 403);
});

test("only the webhook path counts as server-to-server", () => {
  assert.equal(isServerToServerPath(SUBSCRIPTION_WEBHOOK_PATH), true);
  assert.equal(isServerToServerPath(`${SUBSCRIPTION_WEBHOOK_PATH}?x=1`), true);
  assert.equal(isServerToServerPath(`${SUBSCRIPTION_WEBHOOK_PATH}/`), true);
  for (const other of ["/api/stripe/subscription-webhook/x", "/api/stripe", "/api/subscription/confirm", "/", "", undefined]) {
    assert.equal(isServerToServerPath(other), false, String(other));
  }
});
