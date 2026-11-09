import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, personaRedactions, pool, users, verifications } from "@workspace/db";
import { hashPassword } from "../auth.js";
import { createPersonaRedactor, queuePersonaRedactions, runPersonaRedactions } from "./persona-redaction.js";
import { finalizeDeletion, finalizeDueDeletions, type DeletionDeps } from "./service.js";

const UNIQUE = `persona-redaction-${Date.now()}`;
const userIds: number[] = [];
let counter = 0;
const baseDeps: DeletionDeps = { stripeCleanup: async () => {}, sendDeletedEmail: async () => {}, removeUpload: async () => {} };

async function member(inquiryIds: (string | null)[]) {
  const n = ++counter;
  const [user] = await db.insert(users).values({ username: `${UNIQUE}-${n}@example.com`, password: await hashPassword("Redact!42"), emailVerified: true, handle: `${UNIQUE}h${n}`, referralCode: `${UNIQUE}r${n}` }).returning();
  userIds.push(user.id);
  for (const id of inquiryIds) await db.insert(verifications).values({ userId: user.id, status: "approved", fullName: "Ada Lovelace", idNumber: "PERSONA_VERIFIED", personaInquiryId: id, personaStatus: "approved" });
  await db.update(users).set({ accountStatus: "pending_deletion", deletionRequestedAt: new Date(Date.now() - 20 * 24 * 3_600_000) }).where(eq(users.id, user.id));
  return user.id;
}
const tasks = (userId: number) => db.select().from(personaRedactions).where(eq(personaRedactions.userId, userId)).orderBy(personaRedactions.id);
const inq = (label: string) => `inq_${UNIQUE}_${label}`;

before(() => {});
after(async () => {
  try {
    if (userIds.length) {
      await db.delete(personaRedactions).where(inArray(personaRedactions.userId, userIds));
      await db.delete(verifications).where(inArray(verifications.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  } finally {
    await pool.end();
  }
});

test("the redactor calls Persona's Redact an Inquiry endpoint (DELETE /api/v1/inquiries/{id}) with the server key, and treats 404 as already gone", async () => {
  const calls: { url: string; init: any }[] = [];
  const respond = (status: number) => (async (url: any, init: any) => { calls.push({ url: String(url), init }); return new Response("{}", { status }); }) as typeof fetch;
  const env = { PERSONA_API_KEY: "persona_secret_key" };

  await createPersonaRedactor({ env, fetchImpl: respond(200) })("inq_abc");
  assert.equal(calls[0].url, "https://api.withpersona.com/api/v1/inquiries/inq_abc");
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(calls[0].init.headers.Authorization, "Bearer persona_secret_key");
  await createPersonaRedactor({ env, fetchImpl: respond(404) })("inq_gone");
  await createPersonaRedactor({ env, fetchImpl: respond(200) })("inq_a/b?x=1");
  assert.equal(calls[2].url, "https://api.withpersona.com/api/v1/inquiries/inq_a%2Fb%3Fx%3D1", "the id is encoded into the path");

  for (const status of [401, 409, 429, 500]) {
    await assert.rejects(createPersonaRedactor({ env, fetchImpl: respond(status) })("inq_x"), (e: Error) => e.message.includes(String(status)) && !e.message.includes("persona_secret_key"));
  }
  await assert.rejects(createPersonaRedactor({ env: {}, fetchImpl: respond(200) })("inq_x"), /not configured/);
  await assert.rejects(createPersonaRedactor({ env, fetchImpl: (async () => { throw new Error("socket hang up"); }) as typeof fetch })("inq_x"), /socket hang up/);
});

test("deleting an account redacts each of its Persona inquiries once, logs the result, and scrubs the verification rows", async () => {
  const userId = await member([inq("a"), inq("b"), inq("b"), null]);
  const redacted: string[] = [];
  const result = await finalizeDeletion(userId, { ...baseDeps, redactPersonaInquiry: async (id) => void redacted.push(id) });
  assert.equal(result.deleted, true);
  assert.deepEqual(redacted.sort(), [inq("a"), inq("b")], "each distinct inquiry, none for a row without one");
  const rows = await tasks(userId);
  assert.deepEqual(rows.map((r) => [r.status, r.attempts, r.lastError]), [["redacted", 1, null], ["redacted", 1, null]]);
  assert.ok(rows.every((r) => r.redactedAt && r.lastAttemptAt));
  const remaining = await db.select().from(verifications).where(eq(verifications.userId, userId));
  assert.ok(remaining.every((v) => v.personaInquiryId === null && v.fullName === null), "our copy of the inquiry id and the name is gone");
});

test("when Persona is down the deletion still completes, the inquiries stay pending with the error, and a later sweep finishes them", async () => {
  const userId = await member([inq("down1"), inq("down2")]);
  const down: DeletionDeps = { ...baseDeps, redactPersonaInquiry: async () => { throw new Error("Persona answered 503"); } };
  const result = await finalizeDeletion(userId, down);
  assert.equal(result.deleted, true, "Persona being down does not block the deletion");
  assert.equal((await db.select().from(users).where(eq(users.id, userId)))[0].accountStatus, "deleted");
  let rows = await tasks(userId);
  assert.deepEqual(rows.map((r) => [r.status, r.attempts, r.lastError]), [["pending", 1, "Persona answered 503"], ["pending", 1, "Persona answered 503"]]);

  // Still down: another pass records another attempt.
  assert.deepEqual(await runPersonaRedactions(down.redactPersonaInquiry, { userId }), { tried: 2, redacted: 0, failed: 2 });
  assert.deepEqual((await tasks(userId)).map((r) => r.attempts), [2, 2]);

  // Persona is back: the next live deletion sweep redacts what is pending (and only a live run does).
  const seen: string[] = [];
  const back = async (id: string) => void seen.push(id);
  await finalizeDueDeletions({ ...baseDeps, redactPersonaInquiry: back, dryRun: true, only: [] });
  assert.equal((await tasks(userId))[0].status, "pending", "a dry run changes nothing");
  await finalizeDueDeletions({ ...baseDeps, redactPersonaInquiry: back, only: [] });
  assert.ok(seen.includes(inq("down1")) && seen.includes(inq("down2")));
  rows = await tasks(userId);
  assert.deepEqual(rows.map((r) => [r.status, r.attempts, r.lastError]), [["redacted", 3, null], ["redacted", 3, null]]);

  seen.length = 0;
  assert.deepEqual(await runPersonaRedactions(back, { userId }), { tried: 0, redacted: 0, failed: 0 }, "redacted ones are not tried again");
  assert.deepEqual(seen, []);
});

test("one failing inquiry does not stop the others, and without a configured client nothing is attempted and nothing breaks", async () => {
  const userId = await member([inq("ok"), inq("bad")]);
  const mixed: DeletionDeps = { ...baseDeps, redactPersonaInquiry: async (id) => { if (id === inq("bad")) throw new Error("Persona answered 500"); } };
  await finalizeDeletion(userId, mixed);
  const rows = await tasks(userId);
  assert.deepEqual(rows.map((r) => [r.inquiryId.endsWith("ok") ? "ok" : "bad", r.status]).sort(), [["bad", "pending"], ["ok", "redacted"]]);

  const other = await member([inq("noclient")]);
  await finalizeDeletion(other, baseDeps);
  assert.deepEqual((await tasks(other)).map((r) => [r.status, r.attempts]), [["pending", 0]], "queued, not attempted, so a later run with a client can do it");
  assert.deepEqual(await runPersonaRedactions(undefined, { userId: other }), { tried: 0, redacted: 0, failed: 0 });
});

test("queueing is repeatable: the same inquiry is never queued twice, and a member with no inquiries queues nothing", async () => {
  const userId = await member([inq("dup")]);
  assert.equal(await queuePersonaRedactions(db, userId), 1);
  assert.equal(await queuePersonaRedactions(db, userId), 1, "asked again, still one row");
  assert.equal((await tasks(userId)).length, 1);
  const none = await member([null]);
  assert.equal(await queuePersonaRedactions(db, none), 0);
  assert.equal((await tasks(none)).length, 0);
});
