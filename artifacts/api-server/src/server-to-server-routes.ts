/**
 * Routes called by another server (Stripe), not by a browser. They have no session, cookies, CSRF token or
 * Origin, so the browser-only checks (CSRF, the per-IP rate limit) must not apply to them; each authenticates
 * itself instead (the webhook verifies Stripe's signature over the raw body).
 *
 * Scheduled jobs are not here: they run as a separate process (scripts/run-scheduled-jobs.ts), not over HTTP.
 */
export const SUBSCRIPTION_WEBHOOK_PATH = "/api/stripe/subscription-webhook";

const SERVER_TO_SERVER_PATHS: ReadonlySet<string> = new Set([SUBSCRIPTION_WEBHOOK_PATH]);

/** True for a request path (query string ignored) that only another server calls. */
export function isServerToServerPath(path: string | undefined): boolean {
  if (!path) return false;
  const bare = path.split("?", 1)[0];
  return SERVER_TO_SERVER_PATHS.has(bare.length > 1 ? bare.replace(/\/+$/, "") : bare);
}
