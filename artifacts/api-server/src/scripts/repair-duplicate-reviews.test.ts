import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pool as adminPool } from "@workspace/db";
import {
  applyDuplicateReviewRepair,
  buildDuplicateReviewReport,
} from "./repair-duplicate-reviews.js";

const Pool = adminPool.constructor as new (config: {
  connectionString?: string;
  options?: string;
}) => typeof adminPool;

test("reviewed duplicate repair is complete, audited, and safe to rerun", async (t) => {
  const schema = `duplicate_review_repair_${Date.now()}`;
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const testPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema}`,
  });

  t.after(async () => {
    await testPool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  });

  await testPool.query(`
    CREATE TABLE users (
      id serial PRIMARY KEY,
      reputation_score integer NOT NULL DEFAULT 0,
      reputation_level text NOT NULL DEFAULT 'Newcomer',
      share_coins numeric NOT NULL DEFAULT 0
    );
    CREATE TABLE user_reviews (
      id serial PRIMARY KEY,
      reviewer_id integer NOT NULL,
      reviewed_user_id integer NOT NULL,
      transaction_id integer,
      rating integer NOT NULL,
      comment text,
      feedback_tags text[],
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE reputation_activities (
      id serial PRIMARY KEY,
      user_id integer NOT NULL,
      activity_type text NOT NULL,
      points integer NOT NULL,
      item_id integer,
      request_id integer,
      review_id integer,
      description text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE share_coins_transactions (
      id serial PRIMARY KEY,
      user_id integer NOT NULL,
      amount numeric NOT NULL,
      description text NOT NULL,
      transaction_type text NOT NULL,
      review_id integer,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE notifications (
      id serial PRIMARY KEY,
      user_id integer NOT NULL,
      type text NOT NULL,
      title text NOT NULL,
      message text NOT NULL,
      request_id integer,
      review_id integer,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE achievements (
      id serial PRIMARY KEY,
      name text NOT NULL
    );
    CREATE TABLE user_achievements (
      id serial PRIMARY KEY,
      user_id integer NOT NULL,
      achievement_id integer NOT NULL,
      review_id integer,
      earned_at timestamp NOT NULL DEFAULT now()
    );
  `);

  await testPool.query(`
    INSERT INTO users (id, reputation_score, reputation_level, share_coins)
    VALUES (10, 500, 'ShareSwap Champion', 2);
    INSERT INTO user_reviews
      (id, reviewer_id, reviewed_user_id, transaction_id, rating, comment)
    VALUES
      (1, 20, 10, 30, 5, 'canonical'),
      (2, 20, 10, 30, 5, 'duplicate');
    INSERT INTO reputation_activities
      (id, user_id, activity_type, points, request_id, review_id, description)
    VALUES
      (1, 10, 'RECEIVE_REVIEW', 5, 30, NULL, 'canonical effect'),
      (2, 10, 'RECEIVE_REVIEW', 5, 30, NULL, 'duplicate effect');
    INSERT INTO share_coins_transactions
      (id, user_id, amount, description, transaction_type)
    VALUES
      (1, 10, 5, 'Level Up Bonus — Neighbour', 'EARNED'),
      (2, 10, 5, 'Level Up Bonus — Neighbour', 'EARNED');
    INSERT INTO notifications
      (id, user_id, type, title, message, request_id)
    VALUES
      (1, 10, 'new_review_received', 'canonical', 'canonical', 30),
      (2, 10, 'new_review_received', 'duplicate', 'duplicate', 30);
    INSERT INTO achievements (id, name) VALUES (1, 'Reviewed');
    INSERT INTO user_achievements (id, user_id, achievement_id)
    VALUES (1, 10, 1), (2, 10, 1);
  `);

  const report = await buildDuplicateReviewReport(testPool);
  assert.equal(report.duplicateGroupCount, 1);
  const auditTableBeforeApply = await testPool.query(
    "SELECT to_regclass('duplicate_review_repair_audits') AS name",
  );
  assert.equal(auditTableBeforeApply.rows[0].name, null, "report mode must be read-only");
  assert.deepEqual(
    report.duplicates[0].reviews.map((review: any) => review.id),
    [1, 2],
  );
  assert.equal(report.duplicates[0].relatedEffects.reputationActivities.length, 2);
  assert.equal(report.duplicates[0].relatedEffects.shareCoinTransactions.length, 2);
  assert.equal(report.duplicates[0].relatedEffects.notifications.length, 2);
  assert.equal(report.duplicates[0].relatedEffects.userAchievements.length, 2);
  assert.equal(report.duplicates[0].affectedUsers[0].reputationScore, 500);
  assert.equal(report.duplicates[0].attributedEffects.reputationActivities.length, 0);
  assert.equal(report.duplicates[0].legacyCandidates.reputationActivities.length, 2);

  const plan = {
    reason: "Remove effects confirmed to belong to the duplicate review.",
    userReconciliations: [{
      userId: 10,
      expectedReputationScore: 500,
      targetReputationScore: 500,
      expectedShareCoins: "2",
      targetShareCoins: "0",
    }],
    repairs: [{
      reviewerId: 20,
      transactionId: 30,
      canonicalReviewId: 1,
      reputationActivityIds: [2],
      shareCoinTransactionIds: [2],
      notificationIds: [2],
      userAchievementIds: [2],
    }],
  };
  await assert.rejects(
    applyDuplicateReviewRepair({
      ...plan,
      repairs: [plan.repairs[0], {
        ...plan.repairs[0],
        reputationActivityIds: [2],
        shareCoinTransactionIds: [],
        notificationIds: [],
        userAchievementIds: [],
      }],
    }, "integration-test", testPool),
    /selected in more than one repair group/,
  );
  assert.equal(
    (await testPool.query("SELECT count(*)::int AS count FROM user_reviews")).rows[0].count,
    2,
  );
  assert.deepEqual(
    await applyDuplicateReviewRepair(plan, "integration-test", testPool),
    { status: "repaired", repairedGroups: 1 },
  );

  const [reviews, activities, coins, notifications, achievements, users, audits] =
    await Promise.all([
      testPool.query("SELECT id FROM user_reviews ORDER BY id"),
      testPool.query("SELECT id FROM reputation_activities ORDER BY id"),
      testPool.query("SELECT id FROM share_coins_transactions ORDER BY id"),
      testPool.query("SELECT id FROM notifications ORDER BY id"),
      testPool.query("SELECT id FROM user_achievements ORDER BY id"),
      testPool.query("SELECT reputation_score, share_coins FROM users WHERE id = 10"),
      testPool.query("SELECT * FROM duplicate_review_repair_audits"),
    ]);
  assert.deepEqual(reviews.rows, [{ id: 1 }]);
  assert.deepEqual(activities.rows, [{ id: 1 }]);
  assert.deepEqual(coins.rows, [{ id: 1 }]);
  assert.deepEqual(notifications.rows, [{ id: 1 }]);
  assert.deepEqual(achievements.rows, [{ id: 1 }]);
  assert.equal(users.rows[0].reputation_score, 500);
  assert.equal(Number(users.rows[0].share_coins), 0);
  assert.equal(audits.rowCount, 1);
  assert.equal(audits.rows[0].canonical_review_id, 1);
  assert.equal(audits.rows[0].removed_reviews[0].id, 2);

  await assert.rejects(
    testPool.query(`
      INSERT INTO user_reviews
        (reviewer_id, reviewed_user_id, transaction_id, rating)
      VALUES (20, 10, 30, 4)
    `),
    (error: any) => error?.code === "23505",
  );
  assert.deepEqual(
    await applyDuplicateReviewRepair(plan, "integration-test", testPool),
    { status: "already_repaired", repairedGroups: 0 },
  );
});

test("report separates exact review effects from nearby unrelated activity", async (t) => {
  const schema = `review_effect_attribution_${Date.now()}`;
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const testPool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
  t.after(async () => {
    await testPool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  });
  await testPool.query(`
    CREATE TABLE user_reviews (id integer PRIMARY KEY, reviewer_id integer, reviewed_user_id integer, transaction_id integer, rating integer, comment text, feedback_tags text[], created_at timestamp);
    CREATE TABLE users (id integer PRIMARY KEY, reputation_score integer, reputation_level text, share_coins numeric);
    CREATE TABLE reputation_activities (id integer PRIMARY KEY, user_id integer, activity_type text, request_id integer, review_id integer, created_at timestamp);
    CREATE TABLE share_coins_transactions (id integer PRIMARY KEY, user_id integer, description text, transaction_type text, amount numeric, review_id integer, created_at timestamp);
    CREATE TABLE notifications (id integer PRIMARY KEY, user_id integer, type text, request_id integer, review_id integer, created_at timestamp);
    CREATE TABLE achievements (id integer PRIMARY KEY, name text);
    CREATE TABLE user_achievements (id integer PRIMARY KEY, user_id integer, achievement_id integer, review_id integer, earned_at timestamp);
    INSERT INTO users VALUES (10, 0, 'Newcomer', 0);
    INSERT INTO user_reviews VALUES (1, 20, 10, 30, 5, NULL, NULL, '2020-01-01'), (2, 20, 10, 30, 5, NULL, NULL, '2020-01-01');
    INSERT INTO reputation_activities VALUES (1, 10, 'RECEIVE_REVIEW', 30, 2, '2026-01-01'), (2, 10, 'lending_smooth', 30, NULL, '2020-01-01');
    INSERT INTO share_coins_transactions VALUES (1, 20, 'Badge unlocked', 'EARNED', 1, 2, '2026-01-01'), (2, 10, 'Borrowed', 'EARNED', 1, NULL, '2020-01-01');
    INSERT INTO notifications VALUES (1, 20, 'badge_earned', NULL, 2, '2026-01-01'), (2, 10, 'request_accepted', 30, NULL, '2020-01-01');
    INSERT INTO achievements VALUES (1, 'review badge');
    INSERT INTO user_achievements VALUES (1, 20, 1, 2, '2026-01-01'), (2, 10, 1, NULL, '2020-01-01');
  `);
  const report = await buildDuplicateReviewReport(testPool);
  const group = report.duplicates[0];
  for (const category of ["reputationActivities", "shareCoinTransactions", "notifications", "userAchievements"] as const) {
    assert.deepEqual(group.attributedEffects[category].map((row: any) => row.id), [1]);
  }
  assert.deepEqual(group.legacyCandidates.reputationActivities, []);
  assert.deepEqual(group.legacyCandidates.shareCoinTransactions, []);
  assert.deepEqual(group.legacyCandidates.notifications, []);
  // The unlabelled achievement is only a candidate, never an exact match.
  assert.deepEqual(group.legacyCandidates.userAchievements.map((row: any) => row.id), [2]);
  const plan = {
    reason: "Confirm every attributed effect before removing duplicates.",
    userReconciliations: [],
    repairs: [{
      reviewerId: 20, transactionId: 30, canonicalReviewId: 1,
      reputationActivityIds: [], shareCoinTransactionIds: [],
      notificationIds: [], userAchievementIds: [],
    }],
  };
  await assert.rejects(
    applyDuplicateReviewRepair(plan, "integration-test", testPool),
    /omits attributed effects of removed reviews/,
  );
  await assert.rejects(
    applyDuplicateReviewRepair({
      ...plan,
      repairs: [{ ...plan.repairs[0], canonicalReviewId: 2, reputationActivityIds: [1] }],
    }, "integration-test", testPool),
    /selects effects of the canonical review/,
  );
});

test("stale plans and mid-repair failures preserve both duplicate groups and their effects", async (t) => {
  const schema = `repair_rollback_${randomUUID().replaceAll("-", "")}`;
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const testPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema}`,
  });
  t.after(async () => {
    await testPool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  });

  await testPool.query(`
    CREATE TABLE users (id integer PRIMARY KEY, reputation_score integer, reputation_level text, share_coins numeric);
    CREATE TABLE user_reviews (id integer PRIMARY KEY, reviewer_id integer, reviewed_user_id integer, transaction_id integer, rating integer, comment text, feedback_tags text[], created_at timestamp);
    CREATE TABLE reputation_activities (id integer PRIMARY KEY, user_id integer, activity_type text, request_id integer, review_id integer, created_at timestamp);
    CREATE TABLE share_coins_transactions (id integer PRIMARY KEY, user_id integer, description text, transaction_type text, amount numeric, review_id integer, created_at timestamp);
    CREATE TABLE notifications (id integer PRIMARY KEY, user_id integer, type text, request_id integer, review_id integer, created_at timestamp);
    CREATE TABLE achievements (id integer PRIMARY KEY, name text);
    CREATE TABLE user_achievements (id integer PRIMARY KEY, user_id integer, achievement_id integer, review_id integer, earned_at timestamp);
    CREATE TABLE duplicate_review_repair_audits (
      id serial PRIMARY KEY,
      reviewer_id integer NOT NULL,
      transaction_id integer NOT NULL,
      canonical_review_id integer NOT NULL,
      operator_name text NOT NULL,
      reason text NOT NULL,
      removed_reviews jsonb NOT NULL,
      removed_reputation_activities jsonb NOT NULL DEFAULT '[]'::jsonb,
      removed_share_coin_transactions jsonb NOT NULL DEFAULT '[]'::jsonb,
      removed_notifications jsonb NOT NULL DEFAULT '[]'::jsonb,
      removed_user_achievements jsonb NOT NULL DEFAULT '[]'::jsonb,
      score_adjustments jsonb NOT NULL DEFAULT '[]'::jsonb,
      coin_adjustments jsonb NOT NULL DEFAULT '[]'::jsonb,
      repaired_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (reviewer_id, transaction_id)
    );
    INSERT INTO users VALUES (10, 500, 'ShareSwap Champion', 12);
    INSERT INTO achievements VALUES (1, 'Reviewed');
    INSERT INTO user_reviews VALUES
      (1, 20, 10, 30, 5, 'first canonical', NULL, '2026-01-01'),
      (2, 20, 10, 30, 5, 'first duplicate', NULL, '2026-01-02'),
      (3, 21, 10, 31, 5, 'second canonical', NULL, '2026-02-01'),
      (4, 21, 10, 31, 5, 'second duplicate', NULL, '2026-02-02');
    INSERT INTO reputation_activities VALUES
      (1, 10, 'RECEIVE_REVIEW', 30, 1, '2026-01-01'),
      (2, 10, 'RECEIVE_REVIEW', 30, 2, '2026-01-02'),
      (3, 10, 'RECEIVE_REVIEW', 31, 3, '2026-02-01'),
      (4, 10, 'RECEIVE_REVIEW', 31, 4, '2026-02-02');
    INSERT INTO share_coins_transactions VALUES
      (1, 10, 'review reward', 'EARNED', 5, 1, '2026-01-01'),
      (2, 10, 'review reward', 'EARNED', 5, 2, '2026-01-02'),
      (3, 10, 'review reward', 'EARNED', 5, 3, '2026-02-01'),
      (4, 10, 'review reward', 'EARNED', 5, 4, '2026-02-02');
    INSERT INTO notifications VALUES
      (1, 10, 'new_review_received', 30, 1, '2026-01-01'),
      (2, 10, 'new_review_received', 30, 2, '2026-01-02'),
      (3, 10, 'new_review_received', 31, 3, '2026-02-01'),
      (4, 10, 'new_review_received', 31, 4, '2026-02-02');
    INSERT INTO user_achievements VALUES
      (1, 10, 1, 1, '2026-01-01'),
      (2, 10, 1, 2, '2026-01-02'),
      (3, 10, 1, 3, '2026-02-01'),
      (4, 10, 1, 4, '2026-02-02');
  `);

  const report = await buildDuplicateReviewReport(testPool);
  assert.equal(report.duplicateGroupCount, 2);
  assert.deepEqual(report.duplicates.map((group: any) => group.affectedUsers[0].id), [10, 10]);
  const plan = {
    reason: "Remove reviewed effects from both duplicate groups.",
    repairs: [30, 31].map((transactionId, index) => ({
      reviewerId: 20 + index,
      transactionId,
      canonicalReviewId: 1 + index * 2,
      reputationActivityIds: [2 + index * 2],
      shareCoinTransactionIds: [2 + index * 2],
      notificationIds: [2 + index * 2],
      userAchievementIds: [2 + index * 2],
    })),
    userReconciliations: [{
      userId: 10,
      expectedReputationScore: 500,
      targetReputationScore: 490,
      expectedShareCoins: "12",
      targetShareCoins: "2",
    }],
  };
  const tables = [
    "users", "user_reviews", "reputation_activities",
    "share_coins_transactions", "notifications", "user_achievements",
    "duplicate_review_repair_audits",
  ];
  const snapshot = async () => {
    const rows = await Promise.all(tables.map(async (table) =>
      (await testPool.query(`SELECT * FROM ${table} ORDER BY id`)).rows));
    const auditTable = (await testPool.query(
      "SELECT to_regclass('duplicate_review_repair_audits') AS name",
    )).rows[0].name;
    return { rows, auditTable };
  };
  const rejectsWithoutChanges = async (expected: RegExp, apply = () =>
    applyDuplicateReviewRepair(plan, "integration-test", testPool)) => {
    const before = await snapshot();
    await assert.rejects(apply(), expected);
    assert.deepEqual(await snapshot(), before, "a rejected apply must not change any surviving rows or totals");
  };

  await testPool.query("UPDATE users SET reputation_score = 501 WHERE id = 10");
  await rejectsWithoutChanges(/reputation score changed: expected 500, found 501/);
  await testPool.query("UPDATE users SET reputation_score = 500, share_coins = 13 WHERE id = 10");
  await rejectsWithoutChanges(/ShareCoin balance changed: expected 12, found 13/);
  await testPool.query("UPDATE users SET share_coins = 12 WHERE id = 10");

  // The plan still selects the effect, but it vanished after the report was reviewed.
  await testPool.query("DELETE FROM notifications WHERE id = 4");
  await rejectsWithoutChanges(/notificationIds contains unrelated or stale IDs: 4/);
  await testPool.query(
    "INSERT INTO notifications VALUES (4, 10, 'new_review_received', 31, 4, '2026-02-02')",
  );

  let deletedEffects = 0;
  let deletedFirstGroupReviews = false;
  const failingClient = {
    connect: async () => {
      const connection = await testPool.connect();
      return {
        query: async (sql: string, values?: any[]) => {
          if (sql.startsWith("DELETE FROM user_reviews") && values?.[0]?.includes(4)) {
            assert.ok(deletedEffects >= 4, "effects from both groups were deleted before the failure");
            assert.ok(deletedFirstGroupReviews, "the first group was already repaired inside the transaction");
            throw new Error("injected failure after partial deletion");
          }
          const result = await connection.query(sql, values);
          if (sql.startsWith("DELETE FROM reputation_activities") ||
              sql.startsWith("DELETE FROM share_coins_transactions") ||
              sql.startsWith("DELETE FROM notifications") ||
              sql.startsWith("DELETE FROM user_achievements")) {
            deletedEffects += result.rowCount ?? 0;
          }
          if (sql.startsWith("DELETE FROM user_reviews")) deletedFirstGroupReviews = true;
          return result;
        },
        release: () => connection.release(),
      };
    },
    query: (sql: string, values?: any[]) => testPool.query(sql, values),
  };
  await rejectsWithoutChanges(
    /injected failure after partial deletion/,
    () => applyDuplicateReviewRepair(plan, "integration-test", failingClient),
  );
  assert.equal(deletedEffects, 8);

  let auditInserts = 0;
  let sawAdjustedTotals = false;
  const failingAuditClient = {
    connect: async () => {
      const connection = await testPool.connect();
      return {
        query: async (sql: string, values?: any[]) => {
          if (sql.includes("INSERT INTO duplicate_review_repair_audits")) {
            auditInserts++;
            if (auditInserts === 2) {
              const user = (await connection.query(
                "SELECT reputation_score, reputation_level, share_coins FROM users WHERE id = 10",
              )).rows[0];
              assert.equal(user.reputation_score, 490);
              assert.equal(user.reputation_level, "Community Pillar");
              assert.equal(Number(user.share_coins), 2);
              sawAdjustedTotals = true;
              assert.equal((await connection.query(
                "SELECT count(*)::int AS count FROM duplicate_review_repair_audits",
              )).rows[0].count, 1, "the first audit was inserted before the second fails");
              // Force a real PostgreSQL NOT NULL error on the second audit insert.
              return connection.query(sql, [
                ...values!.slice(0, 3), null, ...values!.slice(4),
              ]);
            }
          }
          return connection.query(sql, values);
        },
        release: () => connection.release(),
      };
    },
    query: (sql: string, values?: any[]) => testPool.query(sql, values),
  };
  await rejectsWithoutChanges(
    /null value in column "operator_name"/,
    () => applyDuplicateReviewRepair(plan, "integration-test", failingAuditClient),
  );
  assert.equal(auditInserts, 2);
  assert.ok(sawAdjustedTotals, "both balances were changed before the audit insert failed");

  assert.deepEqual(
    await applyDuplicateReviewRepair(plan, "integration-test", testPool),
    { status: "repaired", repairedGroups: 2 },
  );
  const after = await snapshot();
  assert.deepEqual(after.rows.slice(1, 6).map((rows) => rows.map((row: any) => row.id)),
    [[1, 3], [1, 3], [1, 3], [1, 3], [1, 3]]);
  assert.equal(after.rows[0][0].reputation_score, 490);
  assert.equal(Number(after.rows[0][0].share_coins), 2);
  assert.equal(after.rows[6].length, 2);
});

test("an effect removed by another connection during apply rolls back earlier deletions", async (t) => {
  const schema = `repair_concurrent_effect_${randomUUID().replaceAll("-", "")}`;
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const testPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema}`,
  });
  t.after(async () => {
    await testPool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  });

  await testPool.query(`
    CREATE TABLE users (id integer PRIMARY KEY, reputation_score integer, reputation_level text, share_coins numeric);
    CREATE TABLE user_reviews (id integer PRIMARY KEY, reviewer_id integer, reviewed_user_id integer, transaction_id integer, rating integer, comment text, feedback_tags text[], created_at timestamp);
    CREATE TABLE reputation_activities (id integer PRIMARY KEY, user_id integer, activity_type text, request_id integer, review_id integer, created_at timestamp);
    CREATE TABLE share_coins_transactions (id integer PRIMARY KEY, user_id integer, description text, transaction_type text, amount numeric, review_id integer, created_at timestamp);
    CREATE TABLE notifications (id integer PRIMARY KEY, user_id integer, type text, request_id integer, review_id integer, created_at timestamp);
    CREATE TABLE achievements (id integer PRIMARY KEY, name text);
    CREATE TABLE user_achievements (id integer PRIMARY KEY, user_id integer, achievement_id integer, review_id integer, earned_at timestamp);
    INSERT INTO users VALUES (10, 100, 'Neighbour', 8);
    INSERT INTO user_reviews VALUES
      (1, 20, 10, 30, 5, 'canonical', NULL, '2026-01-01'),
      (2, 20, 10, 30, 5, 'duplicate', NULL, '2026-01-02');
    INSERT INTO reputation_activities VALUES
      (1, 10, 'RECEIVE_REVIEW', 30, 1, '2026-01-01'),
      (2, 10, 'RECEIVE_REVIEW', 30, 2, '2026-01-02');
    INSERT INTO notifications VALUES
      (1, 10, 'new_review_received', 30, 1, '2026-01-01'),
      (2, 10, 'new_review_received', 30, 2, '2026-01-02');
  `);

  const plan = {
    reason: "Remove the duplicate review and its confirmed effects.",
    repairs: [{
      reviewerId: 20,
      transactionId: 30,
      canonicalReviewId: 1,
      reputationActivityIds: [2],
      notificationIds: [2],
    }],
    userReconciliations: [{
      userId: 10,
      expectedReputationScore: 100,
      targetReputationScore: 95,
    }],
  };

  let reachedNotificationDelete!: () => void;
  const atNotificationDelete = new Promise<void>((resolve) => {
    reachedNotificationDelete = resolve;
  });
  let resumeApply!: () => void;
  const mayContinue = new Promise<void>((resolve) => {
    resumeApply = resolve;
  });
  const pausedClient = {
    connect: async () => {
      const connection = await testPool.connect();
      return {
        query: async (sql: string, values?: any[]) => {
          if (sql.startsWith("DELETE FROM notifications")) {
            const deletedActivity = await connection.query(
              "SELECT id FROM reputation_activities WHERE id = 2",
            );
            assert.equal(deletedActivity.rowCount, 0, "apply has already deleted an effect in its transaction");
            reachedNotificationDelete();
            await mayContinue;
          }
          return connection.query(sql, values);
        },
        release: () => connection.release(),
      };
    },
    query: (sql: string, values?: any[]) => testPool.query(sql, values),
  };
  const remover = await testPool.connect();
  const apply = applyDuplicateReviewRepair(plan, "integration-test", pausedClient);
  let removerTransactionOpen = false;
  try {
    // Fail promptly if apply rejects before reaching the pause, rather than waiting forever.
    await Promise.race([
      atNotificationDelete,
      apply.then(
        () => { throw new Error("apply finished before the notification delete"); },
        (error) => { throw error; },
      ),
    ]);
    await remover.query("BEGIN");
    removerTransactionOpen = true;
    await remover.query("SET LOCAL lock_timeout = '5s'");
    const removed = await remover.query("DELETE FROM notifications WHERE id = 2 RETURNING id");
    assert.deepEqual(removed.rows, [{ id: 2 }]);
    await remover.query("COMMIT");
    removerTransactionOpen = false;
    resumeApply();
    await assert.rejects(apply, /A selected notification was stale or already removed/);
  } finally {
    resumeApply();
    if (removerTransactionOpen) await remover.query("ROLLBACK");
    remover.release();
    await apply.catch(() => undefined);
  }

  assert.deepEqual(
    (await testPool.query("SELECT id FROM user_reviews ORDER BY id")).rows,
    [{ id: 1 }, { id: 2 }],
    "neither review was removed",
  );
  assert.deepEqual(
    (await testPool.query("SELECT id FROM reputation_activities ORDER BY id")).rows,
    [{ id: 1 }, { id: 2 }],
    "apply's earlier effect deletion was rolled back",
  );
  assert.deepEqual(
    (await testPool.query("SELECT id FROM notifications ORDER BY id")).rows,
    [{ id: 1 }],
    "only the other connection's committed deletion remains",
  );
  assert.deepEqual(
    (await testPool.query("SELECT reputation_score, reputation_level, share_coins FROM users WHERE id = 10")).rows,
    [{ reputation_score: 100, reputation_level: "Neighbour", share_coins: "8" }],
  );
  assert.equal(
    (await testPool.query("SELECT to_regclass('duplicate_review_repair_audits') AS name")).rows[0].name,
    null,
    "the repair did not commit an audit",
  );
  assert.equal(
    (await testPool.query("SELECT to_regclass('user_reviews_reviewer_transaction_uidx') AS name")).rows[0].name,
    null,
    "the repair did not install the uniqueness index",
  );
});

test.after(async () => {
  await adminPool.end();
});