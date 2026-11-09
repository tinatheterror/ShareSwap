import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { db, notifications, users, verifications } from "@workspace/db";

/**
 * Production ran with a Persona SANDBOX key, so every "approved" verification was simulated: nobody's ID was checked. This finds those
 * approvals and takes the members back to "not verified" (scripts/reset-sandbox-verifications.ts runs it by hand; dry run first).
 *
 * What counts: a verification the Persona flow approved (status "approved" with a Persona inquiry id). Older approvals without an inquiry id
 * did not come from Persona and are left alone. `before` is a cutoff on the row's created_at (the row is created when the inquiry is): set it
 * to the moment the production key went live, so a real approval made after that is never reset.
 *
 * Where the reason is recorded: the row's status becomes "reset" (not approved, so the member counts as unverified and may start again) and its
 * id_number marker "PERSONA_VERIFIED" becomes "SANDBOX_RESET". Not undone here: the trust score and ShareCoins the approval granted.
 */
export const RESET_STATUS = "reset";
export const RESET_REASON = "SANDBOX_RESET";
export const RESET_NOTIFICATION_TYPE = "verification_reset";
export const RESET_NOTIFICATION_TITLE = "Please verify your identity again";
// Free of the words "csrf" and "token" like the app's other member-facing text.
export const RESET_NOTIFICATION_MESSAGE =
  "Your earlier identity verification was recorded in a test mode, so your ID was not actually checked. We have removed your Verified badge. " +
  "Please verify your identity again to get it back.";

export type ResetCandidate = {
  userId: number;
  username: string | null;
  verificationIds: number[];
  inquiryIds: string[];
  firstCreatedAt: Date | null;
  lastCreatedAt: Date | null;
  isVerified: boolean;
};

export async function findSandboxApprovedVerifications(options: { before?: Date } = {}): Promise<ResetCandidate[]> {
  const rows = await db
    .select({
      id: verifications.id, userId: verifications.userId, inquiryId: verifications.personaInquiryId, createdAt: verifications.createdAt,
      username: users.username, isVerified: users.isVerified,
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
    const entry = byUser.get(row.userId) ?? { userId: row.userId, username: row.username, verificationIds: [], inquiryIds: [], firstCreatedAt: null, lastCreatedAt: null, isVerified: row.isVerified === true };
    entry.verificationIds.push(row.id);
    if (row.inquiryId) entry.inquiryIds.push(row.inquiryId);
    if (row.createdAt && (!entry.firstCreatedAt || row.createdAt < entry.firstCreatedAt)) entry.firstCreatedAt = row.createdAt;
    if (row.createdAt && (!entry.lastCreatedAt || row.createdAt > entry.lastCreatedAt)) entry.lastCreatedAt = row.createdAt;
    byUser.set(row.userId, entry);
  }
  return [...byUser.values()];
}

export function describeResetPlan(candidates: ResetCandidate[], options: { before?: Date; now?: Date } = {}): string {
  const lines = [
    `Verifications approved through Persona${options.before ? ` and created before ${options.before.toISOString()}` : " (no cutoff)"}: ` +
      `${candidates.reduce((n, c) => n + c.verificationIds.length, 0)} for ${candidates.length} member(s).`,
  ];
  for (const c of candidates) {
    lines.push(`  user ${c.userId} (${c.username ?? "no username"}): verification(s) ${c.verificationIds.join(", ")}, inquiry ${c.inquiryIds.join(", ")}, ` +
      `created ${c.firstCreatedAt?.toISOString() ?? "?"}${c.lastCreatedAt && c.lastCreatedAt !== c.firstCreatedAt ? ` .. ${c.lastCreatedAt.toISOString()}` : ""}, badge ${c.isVerified ? "on" : "off"}`);
  }
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
  failed: Array<{ userId: number; error: string }>;
};

/**
 * Resets exactly the given candidates (nothing else), one transaction per member so a failure leaves the others done and this one untouched.
 * Safe to run twice: a reset row is no longer "approved", so a second run finds nothing and notifies nobody again.
 */
export async function applySandboxReset(candidates: ResetCandidate[]): Promise<ResetResult> {
  const result: ResetResult = { members: 0, verificationsReset: 0, badgesCleared: 0, notified: 0, failed: [] };
  for (const candidate of candidates) {
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
        await tx.insert(notifications).values({
          userId: candidate.userId, type: RESET_NOTIFICATION_TYPE, title: RESET_NOTIFICATION_TITLE, message: RESET_NOTIFICATION_MESSAGE, isRead: false,
        });
        result.members += 1;
        result.verificationsReset += reset.length;
        result.badgesCleared += cleared;
        result.notified += 1;
      });
    } catch (error) {
      result.failed.push({ userId: candidate.userId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
