import { db } from "@workspace/db";
import { users, reputationActivities, itemRequests } from "@workspace/db";
import { eq, and, gte, like, sql, type SQL } from "drizzle-orm";

export const TRUST_POINTS = {
  MAJOR: {
    BORROW_RETURN_PERFECT: 40,
    BORROW_RETURN_GOOD: 25,
    BORROW_RETURN_LATE_MINOR: 5,   // 1-2 days late
    LENDING_SMOOTH: 20,
    SWAP_COMPLETED: 20,
  },
  MEDIUM: {
    TIMELY_COMMUNICATION: 1,
    POSITIVE_FEEDBACK_RELIABLE: 1,
    POSITIVE_FEEDBACK_ON_TIME: 1,
    POSITIVE_FEEDBACK_AS_DESCRIBED: 1,
  },
  MICRO: {
    RENTAL_DISPUTE_FREE: 20,
    GIFTING_COMPLETED: 10,
  },
  PENALTIES: {
    // Major penalties (significant trust impact)
    ITEM_NOT_RETURNED: -60,
    DAMAGE_CONFIRMED: -45,
    DEPOSIT_CLAIMED: -50,
    FRAUD_ABUSE: -100,
    REPEATED_NO_SHOWS: -35,
    // Late-return tiers (applied at confirm-return; notify-delay softens one tier)
    LATE_RETURN_MODERATE: -20,    // 3-6 days late
    LATE_RETURN_SEVERE: -40,      // 7-13 days late
    LATE_RETURN_CRITICAL: -60,    // 14+ days late
    SERIOUS_OVERDUE: -60,         // 15+ days overdue while still active
    // Other medium penalties
    CANCEL_AFTER_ACCEPTANCE: -20,
    IGNORING_MESSAGES: -18,
    // Low-review penalties (only when negative tags are also selected)
    LOW_REVIEW_ONE_STAR: -10,
    LOW_REVIEW_TWO_STAR: -5,
  },
};

// Minimum trust score floor (can go negative to signal risk)
export const TRUST_SCORE_FLOOR = 0;

export function trustLevelForScore(score: number): string {
  if (score >= 500) return "ShareSwap Champion";
  if (score >= 300) return "Community Pillar";
  if (score >= 150) return "Trusted Member";
  if (score >= 50) return "Neighbour";
  return "Newcomer";
}

export function trustLevelForSqlScore(score: SQL): SQL<string> {
  return sql<string>`CASE
    WHEN ${score} >= 500 THEN 'ShareSwap Champion'
    WHEN ${score} >= 300 THEN 'Community Pillar'
    WHEN ${score} >= 150 THEN 'Trusted Member'
    WHEN ${score} >= 50 THEN 'Neighbour'
    ELSE 'Newcomer' END`;
}

// Grace pass configuration - first-time offenders get a warning instead of penalty
export const GRACE_PASS_CONFIG = {
  ENABLED_PENALTY_TYPES: [
    "cancel_after_acceptance",
    "low_review_one_star",
    "low_review_two_star",
  ] as const,
  // Period to check for prior offenses (30 days)
  LOOKBACK_DAYS: 30,
};

export type TrustActivityType =
  // Positive activities
  | "borrow_return_perfect"
  | "borrow_return_good"
  | "borrow_return_late_minor"     // 1-2 days late (+5)
  | "borrow_return_late_moderate"  // 3-6 days late (−20; effective after soften from 7-13 with notify-delay)
  | "borrow_return_late_severe"    // 7-13 days late (−40; effective after soften from 14+ with notify-delay)
  | "borrow_return_late_critical"  // 14+ days late (−60)
  | "borrow_overdue_serious"        // 15+ days overdue before return (−60)
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
  | "cancel_after_acceptance"
  | "ignoring_messages"
  // Low-review penalties
  | "low_review_one_star"
  | "low_review_two_star"
  // Grace pass (no points deducted, just warning)
  | "grace_pass_warning";

export type PenaltyType =
  | "item_not_returned"
  | "damage_confirmed"
  | "deposit_claimed"
  | "fraud_abuse"
  | "repeated_no_shows"
  | "cancel_after_acceptance"
  | "ignoring_messages"
  | "low_review_one_star"
  | "low_review_two_star";

interface TrustActivityMetadata {
  requestId?: number;
  reviewId?: number;
  itemId?: number;
  itemName?: string | null;
  counterpartyId?: number;
  conditionRating?: number;
  daysLate?: number;
  rating?: number;
  feedbackTags?: string[];
  responseTimeMs?: number;
  originalPenaltyType?: string;
  wasGracePass?: boolean;
  [key: string]: any;
}

/**
 * Soft diminishing returns on positive trust point awards:
 *   score  0–299  → full points (100%)
 *   score 300–449 → 50% of points
 *   score 450+    → 25% of points
 *
 * Penalties (negative points) are never scaled — they always apply in full.
 * Minimum scaled positive award is 1 point so no action ever gives 0 when it
 * should give something.
 */
function scaleTrustPoints(currentScore: number, points: number): number {
  if (points <= 0) return points; // never scale penalties
  if (currentScore >= 450) return Math.max(1, Math.round(points * 0.25));
  if (currentScore >= 300) return Math.max(1, Math.round(points * 0.50));
  return points;
}

export async function awardTrustPoints(
  userId: number,
  activityType: TrustActivityType,
  points: number,
  metadata: TrustActivityMetadata = {},
  executor: any = db,
): Promise<{ newScore: number; pointsAwarded: number }> {
  const description = buildActivityDescription(activityType, metadata);
  const persistAward = async (tx: any): Promise<{ newScore: number; pointsAwarded: number }> => {
    // Lock before reading: scaling, the score floor and the saved level must all
    // use the latest committed score, including when the caller supplies a tx.
    const [user] = await tx
      .select({ reputationScore: users.reputationScore })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user) throw new Error(`User ${userId} not found`);

    const currentScore = user.reputationScore || 0;
    const scaledPoints = scaleTrustPoints(currentScore, points);
    const newScore = Math.max(TRUST_SCORE_FLOOR, currentScore + scaledPoints);

    // The unique request/activity index makes retries no-ops. Insert first so
    // even inside a caller-owned transaction a conflict cannot change the score
    // or abort that transaction.
    const inserted = await tx.insert(reputationActivities).values({
        userId,
        activityType,
        points: scaledPoints,
        description,
        itemId: metadata.itemId,
        requestId: metadata.requestId ?? null,
        reviewId: metadata.reviewId ?? null,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: reputationActivities.id });
    if (inserted.length === 0) {
      return { newScore: currentScore, pointsAwarded: 0 };
    }

    await tx
      .update(users)
      .set({ reputationScore: newScore, reputationLevel: trustLevelForScore(newScore) })
      .where(eq(users.id, userId));
    return { newScore, pointsAwarded: scaledPoints };
  };
  return executor === db ? db.transaction(persistAward) : persistAward(executor);
}

export function formatReputationActivityDescription(
  activityType: string,
  {
    itemName,
    daysLate,
    rating,
    existingDescription,
  }: Pick<TrustActivityMetadata, "itemName" | "daysLate" | "rating"> & {
    existingDescription?: string | null;
  } = {},
): string {
  const item = itemName ? `"${itemName}"` : null;
  const onItem = item ? ` on ${item}` : "";
  const normalizedType = activityType.toLowerCase();
  const parsedRating = rating ?? Number(existingDescription?.match(/(\d)-star review/i)?.[1]);

  switch (normalizedType) {
    case "borrow_overdue_serious":
      return item
        ? `${item} is ${Math.max(0, daysLate ?? 0)} days overdue.`
        : `A borrowed item is ${Math.max(0, daysLate ?? 0)} days overdue.`;
    case "lending_smooth":
      return `Lending completed${onItem}`;
    case "receive_review":
      return Number.isFinite(parsedRating) && parsedRating > 0
        ? `Received a ${parsedRating}-star review${onItem}`
        : `Received a review${onItem}`;
    case "positive_feedback":
      return `Received positive feedback${onItem}`;
    case "borrow_return_perfect":
    case "borrow_return_good":
      return `Borrow return completed${onItem}`;
    case "borrow_return_late_minor":
    case "borrow_return_late_moderate":
    case "borrow_return_late_severe":
    case "borrow_return_late_critical":
      return daysLate && daysLate > 0
        ? `Borrow return completed ${daysLate} day${daysLate === 1 ? "" : "s"} late${onItem}`
        : `Borrow return completed${onItem}`;
    case "borrow_return_damaged":
      return item ? `${item} was returned with damage.` : "A borrowed item was returned with damage.";
    case "swap_completed":
      return `Swap completed${onItem}`;
    case "timely_communication":
      return "Responded promptly to a neighbour.";
    case "rental_dispute_free":
      return `Rental completed without a dispute${onItem}`;
    case "gifting_completed":
      return `Gift completed${onItem}`;
    case "verification_approved":
      return "Identity verification completed.";
    case "item_not_returned":
      return item ? `${item} was not returned.` : "A borrowed item was not returned.";
    case "damage_confirmed":
      return item ? `Damage was confirmed for ${item}.` : "Item damage was confirmed.";
    case "deposit_claimed":
      return item ? `The deposit was claimed for ${item}.` : "A security deposit was claimed.";
    case "fraud_abuse":
      return "A trust and safety violation was confirmed.";
    case "repeated_no_shows":
      return "Repeated missed handoffs were recorded.";
    case "cancel_after_acceptance":
      return `An accepted request was cancelled${onItem}`;
    case "ignoring_messages":
      return "Repeated messages from a neighbour went unanswered.";
    case "low_review_one_star":
    case "low_review_two_star":
      return `Received low-rating feedback${onItem}`;
    case "grace_pass_warning":
      return "A first-time trust penalty was waived.";
    default:
      return existingDescription === "Your trust score was adjusted based on this transaction."
        ? "Trust score updated."
        : existingDescription || "Trust score updated.";
  }
}

function buildActivityDescription(
  activityType: TrustActivityType,
  metadata: TrustActivityMetadata,
): string {
  // Eligibility reads this marker from the stored warning. The read-facing
  // formatter deliberately keeps the user-visible copy independent of it.
  if (activityType === "grace_pass_warning" && metadata.originalPenaltyType) {
    return `${formatReputationActivityDescription(activityType, metadata)} (${metadata.originalPenaltyType})`;
  }
  return formatReputationActivityDescription(activityType, metadata);
}

/**
 * Returns the effective late tier (1–4) after optionally softening by one step.
 *  1 = 1-2 days  → +5
 *  2 = 3-6 days  → −20
 *  3 = 7-13 days → −40
 *  4 = 14+ days  → −60
 *
 * notifyDelayUsed shifts the tier down by one (e.g. tier 3 → tier 2).
 * Tier 1 cannot be softened further.
 *
 * Exported for unit testing.
 */
export function lateTier(daysLate: number, notifyDelayUsed: boolean): 1 | 2 | 3 | 4 {
  let tier: 1 | 2 | 3 | 4;
  if (daysLate >= 14)     tier = 4;
  else if (daysLate >= 7) tier = 3;
  else if (daysLate >= 3) tier = 2;
  else                    tier = 1;

  if (notifyDelayUsed && tier > 1) tier = (tier - 1) as 1 | 2 | 3 | 4;
  return tier;
}

/**
 * Returns the late duration against the currently active due date. Accepted
 * extensions replace that due date before this helper is called.
 */
export function daysLateAgainstDueDate(
  returnedAt: Date,
  activeDueDate: Date | null,
): number {
  if (!activeDueDate || returnedAt <= activeDueDate) return 0;
  return Math.ceil(
    (returnedAt.getTime() - activeDueDate.getTime()) / (1000 * 60 * 60 * 24),
  );
}

export async function awardBorrowReturnPoints(
  borrowerId: number,
  lenderId: number,
  requestId: number,
  itemId: number,
  conditionRating: number,
  daysLate: number,
  notifyDelayUsed: boolean,
): Promise<{
  borrowerPoints: number;
  activityType: TrustActivityType;
  penaltyAlreadyApplied: boolean;
}> {
  // ── Idempotency guard ──────────────────────────────────────────────────────
  // Prevent double-application if confirm-return is called more than once
  // (e.g. network retry or bug). We check for any borrow_return_* activity
  // already recorded for this (borrower, request) pair.
  const existingActivities = await db
    .select({ id: reputationActivities.id, activityType: reputationActivities.activityType })
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, borrowerId),
        eq(reputationActivities.requestId, requestId),
        like(reputationActivities.activityType, "borrow_return_%"),
      ),
    )
    .limit(1);

  if (existingActivities.length > 0) {
    console.warn(
      `[awardBorrowReturnPoints] Skipping duplicate award: borrower=${borrowerId} requestId=${requestId} ` +
        `already has activity "${existingActivities[0].activityType}" (id=${existingActivities[0].id})`,
    );
    // Return the previously recorded values without touching the score again.
    // We don't have the original points handy here, so return 0 to signal
    // the caller that nothing was applied this time.
    return {
      borrowerPoints: 0,
      activityType: existingActivities[0].activityType as TrustActivityType,
      penaltyAlreadyApplied: false,
    };
  }
  // ──────────────────────────────────────────────────────────────────────────

  const [seriousOverdueActivity] = await db
    .select({ id: reputationActivities.id })
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, borrowerId),
        eq(reputationActivities.requestId, requestId),
        eq(reputationActivities.activityType, "borrow_overdue_serious"),
      ),
    )
    .limit(1);

  let borrowerPoints: number;
  let borrowerActivityType: TrustActivityType;
  let penaltyAlreadyApplied = false;
  const lenderPoints = TRUST_POINTS.MAJOR.LENDING_SMOOTH;

  if (conditionRating < 3) {
    // Damaged — lateness is irrelevant; damage penalty dominates
    borrowerPoints = TRUST_POINTS.PENALTIES.DAMAGE_CONFIRMED;
    borrowerActivityType = "borrow_return_damaged";
  } else if (daysLate === 0) {
    // On-time return
    if (conditionRating >= 4) {
      borrowerPoints = TRUST_POINTS.MAJOR.BORROW_RETURN_PERFECT; // +40
      borrowerActivityType = "borrow_return_perfect";
    } else {
      borrowerPoints = TRUST_POINTS.MAJOR.BORROW_RETURN_GOOD;    // +25
      borrowerActivityType = "borrow_return_good";
    }
  } else if (seriousOverdueActivity) {
    // The serious-overdue policy already applied the critical penalty while
    // the item was still active. Keep a return activity for idempotency and
    // reporting, but do not charge the borrower a second time.
    borrowerPoints = 0;
    borrowerActivityType = "borrow_return_late_critical";
    penaltyAlreadyApplied = true;
  } else {
    // Late return — tier determined by daysLate, softened by notify-delay
    const tier = lateTier(daysLate, notifyDelayUsed);
    switch (tier) {
      case 1:
        borrowerPoints = TRUST_POINTS.MAJOR.BORROW_RETURN_LATE_MINOR;   // +5
        borrowerActivityType = "borrow_return_late_minor";
        break;
      case 2:
        borrowerPoints = TRUST_POINTS.PENALTIES.LATE_RETURN_MODERATE;   // −20
        borrowerActivityType = "borrow_return_late_moderate";
        break;
      case 3:
        borrowerPoints = TRUST_POINTS.PENALTIES.LATE_RETURN_SEVERE;     // −40
        borrowerActivityType = "borrow_return_late_severe";
        break;
      case 4:
      default:
        borrowerPoints = TRUST_POINTS.PENALTIES.LATE_RETURN_CRITICAL;   // −60
        borrowerActivityType = "borrow_return_late_critical";
        break;
    }
  }

  const metadata = { requestId, itemId, conditionRating, daysLate, notifyDelayUsed };

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

  return { borrowerPoints, activityType: borrowerActivityType, penaltyAlreadyApplied };
}

/**
 * Apply the serious-overdue penalty once when an active borrow reaches the
 * threshold. The reputation activity unique index makes this safe when both
 * parties trigger the reminder check concurrently.
 */
export async function applySeriousOverduePenalty(
  borrowerId: number,
  lenderId: number,
  requestId: number,
  itemId: number,
  daysOverdue: number,
): Promise<{ pointsAwarded: number }> {
  return db.transaction(async (tx) => {
    // Share the lifecycle row lock with return confirmation. Once a return has
    // won the lock and completed the request, this check becomes a no-op; when
    // the overdue policy wins, the return scorer observes this activity and
    // does not apply its own critical late-return penalty.
    await tx.execute(sql`
      SELECT 1 FROM ${itemRequests}
      WHERE ${itemRequests.id} = ${requestId}
      FOR UPDATE
    `);

    const [activeBorrow] = await tx
      .select({ id: itemRequests.id })
      .from(itemRequests)
      .where(
        and(
          eq(itemRequests.id, requestId),
          eq(itemRequests.requestType, "BORROW"),
          eq(itemRequests.requesterId, borrowerId),
          sql`${itemRequests.status} IN ('IN_PROGRESS', 'RETURN_REQUESTED')`,
        ),
      )
      .limit(1);

    if (!activeBorrow) return { pointsAwarded: 0 };

    const [borrower] = await tx
      .select({ reputationScore: users.reputationScore })
      .from(users)
      .where(eq(users.id, borrowerId))
      .for("update")
      .limit(1);
    if (!borrower) throw new Error(`User ${borrowerId} not found`);

    const pointsAwarded = scaleTrustPoints(
      borrower.reputationScore || 0,
      TRUST_POINTS.PENALTIES.SERIOUS_OVERDUE,
    );

    const inserted = await tx
      .insert(reputationActivities)
      .values({
        userId: borrowerId,
        activityType: "borrow_overdue_serious",
        points: pointsAwarded,
        description: buildActivityDescription("borrow_overdue_serious", {
          requestId,
          itemId,
          daysLate: daysOverdue,
          counterpartyId: lenderId,
        }),
        itemId,
        requestId,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: reputationActivities.id });

    if (inserted.length === 0) return { pointsAwarded: 0 };

    const newScore = Math.max(
      TRUST_SCORE_FLOOR,
      (borrower.reputationScore || 0) + pointsAwarded,
    );
    await tx
      .update(users)
      .set({
        reputationScore: newScore,
        reputationLevel: trustLevelForScore(newScore),
      })
      .where(eq(users.id, borrowerId));

    return { pointsAwarded };
  });
}

export async function awardSwapCompletionPoints(
  user1Id: number,
  user2Id: number,
  requestId: number,
  item1Id: number,
  item2Id: number,
): Promise<void> {
  // ── Per-participant idempotency guard ──────────────────────────────────────
  // Each participant is checked independently so that a partial failure on a
  // previous attempt (user1 committed, user2 failed) can be retried and only
  // the missing award is applied — without double-awarding the successful one.
  const [existingUser1, existingUser2] = await Promise.all([
    db
      .select({ id: reputationActivities.id })
      .from(reputationActivities)
      .where(
        and(
          eq(reputationActivities.userId, user1Id),
          eq(reputationActivities.requestId, requestId),
          eq(reputationActivities.activityType, "swap_completed"),
        ),
      )
      .limit(1),
    db
      .select({ id: reputationActivities.id })
      .from(reputationActivities)
      .where(
        and(
          eq(reputationActivities.userId, user2Id),
          eq(reputationActivities.requestId, requestId),
          eq(reputationActivities.activityType, "swap_completed"),
        ),
      )
      .limit(1),
  ]);

  if (existingUser1.length > 0) {
    console.warn(
      `[awardSwapCompletionPoints] Skipping duplicate award: user1=${user1Id} requestId=${requestId} ` +
        `already has swap_completed (id=${existingUser1[0].id})`,
    );
  }
  if (existingUser2.length > 0) {
    console.warn(
      `[awardSwapCompletionPoints] Skipping duplicate award: user2=${user2Id} requestId=${requestId} ` +
        `already has swap_completed (id=${existingUser2[0].id})`,
    );
  }
  if (existingUser1.length > 0 && existingUser2.length > 0) {
    return; // Both participants already awarded — nothing to do.
  }
  // ──────────────────────────────────────────────────────────────────────────

  const points = TRUST_POINTS.MAJOR.SWAP_COMPLETED;
  const metadata = { requestId, swapItems: [item1Id, item2Id] };
  const awards: Promise<{ newScore: number; pointsAwarded: number }>[] = [];

  if (existingUser1.length === 0) {
    awards.push(
      awardTrustPoints(user1Id, "swap_completed", points, {
        ...metadata,
        counterpartyId: user2Id,
      }),
    );
  }
  if (existingUser2.length === 0) {
    awards.push(
      awardTrustPoints(user2Id, "swap_completed", points, {
        ...metadata,
        counterpartyId: user1Id,
      }),
    );
  }

  await Promise.all(awards);
}

export async function awardRentalCompletionPoints(
  renterId: number,
  ownerId: number,
  requestId: number,
  itemId: number,
  hadDispute: boolean,
): Promise<void> {
  if (hadDispute) return;

  // ── Per-participant idempotency guard ──────────────────────────────────────
  // Each participant is checked independently so that a partial failure on a
  // previous attempt (renter committed, owner failed) can be retried and only
  // the missing award is applied — without double-awarding the successful one.
  const [existingRenter, existingOwner] = await Promise.all([
    db
      .select({ id: reputationActivities.id })
      .from(reputationActivities)
      .where(
        and(
          eq(reputationActivities.userId, renterId),
          eq(reputationActivities.requestId, requestId),
          eq(reputationActivities.activityType, "rental_dispute_free"),
        ),
      )
      .limit(1),
    db
      .select({ id: reputationActivities.id })
      .from(reputationActivities)
      .where(
        and(
          eq(reputationActivities.userId, ownerId),
          eq(reputationActivities.requestId, requestId),
          eq(reputationActivities.activityType, "rental_dispute_free"),
        ),
      )
      .limit(1),
  ]);

  if (existingRenter.length > 0) {
    console.warn(
      `[awardRentalCompletionPoints] Skipping duplicate award: renterId=${renterId} requestId=${requestId} ` +
        `already has rental_dispute_free (id=${existingRenter[0].id})`,
    );
  }
  if (existingOwner.length > 0) {
    console.warn(
      `[awardRentalCompletionPoints] Skipping duplicate award: ownerId=${ownerId} requestId=${requestId} ` +
        `already has rental_dispute_free (id=${existingOwner[0].id})`,
    );
  }
  if (existingRenter.length > 0 && existingOwner.length > 0) {
    return; // Both participants already awarded — nothing to do.
  }
  // ──────────────────────────────────────────────────────────────────────────

  const points = TRUST_POINTS.MICRO.RENTAL_DISPUTE_FREE;
  const metadata = { requestId, itemId };
  const awards: Promise<{ newScore: number; pointsAwarded: number }>[] = [];

  if (existingRenter.length === 0) {
    awards.push(
      awardTrustPoints(renterId, "rental_dispute_free", points, {
        ...metadata,
        counterpartyId: ownerId,
      }),
    );
  }
  if (existingOwner.length === 0) {
    awards.push(
      awardTrustPoints(ownerId, "rental_dispute_free", points, {
        ...metadata,
        counterpartyId: renterId,
      }),
    );
  }

  await Promise.all(awards);
}

export async function awardGiftingPoints(
  giverId: number,
  receiverId: number,
  requestId: number,
  itemId: number,
): Promise<void> {
  // ── Idempotency guard ──────────────────────────────────────────────────────
  const existingActivities = await db
    .select({ id: reputationActivities.id })
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, giverId),
        eq(reputationActivities.requestId, requestId),
        eq(reputationActivities.activityType, "gifting_completed"),
      ),
    )
    .limit(1);

  if (existingActivities.length > 0) {
    console.warn(
      `[awardGiftingPoints] Skipping duplicate award: giverId=${giverId} requestId=${requestId} ` +
        `already has gifting_completed (id=${existingActivities[0].id})`,
    );
    return;
  }
  // ──────────────────────────────────────────────────────────────────────────

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
  // ── Idempotency guard ──────────────────────────────────────────────────────
  const existingActivities = await db
    .select({ id: reputationActivities.id })
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, userId),
        eq(reputationActivities.requestId, requestId),
        eq(reputationActivities.activityType, "timely_communication"),
      ),
    )
    .limit(1);

  if (existingActivities.length > 0) {
    console.warn(
      `[awardCommunicationPoints] Skipping duplicate award: userId=${userId} requestId=${requestId} ` +
        `already has timely_communication (id=${existingActivities[0].id})`,
    );
    return;
  }
  // ──────────────────────────────────────────────────────────────────────────

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
  // ── Idempotency guard ──────────────────────────────────────────────────────
  const existingActivities = await db
    .select({ id: reputationActivities.id })
    .from(reputationActivities)
    .where(
      and(
        eq(reputationActivities.userId, userId),
        eq(reputationActivities.requestId, requestId),
        eq(reputationActivities.activityType, "positive_feedback"),
      ),
    )
    .limit(1);

  if (existingActivities.length > 0) {
    console.warn(
      `[awardFeedbackPoints] Skipping duplicate award: userId=${userId} requestId=${requestId} ` +
        `already has positive_feedback (id=${existingActivities[0].id})`,
    );
    return;
  }
  // ──────────────────────────────────────────────────────────────────────────

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
  cancel_after_acceptance: TRUST_POINTS.PENALTIES.CANCEL_AFTER_ACCEPTANCE,
  ignoring_messages: TRUST_POINTS.PENALTIES.IGNORING_MESSAGES,
  low_review_one_star: TRUST_POINTS.PENALTIES.LOW_REVIEW_ONE_STAR,
  low_review_two_star: TRUST_POINTS.PENALTIES.LOW_REVIEW_TWO_STAR,
};

async function checkGracePassEligibility(
  userId: number,
  penaltyType: PenaltyType,
  executor: any,
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

  const priorPenalties = await executor
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
  const priorWarnings = await executor
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
  const relevantWarnings = priorWarnings.filter((w: any) =>
    w.description?.includes(penaltyType),
  );

  // Eligible for grace pass if no prior penalties and no prior warnings for this type
  return priorPenalties.length === 0 && relevantWarnings.length === 0;
}

export async function applyTrustPenalty(
  userId: number,
  penaltyType: PenaltyType,
  metadata: TrustActivityMetadata = {},
  executor: any = db,
): Promise<{
  applied: boolean;
  wasGracePass: boolean;
  pointsDeducted: number;
  newScore: number;
}> {
  const points = PENALTY_POINTS[penaltyType];
  const persistPenalty = async (tx: any) => {
    // Serialize eligibility with the warning/penalty write, not just the score
    // update. Reuse caller-owned transactions so a failed review rolls back
    // its warning too. All trust awards share this same user-row lock.
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user) throw new Error(`User ${userId} not found`);

    const isGraceEligible = await checkGracePassEligibility(userId, penaltyType, tx);
    if (isGraceEligible) {
      const result = await awardTrustPoints(userId, "grace_pass_warning", 0, {
        ...metadata,
        originalPenaltyType: penaltyType,
        wasGracePass: true,
      }, tx);

      console.log(
        `⚠️ Grace pass issued for user ${userId}: ${penaltyType} (first offense)`,
      );
      return {
        applied: false,
        wasGracePass: true,
        pointsDeducted: 0,
        newScore: result.newScore,
      };
    }

    const result = await awardTrustPoints(userId, penaltyType, points, metadata, tx);
    console.log(
      `🚨 Trust penalty applied to user ${userId}: ${penaltyType} (${points} points)`,
    );
    return {
      applied: true,
      wasGracePass: false,
      pointsDeducted: Math.abs(points),
      newScore: result.newScore,
    };
  };
  return executor === db ? db.transaction(persistPenalty) : persistPenalty(executor);
}

// Convenience functions for specific penalty types
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

// Low-review penalty — only triggered when reviewer also selected negative tags.
// Grace pass applies: first offence within 30 days gets a warning, not a deduction.
export async function applyLowReviewPenalty(
  userId: number,
  reviewId: number,
  rating: 1 | 2,
  negativeTags: string[],
  executor: any = db,
): Promise<{ applied: boolean; wasGracePass: boolean }> {
  const penaltyType = rating === 1 ? "low_review_one_star" : "low_review_two_star";
  const result = await applyTrustPenalty(userId, penaltyType, {
    reviewId,
    feedbackTags: negativeTags,
  }, executor);
  return { applied: result.applied, wasGracePass: result.wasGracePass ?? false };
}
