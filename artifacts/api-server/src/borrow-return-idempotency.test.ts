/**
 * Integration test: awardBorrowReturnPoints idempotency guard.
 *
 * Verifies that calling confirm-return trust scoring twice for the same
 * (borrowerId, requestId) pair only records one reputation_activities row
 * and only adjusts the trust score once.
 *
 * Uses the real Postgres database (same approach as rate-limit-persistence.test.ts).
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool, db } from "@workspace/db";
import { users, items, itemRequests, reputationActivities } from "@workspace/db";
import { eq, and, like } from "drizzle-orm";
import { awardBorrowReturnPoints } from "./trust-score-service.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

let borrowerId: number;
let lenderId: number;
let itemId: number;
let requestId: number;

const UNIQUE = `test-idempotency-${Date.now()}`;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(async () => {
  // Insert minimal test users
  const [borrower] = await db
    .insert(users)
    .values({
      username: `${UNIQUE}-borrower`,
      reputationScore: 100,
    })
    .returning({ id: users.id });

  const [lender] = await db
    .insert(users)
    .values({
      username: `${UNIQUE}-lender`,
      reputationScore: 100,
    })
    .returning({ id: users.id });

  borrowerId = borrower.id;
  lenderId = lender.id;

  // Insert a minimal item owned by the lender
  // Supply all NOT NULL columns that have no DB-side default
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

  // Insert a minimal item request (borrow)
  const [req] = await db
    .insert(itemRequests)
    .values({
      itemId,
      requesterId: borrowerId,
      requestType: "BORROW",
      status: "COMPLETED",
    })
    .returning({ id: itemRequests.id });

  requestId = req.id;
});

after(async () => {
  // Remove in FK-safe order
  await db
    .delete(reputationActivities)
    .where(eq(reputationActivities.requestId, requestId));
  await db
    .delete(itemRequests)
    .where(eq(itemRequests.id, requestId));
  await db
    .delete(items)
    .where(eq(items.id, itemId));
  await db
    .delete(users)
    .where(eq(users.id, borrowerId));
  await db
    .delete(users)
    .where(eq(users.id, lenderId));

  await pool.end();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test("first call to awardBorrowReturnPoints records exactly one borrow_return_* activity", async () => {
  await awardBorrowReturnPoints(
    borrowerId,
    lenderId,
    requestId,
    itemId,
    /* conditionRating */ 4,
    /* daysLate */ 0,
    /* notifyDelayUsed */ false,
  );

  const rows = await db
    .select()
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, borrowerId),
        eq(reputationActivities.requestId, requestId),
        like(reputationActivities.activityType, "borrow_return_%"),
      ),
    );

  assert.equal(rows.length, 1, "exactly one borrow_return_* activity should exist after first call");
  assert.equal(rows[0].activityType, "borrow_return_perfect");
});

test("second call to awardBorrowReturnPoints (retry) does NOT add another activity row", async () => {
  // Call again with the same requestId — simulating a network retry
  await awardBorrowReturnPoints(
    borrowerId,
    lenderId,
    requestId,
    itemId,
    /* conditionRating */ 4,
    /* daysLate */ 0,
    /* notifyDelayUsed */ false,
  );

  const rows = await db
    .select()
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, borrowerId),
        eq(reputationActivities.requestId, requestId),
        like(reputationActivities.activityType, "borrow_return_%"),
      ),
    );

  assert.equal(rows.length, 1, "still exactly one borrow_return_* activity after duplicate call");
});

test("trust score after duplicate call equals score after exactly one call", async () => {
  // Fetch current score after both calls
  const [user] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, borrowerId));

  // Started at 100, borrow_return_perfect awards +40 (no scaling at score 100 < 300)
  assert.equal(
    user.reputationScore,
    140,
    "reputation score should reflect exactly one +40 award, not two",
  );
});
