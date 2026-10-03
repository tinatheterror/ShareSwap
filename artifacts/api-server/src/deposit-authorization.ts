import { createHash } from "node:crypto";
import type Stripe from "stripe";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Stripe binds an idempotency key to the full create payload, so the key must
 * change whenever the payload does (card swap, description/metadata change).
 * Identical retries hash identically and still replay the same creation.
 */
export function depositHoldIdempotencyKey(
  prefix: string,
  parameters: Stripe.PaymentIntentCreateParams,
  attemptNumber = 0,
): string {
  const fingerprint = createHash("sha256").update(canonicalJson(parameters)).digest("hex").slice(0, 16);
  return `${prefix}-${fingerprint}${attemptNumber ? `-attempt-${attemptNumber}` : ""}`;
}

type Attempt = { attemptNumber: number; paymentIntentId: string | null };

/**
 * Preserve payment-creation parameters across retries. Charge expansion belongs
 * on the read, not the idempotent write. Only a verified canceled intent permits
 * a new attempt; timeouts and unknown provider states never advance the key.
 * Callers must serialize attempts and durably record them through onAttempt.
 */
export async function prepareDepositAuthorization({
  stripeClient,
  parameters,
  attemptNumber = 0,
  paymentIntentId = null,
  keyForAttempt,
  onAttempt,
}: {
  stripeClient: {
    paymentIntents: Pick<Stripe["paymentIntents"], "create" | "retrieve">;
  };
  parameters: Stripe.PaymentIntentCreateParams;
  attemptNumber?: number;
  paymentIntentId?: string | null;
  keyForAttempt: (attemptNumber: number) => string;
  onAttempt: (attempt: Attempt) => Promise<void>;
}): Promise<{ paymentIntent: Stripe.PaymentIntent; attemptNumber: number }> {
  for (let recovered = 0; recovered < 3; recovered++) {
    await onAttempt({ attemptNumber, paymentIntentId });
    if (!paymentIntentId) {
      const options = { idempotencyKey: keyForAttempt(attemptNumber) };
      let created: Stripe.PaymentIntent;
      try {
        created = await stripeClient.paymentIntents.create(parameters, options);
      } catch (error: unknown) {
        const failure = error as { type?: string; message?: string };
        if (
          failure.type !== "StripeIdempotencyError" ||
          !failure.message?.includes("same parameters")
        ) {
          throw error;
        }
        // The brief expansion-on-create version may have already bound this
        // SAME key to these parameters. Replay that exact form, never a new key.
        created = await stripeClient.paymentIntents.create(
          { ...parameters, expand: ["latest_charge"] },
          options,
        );
      }
      paymentIntentId = created.id;
      await onAttempt({ attemptNumber, paymentIntentId });
    }

    // Cached creation responses can describe an authorization that was canceled
    // later. Read live state as well as the actual card-network deadline.
    const paymentIntent = await stripeClient.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
    if (paymentIntent.status !== "canceled") {
      return { paymentIntent, attemptNumber };
    }
    attemptNumber++;
    paymentIntentId = null;
  }
  throw new Error("Previous deposit authorizations were canceled. Please retry.");
}