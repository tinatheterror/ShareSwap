import Stripe from "stripe";

const STRIPE_API_VERSION = "2025-11-17.clover";

// Keys come from environment variables (Replit Secrets). Names only in errors, never values.
async function getCredentials() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY?.trim();

  const missing = [
    !secretKey && "STRIPE_SECRET_KEY",
    !publishableKey && "STRIPE_PUBLISHABLE_KEY",
  ].filter(Boolean);
  if (!secretKey || !publishableKey) {
    throw new Error(
      `Missing required Stripe environment variable(s): ${missing.join(", ")}. ` +
        `Set them in Replit Secrets (Tools > Secrets).`,
    );
  }

  return { publishableKey, secretKey };
}

export function stripeKeyMode(secretKey: string): "test" | "live" | "unknown" {
  if (secretKey.startsWith("sk_test_")) return "test";
  if (secretKey.startsWith("sk_live_")) return "live";
  return "unknown";
}

/**
 * Startup check: fails if either key is missing, then logs whether the keys are test or live and the
 * Stripe account id. The keys themselves are never logged.
 */
export async function logStripeStartup(log: (line: string) => void = console.log) {
  const { secretKey } = await getCredentials();
  const mode = stripeKeyMode(secretKey);
  const stripe = await getUncachableStripeClient();
  const account = await stripe.accounts.retrieveCurrent();
  log(`Stripe: ${mode} keys, account ${account.id}`);
}

export async function getUncachableStripeClient() {
  const { secretKey } = await getCredentials();

  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
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
