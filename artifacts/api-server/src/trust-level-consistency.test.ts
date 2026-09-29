import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db, pool, reputationActivities, users } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  awardTrustPoints,
  trustLevelForScore,
  trustLevelForSqlScore,
} from "./trust-score-service.js";

after(async () => {
  await pool.end();
});

test("trust levels follow their score thresholds", () => {
  for (const [score, level] of [
    [0, "Newcomer"],
    [49, "Newcomer"],
    [50, "Neighbour"],
    [149, "Neighbour"],
    [150, "Trusted Member"],
    [292, "Trusted Member"],
    [299, "Trusted Member"],
    [300, "Community Pillar"],
    [499, "Community Pillar"],
    [500, "ShareSwap Champion"],
  ] as const) {
    assert.equal(trustLevelForScore(score), level);
  }
});

test("penalties and awards update the stored level with the score", async () => {
  const [user] = await db.insert(users).values({
    username: `trust-level-test-${Date.now()}`,
    reputationScore: 302,
    reputationLevel: "Community Pillar",
  }).returning({ id: users.id });

  const readTrust = async () => {
    const [row] = await db.select({
      score: users.reputationScore,
      level: users.reputationLevel,
    }).from(users).where(eq(users.id, user.id));
    return row;
  };

  try {
    await awardTrustPoints(user.id, "item_not_returned", -10);
    assert.deepEqual(await readTrust(), { score: 292, level: "Trusted Member" });

    await awardTrustPoints(user.id, "gifting_completed", 10);
    assert.deepEqual(await readTrust(), { score: 302, level: "Community Pillar" });

    await awardTrustPoints(user.id, "fraud_abuse", -500);
    assert.deepEqual(await readTrust(), { score: 0, level: "Newcomer" });

    const raisedScore = sql<number>`LEAST(500, reputation_score + 500)`;
    await db.update(users).set({
      reputationScore: raisedScore,
      reputationLevel: trustLevelForSqlScore(raisedScore),
    }).where(eq(users.id, user.id));
    assert.deepEqual(await readTrust(), { score: 500, level: "ShareSwap Champion" });
  } finally {
    await db.delete(reputationActivities).where(eq(reputationActivities.userId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
  }
});