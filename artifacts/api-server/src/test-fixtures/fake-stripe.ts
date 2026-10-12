// A Stripe stand-in for cancel and expiry tests: records every call, and any capture or payment
// creation is a hard failure (cancel and expiry may only release and refund).

export interface RefundCall {
  params: Record<string, unknown>;
  options?: { idempotencyKey?: string };
}

export interface FakeStripeOptions {
  /** Fail every PaymentIntent cancel while this returns true. */
  failCancel?: () => boolean;
  /** Fail every refund while this returns true. */
  failRefund?: () => boolean;
  /** Cents Stripe reports per refunded id (payment_intent or charge). */
  refundAmounts?: Record<string, number>;
}

export function fakeStripe(options: FakeStripeOptions = {}) {
  const calls = {
    retrieve: [] as string[],
    cancel: [] as { id: string; options?: { idempotencyKey?: string } }[],
    refunds: [] as RefundCall[],
    capture: [] as string[],
    create: [] as unknown[],
  };
  /** Status per PaymentIntent id; anything not set is an uncaptured hold. */
  const intentStatus = new Map<string, string>();
  const client = {
    paymentIntents: {
      retrieve: async (id: string) => {
        calls.retrieve.push(id);
        return { id, status: intentStatus.get(id) ?? "requires_capture" };
      },
      create: async (...args: unknown[]) => {
        calls.create.push(args);
        throw new Error("cancel and expiry must never create a payment");
      },
      cancel: async (id: string, _params?: unknown, opts?: { idempotencyKey?: string }) => {
        if (options.failCancel?.()) throw new Error("stripe unavailable");
        calls.cancel.push({ id, options: opts });
        intentStatus.set(id, "canceled");
        return { id, status: "canceled" };
      },
      capture: async (id: string) => {
        calls.capture.push(id);
        throw new Error("cancel and expiry must never capture");
      },
    },
    refunds: {
      create: async (params: Record<string, unknown>, opts?: { idempotencyKey?: string }) => {
        if (options.failRefund?.()) throw new Error("stripe unavailable");
        calls.refunds.push({ params, options: opts });
        const target = String(params.payment_intent ?? params.charge);
        return { id: `re_${calls.refunds.length}`, amount: options.refundAmounts?.[target] };
      },
    },
  };
  return { calls, intentStatus, client };
}

export const noStripeCalls = { retrieve: [], cancel: [], refunds: [], capture: [], create: [] };
