import {
  db,
  itemRequests,
  items,
  messages,
  notifications,
  rentalPayouts,
  users,
} from "@workspace/db";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  claimDepositTerminalAction,
  releaseDepositTerminalClaim,
  resolveClaimedDepositIntents,
  type DepositRenewalStripeClient,
} from "./deposit-renewal-service";
import * as depositCopy from "./deposit-copy";
import { computeHandoffCutoff } from "./request-dates";
import * as copy from "./request-expiry-copy";

// A BORROW/RENT request that nobody handed off before its late-handoff cutoff
// moves to EXPIRED (final, and separate from CANCELLED/DECLINED).
//
//   - Only ACCEPTED and DEPOSIT_CONFIRMED expire. AWAITING_HANDOFF_CONFIRM means
//     someone already confirmed, so it is never expired here.
//   - The cutoff is derived from the agreed dates (see computeHandoffCutoff);
//     nothing here moves dates or recalculates ShareCoins.
//   - Money is only ever released: the deposit authorization is cancelled (never
//     captured) and any rental fee charged up front is refunded in full.
//
// Expiry is checked wherever a request is read or redeemed (expireRequestIfDue,
// guardHandoffWindow, expireDueRequestsForUser) and, separately, by
// runRequestExpirySweep. Nothing in this module schedules itself: the sweep only
// runs if something calls it.
//
// Races are settled by the same fence the cancel flow uses. The expiry claims the
// row (claimDepositTerminalAction: row lock + operation token), re-checks status
// and cutoff under that lock, and every handoff route refuses to move a request
// that carries an operation token. Whichever side commits first wins; the loser
// changes nothing.

export const EXPIRABLE_STATUSES = ["ACCEPTED", "DEPOSIT_CONFIRMED"] as const;
export const EXPIRABLE_REQUEST_TYPES = ["BORROW", "RENT"] as const;
/** The "hand off soon" reminder goes out this long before the cutoff. */
export const HANDOFF_REMINDER_LEAD_MS = 4 * 3_600_000;
/** Per-read cap so listing a user's requests never turns into a long batch of Stripe calls. */
const MAX_LAZY_EXPIRIES_PER_CALL = 10;

export type ExpiryRequest = typeof itemRequests.$inferSelect;

export interface RequestExpiryDeps {
  stripe: DepositRenewalStripeClient;
  /** Runs after an expiry commits; failures are ignored. */
  onItemFreed?: (itemId: number, itemName: string) => void | Promise<void>;
  /** Native push; failures are ignored. */
  push?: (
    userId: number,
    payload: { title: string; body: string; data?: Record<string, unknown> },
  ) => void | Promise<void>;
}

const isExpirableStatus = (status: string | null | undefined) =>
  (EXPIRABLE_STATUSES as readonly string[]).includes(status ?? "");
const isExpirableType = (type: string | null | undefined) =>
  (EXPIRABLE_REQUEST_TYPES as readonly string[]).includes(type ?? "");

type CutoffFields = Pick<
  ExpiryRequest,
  "startDate" | "endDate" | "counterStartDate" | "counterEndDate"
>;

/** Agreed dates are the counter-proposal when there is one, as everywhere else. */
export function requestHandoffCutoff(request: CutoffFields): Date | null {
  return computeHandoffCutoff(
    request.counterStartDate || request.startDate,
    request.counterEndDate || request.endDate,
  );
}

/** True when this request is BORROW/RENT, still unfulfilled, and past its cutoff. */
export function isDueForExpiry(
  request: CutoffFields & Pick<ExpiryRequest, "status" | "requestType">,
  now: Date,
): boolean {
  if (!isExpirableStatus(request.status) || !isExpirableType(request.requestType)) return false;
  const cutoff = requestHandoffCutoff(request);
  return cutoff !== null && now.getTime() > cutoff.getTime();
}

export type ExpireOutcome =
  | { status: "expired"; requestId: number; cutoff: Date }
  | { status: "not_applicable" | "not_due"; requestId: number }
  | { status: "busy"; requestId: number; reason: string }
  | { status: "failed"; requestId: number; error: string };

/** Stripe reports an already-refunded charge as an error; for us that is the goal state. */
function isAlreadyRefunded(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "charge_already_refunded";
}

async function refundUpfrontFees(
  request: ExpiryRequest,
  stripe: DepositRenewalStripeClient,
): Promise<boolean> {
  if (!stripe.refunds) return false;
  let refunded = false;

  // Rental fee (+ processing fee) is its own PaymentIntent, recorded on the held payout.
  const payouts = await db
    .select({ id: rentalPayouts.id, paymentIntentId: rentalPayouts.stripePaymentIntentId })
    .from(rentalPayouts)
    .where(and(eq(rentalPayouts.requestId, request.id), eq(rentalPayouts.status, "held")));
  const feeIntents = new Set<string>();
  for (const payout of payouts) {
    const intentId = payout.paymentIntentId;
    // A payout that points at the deposit intent is the legacy single-charge shape;
    // releasing the deposit (cancel, or refund of a refundable charge) already covered it.
    if (!intentId || intentId === request.depositPaymentIntentId) continue;
    if (intentId.startsWith("simulated-")) continue;
    feeIntents.add(intentId);
  }
  for (const intentId of feeIntents) {
    try {
      await stripe.refunds.create(
        { payment_intent: intentId },
        { idempotencyKey: `expire-refund-${request.id}-${intentId}` },
      );
      refunded = true;
    } catch (error) {
      if (!isAlreadyRefunded(error)) throw error;
      refunded = true;
    }
  }

  // A platform fee captured up front is a charge, not an intent.
  if (request.platformFeeChargeId && !request.platformFeeChargeId.startsWith("simulated-")) {
    try {
      await stripe.refunds.create(
        { charge: request.platformFeeChargeId },
        { idempotencyKey: `expire-refund-${request.id}-${request.platformFeeChargeId}` },
      );
      refunded = true;
    } catch (error) {
      if (!isAlreadyRefunded(error)) throw error;
      refunded = true;
    }
  }
  return refunded;
}

/**
 * Expire one request if (and only if) it is due. Safe to call on every read and
 * redemption, from several processes at once, and again after a failure.
 */
export async function expireRequestIfDue(
  requestId: number,
  deps: RequestExpiryDeps,
  now: Date = new Date(),
): Promise<ExpireOutcome> {
  const [row] = await db
    .select()
    .from(itemRequests)
    .innerJoin(items, eq(items.id, itemRequests.itemId))
    .where(eq(itemRequests.id, requestId))
    .limit(1);
  if (!row) return { status: "not_applicable", requestId };
  if (!isExpirableStatus(row.item_requests.status) || !isExpirableType(row.item_requests.requestType)) {
    return { status: "not_applicable", requestId };
  }
  if (!requestHandoffCutoff(row.item_requests)) return { status: "not_applicable", requestId };
  if (!isDueForExpiry(row.item_requests, now)) return { status: "not_due", requestId };

  const claim = await claimDepositTerminalAction(requestId, "cancel", now);
  if (claim.status !== "claimed") {
    return { status: "busy", requestId, reason: claim.reason };
  }
  const request = claim.request;

  // Re-check under the row lock: a handoff, cancellation or date change may have won.
  if (!isExpirableStatus(request.status)) {
    await releaseDepositTerminalClaim(claim);
    return { status: "not_applicable", requestId };
  }
  const cutoff = requestHandoffCutoff(request);
  if (!cutoff || !isDueForExpiry(request, now)) {
    await releaseDepositTerminalClaim(claim);
    return { status: "not_due", requestId };
  }

  let feeRefunded = false;
  try {
    await resolveClaimedDepositIntents(claim, deps.stripe, "cancel", {
      cancelIdempotencyKey: (paymentIntentId) => `expire-${requestId}-${paymentIntentId}`,
    });
    feeRefunded = await refundUpfrontFees(request, deps.stripe);
  } catch (error) {
    // Drop the claim so the next read or sweep retries; every Stripe call above
    // uses a deterministic idempotency key, so the retry cannot double-act.
    await releaseDepositTerminalClaim(claim).catch(() => {});
    return { status: "failed", requestId, error: error instanceof Error ? error.message : String(error) };
  }

  const ownerId = row.items.ownerId!;
  const borrowerId = request.requesterId!;
  const hadDeposit = Boolean(request.depositPaymentIntentId);

  const finalized = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(itemRequests)
      .set({
        status: copy.REQUEST_EXPIRED_STATUS,
        expiredAt: now,
        // The handoff code dies with the request.
        handoffPin: null,
        depositStatus: hadDeposit ? "released" : null,
        depositReleasedAt: hadDeposit ? now : null,
        depositPreviousPaymentIntentId: null,
        depositRenewalStatus: null,
        depositOperationToken: null,
        depositOperationType: null,
      })
      .where(
        and(
          eq(itemRequests.id, requestId),
          inArray(itemRequests.status, [...EXPIRABLE_STATUSES]),
          eq(itemRequests.depositRenewalStatus, "terminal_action"),
          eq(itemRequests.depositOperationToken, claim.operationToken),
          request.depositPaymentIntentId
            ? eq(itemRequests.depositPaymentIntentId, request.depositPaymentIntentId)
            : isNull(itemRequests.depositPaymentIntentId),
        ),
      )
      .returning({ id: itemRequests.id });
    if (!claimed) return false;

    // The item frees up for other neighbours.
    await tx.update(items).set({ isAvailable: true, updatedAt: now }).where(eq(items.id, row.items.id));

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

    await tx.insert(messages).values({
      content: copy.expiredChat(cutoff),
      senderId: ownerId,
      receiverId: borrowerId,
      messageType: "system",
      requestId,
    });
    if (hadDeposit && request.depositMethod !== "in_person") {
      await tx.insert(messages).values({
        content:
          request.depositMode === "refundable_charge"
            ? depositCopy.refundableRefundedChat(request.trustDepositAmount ?? 0)
            : depositCopy.holdReleasedChat(request.trustDepositAmount ?? 0),
        senderId: ownerId,
        receiverId: borrowerId,
        messageType: "system",
        requestId,
      });
    }

    const borrowerNotice = copy.expiredBorrowerNotice(row.items.name, cutoff, {
      depositReleased: hadDeposit,
      feeRefunded,
    });
    const ownerNotice = copy.expiredOwnerNotice(row.items.name, cutoff);
    await tx.insert(notifications).values([
      { userId: borrowerId, type: copy.REQUEST_EXPIRED_NOTIFICATION_TYPE, title: borrowerNotice.title, message: borrowerNotice.message, itemId: row.items.id, requestId },
      { userId: ownerId, type: copy.REQUEST_EXPIRED_NOTIFICATION_TYPE, title: ownerNotice.title, message: ownerNotice.message, itemId: row.items.id, requestId },
    ]);
    return { borrowerNotice, ownerNotice };
  });

  if (!finalized) {
    // The claim was superseded between the Stripe calls and the commit. Nothing
    // was changed here; whoever superseded it owns the row now.
    return { status: "busy", requestId, reason: "Request changed before it could expire" };
  }

  if (deps.push) {
    const data = { screen: "chat", requestId, itemId: row.items.id };
    await Promise.resolve(deps.push(borrowerId, { title: finalized.borrowerNotice.title, body: finalized.borrowerNotice.message, data })).catch(() => {});
    await Promise.resolve(deps.push(ownerId, { title: finalized.ownerNotice.title, body: finalized.ownerNotice.message, data })).catch(() => {});
  }
  if (deps.onItemFreed) {
    await Promise.resolve(deps.onItemFreed(row.items.id, row.items.name)).catch(() => {});
  }
  return { status: "expired", requestId, cutoff };
}

export type HandoffWindowGuard =
  | { blocked: false }
  | {
      blocked: true;
      code: typeof copy.REQUEST_EXPIRED_CODE;
      error: string;
      cutoff: Date | null;
      /** True once the request is stored as EXPIRED; false while it is past its cutoff but still being expired. */
      expired: boolean;
    };

/**
 * Call before accepting any handoff, payment or code redemption on a request.
 * Expires the request if it is due, and blocks the action whenever the window
 * is closed, even if the expiry itself could not complete yet (Stripe down).
 */
export async function guardHandoffWindow(
  requestId: number,
  deps: RequestExpiryDeps,
  now: Date = new Date(),
): Promise<HandoffWindowGuard> {
  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId)).limit(1);
  if (!request) return { blocked: false };
  if (request.status === copy.REQUEST_EXPIRED_STATUS) {
    const cutoff = requestHandoffCutoff(request);
    return { blocked: true, code: copy.REQUEST_EXPIRED_CODE, error: copy.requestExpiredError(cutoff), cutoff, expired: true };
  }
  if (!isDueForExpiry(request, now)) return { blocked: false };

  const outcome = await expireRequestIfDue(requestId, deps, now);
  if (outcome.status === "failed") {
    console.error(`[request-expiry] could not expire request ${requestId}: ${outcome.error}`);
  }
  const cutoff = requestHandoffCutoff(request);
  return {
    blocked: true,
    code: copy.REQUEST_EXPIRED_CODE,
    error: copy.requestExpiredError(cutoff),
    cutoff,
    expired: outcome.status === "expired",
  };
}

/** Read-time check for a user's own requests (as borrower or owner). */
export async function expireDueRequestsForUser(
  userId: number,
  deps: RequestExpiryDeps,
  now: Date = new Date(),
): Promise<number> {
  const rows = await db
    .select({
      id: itemRequests.id,
      status: itemRequests.status,
      requestType: itemRequests.requestType,
      startDate: itemRequests.startDate,
      endDate: itemRequests.endDate,
      counterStartDate: itemRequests.counterStartDate,
      counterEndDate: itemRequests.counterEndDate,
    })
    .from(itemRequests)
    .innerJoin(items, eq(items.id, itemRequests.itemId))
    .where(
      and(
        inArray(itemRequests.status, [...EXPIRABLE_STATUSES]),
        inArray(itemRequests.requestType, [...EXPIRABLE_REQUEST_TYPES]),
        or(eq(itemRequests.requesterId, userId), eq(items.ownerId, userId)),
      ),
    );

  let expired = 0;
  for (const row of rows.filter((r) => isDueForExpiry(r, now)).slice(0, MAX_LAZY_EXPIRIES_PER_CALL)) {
    try {
      const outcome = await expireRequestIfDue(row.id, deps, now);
      if (outcome.status === "expired") expired++;
      if (outcome.status === "failed") {
        console.error(`[request-expiry] could not expire request ${row.id}: ${outcome.error}`);
      }
    } catch (error) {
      console.error(`[request-expiry] error expiring request ${row.id}:`, error);
    }
  }
  return expired;
}

// ── Sweep ─────────────────────────────────────────────────────────────────────

export interface RequestExpiryCandidate {
  requestId: number;
  action: "expire" | "remind";
  itemName: string;
  cutoff: Date;
}

export interface RequestExpirySweepOptions {
  now?: Date;
  /** Select and report only; change nothing. */
  dryRun?: boolean;
  /** Restrict to these requests (tests, so they never touch unrelated rows). */
  onlyRequestIds?: number[];
}

export interface RequestExpirySweepResult {
  expiredCount: number;
  remindedCount: number;
  failedCount: number;
  dryRun: boolean;
  candidates: RequestExpiryCandidate[];
}

/**
 * One pass over every unfulfilled BORROW/RENT request: expire what is past its
 * cutoff, and remind both people about what is inside the reminder window.
 * Nothing calls this on a schedule; enabling a sweep is a separate decision.
 */
export async function runRequestExpirySweep(
  deps: RequestExpiryDeps,
  options: RequestExpirySweepOptions = {},
): Promise<RequestExpirySweepResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  const result: RequestExpirySweepResult = {
    expiredCount: 0,
    remindedCount: 0,
    failedCount: 0,
    dryRun,
    candidates: [],
  };

  const rows = await db
    .select()
    .from(itemRequests)
    .innerJoin(items, eq(items.id, itemRequests.itemId))
    .where(
      and(
        inArray(itemRequests.status, [...EXPIRABLE_STATUSES]),
        inArray(itemRequests.requestType, [...EXPIRABLE_REQUEST_TYPES]),
        ...(options.onlyRequestIds ? [inArray(itemRequests.id, options.onlyRequestIds)] : []),
      ),
    );

  for (const row of rows) {
    const request = row.item_requests;
    const cutoff = requestHandoffCutoff(request);
    if (!cutoff) continue;
    const nowMs = now.getTime();

    if (nowMs > cutoff.getTime()) {
      result.candidates.push({ requestId: request.id, action: "expire", itemName: row.items.name, cutoff });
      if (dryRun) continue;
      const outcome = await expireRequestIfDue(request.id, deps, now);
      if (outcome.status === "expired") result.expiredCount++;
      if (outcome.status === "failed") result.failedCount++;
      continue;
    }

    const reminderDue = nowMs >= cutoff.getTime() - HANDOFF_REMINDER_LEAD_MS && !request.expiryReminderSentAt;
    if (!reminderDue) continue;
    result.candidates.push({ requestId: request.id, action: "remind", itemName: row.items.name, cutoff });
    if (dryRun) continue;
    if (await sendHandoffReminder(request, row.items, cutoff, deps, now)) result.remindedCount++;
  }
  return result;
}

/** At-most-once: the conditional update on expiry_reminder_sent_at is the claim. */
async function sendHandoffReminder(
  request: ExpiryRequest,
  item: { id: number; name: string; ownerId: number | null },
  cutoff: Date,
  deps: RequestExpiryDeps,
  now: Date,
): Promise<boolean> {
  const notice = copy.handoffReminder(item.name, cutoff);
  const recipients = [request.requesterId, item.ownerId].filter((id): id is number => typeof id === "number");

  const sent = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(itemRequests)
      .set({ expiryReminderSentAt: now })
      .where(
        and(
          eq(itemRequests.id, request.id),
          isNull(itemRequests.expiryReminderSentAt),
          inArray(itemRequests.status, [...EXPIRABLE_STATUSES]),
        ),
      )
      .returning({ id: itemRequests.id });
    if (!claimed) return false;
    await tx.insert(notifications).values(
      recipients.map((userId) => ({
        userId,
        type: copy.HANDOFF_REMINDER_NOTIFICATION_TYPE,
        title: notice.title,
        message: notice.message,
        itemId: item.id,
        requestId: request.id,
      })),
    );
    return true;
  });

  if (sent && deps.push) {
    for (const userId of recipients) {
      await Promise.resolve(
        deps.push(userId, {
          title: notice.title,
          body: notice.message,
          data: { screen: "chat", requestId: request.id, itemId: item.id },
        }),
      ).catch(() => {});
    }
  }
  return sent;
}
