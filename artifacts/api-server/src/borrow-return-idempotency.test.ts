/**
 * Integration tests: awardBorrowReturnPoints idempotency guard.
 *
 * Verifies that calling confirm-return trust scoring twice for the same
 * (borrowerId, requestId) pair only records one reputation_activities row
 * and only adjusts the trust score once — both for sequential retries and
 * for genuinely concurrent calls.
 *
 * Two layers of protection are exercised:
 *   1. Application-level SELECT guard in awardBorrowReturnPoints.
 *   2. DB-level unique index on (user_id, request_id, activity_type), which
 *      is the last line of defence against multi-server races where both
 *      calls pass the SELECT check before either commits.
 *
 * Uses the real Postgres database (same approach as rate-limit-persistence.test.ts).
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool, db } from "@workspace/db";
import { users, items, itemRequests, reputationActivities } from "@workspace/db";
import { eq, and, like } from "drizzle-orm";
import { awardBorrowReturnPoints, awardTrustPoints, TRUST_POINTS } from "./trust-score-service.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

let borrowerId: number;
let lenderId: number;
let itemId: number;
/** Used by the sequential retry tests. */
let requestId: number;
/** Used by the concurrent awardBorrowReturnPoints penalty test. */
let concurrentRequestId: number;
/** Used by the DB-constraint barrier test (awardTrustPoints called directly). */
let barrierRequestId: number;

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

  // Three separate requests — one per test group — to avoid cross-test conflicts.
  const insertReq = () =>
    db
      .insert(itemRequests)
      .values({
        itemId,
        requesterId: borrowerId,
        requestType: "BORROW",
        status: "COMPLETED",
      })
      .returning({ id: itemRequests.id });

  const [req] = await insertReq();
  requestId = req.id;

  const [concReq] = await insertReq();
  concurrentRequestId = concReq.id;

  const [barReq] = await insertReq();
  barrierRequestId = barReq.id;
});

after(async () => {
  // Remove in FK-safe order
  for (const rid of [requestId, concurrentRequestId, barrierRequestId]) {
    await db
      .delete(reputationActivities)
      .where(eq(reputationActivities.requestId, rid));
    await db
      .delete(itemRequests)
      .where(eq(itemRequests.id, rid));
  }
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(eq(users.id, borrowerId));
  await db.delete(users).where(eq(users.id, lenderId));

  await pool.end();
});

// ── Sequential-retry tests ────────────────────────────────────────────────────

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
  const [user] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, borrowerId));

  // Started at 100; borrow_return_perfect awards +40 (no scaling at score 100 < 300).
  assert.equal(
    user.reputationScore,
    140,
    "reputation score should reflect exactly one +40 award, not two",
  );
});

// ── Concurrent awardBorrowReturnPoints — penalty scenario ─────────────────────
//
// daysLate=7 with conditionRating=4 hits tier 3 (7-13 days, no notify-delay),
// which maps to borrow_return_late_severe (−40 points, never scaled).
// Score going in: 140 (from sequential tests). Expected score after: 100.

test("two simultaneous calls for the same request apply a late-return penalty exactly once", async () => {
  const [snap] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, borrowerId));

  const scoreBefore = snap.reputationScore ?? 0;

  // Fire two concurrent calls — both will pass the application-level SELECT
  // guard if they interleave before either commits; the DB unique index is the
  // last line of defence.
  await Promise.all([
    awardBorrowReturnPoints(
      borrowerId,
      lenderId,
      concurrentRequestId,
      itemId,
      /* conditionRating */ 4,
      /* daysLate     */ 7,
      /* notifyDelayUsed */ false,
    ),
    awardBorrowReturnPoints(
      borrowerId,
      lenderId,
      concurrentRequestId,
      itemId,
      /* conditionRating */ 4,
      /* daysLate     */ 7,
      /* notifyDelayUsed */ false,
    ),
  ]);

  // ── Exactly one borrow_return_* row for the borrower ───────────────────────
  const rows = await db
    .select()
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, borrowerId),
        eq(reputationActivities.requestId, concurrentRequestId),
        like(reputationActivities.activityType, "borrow_return_%"),
      ),
    );

  assert.equal(
    rows.length,
    1,
    `expected exactly 1 borrow_return_* row for borrower after concurrent calls, got ${rows.length}`,
  );
  assert.equal(
    rows[0].activityType,
    "borrow_return_late_severe",
    "activity type should be borrow_return_late_severe for 7 days late",
  );

  // ── Penalty applied exactly once ───────────────────────────────────────────
  const [after] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, borrowerId));

  const delta = (after.reputationScore ?? 0) - scoreBefore;

  // borrow_return_late_severe = −40; penalties are never scaled.
  assert.equal(
    delta,
    TRUST_POINTS.PENALTIES.LATE_RETURN_SEVERE,  // −40
    `score should have changed by exactly −40 (one penalty), but changed by ${delta}`,
  );
});

// ── DB-constraint barrier test ────────────────────────────────────────────────
//
// This test bypasses the application-level SELECT guard entirely by calling
// awardTrustPoints directly. Both concurrent calls therefore observe no prior
// activity row when they start — reproducing the worst-case multi-server race.
// The DB unique index on (user_id, request_id, activity_type) is the only
// thing that prevents a double-insert, and the catch block in awardTrustPoints
// handles the constraint violation gracefully.
//
// If you remove the unique index this test will fail (two rows, two penalties).
// If you remove the catch block it will throw instead of resolving cleanly.

test("DB unique constraint prevents double-insert when both concurrent calls bypass the SELECT guard", async () => {
  const [snap] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, borrowerId));

  const scoreBefore = snap.reputationScore ?? 0;

  const penaltyPoints = TRUST_POINTS.PENALTIES.LATE_RETURN_SEVERE; // −40
  const activityType = "borrow_return_late_severe" as const;
  const metadata = { requestId: barrierRequestId, itemId, daysLate: 7 };

  // Both calls see an empty reputation_activities for (borrowerId, barrierRequestId)
  // because neither has inserted yet — exactly the multi-server race condition.
  await Promise.all([
    awardTrustPoints(borrowerId, activityType, penaltyPoints, metadata),
    awardTrustPoints(borrowerId, activityType, penaltyPoints, metadata),
  ]);

  // ── Exactly one activity row ───────────────────────────────────────────────
  const rows = await db
    .select()
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, borrowerId),
        eq(reputationActivities.requestId, barrierRequestId),
        eq(reputationActivities.activityType, activityType),
      ),
    );

  assert.equal(
    rows.length,
    1,
    `DB unique index should prevent double-insert; got ${rows.length} rows`,
  );

  // ── Penalty applied exactly once ───────────────────────────────────────────
  const [after] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, borrowerId));

  const delta = (after.reputationScore ?? 0) - scoreBefore;

  assert.equal(
    delta,
    penaltyPoints, // −40
    `score should have changed by exactly −40 (one penalty), but changed by ${delta}`,
  );
});
