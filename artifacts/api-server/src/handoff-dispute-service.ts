import { and, eq, sql } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, PLATFORM_CURRENCY, rentalPayouts, requestLifecycleEvents } from "@workspace/db";
import {
  claimDepositTerminalAction,
  releaseDepositTerminalClaim,
  resolveClaimedDepositIntents,
  type DepositRelease,
  type DepositRenewalStripeClient,
} from "./deposit-renewal-service";
import { recordCurrency } from "./payment-currency";
import { buildRefundLedgerRows, insertRefundLedger, refundUpfrontCharges, type UpfrontRefund } from "./request-refunds";
import { resolveFrozenRentalEarnings } from "./rental-earnings-freeze";
import { closeChargeback, recordChargeback } from "./wallet-chargebacks";
import { toCents } from "./wallet-ledger";

/**
 * An admin's decision on a handoff dispute opened after an auto-confirm (status HANDOFF_DISPUTED).
 *   owner   : the handoff stands. The rental goes on (IN_PROGRESS) and the owner's frozen earnings return to the wallet.
 *   borrower: the item was never handed over. Stripe first: the borrower's rental payment and platform fee are refunded in
 *             full and the deposit hold is released (or the charged deposit refunded), every call with a deterministic
 *             idempotency key. Only when that succeeded does one transaction cancel the request, record the refunds in the
 *             refund ledger and reverse the owner's earnings. A Stripe failure changes nothing and the call can be repeated.
 * A repeated call with the same decision is answered as already resolved and does nothing; the other decision is a 409.
 */
export type HandoffDisputeDecision = "owner" | "borrower";
export interface ServiceResult { status: number; body: Record<string, unknown> }

export const handoffDisputeResolvedKey = (requestId: number) => `handoff-dispute-resolved-${requestId}`;

const shortName = (name: string) => (name.length > 20 ? `${name.slice(0, 20)}…` : name);

async function recordedDecision(requestId: number): Promise<HandoffDisputeDecision | null> {
  const [event] = await db.select().from(requestLifecycleEvents).where(eq(requestLifecycleEvents.idempotencyKey, handoffDisputeResolvedKey(requestId))).limit(1);
  const decision = (event?.details as { decision?: string } | null)?.decision;
  return decision === "owner" || decision === "borrower" ? decision : null;
}

export async function resolveHandoffDispute(input: {
  requestId: number;
  decision: HandoffDisputeDecision;
  adminId: number | null;
  stripe: DepositRenewalStripeClient;
  now?: Date;
}): Promise<ServiceResult> {
  const { requestId, decision, adminId, stripe } = input;
  const now = input.now ?? new Date();

  const previous = await recordedDecision(requestId);
  if (previous) {
    return previous === decision
      ? { status: 200, body: { success: true, decision, alreadyResolved: true } }
      : { status: 409, body: { error: `This dispute was already resolved in favour of the ${previous}.` } };
  }

  const [row] = await db.select().from(itemRequests).innerJoin(items, eq(items.id, itemRequests.itemId)).where(eq(itemRequests.id, requestId)).limit(1);
  if (!row) return { status: 404, body: { error: "Request not found" } };
  if (row.item_requests.status !== "HANDOFF_DISPUTED") return { status: 400, body: { error: "Request is not in HANDOFF_DISPUTED status" } };
  const item = row.items;
  const ownerId = item.ownerId!;
  const borrowerId = row.item_requests.requesterId!;
  const name = shortName(item.name);

  if (decision === "owner") {
    const done = await db.transaction(async (tx) => {
      const [moved] = await tx.update(itemRequests).set({ status: "IN_PROGRESS" })
        .where(and(eq(itemRequests.id, requestId), eq(itemRequests.status, "HANDOFF_DISPUTED"))).returning({ id: itemRequests.id });
      if (!moved) return null;
      const earnings = await resolveFrozenRentalEarnings(requestId, "owner", tx);
      await tx.insert(requestLifecycleEvents).values({
        requestId, eventType: "HANDOFF_DISPUTE_RESOLVED", idempotencyKey: handoffDisputeResolvedKey(requestId), actorId: adminId, details: { decision },
      }).onConflictDoNothing();
      await tx.insert(notifications).values([
        { userId: ownerId, type: "dispute_resolved", title: "Handoff dispute resolved", requestId, isRead: false, message: `The handoff of "${name}" stands. Any earnings on hold have been returned to your wallet.` },
        { userId: borrowerId, type: "dispute_resolved", title: "Handoff dispute resolved", requestId, isRead: false, message: `The handoff of "${name}" stands and the rental continues.` },
      ] as any);
      return earnings;
    });
    if (done === null) return { status: 409, body: { error: "Dispute changed before it could be resolved" } };
    return { status: 200, body: { success: true, decision, earnings: done } };
  }

  // ── borrower ──
  const claim = await claimDepositTerminalAction(requestId, "cancel", now);
  if (claim.status !== "claimed") return { status: 409, body: { code: "BUSY", error: claim.reason, retryable: true } };
  const request = claim.request;
  if (request.status !== "HANDOFF_DISPUTED") {
    await releaseDepositTerminalClaim(claim);
    const decided = await recordedDecision(requestId);
    return decided === "borrower"
      ? { status: 200, body: { success: true, decision, alreadyResolved: true } }
      : { status: 409, body: { error: "Dispute changed before it could be resolved" } };
  }

  // Stripe first: the rental payment and platform fee, then the deposit. If a step fails the request is untouched.
  let upfront: UpfrontRefund[];
  let releases: DepositRelease[];
  try {
    upfront = await refundUpfrontCharges(request, stripe, { keyPrefix: "handoff-dispute", payoutStatuses: ["frozen", "released", "reversed"] });
    releases = await resolveClaimedDepositIntents(claim, stripe, "cancel", {
      cancelIdempotencyKey: (paymentIntentId) => `handoff-dispute-${requestId}-${paymentIntentId}`,
    });
  } catch (error) {
    await releaseDepositTerminalClaim(claim).catch(() => {});
    console.error(`[handoff-dispute] could not refund request ${requestId}; left as it was, safe to retry:`, error);
    return { status: 502, body: { code: "REFUND_FAILED", error: "Stripe did not confirm the refund. Nothing was changed; repeating the call is safe.", retryable: true } };
  }
  const ledger = await buildRefundLedgerRows(stripe, request, upfront, releases);
  const hadDeposit = Boolean(request.depositPaymentIntentId);

  const outcome = await db.transaction(async (tx) => {
    const [updated] = await tx.update(itemRequests).set({
      status: "CANCELLED",
      depositStatus: hadDeposit ? "released" : null,
      depositReleasedAt: hadDeposit ? now : null,
      depositPreviousPaymentIntentId: null,
      depositRenewalStatus: null,
      depositOperationToken: null,
      depositOperationType: null,
      unarchivedAt: now,
      cancelledAt: now,
      cancelledBy: adminId,
      cancelledFromStatus: "HANDOFF_DISPUTED",
      cancelReason: "handoff_dispute_borrower",
      cancelledWithPenalty: false,
    }).where(and(
      eq(itemRequests.id, requestId),
      eq(itemRequests.depositRenewalStatus, "terminal_action"),
      eq(itemRequests.depositOperationToken, claim.operationToken),
    )).returning({ id: itemRequests.id });
    if (!updated) return null;
    await insertRefundLedger(tx, requestId, "cancel", ledger);
    await tx.update(items).set({ isAvailable: true, updatedAt: now }).where(eq(items.id, item.id));
    const earnings = await resolveFrozenRentalEarnings(requestId, "borrower", tx);
    await tx.insert(requestLifecycleEvents).values({
      requestId, eventType: "HANDOFF_DISPUTE_RESOLVED", idempotencyKey: handoffDisputeResolvedKey(requestId), actorId: adminId,
      details: { decision, refundedPayments: upfront.length, depositReleases: releases.length },
    }).onConflictDoNothing();
    await tx.insert(messages).values({
      senderId: ownerId, receiverId: borrowerId, messageType: "event", requestId, content: "request_cancelled",
      metadata: { eventType: "request_cancelled", cancelledByRole: "admin", itemName: item.name },
    } as any);
    await tx.insert(notifications).values([
      { userId: ownerId, type: "dispute_resolved", title: "Handoff dispute resolved", requestId, isRead: false, message: `The handoff of "${name}" was not upheld and the rental was cancelled. Earnings from it were reversed.` },
      { userId: borrowerId, type: "dispute_resolved", title: "Handoff dispute resolved", requestId, isRead: false, message: `The handoff of "${name}" was not upheld and the rental was cancelled. Your payment was refunded and your deposit released.` },
    ] as any);
    return { earnings };
  });
  if (!outcome) {
    await releaseDepositTerminalClaim(claim).catch(() => {});
    return { status: 500, body: { code: "RESOLVE_FAILED", error: "The refunds went through but the dispute could not be recorded. Repeating the call is safe.", retryable: true } };
  }

  // If the dispute was opened before the earnings could be frozen, they are still in the owner's wallet: take them back the
  // way a lost chargeback is taken (from the balance, never below zero; the rest becomes a debt paid by later earnings).
  let recovered: string | null = null;
  const [payout] = await db.select().from(rentalPayouts).where(and(eq(rentalPayouts.requestId, requestId), eq(rentalPayouts.status, "released"))).limit(1);
  if (payout && recordCurrency(request) === PLATFORM_CURRENCY) {
    const disputeId = `handoff-dispute-${requestId}`;
    const claimed = await db.update(rentalPayouts).set({ status: "reversed" }).where(and(eq(rentalPayouts.id, payout.id), eq(rentalPayouts.status, "released"))).returning({ id: rentalPayouts.id });
    if (claimed.length > 0) {
      recovered = await recordChargeback({ userId: payout.userId, disputeId, paymentIntentId: null, requestId, currency: PLATFORM_CURRENCY, principalCents: toCents(payout.netAmount) });
      await closeChargeback(disputeId, "lost");
    }
  }
  return { status: 200, body: { success: true, decision, refunded: upfront.map(r => r.stripeId), depositReleases: releases.map(r => r.action), earnings: outcome.earnings, earningsRecovered: recovered } };
}
