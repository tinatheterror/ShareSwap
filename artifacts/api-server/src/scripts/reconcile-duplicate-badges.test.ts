import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { pool as adminPool } from "@workspace/db";
import { reconcileDuplicateBadges, reportDuplicateBadges } from "./reconcile-duplicate-badges.js";

const Pool = adminPool.constructor as new (config: {
  connectionString?: string;
  options?: string;
}) => typeof adminPool;

async function createFixture(t: TestContext) {
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
  return db;
}

test("duplicate-containing migration fails closed; reviewed repair preserves history and enables uniqueness", async (t) => {
  const db = await createFixture(t);
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

test("concurrent operators reconcile each duplicate badge group only once", { timeout: 60_000 }, async (t) => {
  for (const targetShareCoins of ["3.00", "4.00"]) {
    await t.test(`target balance ${targetShareCoins}`, { timeout: 25_000 }, async (t) => {
      const db = await createFixture(t);
      // Keep a separate, valid badge and its effects to detect unrelated deletion.
      await db.query("DELETE FROM user_achievements WHERE id = 104");
      const originalBadges = (await db.query("SELECT * FROM user_achievements ORDER BY id")).rows;
      const originalRewards = (await db.query("SELECT * FROM share_coins_transactions ORDER BY id")).rows;
      const originalNotices = (await db.query("SELECT * FROM notifications ORDER BY id")).rows;
      const plan = {
        reason: "Both operators reviewed the same duplicate badge and reward history.",
        groups: [{
          userId: 10, achievementId: 7, canonicalBadgeId: 101, duplicateBadgeIds: [102],
          rewardTransactionIds: [201, 202], notificationIds: [301],
          expectedShareCoins: "4.00", targetShareCoins,
        }],
      };
      const winner = await db.connect();
      const loser = await db.connect();
      let resumeWinner!: () => void;
      const resume = new Promise<void>((resolve) => { resumeWinner = resolve; });
      let signalDeleted!: () => void;
      const deleted = new Promise<void>((resolve) => { signalDeleted = resolve; });
      const attempts: Promise<PromiseSettledResult<Awaited<ReturnType<typeof reconcileDuplicateBadges>>>>[] = [];
      const settle = (attempt: ReturnType<typeof reconcileDuplicateBadges>) => attempt.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      try {
        // Bound database waits independently of the test runner timeout.
        await winner.query("SET statement_timeout = '10s'");
        await loser.query("SET statement_timeout = '10s'");
        const winnerPid = (await winner.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        const loserPid = (await loser.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        const first = settle(reconcileDuplicateBadges(plan, "first operator", {
          connect: async () => ({
            query: async (text, values) => {
              const result = await winner.query(text, values);
              if (text.startsWith("DELETE FROM user_achievements")) {
                signalDeleted();
                await resume;
              }
              return result;
            },
            // These reserved connections are released only after both attempts settle.
            release() {},
          }),
        }));
        attempts.push(first);
        await Promise.race([
          deleted,
          first.then((result) => {
            assert.fail(`First repair finished before the concurrency barrier: ${JSON.stringify(result)}`);
          }),
        ]);
        const second = settle(reconcileDuplicateBadges(plan, "second operator", {
          connect: async () => ({
            query: (text, values) => loser.query(text, values),
            release() {},
          }),
        }));
        attempts.push(second);
        // Prove actual database contention; merely starting two promises can run
        // sequentially and miss a regression in the transaction lock.
        const deadline = Date.now() + 5_000;
        let blocked = false;
        while (Date.now() < deadline) {
          await db.query("SELECT pg_stat_clear_snapshot()");
          const activity = await db.query(`
            SELECT wait_event_type, $1::int = ANY(pg_blocking_pids(pid)) AS blocked
            FROM pg_stat_activity WHERE pid = $2
          `, [winnerPid, loserPid]);
          if (activity.rows[0]?.wait_event_type === "Lock" && activity.rows[0]?.blocked) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.ok(blocked, "second operator must wait for the uncommitted first repair");
        resumeWinner();
        const [firstResult, secondResult] = await Promise.all(attempts);
        assert.deepEqual(firstResult, {
          status: "fulfilled", value: { status: "reconciled", groups: 1 },
        });
        assert.equal(secondResult.status, "rejected", "stale competing plan must fail safely");
        if (secondResult.status === "rejected") {
          assert.ok(secondResult.reason instanceof Error);
          assert.match(secondResult.reason.message, /Plan must cover exactly the current duplicate groups:/);
        }

        assert.deepEqual(
          (await db.query("SELECT * FROM user_achievements ORDER BY id")).rows,
          originalBadges.filter((badge) => badge.id !== 102),
          "losing repair must preserve the canonical and unrelated badges",
        );
        const rewards = (await db.query("SELECT * FROM share_coins_transactions ORDER BY id")).rows;
        assert.deepEqual(rewards.filter((reward) => reward.transaction_type !== "ADJUSTMENT"), originalRewards,
          "all historical rewards and unrelated spending must remain unchanged");
        assert.deepEqual((await db.query("SELECT * FROM notifications ORDER BY id")).rows, originalNotices);
        assert.equal((await db.query("SELECT share_coins FROM users WHERE id = 10")).rows[0].share_coins,
          targetShareCoins);
        const corrections = rewards.filter((reward) => reward.transaction_type === "ADJUSTMENT");
        assert.equal(corrections.length, targetShareCoins === "3.00" ? 1 : 0);
        if (corrections.length) {
          assert.equal(Number(corrections[0].amount), -1, "balance correction must occur exactly once");
          assert.equal(corrections[0].user_id, 10);
        }
        const audits = (await db.query("SELECT * FROM duplicate_badge_reconciliation_audits")).rows;
        assert.equal(audits.length, 1, "only the committed operator may create an audit");
        assert.equal(audits[0].operator_name, "first operator");
        assert.equal(audits[0].user_id, 10);
        assert.equal(audits[0].achievement_id, 7);
        // JSON audit timestamps are strings; compare through the same serialization.
        const json = (value: unknown) => JSON.parse(JSON.stringify(value));
        assert.deepEqual(audits[0].canonical_badge, json(originalBadges[0]));
        assert.deepEqual(audits[0].archived_badges, json([originalBadges[1]]));
        assert.deepEqual(audits[0].reviewed_rewards, json(originalRewards.slice(0, 2)));
        assert.deepEqual(audits[0].reviewed_notifications, json([originalNotices[0]]));
        assert.deepEqual(audits[0].correction_transaction, json(corrections[0] ?? null));
        assert.equal((await reportDuplicateBadges(db)).duplicateGroupCount, 0);
        await assert.rejects(
          db.query("INSERT INTO user_achievements (id,user_id,achievement_id) VALUES (105,10,7)"),
          (error: any) => error.code === "23505",
        );
      } finally {
        // Do not leave paused transactions or schema locks behind on an assertion failure.
        resumeWinner();
        await Promise.all(attempts);
        winner.release();
        loser.release();
      }
    });
  }
});