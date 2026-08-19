/**
 * Integration tests: gifting, communication, and feedback trust scoring
 * idempotency guards.
 *
 * Each award function must record one activity and adjust the score once when
 * the same request is retried. Uses the real Postgres database.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool, db } from "@workspace/db";
import { users, items, itemRequests, reputationActivities } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  awardGiftingPoints,
  awardCommunicationPoints,
  awardFeedbackPoints,
  TRUST_POINTS,
} from "./trust-score-service.js";

let awardingUserId: number;
let receiverId: number;
let itemId: number;
let giftingRequestId: number;
let communicationRequestId: number;
let feedbackRequestId: number;

const UNIQUE = `test-gifting-communication-feedback-idempotency-${Date.now()}`;

async function scoreFor(userId: number): Promise<number> {
  const [user] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, userId));

  return user.reputationScore ?? 0;
}

async function activitiesFor(requestId: number, activityType: string) {
  return db
    .select()
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, awardingUserId),
        eq(reputationActivities.requestId, requestId),
        eq(reputationActivities.activityType, activityType),
      ),
    );
}

before(async () => {
  const [awardingUser] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-awarding-user`, reputationScore: 100 })
    .returning({ id: users.id });
  const [receiver] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-receiver`, reputationScore: 100 })
    .returning({ id: users.id });

  awardingUserId = awardingUser.id;
  receiverId = receiver.id;

  const [item] = await db
    .insert(items)
    .values({
      ownerId: awardingUserId,
      name: `${UNIQUE}-item`,
      description: "test item",
      conditionRating: 4,
      photos: [],
      securityDeposit: "0",
      lendingDuration: 7,
      shareCoinsReward: "0",
    })
    .returning({ id: items.id });
  itemId = item.id;

  const insertRequest = () =>
    db
      .insert(itemRequests)
      .values({
        itemId,
        requesterId: receiverId,
        requestType: "GIFT",
        status: "COMPLETED",
      })
      .returning({ id: itemRequests.id });

  const [giftingRequest] = await insertRequest();
  const [communicationRequest] = await insertRequest();
  const [feedbackRequest] = await insertRequest();
  giftingRequestId = giftingRequest.id;
  communicationRequestId = communicationRequest.id;
  feedbackRequestId = feedbackRequest.id;
});

after(async () => {
  for (const requestId of [giftingRequestId, communicationRequestId, feedbackRequestId]) {
    await db.delete(reputationActivities).where(eq(reputationActivities.requestId, requestId));
    await db.delete(itemRequests).where(eq(itemRequests.id, requestId));
  }

  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(eq(users.id, awardingUserId));
  await db.delete(users).where(eq(users.id, receiverId));
  await pool.end();
});

test("retrying awardGiftingPoints records one activity and changes the score once", async () => {
  const scoreBefore = await scoreFor(awardingUserId);

  await awardGiftingPoints(awardingUserId, receiverId, giftingRequestId, itemId);
  await awardGiftingPoints(awardingUserId, receiverId, giftingRequestId, itemId);

  const rows = await activitiesFor(giftingRequestId, "gifting_completed");
  assert.equal(rows.length, 1, "a gifting retry must not create a second activity");
  assert.equal(
    (await scoreFor(awardingUserId)) - scoreBefore,
    TRUST_POINTS.MICRO.GIFTING_COMPLETED,
    "a gifting retry must not change the score a second time",
  );
});

test("retrying awardCommunicationPoints records one activity and changes the score once", async () => {
  const scoreBefore = await scoreFor(awardingUserId);

  await awardCommunicationPoints(awardingUserId, communicationRequestId, 1_000);
  await awardCommunicationPoints(awardingUserId, communicationRequestId, 1_000);

  const rows = await activitiesFor(communicationRequestId, "timely_communication");
  assert.equal(rows.length, 1, "a communication retry must not create a second activity");
  assert.equal(
    (await scoreFor(awardingUserId)) - scoreBefore,
    TRUST_POINTS.MEDIUM.TIMELY_COMMUNICATION,
    "a communication retry must not change the score a second time",
  );
});

test("retrying awardFeedbackPoints records one activity and changes the score once", async () => {
  const scoreBefore = await scoreFor(awardingUserId);
  const tags = ["reliable", "on_time", "as_described"] as const;
  const expectedPoints =
    TRUST_POINTS.MEDIUM.POSITIVE_FEEDBACK_RELIABLE +
    TRUST_POINTS.MEDIUM.POSITIVE_FEEDBACK_ON_TIME +
    TRUST_POINTS.MEDIUM.POSITIVE_FEEDBACK_AS_DESCRIBED;

  await awardFeedbackPoints(awardingUserId, feedbackRequestId, [...tags]);
  await awardFeedbackPoints(awardingUserId, feedbackRequestId, [...tags]);

  const rows = await activitiesFor(feedbackRequestId, "positive_feedback");
  assert.equal(rows.length, 1, "a feedback retry must not create a second activity");
  assert.equal(
    (await scoreFor(awardingUserId)) - scoreBefore,
    expectedPoints,
    "a feedback retry must not change the score a second time",
  );
});