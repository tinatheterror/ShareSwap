import { and, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { db, depositSettlementOperations, itemRequests, items, rentalPayouts, securityClaims, users } from "@workspace/db";
import {
  AUTO_RESOLVABLE_REQUEST_STATUSES,
  IN_FLIGHT_SETTLEMENT_STATUSES,
  TERMINAL_CLAIM_STATUSES,
  TERMINAL_REQUEST_STATUSES,
  UNSETTLED_PAYOUT_STATUSES,
  WALLET_LIMITS,
} from "./retention";

export type DeletionBlocker = { code: string; message: string; count?: number; amount?: string };

export type DeletionEligibility = {
  eligible: boolean;
  blockers: DeletionBlocker[];
  /** Requests deletion would cancel by itself because nothing has moved for them. */
  autoResolve: { requests: number };
  wallet: { available: string; pending: string; forfeitedOnDeletion: string };
  /** Things deletion will end without the user doing anything first. */
  willEnd: { subscription: boolean };
};

const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"];
const cents = (value: string | null | undefined) => Math.round(parseFloat(value || "0") * 100);
const dollars = (c: number) => (c / 100).toFixed(2);

/** Read-only: it answers whether the account could be deleted now and what stands in the way. */
export async function getDeletionEligibility(userId: number): Promise<DeletionEligibility> {
  const [user] = await db
    .select({
      rentalBalance: users.rentalBalance,
      pendingRentalBalance: users.pendingRentalBalance,
      stripeSubscriptionStatus: users.stripeSubscriptionStatus,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new Error(`user ${userId} not found`);

  const openRequests = await db
    .select({
      id: itemRequests.id,
      status: itemRequests.status,
      depositPaymentIntentId: itemRequests.depositPaymentIntentId,
      depositCapturedAmount: itemRequests.depositCapturedAmount,
      shareCoinsCharged: itemRequests.shareCoinsCharged,
    })
    .from(itemRequests)
    .innerJoin(items, eq(items.id, itemRequests.itemId))
    .where(and(
      or(eq(itemRequests.requesterId, userId), eq(items.ownerId, userId)),
      notInArray(itemRequests.status, [...TERMINAL_REQUEST_STATUSES]),
    ));

  const moneyHeld = new Set<number>();
  if (openRequests.length > 0) {
    const rows = await db
      .select({ requestId: rentalPayouts.requestId })
      .from(rentalPayouts)
      .where(and(inArray(rentalPayouts.requestId, openRequests.map((r) => r.id)), inArray(rentalPayouts.status, [...UNSETTLED_PAYOUT_STATUSES])));
    for (const row of rows) if (row.requestId !== null) moneyHeld.add(row.requestId);
  }
  const autoResolvable = (r: (typeof openRequests)[number]) =>
    (AUTO_RESOLVABLE_REQUEST_STATUSES as readonly string[]).includes(r.status) &&
    !r.depositPaymentIntentId && cents(r.depositCapturedAmount) === 0 && !r.shareCoinsCharged && !moneyHeld.has(r.id);
  const blockingRequests = openRequests.filter((r) => !autoResolvable(r));

  const [{ openClaims }] = await db
    .select({ openClaims: sql<number>`count(*)::int` })
    .from(securityClaims)
    .where(and(
      or(eq(securityClaims.ownerId, userId), eq(securityClaims.borrowerId, userId)),
      notInArray(securityClaims.status, [...TERMINAL_CLAIM_STATUSES]),
    ));

  const [{ settlementsInFlight }] = await db
    .select({ settlementsInFlight: sql<number>`count(*)::int` })
    .from(depositSettlementOperations)
    .innerJoin(securityClaims, eq(securityClaims.id, depositSettlementOperations.claimId))
    .where(and(
      or(eq(securityClaims.ownerId, userId), eq(securityClaims.borrowerId, userId)),
      inArray(depositSettlementOperations.status, [...IN_FLIGHT_SETTLEMENT_STATUSES]),
    ));

  const [{ unsettledPayouts }] = await db
    .select({ unsettledPayouts: sql<number>`count(*)::int` })
    .from(rentalPayouts)
    .where(and(eq(rentalPayouts.userId, userId), inArray(rentalPayouts.status, [...UNSETTLED_PAYOUT_STATUSES])));

  const availableCents = cents(user.rentalBalance);
  const pendingCents = cents(user.pendingRentalBalance);
  const withdrawable = availableCents >= WALLET_LIMITS.availableBlocksAtOrAbove * 100;
  const pendingBlocks = pendingCents > WALLET_LIMITS.pendingBlocksAbove * 100;

  const blockers: DeletionBlocker[] = [];
  if (blockingRequests.length > 0) {
    blockers.push({
      code: "open_requests",
      count: blockingRequests.length,
      message: "Finish or cancel your open rentals, borrows, swaps and gifts first.",
    });
  }
  if (openClaims > 0) {
    blockers.push({ code: "open_claims", count: openClaims, message: "A security claim involving you is still open." });
  }
  if (settlementsInFlight > 0) {
    blockers.push({ code: "settlement_in_flight", count: settlementsInFlight, message: "A deposit settlement involving you is still being processed." });
  }
  if (withdrawable) {
    blockers.push({ code: "wallet_available", amount: dollars(availableCents), message: "Withdraw your available balance first." });
  }
  if (pendingBlocks) {
    blockers.push({ code: "wallet_pending", amount: dollars(pendingCents), message: "Earnings are still held until your open rentals finish." });
  }
  if (unsettledPayouts > 0) {
    blockers.push({ code: "payout_unsettled", count: unsettledPayouts, message: "A payout is still in progress." });
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    autoResolve: { requests: openRequests.length - blockingRequests.length },
    wallet: {
      available: dollars(availableCents),
      pending: dollars(pendingCents),
      forfeitedOnDeletion: withdrawable ? "0.00" : dollars(availableCents),
    },
    willEnd: { subscription: ACTIVE_SUBSCRIPTION_STATUSES.includes(user.stripeSubscriptionStatus ?? "") },
  };
}
