import { and, asc, eq, inArray } from "drizzle-orm";
import { db, personaRedactions, verifications } from "@workspace/db";

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

/** The real call. Resolves when the inquiry is redacted or Persona has no such inquiry; throws (with no secrets in the message) otherwise. */
export function createPersonaRedactor(options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}): PersonaRedactor {
  return async (inquiryId) => {
    const apiKey = (options.env ?? process.env).PERSONA_API_KEY;
    if (!apiKey) throw new Error("Persona is not configured (PERSONA_API_KEY is not set)");
    const response = await (options.fetchImpl ?? fetch)(`https://api.withpersona.com/api/v1/inquiries/${encodeURIComponent(inquiryId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}`, "Persona-Version": "2023-01-05", "Key-Inflection": "camel" },
    });
    // 404: Persona has no such inquiry (already redacted or never existed): nothing is left to redact.
    if (response.ok || response.status === 404) return;
    throw new Error(`Persona answered ${response.status} to the redaction of ${inquiryId}`);
  };
}

export type PersonaRedactionResult = { tried: number; redacted: number; failed: number };

/** Tries every pending redaction (of one member, or all). Each outcome is recorded and logged; nothing is thrown. */
export async function runPersonaRedactions(
  redact: PersonaRedactor | undefined,
  options: { userId?: number; now?: () => Date; limit?: number } = {},
): Promise<PersonaRedactionResult> {
  const result: PersonaRedactionResult = { tried: 0, redacted: 0, failed: 0 };
  if (!redact) return result;
  const pending = await db.select().from(personaRedactions)
    .where(and(eq(personaRedactions.status, "pending"), ...(options.userId ? [eq(personaRedactions.userId, options.userId)] : [])))
    .orderBy(asc(personaRedactions.id)).limit(options.limit ?? 100);
  for (const task of pending) {
    result.tried++;
    const at = (options.now ?? (() => new Date()))();
    try {
      await redact(task.inquiryId);
      await db.update(personaRedactions).set({ status: "redacted", attempts: task.attempts + 1, lastAttemptAt: at, redactedAt: at, lastError: null }).where(eq(personaRedactions.id, task.id));
      console.log(`[account-deletion] Persona inquiry ${task.inquiryId} redacted (user ${task.userId}, attempt ${task.attempts + 1})`);
      result.redacted++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await db.update(personaRedactions).set({ attempts: task.attempts + 1, lastAttemptAt: at, lastError: message }).where(eq(personaRedactions.id, task.id));
      console.error(`[account-deletion] could not redact Persona inquiry ${task.inquiryId} (user ${task.userId}, attempt ${task.attempts + 1}); it stays pending: ${message}`);
      result.failed++;
    }
  }
  return result;
}

export const pendingPersonaRedactions = (userIds?: number[]) =>
  db.select().from(personaRedactions).where(and(eq(personaRedactions.status, "pending"), ...(userIds ? [inArray(personaRedactions.userId, userIds)] : [])));
