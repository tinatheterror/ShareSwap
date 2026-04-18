import { db } from "@db";
import { users, reputationActivities } from "@db/schema";
import { eq, and, gte } from "drizzle-orm";

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
    // Major penalties (significant trust impact)
    ITEM_NOT_RETURNED: -60,
    DAMAGE_CONFIRMED: -45,
    DEPOSIT_CLAIMED: -50,
    FRAUD_ABUSE: -100,
    REPEATED_NO_SHOWS: -35,
    // Medium penalties (moderate trust impact)
    LATE_RETURN_NO_COMMUNICATION: -25,
    CANCEL_AFTER_ACCEPTANCE: -20,
    IGNORING_MESSAGES: -18,
    // Minor penalties removed - we don't penalize for minor issues
  },
};

// Minimum trust score floor (can go negative to signal risk)
export const TRUST_SCORE_FLOOR = 0;

// Grace pass configuration - first-time offenders get a warning instead of penalty
export const GRACE_PASS_CONFIG = {
  ENABLED_PENALTY_TYPES: [
    "late_return_no_communication",
    "cancel_after_acceptance",
  ] as const,
  // Period to check for prior offenses (30 days)
  LOOKBACK_DAYS: 30,
};

export type TrustActivityType =
  // Positive activities
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
  | "verification_approved"
  // Major penalty activities
  | "item_not_returned"
  | "damage_confirmed"
  | "deposit_claimed"
  | "fraud_abuse"
  | "repeated_no_shows"
  // Medium penalty activities
  | "late_return_no_communication"
  | "cancel_after_acceptance"
  | "ignoring_messages"
  // Grace pass (no points deducted, just warning)
  | "grace_pass_warning";

export type PenaltyType =
  | "item_not_returned"
  | "damage_confirmed"
  | "deposit_claimed"
  | "fraud_abuse"
  | "repeated_no_shows"
  | "late_return_no_communication"
  | "cancel_after_acceptance"
  | "ignoring_messages";

interface TrustActivityMetadata {
  requestId?: number;
  itemId?: number;
  counterpartyId?: number;
  conditionRating?: number;
  daysLate?: number;
  feedbackTags?: string[];
  responseTimeMs?: number;
  originalPenaltyType?: string;
  wasGracePass?: boolean;
  [key: string]: any;
}

export async function awardTrustPoints(
  userId: number,
  activityType: TrustActivityType,
  points: number,
  metadata: TrustActivityMetadata = {},
): Promise<{ newScore: number; pointsAwarded: number }> {
  const [user] = await db
    .select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  const currentScore = user.reputationScore || 0;
  const newScore = Math.max(TRUST_SCORE_FLOOR, currentScore + points);

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

function buildActivityDescription(
  activityType: TrustActivityType,
  metadata: TrustActivityMetadata,
): string {
  // Use neutral wording for all activities
  switch (activityType) {
    // Positive activities
    case "borrow_return_perfect":
      return "Your trust score was adjusted based on this transaction.";
    case "borrow_return_good":
      return "Your trust score was adjusted based on this transaction.";
    case "borrow_return_late":
      return "Your trust score was adjusted based on this transaction.";
    case "borrow_return_damaged":
      return "Your trust score was adjusted based on this transaction.";
    case "lending_smooth":
      return "Your trust score was adjusted based on this transaction.";
    case "swap_completed":
      return "Your trust score was adjusted based on this transaction.";
    case "timely_communication":
      return "Your trust score was adjusted based on this transaction.";
    case "positive_feedback":
      return "Your trust score was adjusted based on this transaction.";
    case "rental_dispute_free":
      return "Your trust score was adjusted based on this transaction.";
    case "gifting_completed":
      return "Your trust score was adjusted based on this transaction.";
    case "verification_approved":
      return "Your trust score was adjusted based on this transaction.";
    // Penalty activities - same neutral wording
    case "item_not_returned":
      return "Your trust score was adjusted based on this transaction.";
    case "damage_confirmed":
      return "Your trust score was adjusted based on this transaction.";
    case "deposit_claimed":
      return "Your trust score was adjusted based on this transaction.";
    case "fraud_abuse":
      return "Your trust score was adjusted based on this transaction.";
    case "repeated_no_shows":
      return "Your trust score was adjusted based on this transaction.";
    case "late_return_no_communication":
      return "Your trust score was adjusted based on this transaction.";
    case "cancel_after_acceptance":
      return "Your trust score was adjusted based on this transaction.";
    case "ignoring_messages":
      return "Your trust score was adjusted based on this transaction.";
    // Grace pass
    case "grace_pass_warning":
      return "Your trust score was adjusted based on this transaction.";
    default:
      return "Your trust score was adjusted based on this transaction.";
  }
}

export async function awardBorrowReturnPoints(
  borrowerId: number,
  lenderId: number,
  requestId: number,
  itemId: number,
  conditionRating: number,
  wasOnTime: boolean,
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
    borrowerPoints = TRUST_POINTS.PENALTIES.DAMAGE_CONFIRMED;
    borrowerActivityType = "borrow_return_damaged";
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
  item2Id: number,
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
  hadDispute: boolean,
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
  itemId: number,
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
  slaThresholdMs: number = 4 * 60 * 60 * 1000,
): Promise<void> {
  if (responseTimeMs <= slaThresholdMs) {
    await awardTrustPoints(
      userId,
      "timely_communication",
      TRUST_POINTS.MEDIUM.TIMELY_COMMUNICATION,
      {
        requestId,
        responseTimeMs,
        slaThresholdMs,
      },
    );
  }
}

export async function awardFeedbackPoints(
  userId: number,
  requestId: number,
  feedbackTags: ("reliable" | "on_time" | "as_described")[],
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

// ============================================
// PENALTY SYSTEM
// ============================================

const PENALTY_POINTS: Record<PenaltyType, number> = {
  item_not_returned: TRUST_POINTS.PENALTIES.ITEM_NOT_RETURNED,
  damage_confirmed: TRUST_POINTS.PENALTIES.DAMAGE_CONFIRMED,
  deposit_claimed: TRUST_POINTS.PENALTIES.DEPOSIT_CLAIMED,
  fraud_abuse: TRUST_POINTS.PENALTIES.FRAUD_ABUSE,
  repeated_no_shows: TRUST_POINTS.PENALTIES.REPEATED_NO_SHOWS,
  late_return_no_communication:
    TRUST_POINTS.PENALTIES.LATE_RETURN_NO_COMMUNICATION,
  cancel_after_acceptance: TRUST_POINTS.PENALTIES.CANCEL_AFTER_ACCEPTANCE,
  ignoring_messages: TRUST_POINTS.PENALTIES.IGNORING_MESSAGES,
};

async function checkGracePassEligibility(
  userId: number,
  penaltyType: PenaltyType,
): Promise<boolean> {
  // Only certain penalty types are eligible for grace pass
  const graceEligible =
    GRACE_PASS_CONFIG.ENABLED_PENALTY_TYPES as readonly string[];
  if (!graceEligible.includes(penaltyType)) {
    return false;
  }

  // Check if user has any prior penalties of this type in the lookback period
  const lookbackDate = new Date();
  lookbackDate.setDate(
    lookbackDate.getDate() - GRACE_PASS_CONFIG.LOOKBACK_DAYS,
  );

  const priorPenalties = await db
    .select()
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, userId),
        eq(reputationActivities.activityType, penaltyType),
        gte(reputationActivities.createdAt, lookbackDate),
      ),
    );

  // Also check for prior grace pass warnings for this type
  const priorWarnings = await db
    .select()
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, userId),
        eq(reputationActivities.activityType, "grace_pass_warning"),
        gte(reputationActivities.createdAt, lookbackDate),
      ),
    );

  // Filter warnings that match this penalty type (stored in description)
  const relevantWarnings = priorWarnings.filter((w) =>
    w.description?.includes(penaltyType),
  );

  // Eligible for grace pass if no prior penalties and no prior warnings for this type
  return priorPenalties.length === 0 && relevantWarnings.length === 0;
}

export async function applyTrustPenalty(
  userId: number,
  penaltyType: PenaltyType,
  metadata: TrustActivityMetadata = {},
): Promise<{
  applied: boolean;
  wasGracePass: boolean;
  pointsDeducted: number;
  newScore: number;
}> {
  const points = PENALTY_POINTS[penaltyType];

  // Check if eligible for grace pass
  const isGraceEligible = await checkGracePassEligibility(userId, penaltyType);

  if (isGraceEligible) {
    // Issue a grace pass warning (no points deducted)
    await awardTrustPoints(userId, "grace_pass_warning", 0, {
      ...metadata,
      originalPenaltyType: penaltyType,
      wasGracePass: true,
    });

    const [user] = await db
      .select({ reputationScore: users.reputationScore })
      .from(users)
      .where(eq(users.id, userId));

    console.log(
      `⚠️ Grace pass issued for user ${userId}: ${penaltyType} (first offense)`,
    );

    return {
      applied: false,
      wasGracePass: true,
      pointsDeducted: 0,
      newScore: user?.reputationScore || 0,
    };
  }

  // Apply the penalty
  const result = await awardTrustPoints(userId, penaltyType, points, metadata);

  console.log(
    `🚨 Trust penalty applied to user ${userId}: ${penaltyType} (${points} points)`,
  );

  return {
    applied: true,
    wasGracePass: false,
    pointsDeducted: Math.abs(points),
    newScore: result.newScore,
  };
}

// Convenience functions for specific penalty types
export async function applyLateReturnPenalty(
  userId: number,
  requestId: number,
  itemId: number,
  daysLate: number,
  hadCommunication: boolean,
): Promise<{ applied: boolean; wasGracePass: boolean }> {
  // Don't penalize if they communicated in advance
  if (hadCommunication) {
    console.log(
      `ℹ️ Late return for user ${userId} not penalized - prior communication noted`,
    );
    return { applied: false, wasGracePass: false };
  }

  const result = await applyTrustPenalty(
    userId,
    "late_return_no_communication",
    {
      requestId,
      itemId,
      daysLate,
    },
  );

  return { applied: result.applied, wasGracePass: result.wasGracePass };
}

export async function applyCancellationPenalty(
  userId: number,
  requestId: number,
  itemId: number,
): Promise<{ applied: boolean; wasGracePass: boolean }> {
  const result = await applyTrustPenalty(userId, "cancel_after_acceptance", {
    requestId,
    itemId,
  });

  return { applied: result.applied, wasGracePass: result.wasGracePass };
}

// Note: No-show/missed pickup is no longer penalized - removed minor penalties

export async function applyDepositClaimedPenalty(
  userId: number,
  requestId: number,
  itemId: number,
): Promise<{ applied: boolean }> {
  // Deposit claimed is a major penalty - no grace pass
  const result = await applyTrustPenalty(userId, "deposit_claimed", {
    requestId,
    itemId,
  });

  return { applied: result.applied };
}

export async function applyItemNotReturnedPenalty(
  userId: number,
  requestId: number,
  itemId: number,
): Promise<{ applied: boolean }> {
  // Item not returned is a major penalty - no grace pass
  const result = await applyTrustPenalty(userId, "item_not_returned", {
    requestId,
    itemId,
  });

  return { applied: result.applied };
}

export async function applyDamageConfirmedPenalty(
  userId: number,
  requestId: number,
  itemId: number,
): Promise<{ applied: boolean }> {
  // Damage confirmed is a major penalty - no grace pass
  const result = await applyTrustPenalty(userId, "damage_confirmed", {
    requestId,
    itemId,
  });

  return { applied: result.applied };
}
