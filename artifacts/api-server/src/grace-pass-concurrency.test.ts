import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { db, pool, reputationActivities, users } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  applyTrustPenalty,
  GRACE_PASS_CONFIG,
  TRUST_POINTS,
  trustLevelForScore,
} from "./trust-score-service.js";

after(async () => {
  await pool.end();
});

async function createUser(t: TestContext) {
  const [user] = await db.insert(users).values({
    username: `grace-concurrency-${randomUUID()}`,
    reputationScore: 155,
    reputationLevel: "Trusted Member",
  }).returning();
  t.after(async () => {
    await db.delete(reputationActivities).where(eq(reputationActivities.userId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
  });
  return user.id;
}

const deductions = {
  cancel_after_acceptance: -TRUST_POINTS.PENALTIES.CANCEL_AFTER_ACCEPTANCE,
  low_review_one_star: -TRUST_POINTS.PENALTIES.LOW_REVIEW_ONE_STAR,
  low_review_two_star: -TRUST_POINTS.PENALTIES.LOW_REVIEW_TWO_STAR,
};

for (const penaltyType of GRACE_PASS_CONFIG.ENABLED_PENALTY_TYPES) {
  for (const callerOwned of [false, true]) {
    test(`${penaltyType}: concurrent distinct events use only one grace pass (${callerOwned ? "caller transaction" : "default database"})`, async (t) => {
      const userId = await createUser(t);
      const backendPids: number[] = [];
      // Hold the row so both supplied transactions are definitely contending.
      // Before the fix both would read an empty warning history, then block in
      // awardTrustPoints. After the fix they block before reading eligibility.
      const blocker = callerOwned ? await pool.connect() : undefined;
      let attempts: Promise<Awaited<ReturnType<typeof applyTrustPenalty>>>[] = [];
      let results: Awaited<ReturnType<typeof applyTrustPenalty>>[] = [];
      try {
        if (blocker) {
          await blocker.query("BEGIN");
          await blocker.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
        }
        attempts = ["first distinct event", "second distinct event"].map((itemName) =>
          callerOwned
            ? db.transaction(async (tx) => {
                await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
                const pid = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
                backendPids.push(Number(pid.rows[0].pid));
                return applyTrustPenalty(userId, penaltyType, { itemName }, tx);
              })
            : applyTrustPenalty(userId, penaltyType, { itemName }),
        );
        // Attach rejection handlers immediately, including if the barrier fails.
        const settled = Promise.allSettled(attempts);
        if (blocker) {
          const deadline = Date.now() + 5000;
          let bothBlocked = false;
          while (Date.now() < deadline) {
            if (backendPids.length === 2) {
              const waiting = await pool.query(
                "SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid = ANY($1::int[]) AND wait_event_type = 'Lock'",
                [backendPids],
              );
              if (waiting.rows[0].count === 2) {
                bothBlocked = true;
                break;
              }
            }
            await delay(10);
          }
          assert.ok(bothBlocked, "both penalty events must contend on the user lock");
          await blocker.query("COMMIT");
        }
        const outcomes = await settled;
        for (const outcome of outcomes) {
          if (outcome.status === "rejected") throw outcome.reason;
          results.push(outcome.value);
        }
      } finally {
        if (blocker) {
          await blocker.query("ROLLBACK");
          blocker.release();
        }
        await Promise.allSettled(attempts);
      }

      assert.equal(results.filter((result) => result.wasGracePass).length, 1);
      const waived = results.find((result) => result.wasGracePass)!;
      const charged = results.find((result) => !result.wasGracePass)!;
      assert.deepEqual(waived, {
        applied: false, wasGracePass: true, pointsDeducted: 0, newScore: 155,
      });
      const expectedScore = 155 - deductions[penaltyType];
      assert.deepEqual(charged, {
        applied: true, wasGracePass: false,
        pointsDeducted: deductions[penaltyType], newScore: expectedScore,
      });
      const activities = await db.select().from(reputationActivities)
        .where(eq(reputationActivities.userId, userId));
      assert.equal(activities.length, 2);
      const warnings = activities.filter((row) => row.activityType === "grace_pass_warning");
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0].points, 0);
      assert.ok(warnings[0].description?.includes(penaltyType));
      const penalties = activities.filter((row) => row.activityType === penaltyType);
      assert.equal(penalties.length, 1);
      assert.equal(penalties[0].points, -deductions[penaltyType]);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      assert.equal(user.reputationScore, expectedScore);
      assert.equal(user.reputationLevel, trustLevelForScore(expectedScore));
    });
  }
}

test("a caller rollback does not consume the grace pass or keep a penalty", async (t) => {
  const userId = await createUser(t);
  for (const expectedGracePass of [true, false]) {
    await assert.rejects(db.transaction(async (tx) => {
      const result = await applyTrustPenalty(userId, "cancel_after_acceptance", {}, tx);
      assert.equal(result.wasGracePass, expectedGracePass);
      throw new Error("abort caller");
    }), /abort caller/);
    const activities = await db.select().from(reputationActivities)
      .where(eq(reputationActivities.userId, userId));
    assert.equal(activities.length, expectedGracePass ? 0 : 1);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    assert.equal(user.reputationScore, 155);
    assert.equal(user.reputationLevel, "Trusted Member");
    if (expectedGracePass) {
      const retry = await applyTrustPenalty(userId, "cancel_after_acceptance");
      assert.equal(retry.wasGracePass, true, "rolled-back warning must not consume eligibility");
    }
  }
});

test("grace passes stay per-type and expire after the lookback period", async (t) => {
  const userId = await createUser(t);
  for (const type of GRACE_PASS_CONFIG.ENABLED_PENALTY_TYPES) {
    const result = await applyTrustPenalty(userId, type);
    assert.equal(result.wasGracePass, true, "another type's warning must not block this type");
  }
  const expiredDate = new Date();
  expiredDate.setDate(expiredDate.getDate() - GRACE_PASS_CONFIG.LOOKBACK_DAYS - 1);
  await db.update(reputationActivities).set({ createdAt: expiredDate })
    .where(eq(reputationActivities.userId, userId));
  const renewed = await applyTrustPenalty(userId, "cancel_after_acceptance");
  assert.equal(renewed.wasGracePass, true);
  const next = await applyTrustPenalty(userId, "cancel_after_acceptance");
  assert.equal(next.wasGracePass, false);
  assert.equal(next.newScore, 135);
});