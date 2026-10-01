import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { itemRequests, items, users } from "@workspace/db";
import { getBlockingOverdueBorrow } from "./routes/routes.js";
import { applySeriousOverduePenalty } from "./trust-score-service.js";

const UNIQUE = `test-overdue-restriction-${Date.now()}`;
const evaluationDate = new Date("2026-08-24T12:00:00.000Z");

let borrowerId: number;
let lenderId: number;
let itemId: number;
let overdueRequestId: number;

before(async () => {
  const [borrower] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-borrower` })
    .returning({ id: users.id });
  borrowerId = borrower.id;

  const [lender] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-lender` })
    .returning({ id: users.id });
  lenderId = lender.id;

  const [item] = await db
    .insert(items)
    .values({
      ownerId: lenderId,
      name: `${UNIQUE}-item`,
      description: "test item",
      conditionRating: 4,
      photos: [],
      securityDeposit: "0",
      lendingDuration: 7,
      shareCoinsReward: "0",
    })
    .returning({ id: items.id });
  itemId = item.id;

  const [request] = await db
    .insert(itemRequests)
    .values({
      itemId,
      requesterId: borrowerId,
      requestType: "BORROW",
      status: "IN_PROGRESS",
      endDate: new Date("2026-08-17T12:00:00.000Z"),
    })
    .returning({ id: itemRequests.id });
  overdueRequestId = request.id;
});

after(async () => {
  await db.delete(itemRequests).where(eq(itemRequests.id, overdueRequestId));
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(eq(users.id, borrowerId));
  await db.delete(users).where(eq(users.id, lenderId));
  await pool.end();
});

test("the shared borrow guard blocks request creation and both acceptance paths at 7 overdue days", async () => {
  const blockedBorrow = await getBlockingOverdueBorrow(borrowerId, evaluationDate);

  assert.equal(blockedBorrow?.requestId, overdueRequestId);
  assert.equal(blockedBorrow?.daysOverdue, 7);

  await db
    .update(itemRequests)
    .set({ status: "RETURN_REQUESTED" })
    .where(eq(itemRequests.id, overdueRequestId));

  const returnInProgressBorrow = await getBlockingOverdueBorrow(borrowerId, evaluationDate);
  assert.equal(returnInProgressBorrow?.requestId, overdueRequestId);
});

test("the shared borrow guard releases automatically once the overdue item is returned", async () => {
  await db
    .update(itemRequests)
    .set({ status: "COMPLETED" })
    .where(eq(itemRequests.id, overdueRequestId));

  const blockedBorrow = await getBlockingOverdueBorrow(borrowerId, evaluationDate);
  assert.equal(blockedBorrow, undefined);
});

test("serious-overdue penalty skips a stale active candidate after physical return is recorded", async () => {
  await db
    .update(itemRequests)
    .set({
      status: "RETURN_REQUESTED",
      actualReturnAt: evaluationDate,
    })
    .where(eq(itemRequests.id, overdueRequestId));

  const result = await applySeriousOverduePenalty(
    borrowerId,
    lenderId,
    overdueRequestId,
    itemId,
    15,
  );

  assert.equal(result.pointsAwarded, 0);
  await db.update(itemRequests)
    .set({ actualReturnAt: null })
    .where(eq(itemRequests.id, overdueRequestId));
});