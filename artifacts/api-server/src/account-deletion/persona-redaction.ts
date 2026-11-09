import { and, asc, eq, inArray } from "drizzle-orm";
import { db, notifications, personaRedactions, verifications } from "@workspace/db";
import { adminUserIds } from "../platform-disputes";

/**
 * Persona keeps the ID images, the selfie and the face-match data of every inquiry. When an account is deleted ShareSwap asks Persona to
 * redact each of that member's inquiries: DELETE https://api.withpersona.com/api/v1/inquiries/{inquiry-id} ("Redact an Inquiry",
 * https://docs.withpersona.com/api-reference/inquiries/redact-an-inquiry), which permanently removes the personal data of the inquiry and
 * its verifications and reports. It cannot be undone.
 *
 * The inquiry ids are written to persona_redactions inside the deletion transaction (before the verification rows are scrubbed), the first
 * attempt runs right after the account is gone, and any that fail (Persona down, key missing) stay "pending" and are retried by every live
 * deletion sweep. Nothing here ever blocks or fails a deletion.
 */
/** A redaction that keeps failing is given up on after this many attempts or this long (whichever comes first), and admins are told once. */
export const PERSONA_REDACTION_MAX_ATTEMPTS = 10;
export const PERSONA_REDACTION_MAX_AGE_MS = 7 * 24 * 3_600_000;
export const PERSONA_REDACTION_FAILED_NOTIFICATION = "admin_persona_redaction_failed";

export type PersonaRedactor = (inquiryId: string) => Promise<void>;

type Executor = Pick<typeof db, "select" | "insert">;

/** The inquiry ids on this member's verification rows, queued for redaction. Call inside the deletion transaction, before the rows are scrubbed. */
export async function queuePersonaRedactions(executor: Executor, userId: number): Promise<number> {
  const rows = await executor.select({ inquiryId: verifications.personaInquiryId }).from(verifications).where(eq(verifications.userId, userId));
  const ids = [...new Set(rows.map((r) => r.inquiryId).filter((id): id is string => !!id))];
  if (ids.length === 0) return 0;
  await executor.insert(personaRedactions).values(ids.map((inquiryId) => ({ userId, inquiryId }))).onConflictDoNothing();
  return ids.length;
}

const PERSONA_API = "https://api.withpersona.com/api/v1";

function personaHeaders(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}`, "Persona-Version": "2023-01-05", "Key-Inflection": "camel" };
}

/** Persona's `redacted-at` (camelCase with Key-Inflection: camel). The docs do not say what a redacted object looks like, so this reads it either way. */
function redactedAtOf(body: any): string | null {
  const attributes = body?.data?.attributes ?? {};
  return attributes.redactedAt ?? attributes["redacted-at"] ?? null;
}

/**
 * The real call. Resolves when Persona says the inquiry is redacted. A 404 is NOT taken at face value (it may mean a wrong endpoint rather
 * than "gone"): the inquiry is fetched, and the redaction counts as done only if Persona shows it redacted (`redacted-at` set) or says it
 * does not exist. If the inquiry is there and not redacted, the redact call did not work: that throws, and is logged loudly.
 */
export function createPersonaRedactor(options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}): PersonaRedactor {
  return async (inquiryId) => {
    const apiKey = (options.env ?? process.env).PERSONA_API_KEY;
    if (!apiKey) throw new Error("Persona is not configured (PERSONA_API_KEY is not set)");
    const doFetch = options.fetchImpl ?? fetch;
    const url = `${PERSONA_API}/inquiries/${encodeURIComponent(inquiryId)}`;
    const response = await doFetch(url, { method: "DELETE", headers: personaHeaders(apiKey) });
    if (response.ok) return;
    if (response.status !== 404) throw new Error(`Persona answered ${response.status} to the redaction of ${inquiryId}`);

    const check = await doFetch(url, { method: "GET", headers: personaHeaders(apiKey) });
    if (check.status === 404) return; // Persona has no such inquiry: nothing is left to redact.
    if (!check.ok) throw new Error(`Persona answered 404 to the redaction of ${inquiryId} and ${check.status} when it was fetched to confirm; not treating it as redacted`);
    if (redactedAtOf(await check.json().catch(() => null))) return; // already redacted
    const message = `Persona answered 404 to DELETE ${url} but the inquiry exists and is NOT redacted. The redact endpoint is probably wrong or the key lacks permission; the inquiry's personal data is still at Persona.`;
    console.error(`[persona-redaction] ALERT: ${message}`);
    throw new Error(message);
  };
}

export type PersonaRedactionResult = { tried: number; redacted: number; failed: number; gaveUp: number };

/**
 * Tries every pending redaction (of one member, or all). Each outcome is recorded and logged; nothing is thrown. A task that fails its
 * 10th attempt, or fails after being queued for 7 days, is marked "failed" and every admin is notified once (the status change is claimed
 * with UPDATE ... WHERE status = 'pending', so two sweeps cannot notify twice). Failed rows are not tried again.
 */
export async function runPersonaRedactions(
  redact: PersonaRedactor | undefined,
  options: { userId?: number; now?: () => Date; limit?: number; adminIds?: () => Promise<number[]> } = {},
): Promise<PersonaRedactionResult> {
  const result: PersonaRedactionResult = { tried: 0, redacted: 0, failed: 0, gaveUp: 0 };
  if (!redact) return result;
  const pending = await db.select().from(personaRedactions)
    .where(and(eq(personaRedactions.status, "pending"), ...(options.userId ? [eq(personaRedactions.userId, options.userId)] : [])))
    .orderBy(asc(personaRedactions.id)).limit(options.limit ?? 100);
  for (const task of pending) {
    result.tried++;
    const at = (options.now ?? (() => new Date()))();
    const attempt = task.attempts + 1;
    try {
      await redact(task.inquiryId);
      await db.update(personaRedactions).set({ status: "redacted", attempts: attempt, lastAttemptAt: at, redactedAt: at, lastError: null }).where(eq(personaRedactions.id, task.id));
      console.log(`[account-deletion] Persona inquiry ${task.inquiryId} redacted (user ${task.userId}, attempt ${attempt})`);
      result.redacted++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      result.failed++;
      const tooOld = at.getTime() - task.createdAt.getTime() >= PERSONA_REDACTION_MAX_AGE_MS;
      if (attempt >= PERSONA_REDACTION_MAX_ATTEMPTS || tooOld) {
        if (await giveUp(task, attempt, at, message, tooOld ? `${PERSONA_REDACTION_MAX_AGE_MS / 86_400_000} days` : `${PERSONA_REDACTION_MAX_ATTEMPTS} attempts`, options.adminIds)) result.gaveUp++;
        continue;
      }
      await db.update(personaRedactions).set({ attempts: attempt, lastAttemptAt: at, lastError: message }).where(eq(personaRedactions.id, task.id));
      console.error(`[account-deletion] could not redact Persona inquiry ${task.inquiryId} (user ${task.userId}, attempt ${attempt}); it stays pending: ${message}`);
    }
  }
  return result;
}

/** Marks the task failed and tells the admins, once. Returns whether this call did it. */
async function giveUp(task: typeof personaRedactions.$inferSelect, attempt: number, at: Date, message: string, limit: string, adminIds = adminUserIds): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [claimed] = await tx.update(personaRedactions)
      .set({ status: "failed", attempts: attempt, lastAttemptAt: at, lastError: message, failedAt: at, adminNotifiedAt: at })
      .where(and(eq(personaRedactions.id, task.id), eq(personaRedactions.status, "pending"))).returning({ id: personaRedactions.id });
    if (!claimed) return false;
    console.error(`[account-deletion] ALERT: giving up on redacting Persona inquiry ${task.inquiryId} (user ${task.userId}) after ${limit}: ${message}`);
    const admins = await adminIds();
    if (admins.length) {
      await tx.insert(notifications).values(admins.map((userId) => ({
        userId, type: PERSONA_REDACTION_FAILED_NOTIFICATION, isRead: false,
        title: "A deleted member's Persona data could not be redacted",
        message: `Persona inquiry ${task.inquiryId} (former user ${task.userId}) could not be redacted after ${limit}. Its ID images and selfie may still be at Persona: redact it in the Persona dashboard, then mark persona_redactions row ${task.id} as redacted. Last error: ${message}`,
      })) as any);
    }
    return true;
  });
}

export const pendingPersonaRedactions = (userIds?: number[]) =>
  db.select().from(personaRedactions).where(and(eq(personaRedactions.status, "pending"), ...(userIds ? [inArray(personaRedactions.userId, userIds)] : [])));
