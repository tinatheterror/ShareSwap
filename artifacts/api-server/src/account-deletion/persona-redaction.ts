import { and, asc, eq, inArray } from "drizzle-orm";
import { db, notifications, personaRedactions, verifications } from "@workspace/db";
import { adminUserIds } from "../platform-disputes";

/**
 * Persona keeps the ID images, the selfie and the face-match data of every inquiry, and an Account object (name, address, ID numbers,
 * birthdate, selfie photo) for the member. When an account is deleted ShareSwap asks Persona to redact both:
 *
 *   inquiry  DELETE /api/v1/inquiries/{id}   "Redact an Inquiry"  (https://docs.withpersona.com/api-reference/inquiries/redact-an-inquiry)
 *   account  DELETE /api/v1/accounts/{id}    "Redact an Account"  (https://docs.withpersona.com/api-reference/accounts/redact-an-account),
 *            which also redacts every inquiry, verification and report under it. The member's accounts are found by the reference id
 *            user_<id> that create-inquiry gives Persona: GET /api/v1/accounts?filter[reference-id]=user_<id>.
 *
 * Both are permanent. The ids are written to persona_redactions inside the deletion transaction (before the verification rows are
 * scrubbed), the first attempt runs right after the account is gone, and any that fail (Persona down, key missing) stay "pending" and are
 * retried by every live deletion sweep, up to 10 attempts or 7 days, then "failed" with one notice to the admins. Nothing here ever blocks
 * or fails a deletion.
 */

/** A redaction that keeps failing is given up on after this many attempts or this long (whichever comes first), and admins are told once. */
export const PERSONA_REDACTION_MAX_ATTEMPTS = 10;
export const PERSONA_REDACTION_MAX_AGE_MS = 7 * 24 * 3_600_000;
export const PERSONA_REDACTION_FAILED_NOTIFICATION = "admin_persona_redaction_failed";

/** The reference id create-inquiry gives Persona for this member (what ties their Account to us). */
export const personaReferenceId = (userId: number) => `user_${userId}`;

export type PersonaRedactor = (id: string) => Promise<void>;
export interface PersonaClient {
  redactInquiry: PersonaRedactor;
  redactAccount: PersonaRedactor;
  /** The ids of the Persona accounts whose reference id is exactly this one. */
  findAccountIds: (referenceId: string) => Promise<string[]>;
}

type Executor = Pick<typeof db, "select" | "insert">;

/**
 * The Persona data to erase for this member, queued. Call inside the deletion transaction, before the verification rows are scrubbed: one row
 * per inquiry id on their verification rows, plus one lookup of their Persona accounts (only if they ever started an inquiry). Returns the
 * number of inquiries queued.
 */
export async function queuePersonaRedactions(executor: Executor, userId: number): Promise<number> {
  const rows = await executor.select({ inquiryId: verifications.personaInquiryId }).from(verifications).where(eq(verifications.userId, userId));
  const ids = [...new Set(rows.map((r) => r.inquiryId).filter((id): id is string => !!id))];
  if (ids.length === 0) return 0;
  await executor.insert(personaRedactions).values([
    ...ids.map((inquiryId) => ({ userId, inquiryId, kind: "inquiry" })),
    { userId, inquiryId: personaReferenceId(userId), kind: "account_lookup" },
  ]).onConflictDoNothing();
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
const referenceIdOf = (account: any): string | null => account?.attributes?.referenceId ?? account?.attributes?.["reference-id"] ?? null;

/**
 * The real Persona calls. A redaction resolves when Persona says it is done. A 404 is NOT taken at face value (it may mean a wrong endpoint
 * rather than "gone"): the object is fetched, and the redaction counts as done only if Persona shows it redacted (`redacted-at` set) or says
 * it does not exist. If it is there and not redacted, the redact call did not work: that throws, and is logged loudly.
 */
export function createPersonaClient(options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}): PersonaClient {
  const key = () => {
    const apiKey = (options.env ?? process.env).PERSONA_API_KEY;
    if (!apiKey) throw new Error("Persona is not configured (PERSONA_API_KEY is not set)");
    return apiKey;
  };
  const doFetch = (url: string, init: RequestInit) => (options.fetchImpl ?? fetch)(url, init);

  const redact = (collection: "inquiries" | "accounts", label: string): PersonaRedactor => async (id) => {
    const apiKey = key();
    const url = `${PERSONA_API}/${collection}/${encodeURIComponent(id)}`;
    const response = await doFetch(url, { method: "DELETE", headers: personaHeaders(apiKey) });
    if (response.ok) return;
    if (response.status !== 404) throw new Error(`Persona answered ${response.status} to the redaction of ${label} ${id}`);

    const check = await doFetch(url, { method: "GET", headers: personaHeaders(apiKey) });
    if (check.status === 404) return; // Persona has no such object: nothing is left to redact.
    if (!check.ok) throw new Error(`Persona answered 404 to the redaction of ${label} ${id} and ${check.status} when it was fetched to confirm; not treating it as redacted`);
    if (redactedAtOf(await check.json().catch(() => null))) return; // already redacted
    const message = `Persona answered 404 to DELETE ${url} but the ${label} exists and is NOT redacted. The redact endpoint is probably wrong or the key lacks permission; its personal data is still at Persona.`;
    console.error(`[persona-redaction] ALERT: ${message}`);
    throw new Error(message);
  };

  return {
    redactInquiry: redact("inquiries", "inquiry"),
    redactAccount: redact("accounts", "account"),
    async findAccountIds(referenceId) {
      const apiKey = key();
      const ids: string[] = [];
      let url: string | null = `${PERSONA_API}/accounts?filter%5Breference-id%5D=${encodeURIComponent(referenceId)}&page%5Bsize%5D=100`;
      for (let page = 0; url && page < 10; page++) {
        const response: Response = await doFetch(url, { method: "GET", headers: personaHeaders(apiKey) });
        if (!response.ok) throw new Error(`Persona answered ${response.status} when listing the accounts of ${referenceId}`);
        const body: any = await response.json().catch(() => null);
        // Never trust the filter: only an account whose reference id is exactly ours is ever redacted.
        for (const account of Array.isArray(body?.data) ? body.data : []) {
          if (typeof account?.id === "string" && referenceIdOf(account) === referenceId) ids.push(account.id);
        }
        const next: string | null = body?.links?.next ?? null;
        url = next ? (next.startsWith("http") ? next : `https://api.withpersona.com${next}`) : null;
      }
      return ids;
    },
  };
}

/** Just the inquiry call (kept for callers and tests that only need it). */
export const createPersonaRedactor = (options: Parameters<typeof createPersonaClient>[0] = {}): PersonaRedactor => createPersonaClient(options).redactInquiry;

export type PersonaRedactionResult = { tried: number; redacted: number; failed: number; gaveUp: number };
type Task = typeof personaRedactions.$inferSelect;

async function performTask(client: PersonaClient, task: Task): Promise<string> {
  if (task.kind === "account_lookup") {
    const accountIds = await client.findAccountIds(task.inquiryId);
    if (accountIds.length) {
      await db.insert(personaRedactions).values(accountIds.map((id) => ({ userId: task.userId, inquiryId: id, kind: "account" }))).onConflictDoNothing();
    }
    return `looked up the accounts of ${task.inquiryId}: ${accountIds.length} found`;
  }
  if (task.kind === "account") {
    await client.redactAccount(task.inquiryId);
    return `Persona account ${task.inquiryId} redacted`;
  }
  await client.redactInquiry(task.inquiryId);
  return `Persona inquiry ${task.inquiryId} redacted`;
}

/**
 * Tries every pending task (of one member, or all). Each outcome is recorded and logged; nothing is thrown. An account lookup that finds
 * accounts queues them, and they are redacted in the same run. A task that fails its 10th attempt, or fails after being queued for 7 days,
 * is marked "failed" and every admin is notified once (the status change is claimed with UPDATE ... WHERE status = 'pending', so two sweeps
 * cannot notify twice). Failed rows are not tried again.
 */
export async function runPersonaRedactions(
  client: PersonaClient | undefined,
  options: { userId?: number; now?: () => Date; limit?: number; adminIds?: () => Promise<number[]> } = {},
): Promise<PersonaRedactionResult> {
  const result: PersonaRedactionResult = { tried: 0, redacted: 0, failed: 0, gaveUp: 0 };
  if (!client) return result;
  const queue = await db.select().from(personaRedactions)
    .where(and(eq(personaRedactions.status, "pending"), ...(options.userId ? [eq(personaRedactions.userId, options.userId)] : [])))
    .orderBy(asc(personaRedactions.id)).limit(options.limit ?? 100);
  for (let i = 0; i < queue.length; i++) {
    const task = queue[i];
    result.tried++;
    const at = (options.now ?? (() => new Date()))();
    const attempt = task.attempts + 1;
    try {
      const done = await performTask(client, task);
      await db.update(personaRedactions).set({ status: "redacted", attempts: attempt, lastAttemptAt: at, redactedAt: at, lastError: null }).where(eq(personaRedactions.id, task.id));
      console.log(`[account-deletion] ${done} (user ${task.userId}, attempt ${attempt})`);
      result.redacted++;
      if (task.kind === "account_lookup") {
        // The accounts it just queued are redacted in this run, not at the next sweep.
        const queuedNow = await db.select().from(personaRedactions)
          .where(and(eq(personaRedactions.userId, task.userId), eq(personaRedactions.kind, "account"), eq(personaRedactions.status, "pending")));
        for (const account of queuedNow) if (!queue.some((q) => q.id === account.id)) queue.push(account);
      }
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      result.failed++;
      const tooOld = at.getTime() - task.createdAt.getTime() >= PERSONA_REDACTION_MAX_AGE_MS;
      if (attempt >= PERSONA_REDACTION_MAX_ATTEMPTS || tooOld) {
        if (await giveUp(task, attempt, at, message, tooOld ? `${PERSONA_REDACTION_MAX_AGE_MS / 86_400_000} days` : `${PERSONA_REDACTION_MAX_ATTEMPTS} attempts`, options.adminIds)) result.gaveUp++;
        continue;
      }
      await db.update(personaRedactions).set({ attempts: attempt, lastAttemptAt: at, lastError: message }).where(eq(personaRedactions.id, task.id));
      console.error(`[account-deletion] could not process Persona ${task.kind} ${task.inquiryId} (user ${task.userId}, attempt ${attempt}); it stays pending: ${message}`);
    }
  }
  return result;
}

const kindLabel = (kind: string) => (kind === "account" ? "account" : kind === "account_lookup" ? "account lookup" : "inquiry");

/** Marks the task failed and tells the admins, once. Returns whether this call did it. */
async function giveUp(task: Task, attempt: number, at: Date, message: string, limit: string, adminIds = adminUserIds): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [claimed] = await tx.update(personaRedactions)
      .set({ status: "failed", attempts: attempt, lastAttemptAt: at, lastError: message, failedAt: at, adminNotifiedAt: at })
      .where(and(eq(personaRedactions.id, task.id), eq(personaRedactions.status, "pending"))).returning({ id: personaRedactions.id });
    if (!claimed) return false;
    console.error(`[account-deletion] ALERT: giving up on Persona ${kindLabel(task.kind)} ${task.inquiryId} (user ${task.userId}) after ${limit}: ${message}`);
    const admins = await adminIds();
    if (admins.length) {
      await tx.insert(notifications).values(admins.map((userId) => ({
        userId, type: PERSONA_REDACTION_FAILED_NOTIFICATION, isRead: false,
        title: "A deleted member's Persona data could not be redacted",
        message: `Persona ${kindLabel(task.kind)} ${task.inquiryId} (former user ${task.userId}) could not be processed after ${limit}. Its ID images, selfie or personal details may still be at Persona: redact it in the Persona dashboard, then mark persona_redactions row ${task.id} as redacted. Last error: ${message}`,
      })) as any);
    }
    return true;
  });
}

export const pendingPersonaRedactions = (userIds?: number[]) =>
  db.select().from(personaRedactions).where(and(eq(personaRedactions.status, "pending"), ...(userIds ? [inArray(personaRedactions.userId, userIds)] : [])));
