import Stripe from "stripe";

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  console.log("[Stripe] Getting credentials...");
  console.log("[Stripe] REPLIT_DEPLOYMENT:", process.env.REPLIT_DEPLOYMENT);
  console.log("[Stripe] Has REPL_IDENTITY:", !!process.env.REPL_IDENTITY);
  console.log("[Stripe] Has WEB_REPL_RENEWAL:", !!process.env.WEB_REPL_RENEWAL);

  if (!xReplitToken) {
    throw new Error("X_REPLIT_TOKEN not found for repl/depl");
  }

  const connectorName = "stripe";
  const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
  // Always use development (test) keys for now - switch to production when live keys are configured
  const targetEnvironment = "development";
  console.log("[Stripe] isProduction:", isProduction);
  console.log("[Stripe] Using environment:", targetEnvironment, "(using test keys for now)");

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

  const data = await response.json();
  console.log("[Stripe] Connector response status:", response.status);
  console.log("[Stripe] Connector has items:", !!data.items?.length);

  connectionSettings = data.items?.[0];

  if (
    !connectionSettings ||
    !connectionSettings.settings.publishable ||
    !connectionSettings.settings.secret
  ) {
    console.error("[Stripe] Connection settings missing or incomplete");
    console.error("[Stripe] Has connectionSettings:", !!connectionSettings);
    console.error("[Stripe] Has publishable:", !!connectionSettings?.settings?.publishable);
    console.error("[Stripe] Has secret:", !!connectionSettings?.settings?.secret);
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }

  const keyType = connectionSettings.settings.publishable.startsWith('pk_live_') ? 'LIVE' : 'TEST';
  console.log("[Stripe] Key type:", keyType);

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
