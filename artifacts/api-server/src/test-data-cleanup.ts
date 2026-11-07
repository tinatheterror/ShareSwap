import { createHash } from "node:crypto";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, itemRequests, items, LEGACY_PAYMENT_CURRENCY, rentalPayouts, requestLifecycleEvents, users, walletTransactions } from "@workspace/db";
import { TERMINAL_REQUEST_STATUSES } from "./account-deletion/retention";
import {
  claimDepositTerminalAction,
  releaseDepositTerminalClaim,
  resolveClaimedDepositIntents,
  type DepositRenewalStripeClient,
} from "./deposit-renewal-service";
import { recordWalletEntry, toCents } from "./wallet-ledger";

/**
 * One-off cleanup of the owner's USD test data (the requests from before the move to CAD, and the wallet balances they left).
 * A DRY RUN unless run live with the hash of the plan that was shown:
 *   - every open request charged in USD is cancelled (cancel_reason test_data_cleanup); its deposit hold is released in Stripe
 *     (cancelled, or the charged deposit refunded), with the deterministic key test-cleanup-<request>-<intent>; held payouts are
 *     voided; the item is made available again unless another open request needs it. Rental payments and platform fees that
 *     were already charged are NOT refunded.
 *   - every wallet balance is set to zero with an 'adjustment' ledger row (minus the balance, in usd, key
 *     test-data-adjustment-<user>); pending earnings are cleared. A user who also has CAD activity is skipped, never zeroed.
 * Live needs --confirm <hash>: if anything changed since the plan was shown, the hash differs and nothing is touched.
 */
export interface CleanupRequest {
  id: number;
  status: string;
  requestType: string;
  ownerId: number | null;
  borrowerId: number | null;
  depositMethod: string | null;
  depositMode: string | null;
  depositStatus: string | null;
  depositPaymentIntentId: string | null;
  /** What Stripe says the deposit intent is (read-only lookup), or null when it was not looked up or does not exist. */
  stripeIntentStatus: string | null;
  /** release_hold: a deposit is released in Stripe. close_only: nothing to release in Stripe. */
  action: "release_hold" | "close_only";
}
export interface CleanupUser {
  userId: number;
  username: string | null;
  balanceCents: number;
  pendingCents: number;
  /** The wallet ledger's total for this user; it should equal the balance once the ledger has been backfilled. */
  ledgerCents: number;
  /** Set when the user is left alone, and why. */
  skipped: string | null;
}
export interface CleanupPlan { requests: CleanupRequest[]; users: CleanupUser[]; hash: string }

export interface CleanupScope { onlyRequestIds?: number[]; onlyUserIds?: number[] }

const OPEN_DEPOSIT_STATUSES = ["authorized", "held", "disputed", "SECURED_REFUNDABLE", "secured_refundable"];

export async function planTestDataCleanup(stripe?: Pick<DepositRenewalStripeClient, "paymentIntents">, scope: CleanupScope = {}): Promise<CleanupPlan> {
  const rows = await db
    .select({ r: itemRequests, ownerId: items.ownerId })
    .from(itemRequests)
    .innerJoin(items, eq(items.id, itemRequests.itemId))
    .where(and(
      eq(itemRequests.paymentCurrency, LEGACY_PAYMENT_CURRENCY),
      notInArray(itemRequests.status, [...TERMINAL_REQUEST_STATUSES]),
      ...(scope.onlyRequestIds ? [inArray(itemRequests.id, scope.onlyRequestIds)] : []),
    ))
    .orderBy(itemRequests.id);

  const requests: CleanupRequest[] = [];
  for (const { r, ownerId } of rows) {
    const hasHold = Boolean(r.depositPaymentIntentId) && r.depositMethod !== "in_person" && OPEN_DEPOSIT_STATUSES.includes(r.depositStatus ?? "");
    let stripeIntentStatus: string | null = null;
    if (hasHold && stripe) {
      try {
        stripeIntentStatus = (await stripe.paymentIntents.retrieve(r.depositPaymentIntentId!)).status ?? null;
      } catch {
        stripeIntentStatus = null;
      }
    }
    requests.push({
      id: r.id, status: r.status, requestType: r.requestType, ownerId, borrowerId: r.requesterId, depositMethod: r.depositMethod, depositMode: r.depositMode,
      depositStatus: r.depositStatus, depositPaymentIntentId: r.depositPaymentIntentId, stripeIntentStatus, action: hasHold ? "release_hold" : "close_only",
    });
  }

  const walletUsers = await db
    .select({ id: users.id, username: users.username, balance: users.rentalBalance, pending: users.pendingRentalBalance })
    .from(users)
    .where(and(
      sql`(COALESCE(${users.rentalBalance}, 0) <> 0 OR COALESCE(${users.pendingRentalBalance}, 0) <> 0)`,
      ...(scope.onlyUserIds ? [inArray(users.id, scope.onlyUserIds)] : []),
    ))
    .orderBy(users.id);
  const cleanupUsers: CleanupUser[] = [];
  for (const u of walletUsers) {
    const ledger = await db.select({ amountCents: walletTransactions.amountCents, currency: walletTransactions.currency }).from(walletTransactions).where(eq(walletTransactions.userId, u.id));
    const otherCurrencyRequests = await db
      .select({ id: itemRequests.id })
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(and(sql`(${items.ownerId} = ${u.id} OR ${itemRequests.requesterId} = ${u.id})`, sql`${itemRequests.paymentCurrency} <> ${LEGACY_PAYMENT_CURRENCY}`))
      .limit(1);
    const skipped = ledger.some(row => row.currency.toLowerCase() !== LEGACY_PAYMENT_CURRENCY)
      ? "has wallet activity in another currency than usd"
      : otherCurrencyRequests.length > 0
        ? "is part of a request charged in another currency than usd"
        : null;
    cleanupUsers.push({
      userId: u.id, username: u.username, balanceCents: toCents(u.balance), pendingCents: toCents(u.pending),
      ledgerCents: ledger.reduce((total, row) => total + row.amountCents, 0), skipped,
    });
  }

  const stable = JSON.stringify({
    requests: requests.map(r => [r.id, r.status, r.depositPaymentIntentId, r.action]),
    users: cleanupUsers.map(u => [u.userId, u.balanceCents, u.pendingCents, u.skipped]),
  });
  return { requests, users: cleanupUsers, hash: createHash("sha256").update(stable).digest("hex").slice(0, 16) };
}

export interface CleanupResult {
  requests: Array<{ id: number; outcome: "closed" | "failed" | "skipped"; detail: string }>;
  users: Array<{ userId: number; outcome: "zeroed" | "skipped" | "changed"; detail: string }>;
}

async function closeRequest(req: CleanupRequest, stripe: DepositRenewalStripeClient, now: Date): Promise<CleanupResult["requests"][number]> {
  const claim = await claimDepositTerminalAction(req.id, "cancel", now);
  if (claim.status !== "claimed") return { id: req.id, outcome: "failed", detail: `busy: ${claim.reason}` };
  const request = claim.request;
  if (TERMINAL_REQUEST_STATUSES.includes(request.status as never) || request.paymentCurrency !== LEGACY_PAYMENT_CURRENCY) {
    await releaseDepositTerminalClaim(claim);
    return { id: req.id, outcome: "skipped", detail: `no longer open or no longer usd (${request.status})` };
  }
  let released: string[] = [];
  try {
    const releases = await resolveClaimedDepositIntents(claim, stripe, "cancel", { cancelIdempotencyKey: (paymentIntentId) => `test-cleanup-${req.id}-${paymentIntentId}` });
    released = releases.map(r => `${r.action} ${r.paymentIntentId}`);
  } catch (error) {
    await releaseDepositTerminalClaim(claim).catch(() => {});
    return { id: req.id, outcome: "failed", detail: `Stripe did not release the hold; left open: ${(error as Error).message?.slice(0, 120)}` };
  }
  const hadDeposit = Boolean(request.depositPaymentIntentId);
  const closed = await db.transaction(async (tx) => {
    const [updated] = await tx.update(itemRequests).set({
      status: "CANCELLED", depositStatus: hadDeposit ? "released" : request.depositStatus, depositReleasedAt: hadDeposit ? now : request.depositReleasedAt,
      depositPreviousPaymentIntentId: null, depositRenewalStatus: null, depositOperationToken: null, depositOperationType: null,
      cancelledAt: now, cancelledFromStatus: request.status, cancelReason: "test_data_cleanup", cancelledWithPenalty: false,
    }).where(and(eq(itemRequests.id, req.id), eq(itemRequests.depositRenewalStatus, "terminal_action"), eq(itemRequests.depositOperationToken, claim.operationToken))).returning({ id: itemRequests.id });
    if (!updated) return false;
    const held = await tx.select({ id: rentalPayouts.id, userId: rentalPayouts.userId, netAmount: rentalPayouts.netAmount }).from(rentalPayouts)
      .where(and(eq(rentalPayouts.requestId, req.id), eq(rentalPayouts.status, "held")));
    for (const payout of held) {
      await tx.update(rentalPayouts).set({ status: "cancelled" }).where(eq(rentalPayouts.id, payout.id));
      await tx.update(users).set({ pendingRentalBalance: sql`GREATEST(0, COALESCE(${users.pendingRentalBalance}, 0) - ${payout.netAmount}::numeric)` }).where(eq(users.id, payout.userId));
    }
    // Available again unless another open request still needs the item.
    await tx.execute(sql`
      UPDATE ${items} SET is_available = true, updated_at = ${now}
      WHERE ${items.id} = ${request.itemId}
        AND NOT EXISTS (
          SELECT 1 FROM ${itemRequests} o
          WHERE o.item_id = ${request.itemId} AND o.id <> ${req.id}
            AND o.status NOT IN (${sql.join(TERMINAL_REQUEST_STATUSES.map(s => sql`${s}`), sql`, `)})
        )`);
    await tx.insert(requestLifecycleEvents).values({
      requestId: req.id, eventType: "TEST_DATA_CLEANUP", idempotencyKey: `test-data-cleanup-${req.id}`, details: { fromStatus: request.status, released },
    }).onConflictDoNothing();
    return true;
  });
  if (!closed) {
    await releaseDepositTerminalClaim(claim).catch(() => {});
    return { id: req.id, outcome: "failed", detail: "the hold was released but the request could not be closed; running it again finishes it" };
  }
  return { id: req.id, outcome: "closed", detail: released.length ? released.join(", ") : "no deposit to release" };
}

async function zeroUser(user: CleanupUser, now: Date): Promise<CleanupResult["users"][number]> {
  if (user.skipped) return { userId: user.userId, outcome: "skipped", detail: user.skipped };
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ b: users.rentalBalance }).from(users).where(eq(users.id, user.userId)).for("update");
    if (toCents(row?.b) !== user.balanceCents) return { userId: user.userId, outcome: "changed" as const, detail: "the balance changed since the plan; left alone" };
    if (user.balanceCents > 0) {
      await recordWalletEntry(tx, {
        userId: user.userId, kind: "adjustment", amountCents: -user.balanceCents, currency: LEGACY_PAYMENT_CURRENCY,
        idempotencyKey: `test-data-adjustment-${user.userId}`, createdAt: now,
      });
    }
    await tx.update(users).set({ rentalBalance: "0.00", pendingRentalBalance: "0.00" }).where(eq(users.id, user.userId));
    return { userId: user.userId, outcome: "zeroed" as const, detail: `balance ${(user.balanceCents / 100).toFixed(2)} and pending ${(user.pendingCents / 100).toFixed(2)} set to 0` };
  });
}

export async function applyTestDataCleanup(plan: CleanupPlan, stripe: DepositRenewalStripeClient, now: Date = new Date()): Promise<CleanupResult> {
  const result: CleanupResult = { requests: [], users: [] };
  for (const req of plan.requests) result.requests.push(await closeRequest(req, stripe, now));
  for (const user of plan.users) result.users.push(await zeroUser(user, now));
  return result;
}

export interface RunOptions { live: boolean; confirm?: string; scope?: CleanupScope; now?: Date }

/** The one entry point: always plans; applies only when live with the matching hash. */
export async function runTestDataCleanup(stripe: DepositRenewalStripeClient, options: RunOptions): Promise<{ mode: "dry-run" | "live"; plan: CleanupPlan; result?: CleanupResult; refused?: string }> {
  const plan = await planTestDataCleanup(stripe, options.scope);
  if (!options.live) return { mode: "dry-run", plan };
  if (!options.confirm) return { mode: "live", plan, refused: "live needs --confirm <hash> from a dry run" };
  if (options.confirm !== plan.hash) return { mode: "live", plan, refused: `the plan changed since the dry run (confirm ${options.confirm}, now ${plan.hash}); run the dry run again` };
  return { mode: "live", plan, result: await applyTestDataCleanup(plan, stripe, options.now) };
}
