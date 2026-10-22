import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEPLOYMENT_STRIPE_ENVIRONMENT,
  resolveStripeConnectorEnvironment,
  stripeConnectorBootLine,
} from "./stripe-connector-env";
import { getStripePublishableKey } from "./stripe.server";

const realFetch = globalThis.fetch;
const saved = { ...process.env };
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

test("a deployment uses the explicit development default; the workspace uses development", () => {
  assert.equal(DEPLOYMENT_STRIPE_ENVIRONMENT, "development");
  assert.deepEqual(resolveStripeConnectorEnvironment({ REPLIT_DEPLOYMENT: "1" }), { environment: "development", source: "deployment default" });
  assert.deepEqual(resolveStripeConnectorEnvironment({}), { environment: "development", source: "workspace default" });
});

test("STRIPE_CONNECTOR_ENV overrides, in either direction, and a bad value is an error", () => {
  assert.deepEqual(resolveStripeConnectorEnvironment({ STRIPE_CONNECTOR_ENV: "production" }), { environment: "production", source: "STRIPE_CONNECTOR_ENV" });
  assert.deepEqual(resolveStripeConnectorEnvironment({ REPLIT_DEPLOYMENT: "1", STRIPE_CONNECTOR_ENV: " Development " }), { environment: "development", source: "STRIPE_CONNECTOR_ENV" });
  assert.throws(() => resolveStripeConnectorEnvironment({ STRIPE_CONNECTOR_ENV: "live" }), /must be "development" or "production"/);
  assert.equal(stripeConnectorBootLine({ REPLIT_DEPLOYMENT: "1" }), "Stripe connector environment: development (deployment default)");
});

function stubConnector(items: unknown[], requested: string[]) {
  process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors.test";
  process.env.REPL_IDENTITY = "token";
  globalThis.fetch = (async (url: string) => {
    requested.push(new URL(url).searchParams.get("environment")!);
    return new Response(JSON.stringify({ items }), { status: 200 });
  }) as typeof fetch;
}

test("requests only the chosen environment and returns its keys", async () => {
  const requested: string[] = [];
  stubConnector([{ settings: { publishable: "pk_test_x", secret: "sk_test_x" } }], requested);
  process.env.REPLIT_DEPLOYMENT = "1";
  delete process.env.STRIPE_CONNECTOR_ENV;
  assert.equal(await getStripePublishableKey(), "pk_test_x");
  assert.deepEqual(requested, ["development"]);
});

test("a missing connection fails loudly and never retries another environment", async () => {
  const requested: string[] = [];
  stubConnector([], requested);
  process.env.STRIPE_CONNECTOR_ENV = "production";
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.join(" "));
  try {
    await assert.rejects(getStripePublishableKey(), /Stripe production connection not found/);
  } finally {
    console.error = realError;
  }
  assert.deepEqual(requested, ["production"]);
  assert.match(logged.join("\n"), /No usable "production" Stripe connection.*STRIPE_CONNECTOR_ENV.*Not falling back/s);
});

test("no raw STRIPE_SECRET_KEY client in the routes", () => {
  assert.doesNotMatch(readFileSync(new URL("./routes/routes.ts", import.meta.url), "utf8"), /process\.env\.STRIPE_SECRET_KEY/);
});
