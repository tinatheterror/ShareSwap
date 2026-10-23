import type Stripe from "stripe";
import { PLATFORM_CURRENCY } from "@workspace/db";

export type CustomerReplacementReason = "none" | "missing" | "deleted" | "currency_locked";

export interface UsableCustomer {
  customerId: string;
  /** True when `customerId` is new and the caller must save it to users.stripeCustomerId. */
  created: boolean;
  /** Why the stored customer could not be used ("none" when nothing was stored). */
  replaced: CustomerReplacementReason;
}

function isMissing(error: unknown): boolean {
  const err = error as { statusCode?: number; code?: string } | null;
  return err?.statusCode === 404 || err?.code === "resource_missing";
}

/**
 * The stored customer if the current Stripe account still has it, it is not deleted and its currency is
 * not locked to something other than the platform currency; otherwise a fresh customer. Any other Stripe
 * error (network, auth) is rethrown rather than treated as "missing".
 */
export async function ensureUsableCustomer(
  stripe: Stripe,
  storedCustomerId: string | null | undefined,
  newCustomer: Stripe.CustomerCreateParams,
): Promise<UsableCustomer> {
  let replaced: CustomerReplacementReason = "none";
  if (storedCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(storedCustomerId);
      if ((existing as Stripe.DeletedCustomer).deleted) {
        replaced = "deleted";
      } else if ((existing as Stripe.Customer).currency && (existing as Stripe.Customer).currency !== PLATFORM_CURRENCY) {
        replaced = "currency_locked";
      } else {
        return { customerId: storedCustomerId, created: false, replaced: "none" };
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
      replaced = "missing";
    }
    console.warn(`[stripe-customer] stored customer ${storedCustomerId} is unusable (${replaced}); creating a new one`);
  }
  const customer = await stripe.customers.create(newCustomer);
  return { customerId: customer.id, created: true, replaced };
}
