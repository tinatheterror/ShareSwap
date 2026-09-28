import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";

type RepairSelection = {
  reviewerId: number;
  transactionId: number;
  canonicalReviewId: number;
  reputationActivityIds?: number[];
  shareCoinTransactionIds?: number[];
  notificationIds?: number[];
  userAchievementIds?: number[];
};

type RepairPlan = {
  reason: string;
  repairs: RepairSelection[];
  userReconciliations: Array<{
    userId: number;
    expectedReputationScore?: number;
    targetReputationScore?: number;
    expectedShareCoins?: string;
    targetShareCoins?: string;
  }>;
};

type Queryable = {
  query(text: string, values?: any[]): Promise<{
    rows: any[];
    rowCount: number | null;
  }>;
};

type Connectable = Queryable & {
  connect(): Promise<Queryable & { release(): void }>;
};

const RELATED_ACTIVITY_TYPES = [
  "RECEIVE_REVIEW",
  "positive_feedback",
  "low_review_one_star",
  "low_review_two_star",
  "grace_pass_warning",
];

const RELATED_NOTIFICATION_TYPES = [
  "new_review_received",
  "level_up",
  "sharecoin_earned",
];

function ids(values: number[] | undefined): number[] {
  return [...new Set(values ?? [])].sort((a, b) => a - b);
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number(value);
}

async function ensureAuditTable(client: Queryable = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS duplicate_review_repair_audits (
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
    )
  `);
}

async function buildDuplicateReviewReportWithClient(client: Queryable) {
  const auditTableCheck = await client.query(
    "SELECT to_regclass('duplicate_review_repair_audits') AS name",
  );
  const auditTableExists = Boolean(auditTableCheck.rows[0]?.name);
  const { rows: groups } = await client.query(`
    SELECT
      reviewer_id AS "reviewerId",
      transaction_id AS "transactionId",
      min(created_at) AS "firstCreatedAt",
      max(created_at) AS "lastCreatedAt",
      count(*)::int AS "reviewCount"
    FROM user_reviews
    WHERE transaction_id IS NOT NULL
    GROUP BY reviewer_id, transaction_id
    HAVING count(*) > 1
    ORDER BY reviewer_id, transaction_id
  `);

  const duplicates = [];
  for (const group of groups) {
    const windowArgs = [group.reviewerId, group.transactionId];
    let queryQueue: Promise<unknown> = Promise.resolve();
    const query = (text: string, values?: any[]) => {
      const result = queryQueue.then(() => client.query(text, values));
      queryQueue = result.then(() => undefined, () => undefined);
      return result;
    };
    const [
      reviews,
      affectedUsers,
      reputationActivities,
      shareCoinTransactions,
      notifications,
      userAchievements,
      priorAudit,
    ] = await Promise.all([
      query(`
        SELECT id, reviewer_id AS "reviewerId", reviewed_user_id AS "reviewedUserId",
               transaction_id AS "transactionId", rating, comment,
               feedback_tags AS "feedbackTags", created_at AS "createdAt"
        FROM user_reviews
        WHERE reviewer_id = $1 AND transaction_id = $2
        ORDER BY created_at, id
      `, windowArgs),
      query(`
        SELECT DISTINCT u.id, u.reputation_score AS "reputationScore",
               u.reputation_level AS "reputationLevel", u.share_coins AS "shareCoins"
        FROM users u
        JOIN user_reviews ur ON ur.reviewed_user_id = u.id
        WHERE ur.reviewer_id = $1 AND ur.transaction_id = $2
        ORDER BY u.id
      `, windowArgs),
      query(`
        WITH duplicate_reviews AS (
          SELECT reviewed_user_id, min(created_at) AS first_at, max(created_at) AS last_at
          FROM user_reviews WHERE reviewer_id = $1 AND transaction_id = $2
          GROUP BY reviewed_user_id
        )
        SELECT DISTINCT ra.*
        FROM reputation_activities ra
        WHERE ra.review_id IN (SELECT id FROM user_reviews WHERE reviewer_id = $1 AND transaction_id = $2)
           OR (ra.review_id IS NULL AND ra.activity_type = ANY($3::text[])
             AND EXISTS (SELECT 1 FROM duplicate_reviews dr WHERE dr.reviewed_user_id = ra.user_id
               AND (ra.request_id = $2 OR (ra.request_id IS NULL
                 AND ra.created_at BETWEEN dr.first_at - interval '10 minutes'
                                       AND dr.last_at + interval '10 minutes'))))
        ORDER BY ra.created_at, ra.id
      `, [...windowArgs, RELATED_ACTIVITY_TYPES]),
      query(`
        WITH duplicate_reviews AS (
          SELECT reviewed_user_id, min(created_at) AS first_at, max(created_at) AS last_at
          FROM user_reviews WHERE reviewer_id = $1 AND transaction_id = $2
          GROUP BY reviewed_user_id
        )
        SELECT DISTINCT sct.*
        FROM share_coins_transactions sct
        WHERE sct.review_id IN (SELECT id FROM user_reviews WHERE reviewer_id = $1 AND transaction_id = $2)
           OR (sct.review_id IS NULL
           AND sct.description LIKE 'Level Up Bonus — %'
          AND sct.transaction_type = 'EARNED'
          AND sct.amount > 0
           AND EXISTS (SELECT 1 FROM duplicate_reviews dr WHERE dr.reviewed_user_id = sct.user_id
             AND sct.created_at BETWEEN dr.first_at - interval '10 minutes'
                                    AND dr.last_at + interval '10 minutes'))
        ORDER BY sct.created_at, sct.id
      `, windowArgs),
      query(`
        WITH duplicate_reviews AS (
          SELECT reviewed_user_id, min(created_at) AS first_at, max(created_at) AS last_at
          FROM user_reviews WHERE reviewer_id = $1 AND transaction_id = $2
          GROUP BY reviewed_user_id
        )
        SELECT DISTINCT n.*
        FROM notifications n
        WHERE n.review_id IN (SELECT id FROM user_reviews WHERE reviewer_id = $1 AND transaction_id = $2)
           OR (n.review_id IS NULL AND n.type = ANY($3::text[])
             AND EXISTS (SELECT 1 FROM duplicate_reviews dr WHERE dr.reviewed_user_id = n.user_id
               AND (n.request_id = $2 OR n.created_at BETWEEN dr.first_at - interval '10 minutes'
                                                          AND dr.last_at + interval '10 minutes')))
        ORDER BY n.created_at, n.id
      `, [...windowArgs, RELATED_NOTIFICATION_TYPES]),
      query(`
        WITH duplicate_reviews AS (
          SELECT reviewed_user_id, min(created_at) AS first_at, max(created_at) AS last_at
          FROM user_reviews WHERE reviewer_id = $1 AND transaction_id = $2
          GROUP BY reviewed_user_id
        )
        SELECT DISTINCT ua.*, a.name AS achievement_name
        FROM user_achievements ua
        JOIN achievements a ON a.id = ua.achievement_id
        WHERE ua.review_id IN (SELECT id FROM user_reviews WHERE reviewer_id = $1 AND transaction_id = $2)
           OR (ua.review_id IS NULL AND EXISTS (
             SELECT 1 FROM duplicate_reviews dr WHERE dr.reviewed_user_id = ua.user_id
               AND ua.earned_at BETWEEN dr.first_at - interval '10 minutes'
                                    AND dr.last_at + interval '10 minutes'))
        ORDER BY ua.earned_at, ua.id
      `, windowArgs),
      auditTableExists
        ? query(`
            SELECT id, canonical_review_id AS "canonicalReviewId",
                   operator_name AS "operatorName", reason, repaired_at AS "repairedAt"
            FROM duplicate_review_repair_audits
            WHERE reviewer_id = $1 AND transaction_id = $2
          `, windowArgs)
        : Promise.resolve({ rows: [], rowCount: 0 }),
    ]);

    const effects = {
      reputationActivities: reputationActivities.rows,
      shareCoinTransactions: shareCoinTransactions.rows,
      notifications: notifications.rows,
      userAchievements: userAchievements.rows,
    };
    const subset = (attributed: boolean) => Object.fromEntries(
      Object.entries(effects).map(([name, rows]) => [name, rows.filter((row: any) =>
        (row.review_id !== null) === attributed)]),
    );
    duplicates.push({
      ...group,
      reviews: reviews.rows,
      affectedUsers: affectedUsers.rows,
      relatedEffects: effects, // Retained for existing report consumers.
      attributedEffects: subset(true),
      legacyCandidates: subset(false),
      priorAudit: priorAudit.rows[0] ?? null,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    duplicateGroupCount: duplicates.length,
    instructions: duplicates.length === 0
      ? "No duplicate review groups found."
      : "Choose one canonical review per group. attributedEffects have exact review_id matches; legacyCandidates are conservative, unverified matches. Include only confirmed effects of removed reviews in the apply plan; nothing is selected automatically.",
    duplicates,
  };
}

export async function buildDuplicateReviewReport(client: Connectable = pool) {
  const connection = await client.connect();
  try {
    await connection.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const report = await buildDuplicateReviewReportWithClient(connection);
    await connection.query("COMMIT");
    return report;
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

function validatePlan(plan: RepairPlan) {
  if (
    !plan ||
    typeof plan !== "object" ||
    !Array.isArray(plan.repairs) ||
    !Array.isArray(plan.userReconciliations)
  ) {
    throw new Error("Plan must contain repairs and userReconciliations arrays");
  }
  if (typeof plan.reason !== "string" || plan.reason.trim().length < 10) {
    throw new Error("Plan reason must explain the repair in at least 10 characters");
  }
  for (const [index, repair] of plan.repairs.entries()) {
    requirePositiveInteger(repair.reviewerId, `repairs[${index}].reviewerId`);
    requirePositiveInteger(repair.transactionId, `repairs[${index}].transactionId`);
    requirePositiveInteger(repair.canonicalReviewId, `repairs[${index}].canonicalReviewId`);
    for (const field of [
      "reputationActivityIds",
      "shareCoinTransactionIds",
      "notificationIds",
      "userAchievementIds",
    ] as const) {
      for (const [idIndex, id] of ids(repair[field]).entries()) {
        requirePositiveInteger(id, `repairs[${index}].${field}[${idIndex}]`);
      }
    }
  }
  const reconciliationUsers = new Set<number>();
  for (const [index, reconciliation] of plan.userReconciliations.entries()) {
    const userId = requirePositiveInteger(
      reconciliation.userId,
      `userReconciliations[${index}].userId`,
    );
    if (reconciliationUsers.has(userId)) {
      throw new Error(`User ${userId} has more than one reconciliation`);
    }
    reconciliationUsers.add(userId);
    const scoreFields = [
      reconciliation.expectedReputationScore,
      reconciliation.targetReputationScore,
    ];
    if (scoreFields.some((value) => value !== undefined)) {
      if (!scoreFields.every((value) => Number.isInteger(value) && Number(value) >= 0)) {
        throw new Error(`User ${userId} must have non-negative integer expected and target scores`);
      }
    }
    const coinFields = [
      reconciliation.expectedShareCoins,
      reconciliation.targetShareCoins,
    ];
    if (coinFields.some((value) => value !== undefined)) {
      if (!coinFields.every(
        (value) => typeof value === "string" && Number.isFinite(Number(value)) && Number(value) >= 0,
      )) {
        throw new Error(`User ${userId} must have non-negative expected and target ShareCoin strings`);
      }
    }
  }

  for (const field of [
    "reputationActivityIds",
    "shareCoinTransactionIds",
    "notificationIds",
    "userAchievementIds",
  ] as const) {
    const seen = new Set<number>();
    for (const repair of plan.repairs) {
      for (const id of ids(repair[field])) {
        if (seen.has(id)) {
          throw new Error(`${field} ID ${id} is selected in more than one repair group`);
        }
        seen.add(id);
      }
    }
  }
}

export async function applyDuplicateReviewRepair(
  plan: RepairPlan,
  operatorName: string,
  client: Connectable = pool,
) {
  validatePlan(plan);
  if (operatorName.trim().length < 2) {
    throw new Error("Operator name is required for the audit record");
  }

  const connection = await client.connect();
  try {
    await connection.query("BEGIN");
    await ensureAuditTable(connection);
    await connection.query("LOCK TABLE user_reviews IN SHARE ROW EXCLUSIVE MODE");

    const report = await buildDuplicateReviewReportWithClient(connection);
    const liveKeys = new Set(report.duplicates.map(
      (group: any) => `${group.reviewerId}:${group.transactionId}`,
    ));
    const planKeys = new Set(plan.repairs.map(
      (repair) => `${repair.reviewerId}:${repair.transactionId}`,
    ));
    const missingKeys = [...liveKeys].filter((key) => !planKeys.has(key));
    const unexpectedKeys = [...planKeys].filter((key) => !liveKeys.has(key));

    if (missingKeys.length > 0) {
      throw new Error(`Plan does not cover every duplicate group: ${missingKeys.join(", ")}`);
    }

    if (liveKeys.size === 0 && plan.repairs.length > 0) {
      const auditCheck = await connection.query(`
        SELECT reviewer_id, transaction_id, canonical_review_id
        FROM duplicate_review_repair_audits
      `);
      const audited = new Set(auditCheck.rows.map(
        (row: any) => `${row.reviewer_id}:${row.transaction_id}:${row.canonical_review_id}`,
      ));
      const unaudited = plan.repairs.filter(
        (repair) => !audited.has(
          `${repair.reviewerId}:${repair.transactionId}:${repair.canonicalReviewId}`,
        ),
      );
      if (unaudited.length > 0) {
        throw new Error("Plan references groups that are not duplicates and have no matching repair audit");
      }
      await connection.query("ROLLBACK");
      return { status: "already_repaired", repairedGroups: 0 };
    }
    if (unexpectedKeys.length > 0) {
      throw new Error(`Plan contains groups that are not current duplicates: ${unexpectedKeys.join(", ")}`);
    }

    const requestedUserIds = plan.userReconciliations.map((entry) => entry.userId);
    const lockedUsers = requestedUserIds.length
      ? (await connection.query(`
          SELECT id, reputation_score, share_coins
          FROM users
          WHERE id = ANY($1::int[])
          ORDER BY id
          FOR UPDATE
        `, [requestedUserIds])).rows
      : [];
    if (lockedUsers.length !== requestedUserIds.length) {
      throw new Error("One or more reconciliation users do not exist");
    }
    for (const reconciliation of plan.userReconciliations) {
      const user = lockedUsers.find((row: any) => row.id === reconciliation.userId);
      if (
        reconciliation.expectedReputationScore !== undefined &&
        Number(user.reputation_score) !== reconciliation.expectedReputationScore
      ) {
        throw new Error(
          `User ${user.id} reputation score changed: expected ` +
          `${reconciliation.expectedReputationScore}, found ${user.reputation_score}`,
        );
      }
      if (
        reconciliation.expectedShareCoins !== undefined &&
        Number(user.share_coins) !== Number(reconciliation.expectedShareCoins)
      ) {
        throw new Error(
          `User ${user.id} ShareCoin balance changed: expected ` +
          `${reconciliation.expectedShareCoins}, found ${user.share_coins}`,
        );
      }
    }

    let repairedGroups = 0;
    const affectedScoreUsers = new Set<number>();
    const affectedCoinUsers = new Set<number>();
    const pendingAudits: any[] = [];
    for (const repair of plan.repairs) {
      const group = report.duplicates.find(
        (candidate: any) =>
          candidate.reviewerId === repair.reviewerId &&
          candidate.transactionId === repair.transactionId,
      );
      if (!group) throw new Error("Duplicate group disappeared while repair lock was held");
      const reviewIds = new Set(group.reviews.map((review: any) => review.id));
      if (!reviewIds.has(repair.canonicalReviewId)) {
        throw new Error(`Canonical review ${repair.canonicalReviewId} is not in its duplicate group`);
      }

      const selections = [
        ["reputationActivityIds", "reputationActivities"],
        ["shareCoinTransactionIds", "shareCoinTransactions"],
        ["notificationIds", "notifications"],
        ["userAchievementIds", "userAchievements"],
      ] as const;
      for (const [planField, reportField] of selections) {
        const candidates = new Set(
          group.relatedEffects[reportField].map((effect: any) => Number(effect.id)),
        );
        const invalid = ids(repair[planField]).filter((id) => !candidates.has(id));
        if (invalid.length > 0) {
          throw new Error(`${planField} contains unrelated or stale IDs: ${invalid.join(", ")}`);
        }
        const selected = new Set(ids(repair[planField]));
        const canonicalEffects = group.attributedEffects[reportField]
          .filter((effect: any) => effect.review_id === repair.canonicalReviewId && selected.has(effect.id));
        if (canonicalEffects.length > 0) {
          throw new Error(`${planField} selects effects of the canonical review: ${canonicalEffects.map((effect: any) => effect.id).join(", ")}`);
        }
        const missing = group.attributedEffects[reportField]
          .filter((effect: any) => effect.review_id !== repair.canonicalReviewId && !selected.has(effect.id));
        if (missing.length > 0) {
          throw new Error(`${planField} omits attributed effects of removed reviews: ${missing.map((effect: any) => effect.id).join(", ")}`);
        }
      }

      const removedReviews = group.reviews.filter(
        (review: any) => review.id !== repair.canonicalReviewId,
      );
      const activityIds = ids(repair.reputationActivityIds);
      const coinIds = ids(repair.shareCoinTransactionIds);
      const notificationIds = ids(repair.notificationIds);
      const achievementIds = ids(repair.userAchievementIds);

      const removedActivities = activityIds.length
        ? (await connection.query(
          "DELETE FROM reputation_activities WHERE id = ANY($1::int[]) RETURNING *",
          [activityIds],
        )).rows
        : [];
      if (removedActivities.length !== activityIds.length) {
        throw new Error("A selected reputation activity was stale or already removed");
      }
      removedActivities.forEach((row: any) => affectedScoreUsers.add(row.user_id));

      const removedCoins = coinIds.length
        ? (await connection.query(
          "DELETE FROM share_coins_transactions WHERE id = ANY($1::int[]) RETURNING *",
          [coinIds],
        )).rows
        : [];
      if (removedCoins.length !== coinIds.length) {
        throw new Error("A selected ShareCoin transaction was stale or already removed");
      }
      removedCoins.forEach((row: any) => affectedCoinUsers.add(row.user_id));

      const removedNotifications = notificationIds.length
        ? (await connection.query(
          "DELETE FROM notifications WHERE id = ANY($1::int[]) RETURNING *",
          [notificationIds],
        )).rows
        : [];
      if (removedNotifications.length !== notificationIds.length) {
        throw new Error("A selected notification was stale or already removed");
      }
      const removedAchievements = achievementIds.length
        ? (await connection.query(
          "DELETE FROM user_achievements WHERE id = ANY($1::int[]) RETURNING *",
          [achievementIds],
        )).rows
        : [];
      if (removedAchievements.length !== achievementIds.length) {
        throw new Error("A selected achievement was stale or already removed");
      }

      const deletedReviews = await connection.query(
        "DELETE FROM user_reviews WHERE id = ANY($1::int[])",
        [removedReviews.map((review: any) => review.id)],
      );
      if (deletedReviews.rowCount !== removedReviews.length) {
        throw new Error("A duplicate review was stale or already removed");
      }
      pendingAudits.push({
        repair,
        reviewedUserIds: [...new Set(group.reviews.map((review: any) => review.reviewedUserId))],
        removedReviews,
        removedActivities,
        removedCoins,
        removedNotifications,
        removedAchievements,
      });
      repairedGroups++;
    }

    const reconciliationByUser = new Map(
      plan.userReconciliations.map((entry) => [entry.userId, entry]),
    );
    for (const userId of affectedScoreUsers) {
      const reconciliation = reconciliationByUser.get(userId);
      if (
        reconciliation?.expectedReputationScore === undefined ||
        reconciliation.targetReputationScore === undefined
      ) {
        throw new Error(`User ${userId} needs an explicit reputation score reconciliation`);
      }
    }
    for (const userId of affectedCoinUsers) {
      const reconciliation = reconciliationByUser.get(userId);
      if (
        reconciliation?.expectedShareCoins === undefined ||
        reconciliation.targetShareCoins === undefined
      ) {
        throw new Error(`User ${userId} needs an explicit ShareCoin balance reconciliation`);
      }
    }
    for (const reconciliation of plan.userReconciliations) {
      const hasScoreFields =
        reconciliation.expectedReputationScore !== undefined ||
        reconciliation.targetReputationScore !== undefined;
      const hasCoinFields =
        reconciliation.expectedShareCoins !== undefined ||
        reconciliation.targetShareCoins !== undefined;
      if (hasScoreFields && !affectedScoreUsers.has(reconciliation.userId)) {
        throw new Error(
          `User ${reconciliation.userId} has a score reconciliation but no selected reputation effect`,
        );
      }
      if (hasCoinFields && !affectedCoinUsers.has(reconciliation.userId)) {
        throw new Error(
          `User ${reconciliation.userId} has a ShareCoin reconciliation but no selected reward effect`,
        );
      }
      if (!hasScoreFields && !hasCoinFields) {
        throw new Error(`User ${reconciliation.userId} reconciliation has no totals`);
      }
    }

    const userAdjustments = [];
    for (const reconciliation of plan.userReconciliations) {
      const before = lockedUsers.find((row: any) => row.id === reconciliation.userId);
      const score = reconciliation.targetReputationScore ??
        Number(before.reputation_score);
      const coins = reconciliation.targetShareCoins ?? String(before.share_coins);
      const { rows } = await connection.query(`
        UPDATE users
        SET reputation_score = $2,
            reputation_level = CASE
              WHEN $2 >= 500 THEN 'ShareSwap Champion'
              WHEN $2 >= 300 THEN 'Community Pillar'
              WHEN $2 >= 150 THEN 'Trusted Member'
              WHEN $2 >= 50 THEN 'Neighbour'
              ELSE 'Newcomer'
            END,
            share_coins = $3
        WHERE id = $1
        RETURNING reputation_score, reputation_level, share_coins
      `, [reconciliation.userId, score, coins]);
      userAdjustments.push({
        userId: reconciliation.userId,
        before: {
          reputationScore: Number(before.reputation_score),
          shareCoins: String(before.share_coins),
        },
        after: {
          reputationScore: Number(rows[0].reputation_score),
          reputationLevel: rows[0].reputation_level,
          shareCoins: String(rows[0].share_coins),
        },
      });
    }

    for (const audit of pendingAudits) {
      const relevantAdjustments = userAdjustments.filter(
        (adjustment) => audit.reviewedUserIds.includes(adjustment.userId),
      );
      await connection.query(`
        INSERT INTO duplicate_review_repair_audits (
          reviewer_id, transaction_id, canonical_review_id, operator_name, reason,
          removed_reviews, removed_reputation_activities,
          removed_share_coin_transactions, removed_notifications,
          removed_user_achievements, score_adjustments, coin_adjustments
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb,
                  $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb)
      `, [
        audit.repair.reviewerId,
        audit.repair.transactionId,
        audit.repair.canonicalReviewId,
        operatorName.trim(),
        plan.reason.trim(),
        JSON.stringify(audit.removedReviews),
        JSON.stringify(audit.removedActivities),
        JSON.stringify(audit.removedCoins),
        JSON.stringify(audit.removedNotifications),
        JSON.stringify(audit.removedAchievements),
        JSON.stringify(relevantAdjustments.filter((item) =>
          affectedScoreUsers.has(item.userId))),
        JSON.stringify(relevantAdjustments.filter((item) =>
          affectedCoinUsers.has(item.userId))),
      ]);
    }

    const remaining = await connection.query(`
      SELECT reviewer_id, transaction_id
      FROM user_reviews
      WHERE transaction_id IS NOT NULL
      GROUP BY reviewer_id, transaction_id
      HAVING count(*) > 1
    `);
    if (remaining.rowCount !== 0) {
      throw new Error("Duplicate reviews remain after repair; transaction was rolled back");
    }
    await connection.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS user_reviews_reviewer_transaction_uidx
      ON user_reviews(reviewer_id, transaction_id)
    `);
    await connection.query("COMMIT");
    return { status: "repaired", repairedGroups };
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "report") {
    console.log(JSON.stringify(await buildDuplicateReviewReport(), null, 2));
    return;
  }
  if (command === "apply") {
    const planPath = args[0];
    const operatorFlag = args.indexOf("--operator");
    const operatorName = operatorFlag >= 0 ? args[operatorFlag + 1] : "";
    if (!planPath || !operatorName) {
      throw new Error("Usage: repair-duplicate-reviews apply <plan.json> --operator <name>");
    }
    const plan = JSON.parse(await readFile(planPath, "utf8")) as RepairPlan;
    console.log(JSON.stringify(await applyDuplicateReviewRepair(plan, operatorName), null, 2));
    return;
  }
  throw new Error(
    "Usage: repair-duplicate-reviews report | apply <plan.json> --operator <name>",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}