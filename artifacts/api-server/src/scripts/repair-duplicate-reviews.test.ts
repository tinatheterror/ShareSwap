import assert from "node:assert/strict";
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

test.after(async () => {
  await adminPool.end();
});