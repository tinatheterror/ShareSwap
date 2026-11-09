import { and, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { db, notifications, reputationActivities, shareCoinsTransactions, users, verifications } from "@workspace/db";
import { trustLevelForScore } from "./trust-score-service";
import { sendVerificationResetEmail } from "./mail";
import { verificationRecipient } from "./verification";

/**
 * Production ran with a Persona SANDBOX key, so every "approved" verification was simulated: nobody's ID was checked. This finds those
 * approvals and takes the members back to "not verified" (scripts/reset-sandbox-verifications.ts runs it by hand; dry run first).
 *
 * What counts: a verification the Persona flow approved (status "approved" with a Persona inquiry id). Older approvals without an inquiry id
 * did not come from Persona and are left alone. `before` is a cutoff on the row's created_at (the row is created when the inquiry is): set it
 * to the moment the production key went live, so a real approval made after that is never reset.
 *
 * Where the reason is recorded: the row's status becomes "reset" (not approved, so the member counts as unverified and may start again) and its
 * id_number marker "PERSONA_VERIFIED" becomes "SANDBOX_RESET".
 *
 * The trust score and ShareCoins each approval granted are taken back too, so verifying again does not give them twice. The grants are found in
 * the ledgers the approval wrote (a reputation_activities row "VERIFICATION_APPROVED" and a share_coins_transactions row "Profile Verification
 * Bonus"), and each one reversed gets its own negative row ("VERIFICATION_RESET") saying what was taken. Reversal never takes more than the member
 * has: the score stops at 0 and the ShareCoins balance at 0, and the row records what was actually taken (the plan shows the full amounts).
 */
export const RESET_STATUS = "reset";
export const RESET_REASON = "SANDBOX_RESET";
export const RESET_NOTIFICATION_TYPE = "verification_reset";
export const RESET_NOTIFICATION_TITLE = "Please verify your identity again";
// Free of the words "csrf" and "token" like the app's other member-facing text.
export const RESET_NOTIFICATION_MESSAGE =
  "Your earlier identity verification was recorded in a test mode, so your ID was not actually checked. We have removed the verified status, " +
  "and the trust points and ShareCoins, that it gave you. Please verify your identity again to earn them back.";

/** What the approval wrote (routes.ts, inquiry-complete), and what the reversal writes. */
export const APPROVAL_ACTIVITY_TYPE = "VERIFICATION_APPROVED";
export const APPROVAL_COINS_DESCRIPTION = "Profile Verification Bonus";
export const REVERSAL_TYPE = "VERIFICATION_RESET";
export const REVERSAL_ACTIVITY_DESCRIPTION = "Identity verification reset: the earlier approval was simulated (sandbox)";
export const REVERSAL_COINS_DESCRIPTION = "Verification bonus taken back: the earlier approval was simulated (sandbox)";

type Grant = { id: number; amount: number };

export type ResetCandidate = {
  userId: number;
  username: string | null;
  verificationIds: number[];
  inquiryIds: string[];
  firstCreatedAt: Date | null;
  lastCreatedAt: Date | null;
  isVerified: boolean;
  /** Where the email goes (the member's own address), or null: no address, or a deleted or banned account. */
  emailTo: string | null;
  displayName: string | null;
  /** Grants not yet reversed, oldest first. */
  trustGrants: Grant[];
  coinGrants: Grant[];
};

/** What the reset would take back: one grant per approval being reset (never more grants than there are approvals). */
export function plannedReversal(candidate: ResetCandidate): { trust: number; coins: number } {
  const take = (grants: Grant[]) => grants.slice(0, candidate.verificationIds.length).reduce((sum, g) => sum + g.amount, 0);
  return { trust: take(candidate.trustGrants), coins: take(candidate.coinGrants) };
}

export async function findSandboxApprovedVerifications(options: { before?: Date } = {}): Promise<ResetCandidate[]> {
  const rows = await db
    .select({
      id: verifications.id, userId: verifications.userId, inquiryId: verifications.personaInquiryId, createdAt: verifications.createdAt,
      username: users.username, isVerified: users.isVerified, email: users.email, displayName: users.displayName, accountStatus: users.accountStatus,
    })
    .from(verifications)
    .innerJoin(users, eq(users.id, verifications.userId))
    .where(and(
      eq(verifications.status, "approved"),
      isNotNull(verifications.personaInquiryId),
      options.before ? lt(verifications.createdAt, options.before) : undefined,
    ))
    .orderBy(verifications.userId, verifications.id);
  const byUser = new Map<number, ResetCandidate>();
  for (const row of rows) {
    const entry = byUser.get(row.userId) ?? { userId: row.userId, username: row.username, verificationIds: [], inquiryIds: [], firstCreatedAt: null, lastCreatedAt: null, isVerified: row.isVerified === true, displayName: row.displayName,
      emailTo: row.accountStatus === "deleted" || row.accountStatus === "banned" ? null : verificationRecipient({ email: row.email, username: row.username }), trustGrants: [], coinGrants: [] };
    entry.verificationIds.push(row.id);
    if (row.inquiryId) entry.inquiryIds.push(row.inquiryId);
    if (row.createdAt && (!entry.firstCreatedAt || row.createdAt < entry.firstCreatedAt)) entry.firstCreatedAt = row.createdAt;
    if (row.createdAt && (!entry.lastCreatedAt || row.createdAt > entry.lastCreatedAt)) entry.lastCreatedAt = row.createdAt;
    byUser.set(row.userId, entry);
  }
  const candidates = [...byUser.values()];
  if (candidates.length === 0) return candidates;
  const userIds = candidates.map((c) => c.userId);

  // The grants. A grant made at or after the cutoff belongs to a real approval and is never reversed (a sandbox approval cannot happen once the
  // production key is live: it cannot even fetch a sandbox inquiry). Reversals already made are counted off, so nothing is reversed twice.
  const beforeCutoff = (at: Date | null) => !options.before || !at || at < options.before;
  const activities = await db
    .select({ id: reputationActivities.id, userId: reputationActivities.userId, type: reputationActivities.activityType, points: reputationActivities.points, createdAt: reputationActivities.createdAt })
    .from(reputationActivities)
    .where(and(inArray(reputationActivities.userId, userIds), inArray(reputationActivities.activityType, [APPROVAL_ACTIVITY_TYPE, REVERSAL_TYPE])))
    .orderBy(reputationActivities.id);
  const coins = await db
    .select({ id: shareCoinsTransactions.id, userId: shareCoinsTransactions.userId, type: shareCoinsTransactions.transactionType, amount: shareCoinsTransactions.amount, createdAt: shareCoinsTransactions.createdAt })
    .from(shareCoinsTransactions)
    .where(and(
      inArray(shareCoinsTransactions.userId, userIds),
      or(and(eq(shareCoinsTransactions.transactionType, "EARNED"), eq(shareCoinsTransactions.description, APPROVAL_COINS_DESCRIPTION)), eq(shareCoinsTransactions.transactionType, REVERSAL_TYPE)),
    ))
    .orderBy(shareCoinsTransactions.id);
  for (const c of candidates) {
    const mineActivities = activities.filter((a) => a.userId === c.userId);
    const reversedTrust = mineActivities.filter((a) => a.type === REVERSAL_TYPE).length;
    c.trustGrants = mineActivities.filter((a) => a.type === APPROVAL_ACTIVITY_TYPE && beforeCutoff(a.createdAt)).map((a) => ({ id: a.id, amount: a.points })).slice(reversedTrust);
    const mineCoins = coins.filter((t) => t.userId === c.userId);
    const reversedCoins = mineCoins.filter((t) => t.type === REVERSAL_TYPE).length;
    c.coinGrants = mineCoins.filter((t) => t.type === "EARNED" && beforeCutoff(t.createdAt)).map((t) => ({ id: t.id, amount: Number(t.amount) })).slice(reversedCoins);
  }
  return candidates;
}

export function describeResetPlan(candidates: ResetCandidate[], options: { before?: Date; now?: Date } = {}): string {
  const lines = [
    `Verifications approved through Persona${options.before ? ` and created before ${options.before.toISOString()}` : " (no cutoff)"}: ` +
      `${candidates.reduce((n, c) => n + c.verificationIds.length, 0)} for ${candidates.length} member(s).`,
  ];
  for (const c of candidates) {
    lines.push(`  user ${c.userId} (${c.username ?? "no username"}): verification(s) ${c.verificationIds.join(", ")}, inquiry ${c.inquiryIds.join(", ")}, ` +
      `created ${c.firstCreatedAt?.toISOString() ?? "?"}${c.lastCreatedAt && c.lastCreatedAt !== c.firstCreatedAt ? ` .. ${c.lastCreatedAt.toISOString()}` : ""}, badge ${c.isVerified ? "on" : "off"}, ` +
      `takes back ${plannedReversal(c).trust} trust points and ${plannedReversal(c).coins} ShareCoins`);
  }
  const totals = candidates.reduce((t, c) => { const p = plannedReversal(c); return { trust: t.trust + p.trust, coins: t.coins + p.coins }; }, { trust: 0, coins: 0 });
  const emailable = candidates.filter((c) => c.emailTo).length;
  lines.push(`Each member gets an in-app notification; ${emailable} of ${candidates.length} will also be emailed (${candidates.length - emailable} have no usable address or a deleted or banned account).`);
  lines.push(`Total to take back: ${totals.trust} trust points and ${totals.coins} ShareCoins (a score or balance never goes below 0, so a member who has spent the coins loses less; the run reports any shortfall).`);
  if (!options.before) {
    lines.push(`\nNo cutoff given, so this is EVERY Persona approval. --apply needs --before=<ISO time>: the moment the production key went live, ` +
      `so a real approval is never reset. Right now that would be --before=${(options.now ?? new Date()).toISOString()} (only right if no real verification has happened yet).`);
  }
  return lines.join("\n");
}

export type ResetResult = {
  members: number;
  verificationsReset: number;
  badgesCleared: number;
  notified: number;
  trustPointsTakenBack: number;
  shareCoinsTakenBack: number;
  /** Members who had less than the plan (the score or balance hit 0): what was missing. */
  shortfalls: Array<{ userId: number; trust: number; coins: number }>;
  emailed: number;
  /** Members who were reset but whose email was not sent (the in-app notification was): follow up by hand, a second run does not find them. */
  emailFailed: number[];
  noEmailAddress: number[];
  failed: Array<{ userId: number; error: string }>;
};

/**
 * Resets exactly the given candidates (nothing else), one transaction per member so a failure leaves the others done and this one untouched.
 * Safe to run twice: a reset row is no longer "approved", so a second run finds nothing and notifies nobody again.
 */
export async function applySandboxReset(candidates: ResetCandidate[], deps: { sendEmail: (to: string, displayName?: string) => Promise<boolean> } = { sendEmail: sendVerificationResetEmail }): Promise<ResetResult> {
  const result: ResetResult = { members: 0, verificationsReset: 0, badgesCleared: 0, notified: 0, trustPointsTakenBack: 0, shareCoinsTakenBack: 0, shortfalls: [], emailed: 0, emailFailed: [], noEmailAddress: [], failed: [] };
  for (const candidate of candidates) {
    let didReset = false;
    try {
      await db.transaction(async (tx) => {
        // Re-checks "approved" inside the transaction, so a row changed since the dry run is skipped, not overwritten.
        const reset = await tx
          .update(verifications)
          .set({ status: RESET_STATUS, idNumber: RESET_REASON })
          .where(and(eq(verifications.userId, candidate.userId), inArray(verifications.id, candidate.verificationIds), eq(verifications.status, "approved")))
          .returning({ id: verifications.id });
        if (reset.length === 0) return;
        // The badge goes unless the member still has another approved ID (one that was not reset).
        const [stillApproved] = await tx
          .select({ id: verifications.id })
          .from(verifications)
          .where(and(eq(verifications.userId, candidate.userId), eq(verifications.status, "approved")))
          .limit(1);
        let cleared = 0;
        if (!stillApproved) {
          const updated = await tx.update(users).set({ isVerified: false, verifiedAt: null }).where(and(eq(users.id, candidate.userId), eq(users.isVerified, true))).returning({ id: users.id });
          cleared = updated.length;
        }
        // Take back what the approvals granted: one negative row per grant reversed, never below 0.
        const [account] = await tx.select({ score: users.trustScore, coins: users.shareCoins }).from(users).where(eq(users.id, candidate.userId)).for("update");
        let score = Math.max(0, account?.score ?? 0);
        let balance = Math.max(0, Number(account?.coins ?? 0));
        const plan = plannedReversal({ ...candidate, verificationIds: reset.map((r) => r.id) });
        let trustTaken = 0;
        let coinsTaken = 0;
        for (const grant of candidate.trustGrants.slice(0, reset.length)) {
          const take = Math.min(grant.amount, score);
          score -= take;
          trustTaken += take;
          await tx.insert(reputationActivities).values({ userId: candidate.userId, activityType: REVERSAL_TYPE, points: -take, description: take < grant.amount ? `${REVERSAL_ACTIVITY_DESCRIPTION} (took ${take} of ${grant.amount}: the score cannot go below 0)` : REVERSAL_ACTIVITY_DESCRIPTION });
        }
        for (const grant of candidate.coinGrants.slice(0, reset.length)) {
          const take = Math.min(grant.amount, balance);
          balance -= take;
          coinsTaken += take;
          await tx.insert(shareCoinsTransactions).values({ userId: candidate.userId, amount: (-take).toString(), transactionType: REVERSAL_TYPE, description: take < grant.amount ? `${REVERSAL_COINS_DESCRIPTION} (took ${take} of ${grant.amount}: already spent)` : REVERSAL_COINS_DESCRIPTION });
        }
        if (trustTaken > 0 || coinsTaken > 0) {
          await tx.update(users).set({ trustScore: score, reputationLevel: trustLevelForScore(score), shareCoins: balance.toFixed(2) }).where(eq(users.id, candidate.userId));
        }
        await tx.insert(notifications).values({
          userId: candidate.userId, type: RESET_NOTIFICATION_TYPE, title: RESET_NOTIFICATION_TITLE, message: RESET_NOTIFICATION_MESSAGE, isRead: false,
        });
        // Counted only now: everything above is committed together or not at all.
        if (trustTaken < plan.trust || coinsTaken < plan.coins) result.shortfalls.push({ userId: candidate.userId, trust: plan.trust - trustTaken, coins: plan.coins - coinsTaken });
        result.trustPointsTakenBack += trustTaken;
        result.shareCoinsTakenBack += coinsTaken;
        result.members += 1;
        result.verificationsReset += reset.length;
        result.badgesCleared += cleared;
        result.notified += 1;
        didReset = true;
      });
    } catch (error) {
      result.failed.push({ userId: candidate.userId, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    // After the commit, never inside it: a mail failure must not undo a reset, and a rolled-back reset must not have sent a mail.
    if (!didReset) continue;
    if (!candidate.emailTo) result.noEmailAddress.push(candidate.userId);
    else if (await deps.sendEmail(candidate.emailTo, candidate.displayName ?? undefined)) result.emailed += 1;
    else result.emailFailed.push(candidate.userId);
  }
  return result;
}
