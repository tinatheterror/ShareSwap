import Stripe from "stripe";
import { resolveStripeConnectorEnvironment } from "./stripe-connector-env";

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error("X_REPLIT_TOKEN not found for repl/depl");
  }

  const connectorName = "stripe";
  // Chosen at runtime (STRIPE_CONNECTOR_ENV, else the deployment/workspace default). Never falls back.
  const { environment: targetEnvironment, source } = resolveStripeConnectorEnvironment();

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", connectorName);
  url.searchParams.set("environment", targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      X_REPLIT_TOKEN: xReplitToken,
    },
  });

  const data: any = await response.json().catch(() => null);
  connectionSettings = data?.items?.[0];
  const settings = connectionSettings?.settings;

  if (!settings?.publishable || !settings?.secret) {
    // Names and counts only, never key values.
    console.error(
      `[stripe] No usable "${targetEnvironment}" Stripe connection (environment chosen by ${source}; ` +
        `connector HTTP ${response.status}, ${Array.isArray(data?.items) ? data.items.length : "no"} connection(s) returned, ` +
        `publishable key ${settings?.publishable ? "present" : "missing"}, secret key ${settings?.secret ? "present" : "missing"}). ` +
        `Not falling back to another environment. Fix the Stripe integration for "${targetEnvironment}" in Replit, ` +
        `or set STRIPE_CONNECTOR_ENV deliberately.`,
    );
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }

  return {
    publishableKey: connectionSettings.settings.publishable,
    secretKey: connectionSettings.settings.secret,
  };
}

export async function getUncachableStripeClient() {
  const { secretKey } = await getCredentials();

  return new Stripe(secretKey, {
    apiVersion: "2025-11-17.clover",
  });
}

export async function getStripeSecretKey() {
  const { secretKey } = await getCredentials();
  return secretKey;
}

export async function getStripePublishableKey() {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

let stripeSync: any = null;

export async function getStripeSync() {
  if (!stripeSync) {
    const { StripeSync } = await import("stripe-replit-sync");
    const secretKey = await getStripeSecretKey();

    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: process.env.DATABASE_URL!,
        max: 2,
      },
      stripeSecretKey: secretKey,
    });
  }
  return stripeSync;
}
