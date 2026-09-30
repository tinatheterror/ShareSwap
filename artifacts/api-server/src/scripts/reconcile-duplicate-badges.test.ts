import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pool as adminPool } from "@workspace/db";
import { reconcileDuplicateBadges, reportDuplicateBadges } from "./reconcile-duplicate-badges.js";

const Pool = adminPool.constructor as new (config: {
  connectionString?: string;
  options?: string;
}) => typeof adminPool;

test("duplicate-containing migration fails closed; reviewed repair preserves history and enables uniqueness", async (t) => {
  const schema = `badge_reconciliation_${randomUUID().replaceAll("-", "")}`;
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const db = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
  t.after(async () => {
    await db.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  });
  await db.query(`
    CREATE TABLE users (id integer PRIMARY KEY, share_coins numeric(10,2) NOT NULL);
    CREATE TABLE achievements (id integer PRIMARY KEY, name text NOT NULL);
    CREATE TABLE user_achievements (
      id integer PRIMARY KEY, user_id integer, achievement_id integer, review_id integer,
      earned_at timestamp DEFAULT now(), progress integer DEFAULT 100, is_completed boolean DEFAULT true
    );
    CREATE TABLE share_coins_transactions (
      id serial PRIMARY KEY, user_id integer, amount numeric NOT NULL,
      description text NOT NULL, transaction_type text NOT NULL,
      review_id integer, created_at timestamp DEFAULT now()
    );
    CREATE TABLE notifications (
      id integer PRIMARY KEY, user_id integer, type text, title text, message text,
      review_id integer, created_at timestamp DEFAULT now()
    );
    INSERT INTO users VALUES (10, 4.00);
    INSERT INTO achievements VALUES (7, 'First Lend'), (8, 'First Borrow');
    INSERT INTO user_achievements (id, user_id, achievement_id) VALUES
      (101,10,7), (102,10,7), (103,10,8), (104,10,8);
    INSERT INTO share_coins_transactions (id,user_id,amount,description,transaction_type) VALUES
      (201,10,1,'Badge unlocked: First Lend','EARNED'),
      (202,10,1,'Badge unlocked: First Lend','EARNED'),
      (203,10,1,'Badge unlocked: First Borrow','EARNED'),
      (204,10,1,'Badge unlocked: First Borrow','EARNED'),
      (205,10,-2,'Spent elsewhere','SPENT');
    INSERT INTO notifications (id,user_id,type,title,message) VALUES
      (301,10,'badge_earned','🏅 Badge Unlocked: First Lend','earned'),
      (302,10,'badge_earned','🏅 Badge Unlocked: First Borrow','earned'),
      (303,10,'other','unrelated','unrelated');
  `);
  const migration = await readFile("../../lib/db/scripts/0006_unique_user_achievements.sql", "utf8");
  await assert.rejects(db.query(migration), /reconcile|badges:duplicates/);
  const report = await reportDuplicateBadges(db);
  assert.equal(report.duplicateGroupCount, 2);
  assert.equal(report.duplicates[0].rewardCandidates.length, 4);
  assert.equal(
    (await db.query("SELECT to_regclass('duplicate_badge_reconciliation_audits') AS name")).rows[0].name,
    null, "report must not mutate the database",
  );
  const plan = {
    reason: "Reviewed all four reward entries and preserved the spend history.",
    groups: [
      { userId: 10, achievementId: 7, canonicalBadgeId: 101, duplicateBadgeIds: [102],
        rewardTransactionIds: [201, 202], notificationIds: [301],
        expectedShareCoins: "4.00", targetShareCoins: "3.00" },
      { userId: 10, achievementId: 8, canonicalBadgeId: 103, duplicateBadgeIds: [104],
        rewardTransactionIds: [203, 204], notificationIds: [302],
        expectedShareCoins: "4.00", targetShareCoins: "3.00" },
    ],
  };
  await assert.rejects(
    reconcileDuplicateBadges({ ...plan, groups: [plan.groups[0]] }, "tester", db),
    /cover exactly/,
  );
  await assert.rejects(
    reconcileDuplicateBadges({
      ...plan, groups: [
        { ...plan.groups[0], duplicateBadgeIds: [999] }, plan.groups[1],
      ],
    }, "tester", db),
    /Badge selection changed/,
  );
  await assert.rejects(
    reconcileDuplicateBadges({
      ...plan, groups: [
        { ...plan.groups[0], expectedShareCoins: "5.00" },
        { ...plan.groups[1], expectedShareCoins: "5.00" },
      ],
    }, "tester", db),
    /balance changed/,
  );
  await assert.rejects(
    reconcileDuplicateBadges({
      ...plan, groups: [
        { ...plan.groups[0], rewardTransactionIds: [205] }, plan.groups[1],
      ],
    }, "tester", db),
    /Unrelated, stale or reused/,
  );
  assert.equal((await db.query("SELECT count(*)::int AS n FROM user_achievements")).rows[0].n, 4);
  assert.equal((await db.query("SELECT to_regclass('duplicate_badge_reconciliation_audits') AS name")).rows[0].name, null);
  assert.deepEqual(await reconcileDuplicateBadges(plan, "tester", db), {
    status: "reconciled", groups: 2,
  });
  assert.equal((await reportDuplicateBadges(db)).duplicateGroupCount, 0);
  const badges = await db.query("SELECT id FROM user_achievements ORDER BY id");
  assert.deepEqual(badges.rows.map((row) => row.id), [101, 103]);
  const audits = await db.query("SELECT * FROM duplicate_badge_reconciliation_audits ORDER BY achievement_id");
  assert.deepEqual(audits.rows.map((row) => row.archived_badges[0].id), [102, 104]);
  assert.deepEqual(audits.rows.map((row) => row.reviewed_rewards.length), [2, 2]);
  assert.deepEqual(audits.rows.map((row) => row.reviewed_notifications.length), [1, 1]);
  assert.equal((await db.query("SELECT share_coins FROM users WHERE id=10")).rows[0].share_coins, "3.00");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM share_coins_transactions")).rows[0].n, 6);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM notifications")).rows[0].n, 3);
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM share_coins_transactions WHERE transaction_type='ADJUSTMENT'")).rows[0].n,
    1,
  );
  await assert.rejects(
    db.query("INSERT INTO user_achievements (id,user_id,achievement_id) VALUES (105,10,7)"),
    (error: any) => error.code === "23505",
  );
  await db.query(migration);
});