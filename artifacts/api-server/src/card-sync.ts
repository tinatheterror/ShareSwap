import type Stripe from "stripe";
import { db } from "@workspace/db";
import { users } from "@workspace/db";
import { eq } from "drizzle-orm";

export const READD_CARD_MESSAGE = "Please re-add your card";

export interface CardFields {
  stripePaymentMethodId: string;
  paymentMethodLast4: string;
  paymentMethodBrand: string;
  paymentMethodExpMonth: number;
  paymentMethodExpYear: number;
}

export interface StoredCard {
  stripeCustomerId: string | null;
  card: CardFields | null;
}

export interface CardStore {
  get(userId: number): Promise<StoredCard>;
  /** Replace the stored card fields (the card was changed in Stripe, e.g. in the billing portal). */
  update(userId: number, card: CardFields): Promise<void>;
  /** Clear the card fields and verified-card status, exactly as remove-card does. */
  clear(userId: number): Promise<void>;
}

export const dbCardStore: CardStore = {
  async get(userId) {
    const [row] = await db
      .select({
        customerId: users.stripeCustomerId,
        id: users.stripePaymentMethodId,
        last4: users.paymentMethodLast4,
        brand: users.paymentMethodBrand,
        expMonth: users.paymentMethodExpMonth,
        expYear: users.paymentMethodExpYear,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return {
      stripeCustomerId: row?.customerId ?? null,
      card: row?.id
        ? {
            stripePaymentMethodId: row.id,
            paymentMethodLast4: row.last4 ?? "",
            paymentMethodBrand: row.brand ?? "",
            paymentMethodExpMonth: Number(row.expMonth ?? 0),
            paymentMethodExpYear: Number(row.expYear ?? 0),
          }
        : null,
    };
  },
  async update(userId, card) {
    await db.update(users).set({ ...card, paymentMethodAddedAt: new Date() } as any).where(eq(users.id, userId));
  },
  async clear(userId) {
    await db
      .update(users)
      .set({
        stripePaymentMethodId: null,
        paymentMethodLast4: null,
        paymentMethodBrand: null,
        paymentMethodExpMonth: null,
        paymentMethodExpYear: null,
        paymentMethodAddedAt: null,
        isVerified: false, // a card is required for verification
      } as any)
      .where(eq(users.id, userId));
  },
};

export type CardSyncStripe = Pick<Stripe, "customers" | "paymentMethods">;

const isMissing = (error: unknown) => {
  const err = error as { statusCode?: number; code?: string } | null;
  return err?.statusCode === 404 || err?.code === "resource_missing";
};

export function cardFieldsOf(pm: Stripe.PaymentMethod): CardFields | null {
  if (!pm.card) return null;
  return {
    stripePaymentMethodId: pm.id,
    paymentMethodLast4: pm.card.last4,
    paymentMethodBrand: pm.card.brand,
    paymentMethodExpMonth: pm.card.exp_month,
    paymentMethodExpYear: pm.card.exp_year,
  };
}

/** The card payment method if it exists and is attached to `customerId`; null if gone, detached or elsewhere. */
export async function attachedCard(stripe: CardSyncStripe, customerId: string, paymentMethodId: string) {
  try {
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    const owner = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
    return owner === customerId && pm.card ? pm : null;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/**
 * Stripe-side half of saving a card: attach it to the customer if it is unattached, make it the customer's
 * default (so the billing portal and subscriptions use it) and detach the card it replaces. Throws
 * `CardOwnershipError` for a payment method that belongs to another customer.
 */
export class CardOwnershipError extends Error {}
export async function attachAsDefault(
  stripe: Pick<Stripe, "customers" | "paymentMethods">,
  customerId: string,
  paymentMethod: Stripe.PaymentMethod,
  previousPaymentMethodId?: string | null,
) {
  const owner = typeof paymentMethod.customer === "string" ? paymentMethod.customer : paymentMethod.customer?.id;
  if (owner && owner !== customerId) throw new CardOwnershipError("This payment method does not belong to your account");
  if (!owner) await stripe.paymentMethods.attach(paymentMethod.id, { customer: customerId });
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethod.id } });
  if (previousPaymentMethodId && previousPaymentMethodId !== paymentMethod.id) {
    try {
      await stripe.paymentMethods.detach(previousPaymentMethodId);
    } catch (error) {
      console.error("Error detaching previous payment method:", error);
    }
  }
}

export type CardSyncResult =
  | { state: "none" }
  | { state: "ok" }
  | { state: "updated"; card: CardFields }
  | { state: "cleared" };

/**
 * Makes ShareSwap's stored card match Stripe. A stored card that is gone, detached, or attached to a
 * different customer than the user's current one is cleared. A card changed in the billing portal (the
 * customer's default is a different valid card) replaces the stored one. Stripe errors other than
 * "missing" are thrown so a network blip never wipes a good card.
 */
export async function syncCardWithStripe(stripe: CardSyncStripe, store: CardStore, userId: number): Promise<CardSyncResult> {
  const { stripeCustomerId, card } = await store.get(userId);
  if (!card) return { state: "none" };
  if (!stripeCustomerId) {
    await store.clear(userId);
    return { state: "cleared" };
  }

  let customer: Stripe.Customer | null = null;
  try {
    const found = await stripe.customers.retrieve(stripeCustomerId);
    customer = (found as Stripe.DeletedCustomer).deleted ? null : (found as Stripe.Customer);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  if (!customer) {
    await store.clear(userId);
    return { state: "cleared" };
  }

  const defaultRef = customer.invoice_settings?.default_payment_method;
  const defaultId = typeof defaultRef === "string" ? defaultRef : defaultRef?.id;
  if (defaultId && defaultId !== card.stripePaymentMethodId) {
    const chosen = await attachedCard(stripe, stripeCustomerId, defaultId);
    const fields = chosen && cardFieldsOf(chosen);
    if (fields) {
      await store.update(userId, fields);
      return { state: "updated", card: fields };
    }
  }

  const current = await attachedCard(stripe, stripeCustomerId, card.stripePaymentMethodId);
  if (!current) {
    await store.clear(userId);
    return { state: "cleared" };
  }
  const fields = cardFieldsOf(current)!;
  const changed =
    fields.paymentMethodLast4 !== card.paymentMethodLast4 ||
    fields.paymentMethodBrand !== card.paymentMethodBrand ||
    fields.paymentMethodExpMonth !== card.paymentMethodExpMonth ||
    fields.paymentMethodExpYear !== card.paymentMethodExpYear;
  if (changed) {
    await store.update(userId, fields);
    return { state: "updated", card: fields };
  }
  return { state: "ok" };
}

/**
 * Pre-charge guard: false only when Stripe says the stored card is definitely not usable (and it has been
 * cleared). If the check itself cannot run, the charge goes ahead and Stripe decides.
 */
export async function cardIsUsableBeforeCharge(stripe: CardSyncStripe, store: CardStore, userId: number): Promise<boolean> {
  try {
    return (await syncCardWithStripe(stripe, store, userId)).state !== "cleared";
  } catch (error) {
    console.warn("[card-sync] pre-charge card check skipped:", (error as Error)?.message);
    return true;
  }
}
