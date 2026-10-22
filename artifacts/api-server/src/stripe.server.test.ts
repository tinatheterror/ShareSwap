import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getStripePublishableKey, getStripeSecretKey, stripeKeyMode } from "./stripe.server";

const saved = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

test("reads both keys from the environment", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_abc";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_abc";
  assert.equal(await getStripeSecretKey(), "sk_test_abc");
  assert.equal(await getStripePublishableKey(), "pk_test_abc");
});

test("a missing key fails loudly, naming the variable and not leaking the other", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_secretvalue";
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  await assert.rejects(getStripeSecretKey(), (err: Error) => {
    assert.match(err.message, /STRIPE_PUBLISHABLE_KEY/);
    assert.doesNotMatch(err.message, /secretvalue/);
    return true;
  });
  delete process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_x";
  await assert.rejects(getStripePublishableKey(), /STRIPE_SECRET_KEY/);
});

test("key mode is test, live or unknown by prefix", () => {
  assert.equal(stripeKeyMode("sk_test_1"), "test");
  assert.equal(stripeKeyMode("sk_live_1"), "live");
  assert.equal(stripeKeyMode("rk_live_1"), "unknown");
});

test("routes use the shared client, not a raw STRIPE_SECRET_KEY", () => {
  assert.doesNotMatch(readFileSync(new URL("./routes/routes.ts", import.meta.url), "utf8"), /process\.env\.STRIPE_SECRET_KEY/);
});
