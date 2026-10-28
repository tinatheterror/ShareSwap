import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray, or, sql } from "drizzle-orm";
import { db, depositSettlementOperations, itemRequests, items, notifications, pool, rentalPayouts, securityClaims, users } from "@workspace/db";
import { hashPassword } from "../auth.js";
import { Client, startApp } from "../auth-test-client.js";
import { getDeletionEligibility } from "./eligibility.js";

const UNIQUE = `deletion-eligibility-${Date.now()}`;
const PASSWORD = "Eligibility!42";
const userIds: number[] = [];
let counter = 0;
let counterpartyId: number;
let baseUrl: string;
let closeServer: () => Promise<void>;

async function makeUser(extra: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${counter++}`, password: await hashPassword(PASSWORD), emailVerified: true, ...extra })
    .returning({ id: users.id, username: users.username });
  userIds.push(row.id);
  return row;
}

/** A request between the user and the counterparty; `asOwner` makes the user own the item. */
async function makeRequest(userId: number, over: Partial<typeof itemRequests.$inferInsert> & { asOwner?: boolean } = {}) {
  const { asOwner, ...fields } = over;
  const [item] = await db
    .insert(items)
    .values({ name: `${UNIQUE}-item`, description: "x", photos: [], conditionRating: 5, shareCoinsReward: "1", ownerId: asOwner ? userId : counterpartyId })
    .returning({ id: items.id });
  const [request] = await db
    .insert(itemRequests)
    .values({ itemId: item.id, requesterId: asOwner ? counterpartyId : userId, requestType: "RENT", status: "PENDING", ...fields })
    .returning({ id: itemRequests.id });
  return request.id;
}

const codes = async (userId: number) => (await getDeletionEligibility(userId)).blockers.map((b) => b.code).sort();

before(async () => {
  counterpartyId = (await makeUser()).id;
  ({ baseUrl, close: closeServer } = await startApp());
});

after(async () => {
  try {
    if (userIds.length) {
      const requestRows = await db.select({ id: itemRequests.id }).from(itemRequests).where(or(inArray(itemRequests.requesterId, userIds), inArray(sql`${itemRequests.itemId}`, db.select({ id: items.id }).from(items).where(inArray(items.ownerId, userIds)))));
      const requestIds = requestRows.map((r) => r.id);
      if (requestIds.length) {
        await db.delete(depositSettlementOperations).where(inArray(depositSettlementOperations.requestId, requestIds));
        await db.delete(securityClaims).where(inArray(securityClaims.requestId, requestIds));
        await db.delete(rentalPayouts).where(inArray(rentalPayouts.requestId, requestIds));
      }
      await db.delete(rentalPayouts).where(inArray(rentalPayouts.userId, userIds));
      await db.delete(notifications).where(inArray(notifications.userId, userIds));
      if (requestIds.length) await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
      await db.delete(items).where(inArray(items.ownerId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  } finally {
    await closeServer?.();
    await pool.end();
  }
});

test("an account with nothing open can be deleted", async () => {
  const user = await makeUser();
  assert.deepEqual(await getDeletionEligibility(user.id), {
    eligible: true,
    blockers: [],
    autoResolve: { requests: 0 },
    wallet: { available: "0.00", pending: "0.00", tier: "none", forfeitedOnDeletion: "0.00", requiresForfeitAcknowledgement: false, withdrawalOffer: null },
    willEnd: { subscription: false },
  });
});

test("$1 up to $10 is offered as a withdrawal with the minimum waived, and is forfeited if declined", async () => {
  for (const [balance, hasAccount] of [["9.99", true], ["1.00", true], ["5.00", false]] as const) {
    const user = await makeUser({ rentalBalance: balance, stripeConnectedAccountId: hasAccount ? `acct_${UNIQUE}-${counter}` : null });
    const { wallet, eligible } = await getDeletionEligibility(user.id);
    assert.equal(eligible, true, balance);
    assert.equal(wallet.tier, "offer_withdrawal", balance);
    assert.deepEqual(wallet.withdrawalOffer, { amount: balance, minimumWaived: true, canWithdraw: hasAccount }, balance);
    assert.equal(wallet.forfeitedOnDeletion, balance);
    assert.equal(wallet.requiresForfeitAcknowledgement, false);
  }
});

test("under $1 is forfeited, and the person has to acknowledge it", async () => {
  const user = await makeUser({ rentalBalance: "0.99" });
  const { wallet, eligible } = await getDeletionEligibility(user.id);
  assert.equal(eligible, true);
  assert.equal(wallet.tier, "forfeit");
  assert.equal(wallet.forfeitedOnDeletion, "0.99");
  assert.equal(wallet.requiresForfeitAcknowledgement, true);
  assert.equal(wallet.withdrawalOffer, null);
});

test("an available balance at the minimum payout must be withdrawn first", async () => {
  const user = await makeUser({ rentalBalance: "10.00" });
  const result = await getDeletionEligibility(user.id);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.blockers, [{ code: "wallet_available", amount: "10.00", message: "Withdraw your available balance first." }]);
  assert.equal(result.wallet.tier, "blocks");
  assert.equal(result.wallet.forfeitedOnDeletion, "0.00");
  assert.equal(result.wallet.withdrawalOffer, null);
});

test("any money held in escrow blocks", async () => {
  const user = await makeUser({ pendingRentalBalance: "0.01" });
  assert.deepEqual(await codes(user.id), ["wallet_pending"]);
});

test("a payout that has not settled blocks, a settled or failed one does not", async () => {
  const user = await makeUser();
  const payout = (status: string) => db.insert(rentalPayouts).values({ userId: user.id, amount: "10", rentalAmount: "10", netAmount: "10", status });
  await payout("paid_out");
  await payout("failed");
  await payout("cancelled");
  assert.deepEqual(await codes(user.id), []);
  for (const status of ["pending_payout", "manual_review"]) {
    const [row] = await payout(status).returning({ id: rentalPayouts.id });
    assert.deepEqual(await codes(user.id), ["payout_unsettled"], status);
    await db.delete(rentalPayouts).where(eq(rentalPayouts.id, row.id));
  }
});

test("a pending request nothing has moved for is cancelled by deletion, as owner or requester", async () => {
  const user = await makeUser();
  await makeRequest(user.id);
  await makeRequest(user.id, { asOwner: true, status: "ACCEPTED" });
  const result = await getDeletionEligibility(user.id);
  assert.equal(result.eligible, true);
  assert.equal(result.autoResolve.requests, 2);
});

test("a request that money has moved for blocks, whichever way the money shows", async () => {
  const user = await makeUser();
  const withDeposit = await makeRequest(user.id, { status: "ACCEPTED", depositPaymentIntentId: "pi_test" });
  assert.deepEqual(await codes(user.id), ["open_requests"]);
  await db.delete(itemRequests).where(eq(itemRequests.id, withDeposit));

  const withCoins = await makeRequest(user.id, { shareCoinsCharged: true });
  assert.deepEqual(await codes(user.id), ["open_requests"]);
  await db.delete(itemRequests).where(eq(itemRequests.id, withCoins));

  const heldRequest = await makeRequest(user.id, { asOwner: true });
  await db.insert(rentalPayouts).values({ userId: user.id, requestId: heldRequest, amount: "10", rentalAmount: "10", netAmount: "10", status: "held" });
  const result = await getDeletionEligibility(user.id);
  assert.deepEqual(result.blockers.map((b) => b.code).sort(), ["open_requests", "payout_unsettled"]);
  assert.equal(result.autoResolve.requests, 0);
});

test("a booking past acceptance blocks even with no money, and an unknown status blocks; finished ones do not", async () => {
  const user = await makeUser();
  for (const status of ["DEPOSIT_CONFIRMED", "IN_PROGRESS", "DISPUTED", "SOMETHING_NEW"]) {
    const id = await makeRequest(user.id, { status });
    assert.deepEqual(await codes(user.id), ["open_requests"], status);
    await db.delete(itemRequests).where(eq(itemRequests.id, id));
  }
  for (const status of ["COMPLETED", "COMPLETED_EARLY", "CANCELLED", "DECLINED", "REJECTED"]) await makeRequest(user.id, { status });
  const result = await getDeletionEligibility(user.id);
  assert.equal(result.eligible, true);
  assert.equal(result.autoResolve.requests, 0);
});

test("an open security claim and an unfinished settlement block, as owner or borrower", async () => {
  const user = await makeUser();
  const requestId = await makeRequest(user.id, { status: "COMPLETED" });
  const [claim] = await db
    .insert(securityClaims)
    .values({ requestId, ownerId: counterpartyId, borrowerId: user.id, claimType: "DAMAGE", reason: "x", requestedAmount: "5", status: "SETTLED" })
    .returning({ id: securityClaims.id });
  assert.deepEqual(await codes(user.id), []);

  await db.update(securityClaims).set({ status: "UNDER_REVIEW" }).where(eq(securityClaims.id, claim.id));
  assert.deepEqual(await codes(user.id), ["open_claims"]);
  assert.ok((await codes(counterpartyId)).includes("open_claims"), "the owner side of the claim blocks too");

  await db.update(securityClaims).set({ status: "SETTLED" }).where(eq(securityClaims.id, claim.id));
  await db.insert(depositSettlementOperations).values({ claimId: claim.id, requestId, operationKey: `${UNIQUE}-op`, approvedAmount: "5", status: "INDETERMINATE" });
  assert.deepEqual(await codes(user.id), ["settlement_in_flight"]);
});

test("an active subscription is reported as ending, not as a blocker", async () => {
  const user = await makeUser({ stripeSubscriptionStatus: "active" });
  const result = await getDeletionEligibility(user.id);
  assert.equal(result.eligible, true);
  assert.equal(result.willEnd.subscription, true);
});

test("the endpoint needs sign-in, is read-only, and is not cached", async () => {
  assert.equal((await new Client(baseUrl).get("/api/account/deletion-eligibility")).status, 401);

  const user = await makeUser({ rentalBalance: "12.50", pendingRentalBalance: "3.00" });
  await makeRequest(user.id);
  const client = new Client(baseUrl);
  assert.equal((await client.post("/api/login", { username: user.username, password: PASSWORD })).status, 200);

  // The app stamps last_active_at on every signed-in request, so that one column is left out of the comparison.
  const snapshot = async () => ({
    user: { ...(await db.select().from(users).where(eq(users.id, user.id)))[0], lastActiveAt: null },
    requests: (await db.select().from(itemRequests).where(or(eq(itemRequests.requesterId, user.id), eq(itemRequests.requesterId, counterpartyId)))).length,
    items: (await db.select().from(items).where(inArray(items.ownerId, [user.id, counterpartyId]))).length,
    notifications: (await db.select().from(notifications).where(eq(notifications.userId, user.id))).length,
    payouts: (await db.select().from(rentalPayouts).where(eq(rentalPayouts.userId, user.id))).length,
  });
  const before = await snapshot();
  const response = await client.get("/api/account/deletion-eligibility");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = (await response.json()) as Awaited<ReturnType<typeof getDeletionEligibility>>;
  assert.equal(body.eligible, false);
  assert.deepEqual(body.blockers.map((b) => b.code).sort(), ["wallet_available", "wallet_pending"]);
  assert.equal(body.autoResolve.requests, 1);
  assert.deepEqual(await snapshot(), before);
});
