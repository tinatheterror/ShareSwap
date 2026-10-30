import { and, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { db, depositSettlementOperations, itemRequests, items, rentalPayouts, securityClaims, users } from "@workspace/db";
import {
  AUTO_RESOLVABLE_REQUEST_STATUSES,
  IN_FLIGHT_SETTLEMENT_STATUSES,
  TERMINAL_CLAIM_STATUSES,
  TERMINAL_REQUEST_STATUSES,
  UNSETTLED_PAYOUT_STATUSES,
  WALLET_LIMITS,
  walletTier,
  type WalletTier,
} from "./retention";

export type BlockingRequest = { id: number; itemName: string; requestType: string; status: string; otherPartyId: number | null };

export type DeletionBlocker = { code: string; message: string; count?: number; amount?: string; requests?: BlockingRequest[] };

export type DeletionEligibility = {
  eligible: boolean;
  blockers: DeletionBlocker[];
  /** Requests deletion would cancel by itself because nothing has moved for them. */
  autoResolve: { requests: number };
  wallet: {
    available: string;
    pending: string;
    tier: WalletTier;
    /** What is lost if the person deletes without withdrawing (the offer band, declined, or under $1). */
    forfeitedOnDeletion: string;
    /** Under $1: the person must acknowledge the forfeit. */
    requiresForfeitAcknowledgement: boolean;
    /** $1 up to $10: the balance can be withdrawn in full with the minimum payout waived. */
    withdrawalOffer: { amount: string; minimumWaived: true; canWithdraw: boolean } | null;
  };
  /** Things deletion will end without the user doing anything first. */
  willEnd: { subscription: boolean };
};

const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"];
const cents = (value: string | null | undefined) => Math.round(parseFloat(value || "0") * 100);
const dollars = (c: number) => (c / 100).toFixed(2);

/**
 * The open requests that stop a deletion: everything not finished, except PENDING/ACCEPTED requests nothing has
 * moved for, which deletion cancels by itself. The Requests screen's blocking-deletion filter uses this too.
 */
export async function findBlockingRequests(
  userId: number,
  executor: Pick<typeof db, "select"> = db,
): Promise<{ openRequestCount: number; blocking: BlockingRequest[] }> {
  const openRequests = await executor
    .select({
      id: itemRequests.id,
      status: itemRequests.status,
      requestType: itemRequests.requestType,
      requesterId: itemRequests.requesterId,
      itemName: items.name,
      ownerId: items.ownerId,
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
    const rows = await executor
      .select({ requestId: rentalPayouts.requestId })
      .from(rentalPayouts)
      .where(and(inArray(rentalPayouts.requestId, openRequests.map((r) => r.id)), inArray(rentalPayouts.status, [...UNSETTLED_PAYOUT_STATUSES])));
    for (const row of rows) if (row.requestId !== null) moneyHeld.add(row.requestId);
  }
  const autoResolvable = (r: (typeof openRequests)[number]) =>
    (AUTO_RESOLVABLE_REQUEST_STATUSES as readonly string[]).includes(r.status) &&
    !r.depositPaymentIntentId && cents(r.depositCapturedAmount) === 0 && !r.shareCoinsCharged && !moneyHeld.has(r.id);
  const blockingRequests = openRequests.filter((r) => !autoResolvable(r));

  return {
    openRequestCount: openRequests.length,
    blocking: blockingRequests.map((r) => ({
      id: r.id,
      itemName: r.itemName,
      requestType: r.requestType,
      status: r.status,
      otherPartyId: r.requesterId === userId ? r.ownerId : r.requesterId,
    })),
  };
}

/** Read-only: it answers whether the account could be deleted now and what stands in the way. */
export async function getDeletionEligibility(userId: number, executor: Pick<typeof db, "select"> = db): Promise<DeletionEligibility> {
  const [user] = await executor
    .select({
      rentalBalance: users.rentalBalance,
      pendingRentalBalance: users.pendingRentalBalance,
      stripeSubscriptionStatus: users.stripeSubscriptionStatus,
      stripeConnectedAccountId: users.stripeConnectedAccountId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new Error(`user ${userId} not found`);

  const { openRequestCount, blocking: blockingRequests } = await findBlockingRequests(userId, executor);

  const [{ openClaims }] = await executor
    .select({ openClaims: sql<number>`count(*)::int` })
    .from(securityClaims)
    .where(and(
      or(eq(securityClaims.ownerId, userId), eq(securityClaims.borrowerId, userId)),
      notInArray(securityClaims.status, [...TERMINAL_CLAIM_STATUSES]),
    ));

  const [{ settlementsInFlight }] = await executor
    .select({ settlementsInFlight: sql<number>`count(*)::int` })
    .from(depositSettlementOperations)
    .innerJoin(securityClaims, eq(securityClaims.id, depositSettlementOperations.claimId))
    .where(and(
      or(eq(securityClaims.ownerId, userId), eq(securityClaims.borrowerId, userId)),
      inArray(depositSettlementOperations.status, [...IN_FLIGHT_SETTLEMENT_STATUSES]),
    ));

  const [{ unsettledPayouts }] = await executor
    .select({ unsettledPayouts: sql<number>`count(*)::int` })
    .from(rentalPayouts)
    .where(and(eq(rentalPayouts.userId, userId), inArray(rentalPayouts.status, [...UNSETTLED_PAYOUT_STATUSES])));

  const availableCents = cents(user.rentalBalance);
  const pendingCents = cents(user.pendingRentalBalance);
  const tier = walletTier(availableCents);
  const withdrawable = tier === "blocks";
  const pendingBlocks = pendingCents > WALLET_LIMITS.pendingBlocksAbove * 100;

  const blockers: DeletionBlocker[] = [];
  if (blockingRequests.length > 0) {
    blockers.push({
      code: "open_requests",
      count: blockingRequests.length,
      requests: blockingRequests,
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
    autoResolve: { requests: openRequestCount - blockingRequests.length },
    wallet: {
      available: dollars(availableCents),
      pending: dollars(pendingCents),
      tier,
      forfeitedOnDeletion: tier === "forfeit" || tier === "offer_withdrawal" ? dollars(availableCents) : "0.00",
      requiresForfeitAcknowledgement: tier === "forfeit",
      withdrawalOffer: tier === "offer_withdrawal"
        ? { amount: dollars(availableCents), minimumWaived: true, canWithdraw: !!user.stripeConnectedAccountId }
        : null,
    },
    willEnd: { subscription: ACTIVE_SUBSCRIPTION_STATUSES.includes(user.stripeSubscriptionStatus ?? "") },
  };
}
