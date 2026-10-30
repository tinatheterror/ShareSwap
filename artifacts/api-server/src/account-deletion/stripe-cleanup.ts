import type { StripeCleanupTarget } from "./service";

// Ends an account's Stripe footprint before its data is erased: the subscription, then the Customer (which also
// removes the saved cards), then the Connect account. Every call can be repeated: something Stripe no longer has
// counts as done, so a retry after a failure in the middle picks up where it stopped.
//
// Pending transfers need no step here. A payout that is still moving money (`held`, `pending_payout`,
// `manual_review`) already blocks the deletion in getDeletionEligibility, and a transfer to a Connect account is
// created in one call, so none can be waiting.

/** The part of the Stripe client this uses; tests pass a fake. */
export interface StripeCleanupClient {
  subscriptions: { cancel(id: string): Promise<unknown> };
  customers: { del(id: string): Promise<unknown> };
  accounts: { del(id: string): Promise<unknown> };
}

/** Stripe answers "no such object" with resource_missing; a subscription that already ended says so in its message. */
function alreadyGone(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "resource_missing" || /already (been )?(canceled|cancelled|deleted)/i.test(e?.message ?? "");
}

async function idempotent(call: () => Promise<unknown>) {
  try {
    await call();
  } catch (error) {
    if (!alreadyGone(error)) throw error;
  }
}

export type StripeCleanupLog = (line: string, error?: unknown) => void;

/**
 * The subscription and Customer must be gone before the account's data is erased, so a failure there stops the
 * deletion and is retried. The Connect account is different: Stripe refuses to delete a live account that still
 * holds a balance, and waiting on that would keep a person who asked to leave in limbo. A refusal is logged with the
 * account id, which the users row keeps (see the manifest), so staff can settle it; it does not stop the deletion.
 */
export function createStripeCleanup(getClient: () => Promise<StripeCleanupClient> | StripeCleanupClient, log: StripeCleanupLog = console.error) {
  return async (target: StripeCleanupTarget): Promise<void> => {
    if (!target.subscriptionId && !target.customerId && !target.connectedAccountId) return;
    const client = await getClient();
    if (target.subscriptionId) await idempotent(() => client.subscriptions.cancel(target.subscriptionId!));
    if (target.customerId) await idempotent(() => client.customers.del(target.customerId!));
    if (target.connectedAccountId) {
      try {
        await idempotent(() => client.accounts.del(target.connectedAccountId!));
      } catch (error) {
        log(`[account-deletion] could not delete Stripe Connect account ${target.connectedAccountId} of user ${target.userId}; the deletion goes on and the account needs follow-up`, error);
      }
    }
  };
}
