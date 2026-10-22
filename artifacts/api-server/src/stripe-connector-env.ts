// Which Replit Stripe connection (test or live keys) this process asks for.
//
// Deployments are pinned to "development" (test keys) until going live is a deliberate decision:
// that is DEPLOYMENT_STRIPE_ENVIRONMENT below, and STRIPE_CONNECTOR_ENV overrides it. There is no
// fallback between environments: whatever is requested is the only thing fetched, and a missing
// connection is an error (see stripe.server.ts).

export type StripeConnectorEnvironment = "development" | "production";

/** What a Replit deployment uses when STRIPE_CONNECTOR_ENV is not set. Change to "production" to go live. */
export const DEPLOYMENT_STRIPE_ENVIRONMENT: StripeConnectorEnvironment = "development";

export interface StripeConnectorChoice {
  environment: StripeConnectorEnvironment;
  /** Why this environment was chosen, for the startup log. */
  source: "STRIPE_CONNECTOR_ENV" | "deployment default" | "workspace default";
}

const isSet = (value: string | undefined) => (value ?? "").trim() !== "";

export function resolveStripeConnectorEnvironment(env: NodeJS.ProcessEnv = process.env): StripeConnectorChoice {
  const override = (env.STRIPE_CONNECTOR_ENV ?? "").trim().toLowerCase();
  if (override) {
    if (override !== "development" && override !== "production") {
      throw new Error(`STRIPE_CONNECTOR_ENV must be "development" or "production", got "${env.STRIPE_CONNECTOR_ENV}"`);
    }
    return { environment: override, source: "STRIPE_CONNECTOR_ENV" };
  }
  if (isSet(env.REPLIT_DEPLOYMENT)) return { environment: DEPLOYMENT_STRIPE_ENVIRONMENT, source: "deployment default" };
  return { environment: "development", source: "workspace default" };
}

export function stripeConnectorBootLine(env: NodeJS.ProcessEnv = process.env): string {
  const { environment, source } = resolveStripeConnectorEnvironment(env);
  return `Stripe connector environment: ${environment} (${source})`;
}
