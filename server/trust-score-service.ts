import { db } from "@db";
import { users, reputationActivities } from "@db/schema";
import { eq } from "drizzle-orm";

export const TRUST_POINTS = {
  MAJOR: {
    BORROW_RETURN_PERFECT: 40,
    BORROW_RETURN_GOOD: 25,
    BORROW_RETURN_LATE: 10,
    LENDING_SMOOTH: 30,
    SWAP_COMPLETED: 30,
  },
  MEDIUM: {
    TIMELY_COMMUNICATION: 15,
    POSITIVE_FEEDBACK_RELIABLE: 12,
    POSITIVE_FEEDBACK_ON_TIME: 12,
    POSITIVE_FEEDBACK_AS_DESCRIBED: 12,
  },
  MICRO: {
    RENTAL_DISPUTE_FREE: 8,
    GIFTING_COMPLETED: 6,
  },
  PENALTIES: {
    LATE_RETURN: -15,
    DAMAGED_ITEM: -25,
    DISPUTE_OPENED: -20,
    NO_SHOW: -30,
  },
};

export type TrustActivityType =
  | "borrow_return_perfect"
  | "borrow_return_good"
  | "borrow_return_late"
  | "borrow_return_damaged"
  | "lending_smooth"
  | "swap_completed"
  | "timely_communication"
  | "positive_feedback"
  | "rental_dispute_free"
  | "gifting_completed"
  | "late_return_penalty"
  | "damaged_item_penalty"
  | "dispute_penalty"
  | "no_show_penalty"
  | "verification_approved";

interface TrustActivityMetadata {
  requestId?: number;
  itemId?: number;
  counterpartyId?: number;
  conditionRating?: number;
  daysLate?: number;
  feedbackTags?: string[];
  responseTimeMs?: number;
  [key: string]: any;
}

export async function awardTrustPoints(
  userId: number,
  activityType: TrustActivityType,
  points: number,
  metadata: TrustActivityMetadata = {}
): Promise<{ newScore: number; pointsAwarded: number }> {
  const [user] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  const currentScore = user.reputationScore || 0;
  const newScore = Math.max(0, currentScore + points);

  const description = buildActivityDescription(activityType, metadata);

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ reputationScore: newScore })
      .where(eq(users.id, userId));

    await tx.insert(reputationActivities).values({
      userId,
      activityType,
      points,
      description,
      itemId: metadata.itemId,
      createdAt: new Date(),
    });
  });

  return { newScore, pointsAwarded: points };
}

function buildActivityDescription(activityType: TrustActivityType, metadata: TrustActivityMetadata): string {
  switch (activityType) {
    case "borrow_return_perfect":
      return "Returned borrowed item on time and in perfect condition";
    case "borrow_return_good":
      return "Returned borrowed item on time in good condition";
    case "borrow_return_late":
      return "Returned borrowed item late but in acceptable condition";
    case "borrow_return_damaged":
      return "Returned borrowed item with damage";
    case "lending_smooth":
      return "Completed lending transaction smoothly";
    case "swap_completed":
      return "Completed swap transaction successfully";
    case "timely_communication":
      return "Responded promptly within communication SLA";
    case "positive_feedback":
      return `Received positive feedback: ${metadata.feedbackTags?.join(", ") || ""}`;
    case "rental_dispute_free":
      return "Completed rental without disputes";
    case "gifting_completed":
      return "Gifted an item to a neighbor";
    case "verification_approved":
      return "Account verification approved";
    default:
      return `Trust activity: ${activityType}`;
  }
}

export async function awardBorrowReturnPoints(
  borrowerId: number,
  lenderId: number,
  requestId: number,
  itemId: number,
  conditionRating: number,
  wasOnTime: boolean
): Promise<void> {
  let borrowerPoints = 0;
  let borrowerActivityType: TrustActivityType;
  let lenderPoints = TRUST_POINTS.MAJOR.LENDING_SMOOTH;

  if (conditionRating >= 4 && wasOnTime) {
    borrowerPoints = TRUST_POINTS.MAJOR.BORROW_RETURN_PERFECT;
    borrowerActivityType = "borrow_return_perfect";
  } else if (conditionRating >= 3 && wasOnTime) {
    borrowerPoints = TRUST_POINTS.MAJOR.BORROW_RETURN_GOOD;
    borrowerActivityType = "borrow_return_good";
  } else if (conditionRating >= 3) {
    borrowerPoints = TRUST_POINTS.MAJOR.BORROW_RETURN_LATE;
    borrowerActivityType = "borrow_return_late";
  } else {
    borrowerPoints = TRUST_POINTS.PENALTIES.DAMAGED_ITEM;
    borrowerActivityType = "borrow_return_damaged";
    lenderPoints = 0;
  }

  const metadata = { requestId, itemId, conditionRating, wasOnTime };

  await awardTrustPoints(borrowerId, borrowerActivityType, borrowerPoints, {
    ...metadata,
    counterpartyId: lenderId,
  });

  if (lenderPoints > 0) {
    await awardTrustPoints(lenderId, "lending_smooth", lenderPoints, {
      ...metadata,
      counterpartyId: borrowerId,
    });
  }
}

export async function awardSwapCompletionPoints(
  user1Id: number,
  user2Id: number,
  requestId: number,
  item1Id: number,
  item2Id: number
): Promise<void> {
  const points = TRUST_POINTS.MAJOR.SWAP_COMPLETED;
  const metadata = { requestId, swapItems: [item1Id, item2Id] };

  await Promise.all([
    awardTrustPoints(user1Id, "swap_completed", points, {
      ...metadata,
      counterpartyId: user2Id,
    }),
    awardTrustPoints(user2Id, "swap_completed", points, {
      ...metadata,
      counterpartyId: user1Id,
    }),
  ]);
}

export async function awardRentalCompletionPoints(
  renterId: number,
  ownerId: number,
  requestId: number,
  itemId: number,
  hadDispute: boolean
): Promise<void> {
  if (hadDispute) return;

  const points = TRUST_POINTS.MICRO.RENTAL_DISPUTE_FREE;
  const metadata = { requestId, itemId };

  await Promise.all([
    awardTrustPoints(renterId, "rental_dispute_free", points, {
      ...metadata,
      counterpartyId: ownerId,
    }),
    awardTrustPoints(ownerId, "rental_dispute_free", points, {
      ...metadata,
      counterpartyId: renterId,
    }),
  ]);
}

export async function awardGiftingPoints(
  giverId: number,
  receiverId: number,
  requestId: number,
  itemId: number
): Promise<void> {
  const points = TRUST_POINTS.MICRO.GIFTING_COMPLETED;

  await awardTrustPoints(giverId, "gifting_completed", points, {
    requestId,
    itemId,
    counterpartyId: receiverId,
  });
}

export async function awardCommunicationPoints(
  userId: number,
  requestId: number,
  responseTimeMs: number,
  slaThresholdMs: number = 4 * 60 * 60 * 1000
): Promise<void> {
  if (responseTimeMs <= slaThresholdMs) {
    await awardTrustPoints(userId, "timely_communication", TRUST_POINTS.MEDIUM.TIMELY_COMMUNICATION, {
      requestId,
      responseTimeMs,
      slaThresholdMs,
    });
  }
}

export async function awardFeedbackPoints(
  userId: number,
  requestId: number,
  feedbackTags: ("reliable" | "on_time" | "as_described")[]
): Promise<void> {
  let totalPoints = 0;

  for (const tag of feedbackTags) {
    switch (tag) {
      case "reliable":
        totalPoints += TRUST_POINTS.MEDIUM.POSITIVE_FEEDBACK_RELIABLE;
        break;
      case "on_time":
        totalPoints += TRUST_POINTS.MEDIUM.POSITIVE_FEEDBACK_ON_TIME;
        break;
      case "as_described":
        totalPoints += TRUST_POINTS.MEDIUM.POSITIVE_FEEDBACK_AS_DESCRIBED;
        break;
    }
  }

  if (totalPoints > 0) {
    await awardTrustPoints(userId, "positive_feedback", totalPoints, {
      requestId,
      feedbackTags,
    });
  }
}
