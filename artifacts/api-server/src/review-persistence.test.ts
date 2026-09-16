import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db, pool, reputationActivities, userReviews, users } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { applyLowReviewPenalty } from "./trust-score-service.js";
import {
  applyRequiredLowReviewPenalty,
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
});

test.after(async () => {
  await pool.end();
});