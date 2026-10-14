import { db, itemRequests, items, messages, notifications, rentalPayouts, users } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  claimDepositTerminalAction,
  releaseDepositTerminalClaim,
  resolveClaimedDepositIntents,
  type DepositRelease,
  type DepositRenewalStripeClient,
} from "./deposit-renewal-service";
import * as depositCopy from "./deposit-copy";
import {
  composeCancelMessage,
  penaltyAckRequiredError,
  REQUEST_ALREADY_CANCELLED_MESSAGE,
  type CancelDepositState,
} from "./cancel-copy";
import { classifyDepositState, cancelPenaltyApplies } from "./deposit-state";
import { buildRefundLedgerRows, insertRefundLedger, refundUpfrontCharges, type UpfrontRefund } from "./request-refunds";
import { applyCancellationAfterDepositPenalty, trustLevelForScore } from "./trust-score-service";

// Cancelling a BORROW or RENT request (POST /api/requests/:id/cancel).
//
//   - Free unless a deposit was authorized or paid: then the person cancelling loses CANCEL_PENALTY_POINTS
//     trust points, after they acknowledged it. The server decides from the request row it holds locked,
//     so a deposit placed between the tap and the request still triggers PENALTY_ACK_REQUIRED.
//   - Everything that was charged is given back: platform fee and rental payment are refunded, the
//     deposit hold is released or the refundable deposit refunded. Nothing is ever captured.
//   - Stripe goes first (fees, then the deposit). If any call fails, the request, the penalty and the
//     notifications are untouched and the caller can simply retry: every call has a deterministic key.
//     Then the status change, penalty, notifications and chat land in one transaction.
//   - Cancelling twice does nothing the second time.
//
// SWAP and GIFT do not come through here; they keep the original handler in routes.ts.

export const CANCEL_PENALTY_POINTS = 5;
export const PENALTY_ACK_REQUIRED_CODE = "PENALTY_ACK_REQUIRED";
export const CANCEL_REASONS = ["user_requested", "changed_plans", "item_unavailable", "other"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
export const DEFAULT_CANCEL_REASON: CancelReason = "user_requested";

/** HANDOFF_CONFIRMED is deliberately absent: the item may already have changed hands. */
export const CANCELABLE_STATUSES = ["PENDING", "ACCEPTED", "DEPOSIT_CONFIRMED"] as const;
export const CANCELLABLE_REQUEST_TYPES = ["BORROW", "RENT"] as const;

type RequestRow = typeof itemRequests.$inferSelect;

export interface CancelDeps {
  stripe: DepositRenewalStripeClient;
  /** Runs after the cancel commits; failures are ignored. */
  onItemFreed?: (itemId: number, itemName: string) => void | Promise<void>;
  /** Native push; failures are ignored. */
  push?: (
    userId: number,
    payload: { title: string; body: string; data?: Record<string, unknown> },
  ) => void | Promise<void>;
}

export interface CancelInput {
  requestId: number;
  actorId: number;
  /** From the request body; unknown values are rejected, absent means the default. */
  reason?: unknown;
  /** From the request body; must equal the penalty the server announced. */
  acknowledgePenalty?: unknown;
}

export interface CancelResult {
  status: number;
  body: Record<string, unknown>;
}

// ── Deposit state and the penalty rule (deposit-state.ts) ─────────────────────

export { classifyDepositState, cancelPenaltyApplies } from "./deposit-state";

function parseReason(raw: unknown): CancelReason | null {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_CANCEL_REASON;
  return typeof raw === "string" && (CANCEL_REASONS as readonly string[]).includes(raw) ? (raw as CancelReason) : null;
}

function isAcknowledged(raw: unknown): boolean {
  return raw === CANCEL_PENALTY_POINTS || raw === String(CANCEL_PENALTY_POINTS);
}

function statusRejection(status: string): CancelResult | null {
  if ((CANCELABLE_STATUSES as readonly string[]).includes(status)) return null;
  if (status === "HANDOFF_CONFIRMED") {
    return {
      status: 409,
      body: {
        code: "HANDOFF_ALREADY_CONFIRMED",
        error: "The handoff was already confirmed. Return the item or open a dispute instead.",
        currentStatus: status,
      },
    };
  }
  return {
    status: 400,
    body: { code: "INVALID_STATUS", error: "Cannot cancel request in current status", currentStatus: status },
  };
}

const alreadyCancelled = (request: RequestRow): CancelResult => ({
  status: 200,
  body: {
    success: true,
    alreadyCancelled: true,
    request: {
      id: request.id,
      status: "CANCELLED",
      // As recorded by the first cancel (null for requests cancelled before the record existed).
      cancelledAt: request.cancelledAt?.toISOString() ?? null,
      cancelledBy: request.cancelledBy ?? null,
      cancelledFromStatus: request.cancelledFromStatus ?? null,
    },
    outcome: null,
    message: REQUEST_ALREADY_CANCELLED_MESSAGE,
  },
});

const dollars = (cents: number | null | undefined) => (typeof cents === "number" ? cents / 100 : null);

// ── The cancel ───────────────────────────────────────────────────────────────

export async function cancelBorrowRentRequest(
  input: CancelInput,
  deps: CancelDeps,
  now: Date = new Date(),
): Promise<CancelResult> {
  const { requestId, actorId } = input;
  const reason = parseReason(input.reason);
  if (!reason) {
    return {
      status: 400,
      body: { code: "INVALID_REASON", error: "Unknown cancellation reason", allowed: [...CANCEL_REASONS] },
    };
  }

  const [row] = await db
    .select()
    .from(itemRequests)
    .innerJoin(items, eq(items.id, itemRequests.itemId))
    .where(eq(itemRequests.id, requestId))
    .limit(1);
  if (!row) return { status: 404, body: { error: "Request not found" } };

  const item = row.items;
  const isOwner = item.ownerId === actorId;
  const isRequester = row.item_requests.requesterId === actorId;
  if (!isOwner && !isRequester) return { status: 403, body: { error: "Unauthorized" } };

  if (row.item_requests.status === "CANCELLED") return alreadyCancelled(row.item_requests);
  const earlyRejection = statusRejection(row.item_requests.status);
  if (earlyRejection) return earlyRejection;

  const claim = await claimDepositTerminalAction(requestId, "cancel", now);
  if (claim.status !== "claimed") {
    return { status: 409, body: { code: "BUSY", error: claim.reason } };
  }
  const request = claim.request;

  // Everything below is decided on the row as it is under the lock.
  if (request.status === "CANCELLED") {
    await releaseDepositTerminalClaim(claim);
    return alreadyCancelled(request);
  }
  const lockedRejection = statusRejection(request.status);
  if (lockedRejection) {
    await releaseDepositTerminalClaim(claim);
    return lockedRejection;
  }

  const depositState = classifyDepositState(request);
  const penalty = cancelPenaltyApplies(depositState);
  if (penalty && !isAcknowledged(input.acknowledgePenalty)) {
    await releaseDepositTerminalClaim(claim);
    return {
      status: 409,
      body: {
        code: PENALTY_ACK_REQUIRED_CODE,
        error: penaltyAckRequiredError(CANCEL_PENALTY_POINTS),
        penalty: { points: CANCEL_PENALTY_POINTS, type: "cancel_after_deposit" },
        depositState,
        requestStatus: request.status,
      },
    };
  }

  // ── Stripe first. Fees, then the deposit: if the last step fails the deposit is still in place. ──
  let upfront: UpfrontRefund[];
  let releases: DepositRelease[];
  try {
    upfront = await refundUpfrontCharges(request, deps.stripe, { keyPrefix: "cancel" });
    releases = await resolveClaimedDepositIntents(claim, deps.stripe, "cancel", {
      cancelIdempotencyKey: (paymentIntentId) => `cancel-${requestId}-${paymentIntentId}`,
    });
  } catch (error) {
    await releaseDepositTerminalClaim(claim).catch(() => {});
    console.error(
      `[cancel] could not release the payments for request ${requestId} (deposit intent ${request.depositPaymentIntentId ?? "none"}); left as it was, safe to retry:`,
      error,
    );
    return {
      status: 502,
      body: {
        code: "REFUND_FAILED",
        error: "We couldn't release your payment. Nothing was changed — please try again.",
        retryable: true,
      },
    };
  }

  // What Stripe did, for the refund ledger (including the processing fee it kept). Never blocks the cancel.
  const ledger = await buildRefundLedgerRows(deps.stripe, request, upfront, releases);

  const otherPartyId = isOwner ? request.requesterId! : item.ownerId!;
  const hadDeposit = Boolean(request.depositPaymentIntentId);
  const cancelledByLabel = isOwner ? "The owner" : "The borrower";
  const depositAmount = request.trustDepositAmount === null ? null : Number(request.trustDepositAmount);

  let finalized: {
    penaltyPoints: number;
    newScore: number | null;
  } | null;
  try {
    finalized = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(itemRequests)
        .set({
          status: "CANCELLED",
          depositStatus: hadDeposit ? "released" : null,
          depositReleasedAt: hadDeposit ? now : null,
          depositPreviousPaymentIntentId: null,
          depositRenewalStatus: null,
          depositOperationToken: null,
          depositOperationType: null,
          // Keep the cancelled thread in the active inbox until the other party reads the event.
          unarchivedAt: now,
          // The cancellation record.
          cancelledAt: now,
          cancelledBy: actorId,
          cancelledFromStatus: request.status,
          cancelReason: reason,
          cancelledWithPenalty: penalty,
          cancelDepositState: depositState,
        })
        .where(
          and(
            eq(itemRequests.id, requestId),
            eq(itemRequests.depositRenewalStatus, "terminal_action"),
            eq(itemRequests.depositOperationToken, claim.operationToken),
            request.depositPaymentIntentId
              ? eq(itemRequests.depositPaymentIntentId, request.depositPaymentIntentId)
              : isNull(itemRequests.depositPaymentIntentId),
          ),
        )
        .returning({ id: itemRequests.id });
      if (!updated) return null;

      await insertRefundLedger(tx, requestId, "cancel", ledger);
      await tx.update(items).set({ isAvailable: true, updatedAt: now }).where(eq(items.id, item.id));

      // Void any held rental payout and reverse the owner's pending balance.
      const [heldPayout] = await tx
        .select({ id: rentalPayouts.id, netAmount: rentalPayouts.netAmount, userId: rentalPayouts.userId })
        .from(rentalPayouts)
        .where(and(eq(rentalPayouts.requestId, requestId), eq(rentalPayouts.status, "held")))
        .limit(1);
      if (heldPayout) {
        await tx.update(rentalPayouts).set({ status: "cancelled" }).where(eq(rentalPayouts.id, heldPayout.id));
        const reverseAmount = parseFloat(heldPayout.netAmount || "0");
        if (reverseAmount > 0) {
          await tx
            .update(users)
            .set({ pendingRentalBalance: sql`GREATEST(0, COALESCE(${users.pendingRentalBalance}, 0) - ${reverseAmount})` })
            .where(eq(users.id, heldPayout.userId));
        }
      }

      // The cancellation event, same shape the chat already understands.
      await tx.insert(messages).values({
        senderId: actorId,
        receiverId: otherPartyId,
        content: "request_cancelled",
        messageType: "event",
        metadata: { eventType: "request_cancelled", cancelledByRole: isOwner ? "owner" : "requester", itemName: item.name },
        requestId,
      });
      if (hadDeposit && request.depositMethod !== "in_person") {
        const refundable = request.depositMode === "refundable_charge";
        const amount = Number(request.trustDepositAmount ?? 0);
        await tx.insert(messages).values({
          senderId: item.ownerId!,
          receiverId: request.requesterId!,
          content: refundable ? depositCopy.refundableRefundedChat(amount) : depositCopy.holdReleasedChat(amount),
          messageType: "event",
          metadata: { eventType: "deposit_released", depositMode: refundable ? "refundable_charge" : "authorization", amount },
          requestId,
        });
      }

      await tx.insert(notifications).values({
        userId: otherPartyId,
        type: "request_cancelled",
        title: "Request Cancelled",
        message: `"${item.name}" — ${cancelledByLabel.toLowerCase()} cancelled the request.`,
        itemId: item.id,
        requestId,
        isRead: false,
      });

      let penaltyPoints = 0;
      let newScore: number | null = null;
      if (penalty) {
        const result = await applyCancellationAfterDepositPenalty(actorId, requestId, item.id, tx);
        penaltyPoints = result.pointsDeducted;
        newScore = result.newScore;
        if (penaltyPoints > 0) {
          const levelAfter = trustLevelForScore(result.newScore);
          const levelChanged = levelAfter !== trustLevelForScore(result.previousScore);
          await tx.insert(notifications).values({
            userId: actorId,
            type: "trust_score_changed",
            title: `Trust Score -${penaltyPoints}`,
            message: levelChanged
              ? `Cancelled after a deposit -${penaltyPoints}. Now ${levelAfter}.`
              : `Cancelled after a deposit -${penaltyPoints}`,
            itemId: item.id,
            requestId,
            isRead: false,
          });
        }
      }
      return { penaltyPoints, newScore };
    });
  } catch (error) {
    await releaseDepositTerminalClaim(claim).catch(() => {});
    console.error(`[cancel] could not record the cancellation of request ${requestId}; safe to retry:`, error);
    return {
      status: 500,
      body: { code: "CANCEL_FAILED", error: "Failed to cancel request", retryable: true },
    };
  }

  if (!finalized) {
    // The claim was superseded between the Stripe calls and the commit. Nothing here changed.
    return { status: 409, body: { code: "BUSY", error: "Request changed before cancellation could complete" } };
  }

  // After the commit: availability alerts and push. Failures never undo the cancel.
  if (deps.onItemFreed) await Promise.resolve(deps.onItemFreed(item.id, item.name)).catch(() => {});
  if (deps.push) {
    await Promise.resolve(
      deps.push(otherPartyId, {
        title: "Request Cancelled",
        body: `"${item.name}" — ${cancelledByLabel.toLowerCase()} cancelled the request.`,
        data: { screen: "chat", chatUserId: actorId, requestId, itemId: item.id },
      }),
    ).catch(() => {});
  }

  const platformFee = upfront.find((r) => r.kind === "platform_fee_refund");
  const rental = upfront.find((r) => r.kind === "rental_refund");
  const platformFeeRefunded = dollars(platformFee?.amountCents);
  const rentalRefunded = dollars(rental?.amountCents);
  const deposit =
    depositState === "authorized" ? "hold_released"
    : depositState === "charged" ? "charge_refunded"
    : depositState === "in_person" ? "in_person"
    : "none";
  const shownDepositAmount = depositState === "authorized" || depositState === "charged" ? depositAmount : null;

  return {
    status: 200,
    body: {
      success: true,
      alreadyCancelled: false,
      request: {
        id: requestId,
        status: "CANCELLED",
        cancelledAt: now.toISOString(),
        cancelledBy: actorId,
        cancelledFromStatus: request.status,
      },
      outcome: {
        deposit,
        depositAmount: shownDepositAmount,
        platformFeeRefunded,
        rentalRefunded,
        penaltyApplied: finalized.penaltyPoints > 0,
        penaltyPoints: finalized.penaltyPoints,
        newScore: finalized.newScore,
      },
      message: composeCancelMessage({
        role: isOwner ? "owner" : "requester",
        depositState,
        depositAmount: shownDepositAmount,
        platformFeeRefunded,
        rentalRefunded,
        platformFeeRefundedUnknownAmount: Boolean(platformFee && platformFee.amountCents === null && platformFee.refundId),
        rentalRefundedUnknownAmount: Boolean(rental && rental.amountCents === null && rental.refundId),
        penaltyPoints: finalized.penaltyPoints,
      }),
    },
  };
}
