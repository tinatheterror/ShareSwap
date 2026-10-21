/**
 * True when a Stripe call may or may not have taken effect (no HTTP status, 429, 5xx, or a connection
 * or timeout failure). Anything else is a definitive rejection: Stripe saw the request and refused it.
 */
export function stripeOutcomeIsIndeterminate(error: unknown): boolean {
  const value = error as any;
  const status = Number(value?.statusCode || value?.status || 0);
  const type = String(value?.type || value?.code || "");
  return !status || status === 429 || status >= 500 ||
    /connection|timeout|network|api_connection|rate_limit/i.test(type) ||
    /connection|timeout|socket|network|temporar/i.test(String(value?.message || ""));
}
