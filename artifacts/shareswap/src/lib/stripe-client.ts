import { loadStripe, Stripe } from "@stripe/stripe-js";

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = fetch("/api/stripe/publishable-key")
      .then((res) => res.json())
      .then((data) => {
        if (data.publishableKey) {
          return loadStripe(data.publishableKey);
        }
        console.error("[Stripe] No publishable key returned from API");
        return null;
      })
      .catch((err) => {
        console.error("[Stripe] Failed to fetch publishable key:", err);
        return null;
      });
  }
  return stripePromise;
}
