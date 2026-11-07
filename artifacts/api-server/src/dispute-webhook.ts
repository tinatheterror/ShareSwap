import type { Request, Response } from "express";
import type Stripe from "stripe";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, itemRequests, PLATFORM_CURRENCY, rentalPayouts, walletTransactions } from "@workspace/db";
import { getUncachableStripeClient } from "./stripe.server";
import { recordCurrency } from "./payment-currency";
import { closeChargeback, recordChargeback, recordChargebackFee } from "./wallet-chargebacks";

/**
 * Stripe dispute (chargeback) events, charged back to the member who received the money (see wallet-chargebacks.ts).
 * Events handled: charge.dispute.created, charge.dispute.funds_withdrawn, charge.dispute.closed.
 * Fails closed like the subscription webhook: without the secret, a signature header, a raw body and a valid signature
 * nothing is read or changed. Expects the raw body (see app.ts).
 */
export const DISPUTE_WEBHOOK_SECRET_ENV = "STRIPE_DISPUTE_WEBHOOK_SECRET";

export type DisputeWebhookStripe = Pick<Stripe, "webhooks">;

export interface DisputeLiability {
  userId: number;
  requestId: number | null;
  currency: string;
  /** The member's share of the disputed payment, in cents, never more than the disputed amount. */
  principalCents: number;
}

/**
 * Who the disputed payment paid. A rental payment pays the owner's net earnings for that request; a deposit that was
 * charged for a claim pays the claim award that was credited to the owner. Anything else (the platform's own fees,
 * subscriptions, an award that went to manual payout) is not recovered from a wallet: returns null.
 */
export async function findDisputeLiability(paymentIntentId: string, disputedCents: number): Promise<DisputeLiability | null> {
  const [payout] = await db.select().from(rentalPayouts)
    .where(and(eq(rentalPayouts.stripePaymentIntentId, paymentIntentId), inArray(rentalPayouts.status, ["released", "frozen", "held", "paid_out"])))
    .orderBy(desc(rentalPayouts.id)).limit(1);
  if (payout?.requestId) {
    const [request] = await db.select({ paymentCurrency: itemRequests.paymentCurrency }).from(itemRequests).where(eq(itemRequests.id, payout.requestId)).limit(1);
    const currency = recordCurrency(request ?? {});
    // Earnings in another currency were never credited to the (CAD) wallet, so there is nothing in it to take back.
    if (currency !== PLATFORM_CURRENCY) return null;
    return {
      userId: payout.userId, requestId: payout.requestId, currency,
      principalCents: Math.min(Math.round(Number(payout.netAmount) * 100), disputedCents),
    };
  }
  const [request] = await db.select({ id: itemRequests.id, paymentCurrency: itemRequests.paymentCurrency }).from(itemRequests).where(eq(itemRequests.depositPaymentIntentId, paymentIntentId)).limit(1);
  if (request) {
    const [award] = await db.select().from(walletTransactions).where(and(eq(walletTransactions.requestId, request.id), eq(walletTransactions.kind, "claim_award"))).limit(1);
    if (award) return { userId: award.userId, requestId: request.id, currency: award.currency, principalCents: Math.min(award.amountCents, disputedCents) };
  }
  return null;
}

/** The fee Stripe charged for the dispute, in cents: the fees on the dispute's balance transactions. */
export function disputeFeeCents(dispute: any): number {
  const transactions: any[] = Array.isArray(dispute?.balance_transactions) ? dispute.balance_transactions : [];
  return transactions.reduce((total, bt) => total + (Number(bt?.fee) > 0 ? Number(bt.fee) : 0), 0);
}

/**
 * What Stripe gave back to us on a closed dispute, in cents: the money that came back on the dispute's balance transactions
 * (positive net). The withdrawal and its fee are negative net and do not count.
 */
export function disputeReturnedCents(dispute: any): number {
  const transactions: any[] = Array.isArray(dispute?.balance_transactions) ? dispute.balance_transactions : [];
  return transactions.reduce((total, bt) => total + (Number(bt?.net) > 0 ? Number(bt.net) : 0), 0);
}

export async function handleDisputeEvent(event: Pick<Stripe.Event, "type" | "data">): Promise<string> {
  const dispute: any = event.data.object;
  const disputeId = String(dispute?.id ?? "");
  if (!disputeId) return "ignored: no dispute id";

  if (event.type === "charge.dispute.created") {
    const paymentIntentId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
    if (!paymentIntentId) return "ignored: dispute has no payment intent";
    const liability = await findDisputeLiability(paymentIntentId, Number(dispute.amount) || 0);
    if (!liability || liability.principalCents <= 0) {
      console.warn(`[dispute-webhook] dispute ${disputeId} on ${paymentIntentId} matches no wallet earnings or claim award; nothing recovered`);
      return "ignored: no member to recover from";
    }
    return recordChargeback({ ...liability, disputeId, paymentIntentId });
  }
  if (event.type === "charge.dispute.funds_withdrawn") {
    return recordChargebackFee(disputeId, disputeFeeCents(dispute));
  }
  if (event.type === "charge.dispute.closed") {
    return closeChargeback(disputeId, dispute.status === "lost" ? "lost" : "won", { returnedCents: disputeReturnedCents(dispute), disputeAmountCents: Number(dispute.amount) || 0 });
  }
  return "ignored: event type not handled";
}

export function disputeWebhookHandler(deps: { getStripe?: () => Promise<DisputeWebhookStripe>; getSecret?: () => string | undefined; handle?: typeof handleDisputeEvent } = {}) {
  const getStripe = deps.getStripe ?? getUncachableStripeClient;
  const getSecret = deps.getSecret ?? (() => process.env[DISPUTE_WEBHOOK_SECRET_ENV]);
  const handle = deps.handle ?? handleDisputeEvent;

  return async (req: Request, res: Response) => {
    const secret = getSecret()?.trim();
    const sig = req.headers["stripe-signature"];
    if (!secret) {
      console.error(`Dispute webhook rejected: ${DISPUTE_WEBHOOK_SECRET_ENV} is not set.`);
      return res.status(400).json({ error: "Webhook not configured" });
    }
    if (typeof sig !== "string" || !sig) return res.status(400).json({ error: "Missing signature" });
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: "Invalid body" });

    let event: Stripe.Event;
    try {
      event = (await getStripe()).webhooks.constructEvent(req.body, sig, secret);
    } catch (err: any) {
      console.error("Dispute webhook rejected: signature verification failed:", err?.message);
      return res.status(400).json({ error: "Invalid signature" });
    }
    try {
      const outcome = await handle(event);
      console.log(`[dispute-webhook] ${event.type} ${(event.data.object as any)?.id}: ${outcome}`);
      return res.json({ received: true });
    } catch (error) {
      console.error("Dispute webhook processing error:", error);
      return res.status(500).json({ error: "Webhook processing failed" });
    }
  };
}
