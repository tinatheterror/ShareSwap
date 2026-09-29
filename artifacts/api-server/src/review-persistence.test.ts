import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import {
  achievements,
  db,
  itemRequests,
  items,
  notifications,
  pool,
  reputationActivities,
  shareCoinsTransactions,
  userAchievements,
  userReviews,
  users,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "./auth.js";
import { checkAndAwardAchievements, registerRoutes } from "./routes/routes.js";
import { applyLowReviewPenalty } from "./trust-score-service.js";
import {
  applyRequiredLowReviewPenalty,
  isDuplicateReviewSubmission,
  persistReviewAtomically,
  runNonCriticalReviewSideEffect,
} from "./review-persistence.js";

test("a required reputation failure rolls back the review insert", async (t) => {
  const unique = `review-atomicity-${Date.now()}`;
  const [reviewer] = await db.insert(users).values({ username: `${unique}-reviewer` }).returning();
  const [reviewed] = await db.insert(users).values({ username: `${unique}-reviewed` }).returning();

  t.after(async () => {
    await db.delete(userReviews).where(eq(userReviews.reviewerId, reviewer.id));
    await db.delete(users).where(eq(users.id, reviewer.id));
    await db.delete(users).where(eq(users.id, reviewed.id));
  });

  await assert.rejects(
    persistReviewAtomically(db, async (tx) => {
      await tx.insert(userReviews).values({
        reviewerId: reviewer.id,
        reviewedUserId: reviewed.id,
        rating: 5,
      });
      throw new Error("simulated reputation update failure");
    }),
    /simulated reputation update failure/,
  );

  const reviews = await db
    .select()
    .from(userReviews)
    .where(eq(userReviews.reviewerId, reviewer.id));
  assert.equal(reviews.length, 0, "the failed attempt must not block a retry");
});

test("a non-critical side-effect failure does not reject the saved operation", async () => {
  await assert.doesNotReject(
    runNonCriticalReviewSideEffect("test notification", async () => {
      throw new Error("simulated notification failure");
    }),
  );
});

test("concurrent submissions save one review and one reputation change", async (t) => {
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_reviews_reviewer_transaction_uidx
      ON user_reviews(reviewer_id, transaction_id)
  `);

  const unique = `review-concurrency-${Date.now()}`;
  const [reviewer] = await db.insert(users)
    .values({ username: `${unique}-reviewer` })
    .returning();
  const [reviewed] = await db.insert(users)
    .values({ username: `${unique}-reviewed` })
    .returning();
  const [item] = await db.insert(items).values({
    ownerId: reviewed.id,
    name: `${unique}-item`,
    description: "concurrent review test item",
    conditionRating: 4,
    photos: [],
    shareCoinsReward: "0",
  }).returning();
  const [request] = await db.insert(itemRequests).values({
    itemId: item.id,
    requesterId: reviewer.id,
    requestType: "BORROW",
    status: "COMPLETED",
  }).returning();

  t.after(async () => {
    await db.delete(reputationActivities).where(eq(reputationActivities.requestId, request.id));
    await db.delete(userReviews).where(eq(userReviews.transactionId, request.id));
    await db.delete(itemRequests).where(eq(itemRequests.id, request.id));
    await db.delete(items).where(eq(items.id, item.id));
    await db.delete(users).where(eq(users.id, reviewer.id));
    await db.delete(users).where(eq(users.id, reviewed.id));
  });

  const submit = () =>
    persistReviewAtomically(db, async (tx) => {
      await tx.insert(userReviews).values({
        reviewerId: reviewer.id,
        reviewedUserId: reviewed.id,
        transactionId: request.id,
        rating: 5,
      });
      await tx.insert(reputationActivities).values({
        userId: reviewed.id,
        activityType: "RECEIVE_REVIEW",
        points: 5,
        itemId: item.id,
        requestId: request.id,
        description: "Concurrent review reputation award",
      });
      await tx.update(users)
        .set({ reputationScore: 5 })
        .where(eq(users.id, reviewed.id));
    });

  const results = await Promise.allSettled([submit(), submit()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  assert.ok(rejected);
  assert.equal(isDuplicateReviewSubmission(rejected.reason), true);

  const [reviews, activities, [reviewedAfter]] = await Promise.all([
    db.select().from(userReviews).where(eq(userReviews.transactionId, request.id)),
    db.select().from(reputationActivities).where(eq(reputationActivities.requestId, request.id)),
    db.select({ reputationScore: users.reputationScore })
      .from(users)
      .where(eq(users.id, reviewed.id)),
  ]);
  assert.equal(reviews.length, 1);
  assert.equal(activities.length, 1);
  assert.equal(reviewedAfter.reputationScore, 5);
});

test("concurrent authenticated review requests return success and already-reviewed", async (t) => {
  const unique = `review-route-concurrency-${Date.now()}`;
  const password = "ReviewRouteConcurrency!42";
  const [reviewer, reviewed] = await db.insert(users).values([
    { username: `${unique}-reviewer`, password: await hashPassword(password), emailVerified: true },
    { username: `${unique}-reviewed`, emailVerified: true, reputationScore: 49 },
  ]).returning();
  assert.notEqual(reviewer.id, reviewed.id);
  const [item] = await db.insert(items).values({
    ownerId: reviewed.id,
    name: `${unique}-item`,
    description: "Concurrent review route test item",
    conditionRating: 4,
    photos: [],
    shareCoinsReward: "0",
  }).returning();
  const [request] = await db.insert(itemRequests).values({
    itemId: item.id,
    requesterId: reviewer.id,
    requestType: "BORROW",
    status: "COMPLETED",
  }).returning();
  // These four reviews were left AND received by the reviewer, not the recipient.
  // The new submission is the reviewer's fifth review left.
  await db.insert(userReviews).values(
    Array.from({ length: 4 }, () => ({
      reviewerId: reviewer.id, reviewedUserId: reviewer.id, rating: 4,
    })),
  );
  // The recipient has nine prior 5-star reviews, so the new 5-star review is
  // their tenth received and keeps their average at 5.0 (above the 4.8 badge threshold).
  await db.insert(userReviews).values(
    Array.from({ length: 9 }, () => ({
      reviewerId: reviewed.id, reviewedUserId: reviewed.id, rating: 5,
    })),
  );
  const recipientHistory = await db.select({ rating: userReviews.rating })
    .from(userReviews).where(eq(userReviews.reviewedUserId, reviewed.id));
  assert.equal(recipientHistory.length, 9);
  assert.ok(recipientHistory.every(({ rating }) => rating === 5));
  await db.insert(shareCoinsTransactions).values({
    userId: reviewed.id, amount: "49", transactionType: "EARNED",
    description: "Prior earned coins for review milestone",
  });

  t.after(async () => {
    await db.delete(reputationActivities).where(eq(reputationActivities.requestId, request.id));
    await db.delete(userReviews).where(eq(userReviews.transactionId, request.id));
    await db.delete(notifications).where(eq(notifications.userId, reviewed.id));
    await db.delete(notifications).where(eq(notifications.userId, reviewer.id));
    await db.delete(shareCoinsTransactions).where(eq(shareCoinsTransactions.userId, reviewed.id));
    await db.delete(shareCoinsTransactions).where(eq(shareCoinsTransactions.userId, reviewer.id));
    await db.delete(userAchievements).where(eq(userAchievements.userId, reviewed.id));
    await db.delete(userAchievements).where(eq(userAchievements.userId, reviewer.id));
    await db.delete(userReviews).where(eq(userReviews.reviewerId, reviewer.id));
    await db.delete(userReviews).where(eq(userReviews.reviewerId, reviewed.id));
    await db.delete(itemRequests).where(eq(itemRequests.id, request.id));
    await db.delete(items).where(eq(items.id, item.id));
    await db.delete(users).where(eq(users.id, reviewer.id));
    await db.delete(users).where(eq(users.id, reviewed.id));
  });

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const server = registerRoutes(app, { startBackgroundJobs: false });
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  let cookies = "";
  const login = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
    body: JSON.stringify({ username: reviewer.username, password }),
  });
  assert.equal(login.status, 200, await login.text());
  cookies = login.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]).join("; ");
  assert.ok(cookies, "login must establish a real authenticated session");

  const csrfResponse = await fetch(`${baseUrl}/api/csrf-token`, {
    headers: { cookie: cookies, "x-forwarded-proto": "https" },
  });
  assert.equal(csrfResponse.status, 200);
  const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
  const csrfCookies = csrfResponse.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]);
  cookies = [cookies, ...csrfCookies].filter(Boolean).join("; ");

  const submit = () => fetch(`${baseUrl}/api/users/${reviewed.id}/reviews`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-proto": "https",
      "x-csrf-token": csrfToken,
      cookie: cookies,
    },
    body: JSON.stringify({ rating: 5, transactionId: request.id }),
  });
  const responses = await Promise.all([submit(), submit()]);
  const results = await Promise.all(responses.map(async (response) => ({
    status: response.status,
    body: await response.text(),
  })));
  assert.deepEqual(results.map(({ status }) => status).sort(), [201, 400], JSON.stringify(results));
  assert.equal(results.find(({ status }) => status === 400)?.body,
    "You have already reviewed this transaction");
  const savedReview = JSON.parse(results.find(({ status }) => status === 201)!.body) as { id: number };

  const [reviews, activities, [reviewedAfter], coins, achievementRows, notificationRows] = await Promise.all([
    db.select().from(userReviews).where(eq(userReviews.transactionId, request.id)),
    db.select().from(reputationActivities).where(eq(reputationActivities.requestId, request.id)),
    db.select({ reputationScore: users.reputationScore })
      .from(users).where(eq(users.id, reviewed.id)),
    db.select().from(shareCoinsTransactions).where(eq(shareCoinsTransactions.reviewId, savedReview.id)),
    db.select().from(userAchievements).where(eq(userAchievements.reviewId, savedReview.id)),
    db.select().from(notifications).where(eq(notifications.userId, reviewed.id)),
  ]);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].reviewerId, reviewer.id);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].activityType, "RECEIVE_REVIEW");
  assert.equal(activities[0].points, 5);
  assert.equal(activities[0].reviewId, savedReview.id);
  assert.equal(reviewedAfter.reputationScore, 54);
  assert.ok(coins.some(row => row.userId === reviewed.id && row.amount === "5"), "level reward must be attributed");
  assert.ok(coins.some(row => row.userId === reviewer.id && row.amount === "1"), "review milestone reward must be attributed");
  assert.ok(achievementRows.some(row => row.userId === reviewer.id), "review milestone must be attributed");
  assert.ok(notificationRows.some(row => row.type === "new_review_received" && row.reviewId === savedReview.id));
  assert.ok(notificationRows.some(row => row.type === "level_up" && row.reviewId === savedReview.id));
  const earnedDefinitions = await db.select({ id: achievements.id, name: achievements.name }).from(achievements);
  const earnedNames = earnedDefinitions.filter(def => achievementRows.some(row => row.achievementId === def.id))
    .map(def => def.name).sort();
  assert.deepEqual(earnedNames, [
    "coin_collector", "five_reviews_left", "five_reviews_received",
    "five_star_neighbour", "well_loved",
  ].sort(), "only review-sensitive badges are attributed to the submitted review");
  assert.equal(coins.filter(row => row.amount === "1").length, achievementRows.length,
    "each attributed badge earns exactly one coin");
  assert.equal(notificationRows.filter(row => row.type === "badge_earned" && row.reviewId === savedReview.id).length, 4,
    "recipient badges produce attributed notifications in the same commit");
});

test("non-review achievement checks still award listing milestones", async (t) => {
  const unique = `non-review-achievements-${Date.now()}`;
  const [owner] = await db.insert(users).values({ username: unique }).returning();
  const listed = await db.insert(items).values(Array.from({ length: 5 }, (_, index) => ({
    ownerId: owner.id,
    name: `${unique}-${index}`,
    description: "Listing achievement test item",
    conditionRating: 4,
    photos: [],
    shareCoinsReward: "0",
  }))).returning();
  t.after(async () => {
    await db.delete(notifications).where(eq(notifications.userId, owner.id));
    await db.delete(shareCoinsTransactions).where(eq(shareCoinsTransactions.userId, owner.id));
    await db.delete(userAchievements).where(eq(userAchievements.userId, owner.id));
    await db.delete(items).where(eq(items.ownerId, owner.id));
    await db.delete(users).where(eq(users.id, owner.id));
  });

  await checkAndAwardAchievements(owner.id);
  const badges = await db.select({ name: achievements.name })
    .from(userAchievements)
    .innerJoin(achievements, eq(achievements.id, userAchievements.achievementId))
    .where(eq(userAchievements.userId, owner.id));
  assert.ok(badges.some(badge => badge.name === "five_listed"));
});

test("only the review submission constraint maps to already-reviewed", () => {
  assert.equal(isDuplicateReviewSubmission({
    code: "23505",
    constraint: "user_reviews_reviewer_transaction_uidx",
  }), true);
  assert.equal(isDuplicateReviewSubmission({
    code: "23505",
    constraint: "some_other_constraint",
  }), false);
});

async function createReviewUsers(t: TestContext, suffix: string) {
  const unique = `review-penalty-${suffix}-${Date.now()}`;
  const [reviewer] = await db.insert(users).values({ username: `${unique}-reviewer` }).returning();
  const [reviewed] = await db.insert(users).values({ username: `${unique}-reviewed` }).returning();
  t.after(async () => {
    await db.delete(reputationActivities).where(eq(reputationActivities.userId, reviewed.id));
    await db.delete(userReviews).where(eq(userReviews.reviewerId, reviewer.id));
    await db.delete(users).where(eq(users.id, reviewer.id));
    await db.delete(users).where(eq(users.id, reviewed.id));
  });
  return { reviewer, reviewed };
}

test("a zero-total low review commits its required penalty activity", async (t) => {
  const { reviewer, reviewed } = await createReviewUsers(t, "zero-total");

  await persistReviewAtomically(db, async (tx) => {
    const [review] = await tx.insert(userReviews).values({
      reviewerId: reviewer.id,
      reviewedUserId: reviewed.id,
      rating: 1,
      feedbackTags: ["reliable", "late_return"],
    }).returning();
    await applyRequiredLowReviewPenalty({
      rating: 1,
      cleanedTags: ["reliable", "late_return"],
      applyPenalty: (rating, tags) =>
        applyLowReviewPenalty(reviewed.id, review.id, rating, tags, tx),
    });
  });

  const [reviews, activities] = await Promise.all([
    db.select().from(userReviews).where(eq(userReviews.reviewerId, reviewer.id)),
    db.select().from(reputationActivities).where(eq(reputationActivities.userId, reviewed.id)),
  ]);
  assert.equal(reviews.length, 1);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].activityType, "grace_pass_warning");
  assert.equal(activities[0].reviewId, reviews[0].id);
});

test("a prior pair review cannot suppress the new low-review penalty activity", async (t) => {
  const { reviewer, reviewed } = await createReviewUsers(t, "pair-cap");
  await db.insert(userReviews).values({
    reviewerId: reviewer.id,
    reviewedUserId: reviewed.id,
    rating: 5,
  });

  await persistReviewAtomically(db, async (tx) => {
    const [review] = await tx.insert(userReviews).values({
      reviewerId: reviewer.id,
      reviewedUserId: reviewed.id,
      rating: 2,
      feedbackTags: ["reliable", "issue_reported"],
    }).returning();
    await applyRequiredLowReviewPenalty({
      rating: 2,
      cleanedTags: ["reliable", "issue_reported"],
      applyPenalty: (rating, tags) =>
        applyLowReviewPenalty(reviewed.id, review.id, rating, tags, tx),
    });
  });

  const [reviewCount, activities] = await Promise.all([
    db.select().from(userReviews).where(eq(userReviews.reviewerId, reviewer.id)),
    db.select().from(reputationActivities).where(
      and(
        eq(reputationActivities.userId, reviewed.id),
        eq(reputationActivities.activityType, "grace_pass_warning"),
      ),
    ),
  ]);
  assert.equal(reviewCount.length, 2);
  assert.equal(activities.length, 1);
  const [lowReview] = reviewCount.filter(review => review.rating === 2);
  assert.equal(activities[0].reviewId, lowReview.id);
});

test.after(async () => {
  await pool.end();
});