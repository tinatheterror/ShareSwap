import type Stripe from "stripe";

/**
 * A subscription's current billing period, in Unix seconds.
 *
 * From Stripe API 2025-03-31.basil on, `current_period_start` / `current_period_end` live on the subscription
 * items, not the subscription (this app uses 2025-11-17.clover). Read them from the items; the subscription-level
 * fields are only a fallback for responses from older API versions. With several items the period that ends first
 * is the one that matters.
 */
export function subscriptionPeriod(sub: Pick<Stripe.Subscription, "items"> & Record<string, any>): { start: number | null; end: number | null } {
  const items: any[] = sub.items?.data ?? [];
  const starts = items.map((i) => i.current_period_start).filter((n): n is number => typeof n === "number");
  const ends = items.map((i) => i.current_period_end).filter((n): n is number => typeof n === "number");
  return {
    start: starts.length ? Math.min(...starts) : typeof sub.current_period_start === "number" ? sub.current_period_start : null,
    end: ends.length ? Math.min(...ends) : typeof sub.current_period_end === "number" ? sub.current_period_end : null,
  };
}

export const periodEndIso = (sub: Pick<Stripe.Subscription, "items"> & Record<string, any>): string | null => {
  const { end } = subscriptionPeriod(sub);
  return end ? new Date(end * 1000).toISOString() : null;
};

/** "type=… code=… message=…" for a log line, from a Stripe error (or any error). */
export function stripeErrorDetails(error: unknown): string {
  const e = error as { type?: string; code?: string; param?: string; message?: string } | null;
  return `type=${e?.type ?? "unknown"} code=${e?.code ?? "none"}${e?.param ? ` param=${e.param}` : ""} message=${e?.message ?? String(error)}`;
}
