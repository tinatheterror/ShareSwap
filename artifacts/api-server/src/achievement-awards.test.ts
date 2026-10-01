import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { db, pool, achievements, notifications, shareCoinsTransactions, userAchievements, users } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { awardAchievementOnce } from "./achievement-awards";

test("simultaneous claims for one badge pay one coin and send one notification", async (t) => {
  const migration = await readFile(
    new URL("../../../lib/db/scripts/0006_unique_user_achievements.sql", import.meta.url),
    "utf8",
  );
  await pool.query(migration);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [user] = await db.insert(users).values({ username: `badge-race-${suffix}`, shareCoins: "0" }).returning();
  const [badge] = await db.insert(achievements).values({
    name: `badge-race-${suffix}`,
    description: "Concurrency test badge",
    badgeIcon: "🏅",
    badgeColor: "#123456",
    category: "milestone",
  }).returning();

  t.after(async () => {
    await db.delete(notifications).where(eq(notifications.userId, user.id));
    await db.delete(shareCoinsTransactions).where(eq(shareCoinsTransactions.userId, user.id));
    await db.delete(userAchievements).where(eq(userAchievements.userId, user.id));
    await db.delete(achievements).where(eq(achievements.id, badge.id));
    await db.delete(users).where(eq(users.id, user.id));
  });

  const award = {
    userId: user.id,
    achievementId: badge.id,
    title: "Concurrency test badge",
    description: "Concurrency test badge",
  };
  const results = await Promise.all(Array.from({ length: 8 }, () => awardAchievementOnce(award)));
  assert.equal(results.filter(Boolean).length, 1);

  const [badges, coins, alerts, [account]] = await Promise.all([
    db.select().from(userAchievements).where(and(
      eq(userAchievements.userId, user.id),
      eq(userAchievements.achievementId, badge.id),
    )),
    db.select().from(shareCoinsTransactions).where(eq(shareCoinsTransactions.userId, user.id)),
    db.select().from(notifications).where(eq(notifications.userId, user.id)),
    db.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, user.id)),
  ]);
  assert.equal(badges.length, 1);
  assert.equal(coins.length, 1);
  assert.equal(coins[0].amount, "1");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, "badge_earned");
  assert.equal(account.shareCoins, "1.00");
});

test("a late notification failure rolls back the badge and reward, leaving the award retryable", async (t) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [user] = await db.insert(users).values({ username: `badge-rollback-${suffix}`, shareCoins: "0" }).returning();
  const [badge] = await db.insert(achievements).values({
    name: `badge-rollback-${suffix}`,
    description: "Rollback test badge",
    badgeIcon: "🏅",
    badgeColor: "#123456",
    category: "milestone",
  }).returning();

  t.after(async () => {
    await db.delete(notifications).where(eq(notifications.userId, user.id));
    await db.delete(shareCoinsTransactions).where(eq(shareCoinsTransactions.userId, user.id));
    await db.delete(userAchievements).where(eq(userAchievements.userId, user.id));
    await db.delete(achievements).where(eq(achievements.id, badge.id));
    await db.delete(users).where(eq(users.id, user.id));
  });

  const award = {
    userId: user.id,
    achievementId: badge.id,
    title: "Rollback test badge",
    description: "Rollback test badge",
  };
  const state = async () => {
    const [badges, coins, alerts, [account]] = await Promise.all([
      db.select().from(userAchievements).where(and(
        eq(userAchievements.userId, user.id),
        eq(userAchievements.achievementId, badge.id),
      )),
      db.select().from(shareCoinsTransactions).where(eq(shareCoinsTransactions.userId, user.id)),
      db.select().from(notifications).where(eq(notifications.userId, user.id)),
      db.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, user.id)),
    ]);
    return { badges, coins, alerts, account };
  };

  // The ledger description is text, but notification titles are varchar(255).
  // This fails at the final insert, after the badge, ledger, and balance writes.
  await assert.rejects(
    awardAchievementOnce({ ...award, title: "x".repeat(256) }),
    (error: unknown) => {
      assert.equal((error as { cause?: { code?: string } }).cause?.code, "22001");
      return true;
    },
  );
  const failed = await state();
  assert.equal(failed.badges.length, 0);
  assert.equal(failed.coins.length, 0);
  assert.equal(failed.alerts.length, 0);
  assert.equal(failed.account.shareCoins, "0.00");

  assert.equal(await awardAchievementOnce(award), true);
  assert.equal(await awardAchievementOnce(award), false);
  const retried = await state();
  assert.equal(retried.badges.length, 1);
  assert.equal(retried.coins.length, 1);
  assert.equal(retried.coins[0].amount, "1");
  assert.equal(retried.alerts.length, 1);
  assert.equal(retried.alerts[0].type, "badge_earned");
  assert.equal(retried.account.shareCoins, "1.00");
});