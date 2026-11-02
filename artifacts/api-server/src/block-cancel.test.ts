import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, reputationActivities, requestRefunds, userBlocks, users } from "@workspace/db";
import { BLOCKED_CANCEL_REASON, cancelBorrowRentRequest, PENALTY_ACK_REQUIRED_CODE } from "./cancel-service.js";
import { fakeStripe } from "./test-fixtures/fake-stripe.js";

// After a block either person can cancel before the handoff with everything given back and no penalty. Without a block the
// same cancel needs the penalty acknowledged. After the handoff the block changes nothing.

const NOW = new Date("2026-10-03T19:00:00.000Z");
const UNIQUE = `block-cancel-${Date.now()}`;
const requestIds: number[] = [];
const itemIds: number[] = [];
const userIds: number[] = [];

async function newUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${label}-${userIds.length}`, password: "x", emailVerified: true, trustScore: 80, pendingRentalBalance: "0.00" })
    .returning({ id: users.id });
  userIds.push(user.id);
  return user.id;
}

async function heldRequest(ownerId: number, borrowerId: number, overrides: Partial<typeof itemRequests.$inferInsert> = {}) {
  const [item] = await db
    .insert(items)
    .values({ ownerId, name: `${UNIQUE}-item-${itemIds.length}`, description: "Block cancel test item", conditionRating: 4, photos: [], isLendable: true, isAvailable: false, replacementValue: 100, securityDeposit: "10.00", lendingDuration: 7, shareCoinsReward: "0", shareCoinPrice: "7.00" })
    .returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db
    .insert(itemRequests)
    .values({
      itemId: item.id, requesterId: borrowerId, requestType: "BORROW", status: "DEPOSIT_CONFIRMED",
      startDate: new Date("2026-10-05T00:00:00.000Z"), endDate: new Date("2026-10-08T00:00:00.000Z"), depositMethod: "in_app",
      depositPaymentIntentId: "pi_deposit_hold", depositStatus: "authorized", depositMode: "authorization", trustDepositAmount: "42.00",
      ...overrides,
    })
    .returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return request.id;
}

const load = async (id: number) => (await db.select().from(itemRequests).where(eq(itemRequests.id, id)))[0];
const trust = async (id: number) => (await db.select({ s: users.trustScore }).from(users).where(eq(users.id, id)))[0].s;
const block = (blockerId: number, blockedId: number) => db.insert(userBlocks).values({ blockerId, blockedId });
const deps = () => ({ stripe: fakeStripe().client as any });

after(async () => {
  if (requestIds.length) {
    await db.delete(requestRefunds).where(inArray(requestRefunds.requestId, requestIds));
    await db.delete(reputationActivities).where(inArray(reputationActivities.requestId, requestIds));
    await db.delete(messages).where(inArray(messages.requestId, requestIds));
    await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
    await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
  }
  if (userIds.length) {
    await db.delete(reputationActivities).where(inArray(reputationActivities.userId, userIds));
    await db.delete(notifications).where(inArray(notifications.userId, userIds));
    await db.delete(userBlocks).where(inArray(userBlocks.blockerId, userIds));
  }
  if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

test("without a block, cancelling over a held deposit needs the penalty acknowledged", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const id = await heldRequest(owner, borrower);
  const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower }, deps(), NOW);
  assert.equal(result.status, 409);
  assert.equal((result.body as { code: string }).code, PENALTY_ACK_REQUIRED_CODE);
  assert.equal((await load(id)).status, "DEPOSIT_CONFIRMED");
});

test("after a block either person cancels over a held deposit with no penalty, whichever of them pressed block", async () => {
  for (const [label, blockerIsOwner, cancellerIsOwner] of [
    ["owner blocked, borrower cancels", true, false],
    ["owner blocked, owner cancels", true, true],
    ["borrower blocked, borrower cancels", false, false],
    ["borrower blocked, owner cancels", false, true],
  ] as const) {
    const owner = await newUser("owner");
    const borrower = await newUser("borrower");
    const id = await heldRequest(owner, borrower);
    await block(blockerIsOwner ? owner : borrower, blockerIsOwner ? borrower : owner);
    const actor = cancellerIsOwner ? owner : borrower;
    const scoreBefore = await trust(actor);

    const result = await cancelBorrowRentRequest({ requestId: id, actorId: actor }, deps(), NOW);

    assert.equal(result.status, 200, label);
    const row = await load(id);
    assert.equal(row.status, "CANCELLED", label);
    assert.equal(row.cancelledWithPenalty, false, label);
    assert.equal(row.cancelReason, BLOCKED_CANCEL_REASON, label);
    assert.equal(row.cancelDepositState, "authorized", label);
    assert.equal(row.depositStatus, "released", `${label}: the hold is released`);
    assert.equal(await trust(actor), scoreBefore, `${label}: no trust penalty`);
  }
});

test("a block changes nothing once the item may have changed hands", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const id = await heldRequest(owner, borrower, { status: "HANDOFF_CONFIRMED" });
  await block(owner, borrower);
  const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower }, deps(), NOW);
  assert.notEqual(result.status, 200);
  assert.equal((await load(id)).status, "HANDOFF_CONFIRMED");
});

test("a block between other people does not exempt this cancel", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const stranger = await newUser("stranger");
  const id = await heldRequest(owner, borrower);
  await block(owner, stranger);
  const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower }, deps(), NOW);
  assert.equal(result.status, 409);
});
