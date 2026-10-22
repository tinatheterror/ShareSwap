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
 * Startup check. Missing keys throw (the boot stops). Otherwise logs whether the keys are test or live
 * and the Stripe account id (never the keys). If Stripe can't be reached or rejects the lookup, it
 * warns and the boot continues.
 */
export async function logStripeStartup(
  log: (line: string) => void = console.log,
  warn: (line: string) => void = console.warn,
  getClient: () => Promise<Pick<Stripe, "accounts">> = getUncachableStripeClient,
) {
  const { secretKey } = await getCredentials();
  const mode = stripeKeyMode(secretKey);
  try {
    const stripe = await getClient();
    const account = await stripe.accounts.retrieveCurrent();
    log(`Stripe: ${mode} keys, account ${account.id}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warn(`Stripe: could not verify account at startup (${mode} keys): ${reason}`);
  }
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
