import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";

type Queryable = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
};
type Connectable = {
  connect(): Promise<Queryable & { release(): void }>;
  end?(): Promise<void>;
};
type GroupPlan = {
  userId: number;
  achievementId: number;
  canonicalBadgeId: number;
  duplicateBadgeIds: number[];
  rewardTransactionIds: number[];
  notificationIds: number[];
  expectedShareCoins: string;
  targetShareCoins: string;
};
type Plan = { reason: string; groups: GroupPlan[] };

function positive(id: number) {
  return Number.isSafeInteger(id) && id > 0;
}
function amount(value: string) {
  return typeof value === "string" && /^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value)
    && Number(value) <= 99999999;
}
function uniqueIds(values: number[], name: string) {
  if (!Array.isArray(values) || values.some((id) => !positive(id)) ||
      new Set(values).size !== values.length) {
    throw new Error(`${name} must contain distinct positive integer IDs`);
  }
}
function validate(plan: Plan, operator: string) {
  if (!plan || typeof plan.reason !== "string" || plan.reason.trim().length < 10 ||
      !Array.isArray(plan.groups) || !plan.groups.length ||
      typeof operator !== "string" || operator.trim().length < 2) {
    throw new Error("A reason (at least 10 characters), groups, and operator are required");
  }
  const keys = new Set<string>();
  for (const group of plan.groups) {
    if (!positive(group.userId) || !positive(group.achievementId) ||
        !positive(group.canonicalBadgeId) || !amount(group.expectedShareCoins) ||
        !amount(group.targetShareCoins)) {
      throw new Error("Invalid badge key, canonical ID, or ShareCoin balance");
    }
    for (const field of ["duplicateBadgeIds", "rewardTransactionIds", "notificationIds"] as const) {
      uniqueIds(group[field], field);
    }
    if (!group.duplicateBadgeIds.length ||
        group.duplicateBadgeIds.includes(group.canonicalBadgeId)) {
      throw new Error("Select every noncanonical badge, but not the canonical badge");
    }
    const key = `${group.userId}:${group.achievementId}`;
    if (keys.has(key)) throw new Error(`Duplicate plan group ${key}`);
    keys.add(key);
  }
  const balances = new Map<number, string>();
  for (const group of plan.groups) {
    const previous = balances.get(group.userId);
    const pair = `${group.expectedShareCoins}:${group.targetShareCoins}`;
    if (previous && previous !== pair) {
      throw new Error(`All groups for user ${group.userId} must agree on account balances`);
    }
    balances.set(group.userId, pair);
  }
}

async function reportWithClient(client: Queryable) {
  const { rows: groups } = await client.query(`
    SELECT ua.user_id AS "userId", ua.achievement_id AS "achievementId",
           a.name AS "achievementName", u.share_coins AS "shareCoins",
           array_agg(ua.id ORDER BY ua.earned_at, ua.id) AS "badgeIds"
    FROM user_achievements ua
    JOIN achievements a ON a.id = ua.achievement_id
    JOIN users u ON u.id = ua.user_id
    WHERE ua.user_id IS NOT NULL AND ua.achievement_id IS NOT NULL
    GROUP BY ua.user_id, ua.achievement_id, a.name, u.share_coins
    HAVING count(*) > 1
    ORDER BY ua.user_id, ua.achievement_id
  `);
  const duplicates = [];
  for (const group of groups) {
    // A pg client permits only one in-flight query on its connection.
    const badges = await client.query(`SELECT * FROM user_achievements WHERE user_id = $1 AND achievement_id = $2
                    ORDER BY earned_at, id`, [group.userId, group.achievementId]);
    const rewards = await client.query(`SELECT * FROM share_coins_transactions
                    WHERE user_id = $1 AND transaction_type = 'EARNED'
                       AND (description LIKE 'Badge unlocked: %' OR review_id IN (
                        SELECT review_id FROM user_achievements
                         WHERE user_id = $1 AND achievement_id = $2 AND review_id IS NOT NULL))
                    ORDER BY created_at, id`,
        [group.userId, group.achievementId]);
    const notices = await client.query(`SELECT * FROM notifications
                    WHERE user_id = $1 AND type = 'badge_earned'
                    ORDER BY created_at, id`,
        [group.userId]);
    duplicates.push({
      ...group,
      badges: badges.rows,
      rewardCandidates: rewards.rows,
      notificationCandidates: notices.rows,
    });
  }
  return {
    duplicateGroupCount: duplicates.length,
    instructions: "Review each account and every badge, reward and notice. Candidates are not proof of attribution; put confirmed IDs in the plan, and explicitly enter expected and target balances. Unselected effects remain untouched.",
    duplicates,
  };
}

export async function reportDuplicateBadges(database: Connectable = pool) {
  const client = await database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const report = await reportWithClient(client);
    await client.query("COMMIT");
    return report;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reconcileDuplicateBadges(plan: Plan, operator: string, database: Connectable = pool) {
  validate(plan, operator);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    // This lock prevents new badge awards while we verify the plan and create the index.
    await client.query("LOCK TABLE user_achievements IN SHARE ROW EXCLUSIVE MODE");
    const report = await reportWithClient(client);
    const keys = report.duplicates.map((g) => `${g.userId}:${g.achievementId}`).sort();
    const planned = plan.groups.map((g) => `${g.userId}:${g.achievementId}`).sort();
    if (JSON.stringify(keys) !== JSON.stringify(planned)) {
      throw new Error(`Plan must cover exactly the current duplicate groups: ${keys.join(", ")}`);
    }
    const userIds = [...new Set(plan.groups.map((g) => g.userId))].sort((a, b) => a - b);
    const { rows: users } = await client.query(
      "SELECT id, share_coins FROM users WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE",
      [userIds],
    );
    if (users.length !== userIds.length) throw new Error("An affected account is missing");

    const allRewards = new Set<number>();
    const allNotices = new Set<number>();
    const audits = [];
    for (const group of plan.groups) {
      const live = report.duplicates.find(
        (g) => g.userId === group.userId && g.achievementId === group.achievementId,
      )!;
      const liveIds = live.badges.map((row: any) => row.id).sort((a: number, b: number) => a - b);
      const selectedIds = [group.canonicalBadgeId, ...group.duplicateBadgeIds].sort((a, b) => a - b);
      if (JSON.stringify(liveIds) !== JSON.stringify(selectedIds)) {
        throw new Error(`Badge selection changed for ${group.userId}:${group.achievementId}`);
      }
      for (const [field, candidates, seen] of [
        ["rewardTransactionIds", live.rewardCandidates, allRewards],
        ["notificationIds", live.notificationCandidates, allNotices],
      ] as const) {
        const allowed = new Set(candidates.map((row: any) => row.id));
        for (const id of group[field]) {
          if (!allowed.has(id) || seen.has(id)) throw new Error(`Unrelated, stale or reused ${field}: ${id}`);
          seen.add(id);
        }
      }
      const before = users.find((user) => user.id === group.userId).share_coins;
      if (Number(before) !== Number(group.expectedShareCoins)) {
        throw new Error(`ShareCoin balance changed for user ${group.userId}: expected ${group.expectedShareCoins}, found ${before}`);
      }
      // No historical reward or notification is deleted or rewritten. A balance
      // correction is a new ledger entry so previous credits stay explainable.
      const rewardRows = group.rewardTransactionIds.length
        ? (await client.query(
          "SELECT * FROM share_coins_transactions WHERE id = ANY($1::int[]) AND user_id = $2 ORDER BY id FOR UPDATE",
          [group.rewardTransactionIds, group.userId],
        )).rows : [];
      const noticeRows = group.notificationIds.length
        ? (await client.query(
          "SELECT * FROM notifications WHERE id = ANY($1::int[]) AND user_id = $2 ORDER BY id FOR UPDATE",
          [group.notificationIds, group.userId],
        )).rows : [];
      if (rewardRows.length !== group.rewardTransactionIds.length ||
          noticeRows.length !== group.notificationIds.length) {
        throw new Error("A reviewed reward or notification changed");
      }
      for (const [actual, candidates] of [
        [rewardRows, live.rewardCandidates],
        [noticeRows, live.notificationCandidates],
      ] as const) {
        for (const row of actual) {
          if (JSON.stringify(row) !== JSON.stringify(candidates.find((candidate: any) => candidate.id === row.id))) {
            throw new Error(`Reviewed effect ${row.id} changed since the report`);
          }
        }
      }
      audits.push({ group, live, before, rewardRows, noticeRows });
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS duplicate_badge_reconciliation_audits (
        id serial PRIMARY KEY,
        user_id integer NOT NULL,
        achievement_id integer NOT NULL,
        canonical_badge jsonb NOT NULL,
        archived_badges jsonb NOT NULL,
        reviewed_rewards jsonb NOT NULL,
        reviewed_notifications jsonb NOT NULL,
        expected_share_coins numeric NOT NULL,
        target_share_coins numeric NOT NULL,
        correction_transaction jsonb,
        operator_name text NOT NULL,
        reason text NOT NULL,
        reconciled_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS duplicate_badge_reconciliation_audits_user_achievement_uidx
      ON duplicate_badge_reconciliation_audits(user_id, achievement_id)
    `);
    const adjusted = new Set<number>();
    for (const { group, live, before, rewardRows, noticeRows } of audits) {
      const { rows: removed } = await client.query(
        "DELETE FROM user_achievements WHERE id = ANY($1::int[]) RETURNING *",
        [group.duplicateBadgeIds],
      );
      if (removed.length !== group.duplicateBadgeIds.length) throw new Error("Badge changed during reconciliation");
      let correction = null;
      if (!adjusted.has(group.userId) && Number(before) !== Number(group.targetShareCoins)) {
        const { rows } = await client.query(`
          INSERT INTO share_coins_transactions (user_id, amount, description, transaction_type)
          VALUES ($1, $2::numeric - $3::numeric, $4, 'ADJUSTMENT') RETURNING *
        `, [group.userId, group.targetShareCoins, before,
          `Reviewed duplicate badge reconciliation: ${group.achievementId}`]);
        correction = rows[0];
        const updated = await client.query(
          "UPDATE users SET share_coins = $2 WHERE id = $1 AND share_coins = $3 RETURNING id",
          [group.userId, group.targetShareCoins, before],
        );
        if (updated.rowCount !== 1) throw new Error("Account balance changed during reconciliation");
      }
      adjusted.add(group.userId);
      await client.query(`
        INSERT INTO duplicate_badge_reconciliation_audits (
          user_id, achievement_id, canonical_badge, archived_badges,
          reviewed_rewards, reviewed_notifications, expected_share_coins,
          target_share_coins, correction_transaction, operator_name, reason
        ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb,
                  $7, $8, $9::jsonb, $10, $11)
      `, [
        group.userId, group.achievementId,
        JSON.stringify(live.badges.find((row: any) => row.id === group.canonicalBadgeId)),
        JSON.stringify(removed), JSON.stringify(rewardRows), JSON.stringify(noticeRows),
        before, group.targetShareCoins, JSON.stringify(correction), operator.trim(), plan.reason.trim(),
      ]);
    }
    const remaining = await client.query(`
      SELECT user_id, achievement_id FROM user_achievements
      WHERE user_id IS NOT NULL AND achievement_id IS NOT NULL
      GROUP BY user_id, achievement_id HAVING count(*) > 1
    `);
    if (remaining.rows.length) throw new Error("Duplicate badges remain; rolling back");
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS user_achievements_user_achievement_uidx
      ON user_achievements(user_id, achievement_id)
    `);
    await client.query("COMMIT");
    return { status: "reconciled", groups: audits.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const [command, file, flag, operator] = process.argv.slice(2);
  if (command === "report") {
    console.log(JSON.stringify(await reportDuplicateBadges(), null, 2));
  } else if (command === "apply" && file && flag === "--operator" && operator) {
    const plan = JSON.parse(await readFile(file, "utf8"));
    console.log(JSON.stringify(await reconcileDuplicateBadges(plan, operator), null, 2));
  } else {
    throw new Error("Usage: badges:duplicates report | apply <reviewed-plan.json> --operator <name>");
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }).finally(() => pool.end());
}