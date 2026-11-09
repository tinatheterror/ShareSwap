import type { Response } from "express";
import { SANDBOX_KEY_PREFIX } from "./account-deletion/persona-sandbox-check";
import { isProductionRuntime } from "./non-production-gate";

/**
 * A Persona SANDBOX key (persona_sandbox_...) in production simulates every check: the member sees "verified" but nobody's ID was looked at.
 * So in production (NODE_ENV=production or any Replit deployment, see isProductionRuntime) a sandbox key stops the two verification
 * endpoints and logs an error at boot. The environment is read on every call, not cached at startup.
 *
 * The key prefix is the only signal: Persona's inquiry objects do not say which environment they came from. Because both endpoints are
 * refused, no inquiry is created and none can be approved while a sandbox key is in use.
 */
export const PERSONA_SANDBOX_KEY_IN_PRODUCTION_CODE = "PERSONA_SANDBOX_KEY_IN_PRODUCTION";
// What members see: no mention of keys. Free of the words "csrf" and "token" like the other refusals.
export const PERSONA_UNAVAILABLE_MESSAGE = "Identity verification is not available right now. Please try again later.";

export const isPersonaSandboxKey = (key: string | undefined | null): boolean => typeof key === "string" && key.trim().startsWith(SANDBOX_KEY_PREFIX);

export function personaSandboxKeyInProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return isProductionRuntime(env) && isPersonaSandboxKey(env.PERSONA_API_KEY);
}

const WHAT_TO_DO = "Set PERSONA_API_KEY to the production key (persona_production_...) and PERSONA_TEMPLATE_ID to the template confirmed in Persona's Production environment.";

/** The line logged at boot, or null when all is well. Never contains the key. */
export function personaSandboxBootError(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!personaSandboxKeyInProduction(env)) return null;
  return `[persona] PERSONA_API_KEY is a SANDBOX key (${SANDBOX_KEY_PREFIX}...) but this is production: every verification would be simulated. ` +
    `/api/persona/create-inquiry and /api/persona/inquiry-complete are refused until it is replaced. ${WHAT_TO_DO}`;
}

/** Answers 503 and returns true when the endpoint must not run (sandbox key in production). Call it first in each Persona endpoint. */
export function refuseIfPersonaSandboxInProduction(res: Response, route: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!personaSandboxKeyInProduction(env)) return false;
  console.error(`[persona] Refused ${route}: PERSONA_API_KEY is a sandbox key (${SANDBOX_KEY_PREFIX}...) in production, so no inquiry is created or approved. ${WHAT_TO_DO}`);
  res.status(503).json({ code: PERSONA_SANDBOX_KEY_IN_PRODUCTION_CODE, error: PERSONA_UNAVAILABLE_MESSAGE, message: PERSONA_UNAVAILABLE_MESSAGE });
  return true;
}
