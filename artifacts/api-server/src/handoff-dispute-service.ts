import { and, eq, inArray, sql } from "drizzle-orm";
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
import { releaseHold, settleRequestCoins } from "./sharecoin-funds";
import { declineRequestsForGoneItems, involvedItemIds } from "./item-availability";

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

/** The exchanges an admin decides: a dispute (HANDOFF_DISPUTED) or an exchange flagged for review (HANDOFF_FLAGGED). Either decision applies to both. */
export const ADMIN_DECIDABLE_STATUSES = ["HANDOFF_DISPUTED", "HANDOFF_FLAGGED"] as const;
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
  if (!(ADMIN_DECIDABLE_STATUSES as readonly string[]).includes(row.item_requests.status)) return { status: 400, body: { error: "Request is not disputed or flagged" } };
  const fromStatus = row.item_requests.status as (typeof ADMIN_DECIDABLE_STATUSES)[number];
  const requestType = row.item_requests.requestType;
  const completesAtHandoff = requestType === "SWAP" || requestType === "GIFT";
  const thing = requestType === "RENT" ? "rental" : requestType === "BORROW" ? "borrow" : requestType === "SWAP" ? "swap" : "gift";
  const releaseReason = fromStatus === "HANDOFF_FLAGGED" ? "flag_rejected" : "dispute_released";
  const item = row.items;
  const ownerId = item.ownerId!;
  const borrowerId = row.item_requests.requesterId!;
  const name = shortName(item.name);

  if (decision === "owner") {
    const done = await db.transaction(async (tx) => {
      // The handoff stands. A borrow or rental goes on (IN_PROGRESS); a swap or gift is finished (COMPLETED). One that was never
      // confirmed (a flagged exchange, or a dispute opened before the handoff) gets the fields the handoff itself would have set.
      const neverConfirmed = !row.item_requests.handoffConfirmedAt;
      const [moved] = await tx.update(itemRequests).set({
        status: completesAtHandoff ? "COMPLETED" : "IN_PROGRESS",
        ...(neverConfirmed ? {
          handoffConfirmedAt: now, actualHandoffAt: now, confirmationMethod: "admin",
          ...(completesAtHandoff ? { completedAt: now } : { borrowPeriodStartedAt: now, depositStatus: "held" }),
        } : {}),
      } as any).where(and(eq(itemRequests.id, requestId), eq(itemRequests.status, fromStatus))).returning({ id: itemRequests.id });
      if (!moved) return null;
      // The hold was kept while the exchange was disputed or flagged; the handoff stands, so the coins it reserved now move.
      const settled = await settleRequestCoins(tx, { requestId, reason: "dispute_settled", itemName: item.name });
      if (requestType === "BORROW" && settled.settled) await tx.update(itemRequests).set({ shareCoinsCharged: true, shareCoinsChargedAt: now }).where(eq(itemRequests.id, requestId));
      await tx.update(items).set({ isAvailable: false }).where(eq(items.id, item.id));
      if (requestType === "SWAP") {
        const ids = involvedItemIds(row.item_requests);
        await tx.update(items).set({ isAvailable: false, isSwapped: true }).where(inArray(items.id, ids));
      }
      const earnings = await resolveFrozenRentalEarnings(requestId, "owner", tx);
      await tx.insert(requestLifecycleEvents).values({
        requestId, eventType: "HANDOFF_DISPUTE_RESOLVED", idempotencyKey: handoffDisputeResolvedKey(requestId), actorId: adminId, details: { decision, from: fromStatus },
      }).onConflictDoNothing();
      const ownerNote = `The ${fromStatus === "HANDOFF_FLAGGED" ? "review" : "dispute"} of "${name}" is decided: the handoff stands.${earnings ? " Any earnings on hold have been returned to your wallet." : ""}`;
      const requesterNote = `The ${fromStatus === "HANDOFF_FLAGGED" ? "review" : "dispute"} of "${name}" is decided: the handoff stands${completesAtHandoff ? ` and the ${thing} is complete` : ` and the ${thing} continues`}.`;
      await tx.insert(notifications).values([
        { userId: ownerId, type: "dispute_resolved", title: "Handoff decided", requestId, isRead: false, message: ownerNote },
        { userId: borrowerId, type: "dispute_resolved", title: "Handoff decided", requestId, isRead: false, message: requesterNote },
      ] as any);
      return { earnings };
    });
    if (done === null) return { status: 409, body: { error: "This exchange changed before it could be decided" } };
    // The items are gone: the other pending requests for them are declined ("This item is no longer available.").
    if (completesAtHandoff) await declineRequestsForGoneItems(requestId).catch((error) => console.error("[handoff-dispute] could not decline the other requests:", error));
    return { status: 200, body: { success: true, decision, earnings: done.earnings } };
  }

  // ── borrower ──
  const claim = await claimDepositTerminalAction(requestId, "cancel", now);
  if (claim.status !== "claimed") return { status: 409, body: { code: "BUSY", error: claim.reason, retryable: true } };
  const request = claim.request;
  if (request.status !== fromStatus) {
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
      cancelledFromStatus: fromStatus,
      cancelReason: fromStatus === "HANDOFF_FLAGGED" ? "handoff_flag_rejected" : "handoff_dispute_borrower",
      cancelledWithPenalty: false,
    }).where(and(
      eq(itemRequests.id, requestId),
      eq(itemRequests.depositRenewalStatus, "terminal_action"),
      eq(itemRequests.depositOperationToken, claim.operationToken),
    )).returning({ id: itemRequests.id });
    if (!updated) return null;
    // The handoff did not happen: the coins reserved for it are free again.
    await releaseHold(tx, requestId, releaseReason);
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
      { userId: ownerId, type: "dispute_resolved", title: "Handoff decided", requestId, isRead: false, message: `The ${fromStatus === "HANDOFF_FLAGGED" ? "review" : "dispute"} of "${name}" is decided: the handoff was not upheld and the ${thing} was cancelled.${earnings ? " Earnings from it were reversed." : ""}` },
      { userId: borrowerId, type: "dispute_resolved", title: "Handoff decided", requestId, isRead: false, message: `The ${fromStatus === "HANDOFF_FLAGGED" ? "review" : "dispute"} of "${name}" is decided: the handoff was not upheld and the ${thing} was cancelled.${requestType === "RENT" || requestType === "BORROW" ? " Your payment was refunded and your deposit released." : ""}` },
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
