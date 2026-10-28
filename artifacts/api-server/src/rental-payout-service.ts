import { and, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { db, itemRequests, items, notifications, PLATFORM_CURRENCY, rentalPayouts, users } from "@workspace/db";
import { stripeOutcomeIsIndeterminate } from "./stripe-outcome";

export type PayoutStripeClient = {
  transfers: { create(params: any, options?: any): Promise<{ id: string }> };
};

/** Statuses of a wallet withdrawal whose Stripe transfer has not been settled either way. */
const IN_FLIGHT = ["pending_payout", "manual_review"];
/** Stripe keeps an idempotency key for 24 hours; past that a replay could send the money a second time. */
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
export const MIN_PAYOUT = 10;

export const payoutIdempotencyKey = (payoutId: number) => `rental-payout-${payoutId}`;

export type PayoutRow = typeof rentalPayouts.$inferSelect;

export type PayoutFailure = { ok: false; status: number; code: string; error: string; payoutId?: number };
export type PayoutOutcome = { ok: true; payout: PayoutRow; transferId: string } | PayoutFailure;

const toDollars = (cents: number) => (cents / 100).toFixed(2);

/**
 * Takes the amount out of the wallet and records the withdrawal as pending_payout in one transaction.
 * The conditional UPDATE is what makes concurrent withdrawals safe: only a statement that still sees
 * enough balance matches a row, so two requests can never spend the same money.
 */
export async function reservePayout(userId: number, cents: number): Promise<PayoutRow | null> {
  const amount = toDollars(cents);
  return db.transaction(async (tx) => {
    const reserved = await tx
      .update(users)
      .set({ rentalBalance: sql`COALESCE(${users.rentalBalance}, 0) - ${amount}::numeric` })
      .where(and(eq(users.id, userId), sql`COALESCE(${users.rentalBalance}, 0) >= ${amount}::numeric`))
      .returning({ id: users.id });
    if (reserved.length === 0) return null;
    const [row] = await tx.insert(rentalPayouts).values({
      userId,
      requestId: null,
      amount,
      rentalAmount: amount,
      platformFee: "0",
      processingFee: "0",
      netAmount: amount,
      status: "pending_payout",
    }).returning();
    return row;
  });
}

/** Marks the withdrawal failed and puts the money back, once: only a row still in flight is restored. */
async function failAndRestore(row: PayoutRow): Promise<boolean> {
  return db.transaction(async (tx) => {
    const failed = await tx
      .update(rentalPayouts)
      .set({ status: "failed" })
      .where(and(eq(rentalPayouts.id, row.id), inArray(rentalPayouts.status, IN_FLIGHT)))
      .returning({ id: rentalPayouts.id });
    if (failed.length === 0) return false;
    await tx
      .update(users)
      .set({ rentalBalance: sql`COALESCE(${users.rentalBalance}, 0) + ${row.netAmount}::numeric` })
      .where(eq(users.id, row.userId));
    return true;
  });
}

/** Never throws: it runs inside a failure handler, and the log line is what an admin searches for. */
async function flagForManualReview(row: PayoutRow, error: unknown) {
  try {
    console.error(
      `[payout] transfer outcome unknown for rental payout ${row.id} (user ${row.userId}, $${row.netAmount}); ` +
        `balance not restored, idempotency key ${payoutIdempotencyKey(row.id)}:`,
      error,
    );
    await db.update(rentalPayouts).set({ status: "manual_review" })
      .where(and(eq(rentalPayouts.id, row.id), inArray(rentalPayouts.status, IN_FLIGHT)));
  } catch (flagError) {
    try { console.error(`[payout] could not flag rental payout ${row.id} for manual review:`, flagError); } catch { /* nothing left to do */ }
  }
}

/** A concurrent replay of the same key is "in progress", not a refusal, so it must never restore the balance. */
function transferIsUncertain(error: unknown) {
  const value = error as any;
  return stripeOutcomeIsIndeterminate(error) ||
    value?.type === "StripeIdempotencyError" || value?.code === "idempotency_key_in_use";
}

function definitiveFailure(row: PayoutRow, error: unknown): PayoutOutcome {
  const code = (error as any)?.code;
  if (code === "balance_insufficient") {
    return {
      ok: false, status: 503, code: "PAYOUT_UNAVAILABLE", payoutId: row.id,
      error: "Payouts are temporarily unavailable. Nothing was sent and your balance is unchanged. Please try again later.",
    };
  }
  return {
    ok: false, status: 502, code: "PAYOUT_FAILED", payoutId: row.id,
    error: "Your bank payout could not be completed. Nothing was sent and the money is back in your balance.",
  };
}

/**
 * Sends the Stripe transfer for a reserved withdrawal. The transfer's idempotency key is derived from the
 * payout row's id, so any retry of the same withdrawal replays instead of paying twice.
 *  - Success: the row becomes paid_out.
 *  - Definitive Stripe refusal (including insufficient platform balance): the row becomes failed and the
 *    balance is restored in the same transaction.
 *  - Unknown result: the balance stays reserved and the row is flagged manual_review.
 */
export async function sendPayout(
  row: PayoutRow,
  destination: string,
  stripe: PayoutStripeClient,
  now: Date = new Date(),
): Promise<PayoutOutcome> {
  let transfer: { id: string };
  try {
    transfer = await stripe.transfers.create(
      {
        amount: Math.round(parseFloat(row.netAmount) * 100),
        currency: PLATFORM_CURRENCY, // wallet balances are paid out in the platform currency
        destination,
        description: `ShareSwap payout ${now.toISOString().split("T")[0]}`,
        metadata: { rentalPayoutId: String(row.id), userId: String(row.userId) },
      },
      { idempotencyKey: payoutIdempotencyKey(row.id) },
    );
  } catch (error) {
    if (transferIsUncertain(error)) {
      await flagForManualReview(row, error);
      return {
        ok: false, status: 502, code: "PAYOUT_UNCONFIRMED", payoutId: row.id,
        error: "We could not confirm your payout. Your balance is on hold while we check, so please don't submit it again.",
      };
    }
    console.error(`[payout] transfer for rental payout ${row.id} was refused:`, error);
    await failAndRestore(row);
    return definitiveFailure(row, error);
  }

  try {
    const [paid] = await db
      .update(rentalPayouts)
      .set({ status: "paid_out", stripeTransferId: transfer.id, paidOutAt: now })
      .where(and(eq(rentalPayouts.id, row.id), inArray(rentalPayouts.status, IN_FLIGHT)))
      .returning();
    if (paid) return { ok: true, payout: paid, transferId: transfer.id };
  } catch (error) {
    console.error(`[payout] rental payout ${row.id} was sent (${transfer.id}) but its row could not be settled:`, error);
  }
  // The money has left; never restore it. The row is left for a retry, which replays the same transfer.
  return { ok: true, payout: { ...row, status: "paid_out", stripeTransferId: transfer.id, paidOutAt: now }, transferId: transfer.id };
}

/** Looks up an unsettled withdrawal of this user that may be retried, or says why it may not. */
export async function findRetryablePayout(userId: number, payoutId: number, now: Date): Promise<{ row: PayoutRow } | { failure: PayoutFailure }> {
  const [row] = await db.select().from(rentalPayouts).where(and(
    eq(rentalPayouts.id, payoutId),
    eq(rentalPayouts.userId, userId),
    inArray(rentalPayouts.status, IN_FLIGHT),
  ));
  if (!row || row.requestId !== null) {
    return { failure: { ok: false, status: 404, code: "PAYOUT_NOT_FOUND", error: "There is no unfinished payout to retry." } };
  }
  const age = now.getTime() - new Date(row.createdAt ?? now).getTime();
  if (age > RETRY_WINDOW_MS) {
    return {
      failure: {
        ok: false, status: 409, code: "PAYOUT_REVIEW_REQUIRED", payoutId: row.id,
        error: "This payout is being reviewed by our team and can't be retried automatically.",
      },
    };
  }
  return { row };
}

/**
 * Moves a rental's held earnings into the owner's available balance when the handoff completes.
 * The held row is claimed with a conditional UPDATE and the balances change in the same transaction,
 * so the owner is credited exactly once however often this is reached. With no held row there is
 * nothing to release: it logs and credits nothing rather than inventing an amount.
 */
export async function releaseHeldRentalPayout(args: {
  requestId: number; ownerId: number; itemId: number; itemName: string; logTag: string;
}): Promise<boolean> {
  const { requestId, ownerId, itemId, itemName, logTag } = args;
  const released = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(rentalPayouts)
      .set({ status: "released", releasedAt: new Date() })
      .where(and(eq(rentalPayouts.requestId, requestId), eq(rentalPayouts.status, "held")))
      .returning({ netAmount: rentalPayouts.netAmount });
    if (!row) return null;
    const net = parseFloat(row.netAmount || "0");
    await tx.update(users).set({
      pendingRentalBalance: sql`GREATEST(0, COALESCE(${users.pendingRentalBalance}, 0) - ${net})`,
      rentalBalance: sql`COALESCE(${users.rentalBalance}, 0) + ${net}`,
    }).where(eq(users.id, ownerId));
    const short = itemName.length > 20 ? `${itemName.slice(0, 20)}…` : itemName;
    await tx.insert(notifications).values({
      userId: ownerId, type: "payment_received", title: "Rental Payment Ready",
      message: `$${net.toFixed(2)} earned from "${short}" — ready to withdraw.`,
      itemId, requestId, isRead: false,
    });
    return net;
  });
  if (released === null) {
    // Reaching here again for a payout that is already released is normal (a retry, a sweep, a second path),
    // so it is not an error. Only a request that never had a held payout is worth a log line.
    const [already] = await db.select({ id: rentalPayouts.id }).from(rentalPayouts)
      .where(and(eq(rentalPayouts.requestId, requestId), eq(rentalPayouts.status, "released"))).limit(1);
    if (already) console.log(`[${logTag}] request ${requestId}: rental earnings were already released`);
    else console.error(`[${logTag}] request ${requestId} has no held rental payout; the owner was not credited (never held)`);
    return false;
  }
  console.log(`[${logTag}] Released rental earnings $${released.toFixed(2)} to owner ${ownerId}`);
  return true;
}

/**
 * Request statuses whose held payout is not released by the recovery pass: voided ones, and disputed or
 * flagged ones, where an admin decides who gets the money.
 */
export const VOIDED_REQUEST_STATUSES = [
  "CANCELLED", "DECLINED", "REJECTED", "EXPIRED", "DEPOSIT_FAILED",
  "DISPUTED", "HANDOFF_DISPUTED", "HANDOFF_FLAGGED",
];

export type StrandedPayout = { requestId: number; ownerId: number; itemId: number; itemName: string };

/**
 * Held payouts of rentals whose handoff has already happened (handoff_confirmed_at is set by every path that
 * completes one). Earnings are released at handoff, so a payout still held for such a rental was missed: the
 * auto-confirm sweep used to skip the release, and a crash between the handoff commit and the release does the same.
 */
export async function findStrandedHeldPayouts(options: { onlyRequestIds?: number[] } = {}): Promise<StrandedPayout[]> {
  if (options.onlyRequestIds && options.onlyRequestIds.length === 0) return [];
  return db
    .select({ requestId: rentalPayouts.requestId, ownerId: items.ownerId, itemId: items.id, itemName: items.name })
    .from(rentalPayouts)
    .innerJoin(itemRequests, eq(itemRequests.id, rentalPayouts.requestId))
    .innerJoin(items, eq(items.id, itemRequests.itemId))
    .where(and(
      eq(rentalPayouts.status, "held"),
      eq(itemRequests.requestType, "RENT"),
      isNotNull(itemRequests.handoffConfirmedAt),
      notInArray(itemRequests.status, VOIDED_REQUEST_STATUSES),
      ...(options.onlyRequestIds ? [inArray(rentalPayouts.requestId, options.onlyRequestIds)] : []),
    )) as Promise<StrandedPayout[]>;
}

/** Releases every stranded payout. Safe to run any number of times, and alongside the handoff paths. */
export async function releaseStrandedRentalPayouts(
  options: { dryRun?: boolean; onlyRequestIds?: number[] } = {},
): Promise<{ found: number; released: number }> {
  const stranded = await findStrandedHeldPayouts({ onlyRequestIds: options.onlyRequestIds });
  if (options.dryRun) {
    for (const row of stranded) console.log(`[payout-recovery] dry run: would release the held payout of request ${row.requestId} to owner ${row.ownerId}`);
    return { found: stranded.length, released: 0 };
  }
  let released = 0;
  for (const row of stranded) {
    try {
      if (await releaseHeldRentalPayout({ ...row, logTag: "Payout recovery" })) released++;
    } catch (error) {
      console.error(`[payout-recovery] could not release the held payout of request ${row.requestId}:`, error);
    }
  }
  return { found: stranded.length, released };
}
