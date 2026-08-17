/**
 * Integration tests: awardSwapCompletionPoints and awardRentalCompletionPoints
 * idempotency guards.
 *
 * Verifies that calling swap/rental completion trust scoring twice for the same
 * requestId only records one reputation_activities row per participant and only
 * adjusts the trust score once — for both sequential retries and genuinely
 * concurrent calls.
 *
 * Two layers of protection are exercised:
 *   1. Application-level SELECT guard in awardSwapCompletionPoints /
 *      awardRentalCompletionPoints.
 *   2. DB-level unique index on (user_id, request_id, activity_type), which
 *      is the last line of defence against multi-server races where both calls
 *      pass the SELECT check before either commits.
 *
 * Mirrors the pattern established in borrow-return-idempotency.test.ts.
 * Uses the real Postgres database.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool, db } from "@workspace/db";
import { users, items, itemRequests, reputationActivities } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  awardSwapCompletionPoints,
  awardRentalCompletionPoints,
  awardTrustPoints,
  TRUST_POINTS,
} from "./trust-score-service.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

let user1Id: number;
let user2Id: number;
let item1Id: number;
let item2Id: number;

/** Score snapshots captured just before each sequential-first-call test. */
let swapScoreBefore: Record<number, number> = {};
let rentalScoreBefore: Record<number, number> = {};

/** Swap sequential-retry test request. */
let swapRequestId: number;
/** Swap concurrent-call test request. */
let swapConcurrentRequestId: number;
/** Swap DB-barrier test request (awardTrustPoints called directly). */
let swapBarrierRequestId: number;

/** Rental sequential-retry test request. */
let rentalRequestId: number;
/** Rental concurrent-call test request. */
let rentalConcurrentRequestId: number;
/** Rental DB-barrier test request (awardTrustPoints called directly). */
let rentalBarrierRequestId: number;

/**
 * Partial-failure recovery requests — simulate a previous attempt where only
 * the first participant's award committed before the process died.
 */
let swapPartialRequestId: number;
let rentalPartialRequestId: number;

const UNIQUE = `test-swap-rental-idempotency-${Date.now()}`;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(async () => {
  // Insert minimal test users
  const [u1] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-user1`, reputationScore: 100 })
    .returning({ id: users.id });

  const [u2] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-user2`, reputationScore: 100 })
    .returning({ id: users.id });

  user1Id = u1.id;
  user2Id = u2.id;

  // Two items — one owned by each user for the swap scenario
  const [i1] = await db
    .insert(items)
    .values({
      ownerId: user1Id,
      name: `${UNIQUE}-item1`,
      description: "test item 1",
      conditionRating: 4,
      photos: [],
      securityDeposit: "0",
      lendingDuration: 7,
      shareCoinsReward: "0",
    })
    .returning({ id: items.id });

  const [i2] = await db
    .insert(items)
    .values({
      ownerId: user2Id,
      name: `${UNIQUE}-item2`,
      description: "test item 2",
      conditionRating: 4,
      photos: [],
      securityDeposit: "0",
      lendingDuration: 7,
      shareCoinsReward: "0",
    })
    .returning({ id: items.id });

  item1Id = i1.id;
  item2Id = i2.id;

  // Helper to insert a request
  const insertReq = (requestType: string) =>
    db
      .insert(itemRequests)
      .values({
        itemId: item1Id,
        requesterId: user2Id,
        requestType,
        status: "COMPLETED",
      })
      .returning({ id: itemRequests.id });

  const [sp] = await insertReq("SWAP");
  swapPartialRequestId = sp.id;

  const [rp] = await insertReq("RENT");
  rentalPartialRequestId = rp.id;

  const [sr] = await insertReq("SWAP");
  swapRequestId = sr.id;

  const [scr] = await insertReq("SWAP");
  swapConcurrentRequestId = scr.id;

  const [sbr] = await insertReq("SWAP");
  swapBarrierRequestId = sbr.id;

  const [rr] = await insertReq("RENT");
  rentalRequestId = rr.id;

  const [rcr] = await insertReq("RENT");
  rentalConcurrentRequestId = rcr.id;

  const [rbr] = await insertReq("RENT");
  rentalBarrierRequestId = rbr.id;
});

after(async () => {
  const allRequestIds = [
    swapPartialRequestId,
    rentalPartialRequestId,
    swapRequestId,
    swapConcurrentRequestId,
    swapBarrierRequestId,
    rentalRequestId,
    rentalConcurrentRequestId,
    rentalBarrierRequestId,
  ];

  for (const rid of allRequestIds) {
    await db
      .delete(reputationActivities)
      .where(eq(reputationActivities.requestId, rid));
    await db
      .delete(itemRequests)
      .where(eq(itemRequests.id, rid));
  }

  await db.delete(items).where(eq(items.id, item1Id));
  await db.delete(items).where(eq(items.id, item2Id));
  await db.delete(users).where(eq(users.id, user1Id));
  await db.delete(users).where(eq(users.id, user2Id));

  await pool.end();
});

// ── SWAP — Sequential-retry tests ─────────────────────────────────────────────

test("first call to awardSwapCompletionPoints records exactly one swap_completed activity per user", async () => {
  // Capture scores before any swap award so later tests can assert the delta.
  for (const userId of [user1Id, user2Id]) {
    const [snap] = await db
      .select({ reputationScore: users.reputationScore })
      .from(users)
      .where(eq(users.id, userId));
    swapScoreBefore[userId] = snap.reputationScore ?? 0;
  }

  await awardSwapCompletionPoints(user1Id, user2Id, swapRequestId, item1Id, item2Id);

  for (const userId of [user1Id, user2Id]) {
    const rows = await db
      .select()
      .from(reputationActivities)
      .where(
        and(
          eq(reputationActivities.userId, userId),
          eq(reputationActivities.requestId, swapRequestId),
          eq(reputationActivities.activityType, "swap_completed"),
        ),
      );

    assert.equal(
      rows.length,
      1,
      `user ${userId} should have exactly one swap_completed activity after first call`,
    );
  }
});

test("second call to awardSwapCompletionPoints (retry) does NOT add another activity row", async () => {
  await awardSwapCompletionPoints(user1Id, user2Id, swapRequestId, item1Id, item2Id);

  for (const userId of [user1Id, user2Id]) {
    const rows = await db
      .select()
      .from(reputationActivities)
      .where(
        and(
          eq(reputationActivities.userId, userId),
          eq(reputationActivities.requestId, swapRequestId),
          eq(reputationActivities.activityType, "swap_completed"),
        ),
      );

    assert.equal(
      rows.length,
      1,
      `user ${userId} should still have exactly one swap_completed activity after duplicate call`,
    );
  }
});

test("trust score after duplicate swap call equals score after exactly one call", async () => {
  for (const userId of [user1Id, user2Id]) {
    const [user] = await db
      .select({ reputationScore: users.reputationScore })
      .from(users)
      .where(eq(users.id, userId));

    const delta = (user.reputationScore ?? 0) - swapScoreBefore[userId];
    // swap_completed awards +20 (no scaling below score 300).
    assert.equal(
      delta,
      TRUST_POINTS.MAJOR.SWAP_COMPLETED, // +20
      `user ${userId} score delta should be exactly +20 (one swap award), not ${delta}`,
    );
  }
});

// ── SWAP — Concurrent calls ───────────────────────────────────────────────────

test("two simultaneous calls to awardSwapCompletionPoints apply points exactly once", async () => {
  const snapshots: Record<number, number> = {};
  for (const userId of [user1Id, user2Id]) {
    const [snap] = await db
      .select({ reputationScore: users.reputationScore })
      .from(users)
      .where(eq(users.id, userId));
    snapshots[userId] = snap.reputationScore ?? 0;
  }

  await Promise.all([
    awardSwapCompletionPoints(user1Id, user2Id, swapConcurrentRequestId, item1Id, item2Id),
    awardSwapCompletionPoints(user1Id, user2Id, swapConcurrentRequestId, item1Id, item2Id),
  ]);

  for (const userId of [user1Id, user2Id]) {
    const rows = await db
      .select()
      .from(reputationActivities)
      .where(
        and(
          eq(reputationActivities.userId, userId),
          eq(reputationActivities.requestId, swapConcurrentRequestId),
          eq(reputationActivities.activityType, "swap_completed"),
        ),
      );

    assert.equal(
      rows.length,
      1,
      `user ${userId}: expected exactly 1 swap_completed row after concurrent calls, got ${rows.length}`,
    );

    const [after] = await db
      .select({ reputationScore: users.reputationScore })
      .from(users)
      .where(eq(users.id, userId));

    const delta = (after.reputationScore ?? 0) - snapshots[userId];
    assert.equal(
      delta,
      TRUST_POINTS.MAJOR.SWAP_COMPLETED, // +20
      `user ${userId}: score should have changed by exactly +20 (one award), but changed by ${delta}`,
    );
  }
});

// ── SWAP — DB-constraint barrier ──────────────────────────────────────────────
//
// Bypasses the application-level SELECT guard by calling awardTrustPoints
// directly, reproducing the worst-case multi-server race.

test("DB unique constraint prevents double swap_completed insert when both concurrent calls bypass the SELECT guard", async () => {
  const snapshots: Record<number, number> = {};
  for (const userId of [user1Id, user2Id]) {
    const [snap] = await db
      .select({ reputationScore: users.reputationScore })
      .from(users)
      .where(eq(users.id, userId));
    snapshots[userId] = snap.reputationScore ?? 0;
  }

  const points = TRUST_POINTS.MAJOR.SWAP_COMPLETED;
  const activityType = "swap_completed" as const;
  const metadata = { requestId: swapBarrierRequestId, swapItems: [item1Id, item2Id] };

  await Promise.all([
    awardTrustPoints(user1Id, activityType, points, { ...metadata, counterpartyId: user2Id }),
    awardTrustPoints(user1Id, activityType, points, { ...metadata, counterpartyId: user2Id }),
  ]);

  const rows = await db
    .select()
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, user1Id),
        eq(reputationActivities.requestId, swapBarrierRequestId),
        eq(reputationActivities.activityType, activityType),
      ),
    );

  assert.equal(
    rows.length,
    1,
    `DB unique index should prevent double swap_completed insert; got ${rows.length} rows`,
  );

  const [after] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, user1Id));

  const delta = (after.reputationScore ?? 0) - snapshots[user1Id];
  assert.equal(
    delta,
    points, // +20
    `score should have changed by exactly +20 (one award), but changed by ${delta}`,
  );
});

// ── RENTAL — Sequential-retry tests ──────────────────────────────────────────

test("first call to awardRentalCompletionPoints records exactly one rental_dispute_free activity per user", async () => {
  // Capture scores before any rental award so later tests can assert the delta.
  for (const userId of [user1Id, user2Id]) {
    const [snap] = await db
      .select({ reputationScore: users.reputationScore })
      .from(users)
      .where(eq(users.id, userId));
    rentalScoreBefore[userId] = snap.reputationScore ?? 0;
  }

  await awardRentalCompletionPoints(user1Id, user2Id, rentalRequestId, item1Id, false);

  for (const userId of [user1Id, user2Id]) {
    const rows = await db
      .select()
      .from(reputationActivities)
      .where(
        and(
          eq(reputationActivities.userId, userId),
          eq(reputationActivities.requestId, rentalRequestId),
          eq(reputationActivities.activityType, "rental_dispute_free"),
        ),
      );

    assert.equal(
      rows.length,
      1,
      `user ${userId} should have exactly one rental_dispute_free activity after first call`,
    );
  }
});

test("second call to awardRentalCompletionPoints (retry) does NOT add another activity row", async () => {
  await awardRentalCompletionPoints(user1Id, user2Id, rentalRequestId, item1Id, false);

  for (const userId of [user1Id, user2Id]) {
    const rows = await db
      .select()
      .from(reputationActivities)
      .where(
        and(
          eq(reputationActivities.userId, userId),
          eq(reputationActivities.requestId, rentalRequestId),
          eq(reputationActivities.activityType, "rental_dispute_free"),
        ),
      );

    assert.equal(
      rows.length,
      1,
      `user ${userId} should still have exactly one rental_dispute_free activity after duplicate call`,
    );
  }
});

test("trust score after duplicate rental call equals score after exactly one call", async () => {
  for (const userId of [user1Id, user2Id]) {
    const [user] = await db
      .select({ reputationScore: users.reputationScore })
      .from(users)
      .where(eq(users.id, userId));

    const delta = (user.reputationScore ?? 0) - rentalScoreBefore[userId];
    // rental_dispute_free awards +20 (no scaling below score 300).
    assert.equal(
      delta,
      TRUST_POINTS.MICRO.RENTAL_DISPUTE_FREE, // +20
      `user ${userId} score delta should be exactly +20 (one rental award), not ${delta}`,
    );
  }
});

// ── RENTAL — Concurrent calls ─────────────────────────────────────────────────

test("two simultaneous calls to awardRentalCompletionPoints apply points exactly once", async () => {
  const snapshots: Record<number, number> = {};
  for (const userId of [user1Id, user2Id]) {
    const [snap] = await db
      .select({ reputationScore: users.reputationScore })
      .from(users)
      .where(eq(users.id, userId));
    snapshots[userId] = snap.reputationScore ?? 0;
  }

  await Promise.all([
    awardRentalCompletionPoints(user1Id, user2Id, rentalConcurrentRequestId, item1Id, false),
    awardRentalCompletionPoints(user1Id, user2Id, rentalConcurrentRequestId, item1Id, false),
  ]);

  for (const userId of [user1Id, user2Id]) {
    const rows = await db
      .select()
      .from(reputationActivities)
      .where(
        and(
          eq(reputationActivities.userId, userId),
          eq(reputationActivities.requestId, rentalConcurrentRequestId),
          eq(reputationActivities.activityType, "rental_dispute_free"),
        ),
      );

    assert.equal(
      rows.length,
      1,
      `user ${userId}: expected exactly 1 rental_dispute_free row after concurrent calls, got ${rows.length}`,
    );

    const [after] = await db
      .select({ reputationScore: users.reputationScore })
      .from(users)
      .where(eq(users.id, userId));

    const delta = (after.reputationScore ?? 0) - snapshots[userId];
    assert.equal(
      delta,
      TRUST_POINTS.MICRO.RENTAL_DISPUTE_FREE, // +20
      `user ${userId}: score should have changed by exactly +20 (one award), but changed by ${delta}`,
    );
  }
});

// ── RENTAL — DB-constraint barrier ────────────────────────────────────────────
//
// Bypasses the application-level SELECT guard by calling awardTrustPoints
// directly, reproducing the worst-case multi-server race.

test("DB unique constraint prevents double rental_dispute_free insert when both concurrent calls bypass the SELECT guard", async () => {
  const [snap] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, user1Id));

  const scoreBefore = snap.reputationScore ?? 0;

  const points = TRUST_POINTS.MICRO.RENTAL_DISPUTE_FREE; // +20
  const activityType = "rental_dispute_free" as const;
  const metadata = { requestId: rentalBarrierRequestId, itemId: item1Id };

  await Promise.all([
    awardTrustPoints(user1Id, activityType, points, { ...metadata, counterpartyId: user2Id }),
    awardTrustPoints(user1Id, activityType, points, { ...metadata, counterpartyId: user2Id }),
  ]);

  const rows = await db
    .select()
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, user1Id),
        eq(reputationActivities.requestId, rentalBarrierRequestId),
        eq(reputationActivities.activityType, activityType),
      ),
    );

  assert.equal(
    rows.length,
    1,
    `DB unique index should prevent double rental_dispute_free insert; got ${rows.length} rows`,
  );

  const [after] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, user1Id));

  const delta = (after.reputationScore ?? 0) - scoreBefore;
  assert.equal(
    delta,
    points, // +20
    `score should have changed by exactly +20 (one award), but changed by ${delta}`,
  );
});

// ── Partial-failure recovery tests ────────────────────────────────────────────
//
// These tests simulate a scenario where a previous call succeeded for one
// participant but the process died before awarding the other. The guard must
// award only the missing participant on retry, without double-awarding the
// one that already has their row.

test("swap retry after partial failure: only the missing participant gets awarded", async () => {
  // Simulate: user1's award committed on a prior attempt, user2's never ran.
  await awardTrustPoints(user1Id, "swap_completed", TRUST_POINTS.MAJOR.SWAP_COMPLETED, {
    requestId: swapPartialRequestId,
    swapItems: [item1Id, item2Id],
    counterpartyId: user2Id,
  });

  const [snap1Before] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, user1Id));
  const [snap2Before] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, user2Id));

  const score1Before = snap1Before.reputationScore ?? 0;
  const score2Before = snap2Before.reputationScore ?? 0;

  // Retry the full completion — should award user2 but skip user1.
  await awardSwapCompletionPoints(user1Id, user2Id, swapPartialRequestId, item1Id, item2Id);

  // user1 should have exactly one swap_completed row (not two).
  const rows1 = await db
    .select()
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, user1Id),
        eq(reputationActivities.requestId, swapPartialRequestId),
        eq(reputationActivities.activityType, "swap_completed"),
      ),
    );
  assert.equal(rows1.length, 1, "user1 should still have exactly one swap_completed row after retry");

  // user2 should now have exactly one swap_completed row.
  const rows2 = await db
    .select()
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, user2Id),
        eq(reputationActivities.requestId, swapPartialRequestId),
        eq(reputationActivities.activityType, "swap_completed"),
      ),
    );
  assert.equal(rows2.length, 1, "user2 should have exactly one swap_completed row after retry");

  // user1's score must not have changed (already awarded).
  const [snap1After] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, user1Id));
  assert.equal(
    snap1After.reputationScore,
    score1Before,
    `user1 score must be unchanged on retry (no double-award), but changed by ${(snap1After.reputationScore ?? 0) - score1Before}`,
  );

  // user2's score must have increased by exactly +20.
  const [snap2After] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, user2Id));
  const delta2 = (snap2After.reputationScore ?? 0) - score2Before;
  assert.equal(
    delta2,
    TRUST_POINTS.MAJOR.SWAP_COMPLETED, // +20
    `user2 score delta should be exactly +20 (one award on retry), but was ${delta2}`,
  );
});

test("rental retry after partial failure: only the missing participant gets awarded", async () => {
  // Simulate: renter's award committed on a prior attempt, owner's never ran.
  await awardTrustPoints(user1Id, "rental_dispute_free", TRUST_POINTS.MICRO.RENTAL_DISPUTE_FREE, {
    requestId: rentalPartialRequestId,
    itemId: item1Id,
    counterpartyId: user2Id,
  });

  const [snapRenterBefore] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, user1Id));
  const [snapOwnerBefore] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, user2Id));

  const scoreRenterBefore = snapRenterBefore.reputationScore ?? 0;
  const scoreOwnerBefore = snapOwnerBefore.reputationScore ?? 0;

  // Retry the full completion — should award owner but skip renter.
  await awardRentalCompletionPoints(user1Id, user2Id, rentalPartialRequestId, item1Id, false);

  // Renter should have exactly one rental_dispute_free row (not two).
  const rowsRenter = await db
    .select()
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, user1Id),
        eq(reputationActivities.requestId, rentalPartialRequestId),
        eq(reputationActivities.activityType, "rental_dispute_free"),
      ),
    );
  assert.equal(rowsRenter.length, 1, "renter should still have exactly one rental_dispute_free row after retry");

  // Owner should now have exactly one rental_dispute_free row.
  const rowsOwner = await db
    .select()
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, user2Id),
        eq(reputationActivities.requestId, rentalPartialRequestId),
        eq(reputationActivities.activityType, "rental_dispute_free"),
      ),
    );
  assert.equal(rowsOwner.length, 1, "owner should have exactly one rental_dispute_free row after retry");

  // Renter's score must not have changed (already awarded).
  const [snapRenterAfter] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, user1Id));
  assert.equal(
    snapRenterAfter.reputationScore,
    scoreRenterBefore,
    `renter score must be unchanged on retry (no double-award), but changed by ${(snapRenterAfter.reputationScore ?? 0) - scoreRenterBefore}`,
  );

  // Owner's score must have increased by exactly +20.
  const [snapOwnerAfter] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, user2Id));
  const deltaOwner = (snapOwnerAfter.reputationScore ?? 0) - scoreOwnerBefore;
  assert.equal(
    deltaOwner,
    TRUST_POINTS.MICRO.RENTAL_DISPUTE_FREE, // +20
    `owner score delta should be exactly +20 (one award on retry), but was ${deltaOwner}`,
  );
});
