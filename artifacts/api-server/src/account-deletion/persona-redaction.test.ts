import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, notifications, personaRedactions, pool, users, verifications } from "@workspace/db";
import { hashPassword } from "../auth.js";
import {
  createPersonaClient, createPersonaRedactor, type PersonaClient, PERSONA_REDACTION_FAILED_NOTIFICATION, PERSONA_REDACTION_MAX_ATTEMPTS, PERSONA_REDACTION_MAX_AGE_MS, queuePersonaRedactions, runPersonaRedactions,
} from "./persona-redaction.js";
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
const tasks = (userId: number, kind = "inquiry") => db.select().from(personaRedactions).where(and(eq(personaRedactions.userId, userId), eq(personaRedactions.kind, kind))).orderBy(personaRedactions.id);
/** A fake Persona client: the inquiry redactor is the one under test; accounts default to none. */
const client = (redactInquiry: (id: string) => Promise<void> = async () => {}, extra: Partial<PersonaClient> = {}): PersonaClient => ({
  redactInquiry, redactAccount: async () => {}, findAccountIds: async () => [], ...extra,
});
const inq = (label: string) => `inq_${UNIQUE}_${label}`;

before(() => {});
after(async () => {
  try {
    if (userIds.length) {
      await db.delete(notifications).where(inArray(notifications.userId, userIds));
      await db.delete(personaRedactions).where(inArray(personaRedactions.userId, userIds));
      await db.delete(verifications).where(inArray(verifications.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  } finally {
    await pool.end();
  }
});

test("the redactor calls Persona's Redact an Inquiry endpoint (DELETE /api/v1/inquiries/{id}) with the server key", async () => {
  const calls: { url: string; init: any }[] = [];
  const respond = (status: number) => (async (url: any, init: any) => { calls.push({ url: String(url), init }); return new Response("{}", { status }); }) as typeof fetch;
  const env = { PERSONA_API_KEY: "persona_secret_key" };

  await createPersonaRedactor({ env, fetchImpl: respond(200) })("inq_abc");
  assert.equal(calls.length, 1, "a 200 is believed: one call");
  assert.equal(calls[0].url, "https://api.withpersona.com/api/v1/inquiries/inq_abc");
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(calls[0].init.headers.Authorization, "Bearer persona_secret_key");
  await createPersonaRedactor({ env, fetchImpl: respond(200) })("inq_a/b?x=1");
  assert.equal(calls[1].url, "https://api.withpersona.com/api/v1/inquiries/inq_a%2Fb%3Fx%3D1", "the id is encoded into the path");

  for (const status of [401, 409, 429, 500]) {
    await assert.rejects(createPersonaRedactor({ env, fetchImpl: respond(status) })("inq_x"), (e: Error) => e.message.includes(String(status)) && !e.message.includes("persona_secret_key"));
  }
  await assert.rejects(createPersonaRedactor({ env: {}, fetchImpl: respond(200) })("inq_x"), /not configured/);
  await assert.rejects(createPersonaRedactor({ env, fetchImpl: (async () => { throw new Error("socket hang up"); }) as typeof fetch })("inq_x"), /socket hang up/);
});

/** A fake Persona: DELETE answers `del`, GET answers `get` (a status, or a status with a body). */
function persona(del: number, get: number | [number, unknown]) {
  const calls: string[] = [];
  const fetchImpl = (async (url: any, init: any) => {
    calls.push(`${init.method} ${String(url).replace("https://api.withpersona.com/api/v1", "")}`);
    if (init.method === "DELETE") return new Response("{}", { status: del });
    const [status, body] = Array.isArray(get) ? get : [get, {}];
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, redact: createPersonaRedactor({ env: { PERSONA_API_KEY: "k" }, fetchImpl }) };
}

test("a 404 is checked, not believed: done only when Persona shows the inquiry redacted or says it does not exist", async () => {
  const redacted = persona(404, [200, { data: { attributes: { redactedAt: "2026-11-10T00:00:00Z" } } }]);
  await redacted.redact("inq_1");
  assert.deepEqual(redacted.calls, ["DELETE /inquiries/inq_1", "GET /inquiries/inq_1"]);

  const kebab = persona(404, [200, { data: { attributes: { "redacted-at": "2026-11-10T00:00:00Z" } } }]);
  await kebab.redact("inq_1");

  const missing = persona(404, 404);
  await missing.redact("inq_1");
  assert.deepEqual(missing.calls, ["DELETE /inquiries/inq_1", "GET /inquiries/inq_1"]);
});

test("a 404 on a live, unredacted inquiry fails loudly: the redact call did not work", async () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.join(" "));
  try {
    for (const body of [{ data: { attributes: { redactedAt: null, status: "approved" } } }, { data: { attributes: { "redacted-at": null } } }, {}]) {
      const live = persona(404, [200, body]);
      await assert.rejects(live.redact("inq_live"), /exists and is NOT redacted/);
    }
  } finally {
    console.error = original;
  }
  assert.equal(errors.filter((e) => e.includes("ALERT") && e.includes("NOT redacted")).length, 3, "each one is logged as an alert");
});

test("a 404 that cannot be confirmed is a failure, so it is retried instead of marked done", async () => {
  for (const status of [401, 429, 500]) {
    await assert.rejects(persona(404, status).redact("inq_x"), (e: Error) => e.message.includes(String(status)) && e.message.includes("not treating it as redacted"));
  }
  const network = createPersonaRedactor({ env: { PERSONA_API_KEY: "k" }, fetchImpl: (async (_u: any, init: any) => { if (init.method === "DELETE") return new Response("{}", { status: 404 }); throw new Error("socket hang up"); }) as typeof fetch });
  await assert.rejects(network("inq_x"), /socket hang up/);
});

test("deleting an account redacts each of its Persona inquiries once, logs the result, and scrubs the verification rows", async () => {
  const userId = await member([inq("a"), inq("b"), inq("b"), null]);
  const redacted: string[] = [];
  const result = await finalizeDeletion(userId, { ...baseDeps, persona: client(async (id) => void redacted.push(id)) });
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
  const down: DeletionDeps = { ...baseDeps, persona: client(async () => { throw new Error("Persona answered 503"); }) };
  const result = await finalizeDeletion(userId, down);
  assert.equal(result.deleted, true, "Persona being down does not block the deletion");
  assert.equal((await db.select().from(users).where(eq(users.id, userId)))[0].accountStatus, "deleted");
  let rows = await tasks(userId);
  assert.deepEqual(rows.map((r) => [r.status, r.attempts, r.lastError]), [["pending", 1, "Persona answered 503"], ["pending", 1, "Persona answered 503"]]);

  // Still down: another pass records another attempt.
  assert.deepEqual(await runPersonaRedactions(down.persona, { userId }), { tried: 2, redacted: 0, failed: 2, gaveUp: 0 });
  assert.deepEqual((await tasks(userId)).map((r) => r.attempts), [2, 2]);

  // Persona is back: the next live deletion sweep redacts what is pending (and only a live run does).
  const seen: string[] = [];
  const back = async (id: string) => void seen.push(id);
  await finalizeDueDeletions({ ...baseDeps, persona: client(back), dryRun: true, only: [] });
  assert.equal((await tasks(userId))[0].status, "pending", "a dry run changes nothing");
  await finalizeDueDeletions({ ...baseDeps, persona: client(back), only: [] });
  assert.ok(seen.includes(inq("down1")) && seen.includes(inq("down2")));
  rows = await tasks(userId);
  assert.deepEqual(rows.map((r) => [r.status, r.attempts, r.lastError]), [["redacted", 3, null], ["redacted", 3, null]]);

  seen.length = 0;
  assert.deepEqual(await runPersonaRedactions(client(back), { userId }), { tried: 0, redacted: 0, failed: 0, gaveUp: 0 }, "redacted ones are not tried again");
  assert.deepEqual(seen, []);
});

test("one failing inquiry does not stop the others, and without a configured client nothing is attempted and nothing breaks", async () => {
  const userId = await member([inq("ok"), inq("bad")]);
  const mixed: DeletionDeps = { ...baseDeps, persona: client(async (id) => { if (id === inq("bad")) throw new Error("Persona answered 500"); }) };
  await finalizeDeletion(userId, mixed);
  const rows = await tasks(userId);
  assert.deepEqual(rows.map((r) => [r.inquiryId.endsWith("ok") ? "ok" : "bad", r.status]).sort(), [["bad", "pending"], ["ok", "redacted"]]);

  const other = await member([inq("noclient")]);
  await finalizeDeletion(other, baseDeps);
  assert.deepEqual((await tasks(other)).map((r) => [r.status, r.attempts]), [["pending", 0]], "queued, not attempted, so a later run with a client can do it");
  assert.deepEqual(await runPersonaRedactions(undefined, { userId: other }), { tried: 0, redacted: 0, failed: 0, gaveUp: 0 });
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


// ── The retry cap: 10 attempts or 7 days, then failed, and the admins are told once ──
async function queued(label: string) {
  const userId = await member([inq(label)]);
  await db.update(users).set({ accountStatus: "deleted" }).where(eq(users.id, userId));
  await queuePersonaRedactions(db, userId);
  return userId;
}
const fails = async () => { throw new Error("Persona answered 503"); };
const noteCount = async (userId: number) => (await db.select().from(notifications).where(eq(notifications.userId, userId))).filter((n) => n.type === PERSONA_REDACTION_FAILED_NOTIFICATION).length;

test("the 10th failed attempt marks the row failed and notifies the admins once; failed rows are never tried again", async () => {
  const userId = await queued("cap-attempts");
  const admin = userId; // a real user standing in for an admin, so no admin account is created for other suites to alert
  const adminIds = async () => [admin];
  await db.update(personaRedactions).set({ attempts: PERSONA_REDACTION_MAX_ATTEMPTS - 2 }).where(eq(personaRedactions.userId, userId));

  const ninth = await runPersonaRedactions(client(fails), { userId, adminIds });
  assert.deepEqual([ninth.failed, ninth.gaveUp], [1, 0]);
  assert.deepEqual((await tasks(userId)).map((r) => [r.status, r.attempts]), [["pending", PERSONA_REDACTION_MAX_ATTEMPTS - 1]]);
  assert.equal(await noteCount(admin), 0, "not yet");

  const tenth = await runPersonaRedactions(client(fails), { userId, adminIds });
  assert.deepEqual([tenth.failed, tenth.gaveUp], [1, 1]);
  const [row] = await tasks(userId);
  assert.deepEqual([row.status, row.attempts, row.lastError], ["failed", PERSONA_REDACTION_MAX_ATTEMPTS, "Persona answered 503"]);
  assert.ok(row.failedAt && row.adminNotifiedAt);
  assert.equal(await noteCount(admin), 1);
  const [note] = (await db.select().from(notifications).where(eq(notifications.userId, admin))).filter((n) => n.type === PERSONA_REDACTION_FAILED_NOTIFICATION);
  assert.match(note.message, new RegExp(inq("cap-attempts")));
  assert.match(note.message, /Persona dashboard/);

  const calls: string[] = [];
  assert.deepEqual(await runPersonaRedactions(client(async (id) => void calls.push(id)), { userId, adminIds }), { tried: 0, redacted: 0, failed: 0, gaveUp: 0 });
  assert.deepEqual(calls, [], "a failed row is not retried");
  assert.equal(await noteCount(admin), 1, "and nobody is told twice");
});

test("a row queued for 7 days is given up on at its next failure, even with few attempts", async () => {
  const userId = await queued("cap-age");
  const now = new Date();
  await db.update(personaRedactions).set({ createdAt: new Date(now.getTime() - PERSONA_REDACTION_MAX_AGE_MS - 1000) }).where(eq(personaRedactions.userId, userId));
  const result = await runPersonaRedactions(client(fails), { userId, now: () => now, adminIds: async () => [userId] });
  assert.equal(result.gaveUp, 1);
  const [row] = await tasks(userId);
  assert.deepEqual([row.status, row.attempts], ["failed", 1]);
  assert.equal(await noteCount(userId), 1);

  const young = await queued("cap-young");
  await db.update(personaRedactions).set({ createdAt: new Date(now.getTime() - PERSONA_REDACTION_MAX_AGE_MS + 3_600_000) }).where(eq(personaRedactions.userId, young));
  assert.equal((await runPersonaRedactions(client(fails), { userId: young, now: () => now, adminIds: async () => [young] })).gaveUp, 0, "an hour short of 7 days keeps trying");
  assert.equal((await tasks(young))[0].status, "pending");
});

test("success on the last allowed attempt, or long after queueing, is still a success", async () => {
  const userId = await queued("cap-success");
  await db.update(personaRedactions).set({ attempts: PERSONA_REDACTION_MAX_ATTEMPTS - 1, createdAt: new Date(Date.now() - 30 * 86_400_000) }).where(eq(personaRedactions.userId, userId));
  const result = await runPersonaRedactions(client(async () => {}), { userId, adminIds: async () => [userId] });
  assert.deepEqual([result.redacted, result.gaveUp], [2, 0], "the inquiry, and the account lookup queued with it");
  assert.deepEqual((await tasks(userId)).map((r) => [r.status, r.attempts]), [["redacted", PERSONA_REDACTION_MAX_ATTEMPTS]]);
  assert.equal(await noteCount(userId), 0);
});

test("two sweeps giving up on the same row at once notify once", async () => {
  const userId = await queued("cap-race");
  await db.update(personaRedactions).set({ attempts: PERSONA_REDACTION_MAX_ATTEMPTS - 1 }).where(eq(personaRedactions.userId, userId));
  const adminIds = async () => [userId];
  await Promise.all([runPersonaRedactions(client(fails), { userId, adminIds }), runPersonaRedactions(client(fails), { userId, adminIds })]);
  assert.equal(await noteCount(userId), 1);
  assert.equal((await tasks(userId))[0].status, "failed");
});


// ── Persona accounts (the member's Account object: name, address, ID numbers, selfie), found by reference id user_<id> ──
const ref = (userId: number) => `user_${userId}`;
const account = (id: string, referenceId: string) => ({ id, attributes: { referenceId } });

test("findAccountIds filters by reference id, pages through the results, and never returns an account with a different reference id", async () => {
  const urls: string[] = [];
  const pages: Record<string, unknown> = {
    first: { data: [account("act_1", "user_7"), account("act_other", "user_70"), account("act_none", "")], links: { next: "/api/v1/accounts?page%5Bafter%5D=act_none" } },
    second: { data: [{ id: "act_kebab", attributes: { "reference-id": "user_7" } }, account("act_2", "user_7")], links: { next: null } },
  };
  const fetchImpl = (async (url: any, init: any) => {
    urls.push(`${init.method} ${url}`);
    return new Response(JSON.stringify(String(url).includes("after") ? pages.second : pages.first), { status: 200 });
  }) as typeof fetch;
  const found = await createPersonaClient({ env: { PERSONA_API_KEY: "k" }, fetchImpl }).findAccountIds("user_7");
  assert.deepEqual(found, ["act_1", "act_kebab", "act_2"], "only exact reference matches, from every page");
  assert.equal(urls[0], "GET https://api.withpersona.com/api/v1/accounts?filter%5Breference-id%5D=user_7&page%5Bsize%5D=100");
  assert.equal(urls[1], "GET https://api.withpersona.com/api/v1/accounts?page%5Bafter%5D=act_none");

  const failing = createPersonaClient({ env: { PERSONA_API_KEY: "k" }, fetchImpl: (async () => new Response("{}", { status: 500 })) as typeof fetch });
  await assert.rejects(failing.findAccountIds("user_7"), /500/);
  await assert.rejects(createPersonaClient({ env: {}, fetchImpl }).findAccountIds("user_7"), /not configured/);
  const garbage = createPersonaClient({ env: { PERSONA_API_KEY: "k" }, fetchImpl: (async () => new Response("not json", { status: 200 })) as typeof fetch });
  assert.deepEqual(await garbage.findAccountIds("user_7"), []);
});

test("redactAccount calls DELETE /api/v1/accounts/{id} and checks a 404 the same way as an inquiry", async () => {
  const calls: string[] = [];
  const make = (del: number, get: number | [number, unknown]) => createPersonaClient({
    env: { PERSONA_API_KEY: "k" },
    fetchImpl: (async (url: any, init: any) => {
      calls.push(`${init.method} ${String(url).replace("https://api.withpersona.com/api/v1", "")}`);
      if (init.method === "DELETE") return new Response("{}", { status: del });
      const [status, body] = Array.isArray(get) ? get : [get, {}];
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch,
  }).redactAccount;
  await make(200, 200)("act_1");
  assert.deepEqual(calls, ["DELETE /accounts/act_1"]);
  await make(404, [200, { data: { attributes: { redactedAt: "2026-11-10T00:00:00Z" } } }])("act_1");
  await make(404, 404)("act_1");
  const original = console.error;
  console.error = () => {};
  try {
    await assert.rejects(make(404, [200, { data: { attributes: { redactedAt: null } } }])("act_1"), /account exists and is NOT redacted/);
  } finally {
    console.error = original;
  }
  await assert.rejects(make(500, 200)("act_1"), /500/);
  await assert.rejects(make(404, 500)("act_1"), /not treating it as redacted/);
});

test("deleting a member who verified queues a lookup of their Persona accounts; each account found is redacted in the same run", async () => {
  const userId = await member([inq("acct")]);
  const redactedAccounts: string[] = [];
  const looked: string[] = [];
  const persona: PersonaClient = client(async () => {}, {
    findAccountIds: async (referenceId) => { looked.push(referenceId); return ["act_a", "act_b"]; },
    redactAccount: async (id) => void redactedAccounts.push(id),
  });
  await finalizeDeletion(userId, { ...baseDeps, persona });
  assert.deepEqual(looked, [ref(userId)], "looked up by the reference id create-inquiry gave Persona");
  assert.deepEqual(redactedAccounts.sort(), ["act_a", "act_b"]);
  assert.deepEqual((await tasks(userId, "account_lookup")).map((r) => [r.inquiryId, r.status]), [[ref(userId), "redacted"]]);
  assert.deepEqual((await tasks(userId, "account")).map((r) => [r.inquiryId, r.status, r.attempts]), [["act_a", "redacted", 1], ["act_b", "redacted", 1]]);
  assert.deepEqual((await tasks(userId)).map((r) => r.status), ["redacted"], "the inquiry too");
});

test("no accounts found is fine; a member who never started an inquiry has no lookup at all", async () => {
  const userId = await member([inq("noacct")]);
  await finalizeDeletion(userId, { ...baseDeps, persona: client() });
  assert.deepEqual((await tasks(userId, "account_lookup")).map((r) => r.status), ["redacted"]);
  assert.equal((await tasks(userId, "account")).length, 0);

  const never = await member([null]);
  assert.equal(await queuePersonaRedactions(db, never), 0);
  assert.equal((await tasks(never, "account_lookup")).length, 0);
});

test("a failing lookup or account redaction stays pending and is retried; accounts already queued are not queued twice", async () => {
  const userId = await member([inq("retry-acct")]);
  let lookups = 0;
  const flaky = client(async () => {}, {
    findAccountIds: async () => { if (++lookups === 1) throw new Error("Persona answered 503"); return ["act_r"]; },
    redactAccount: async () => { if (lookups < 3) { lookups++; throw new Error("Persona answered 500"); } },
  });
  await finalizeDeletion(userId, { ...baseDeps, persona: flaky });
  assert.deepEqual((await tasks(userId, "account_lookup")).map((r) => [r.status, r.attempts, r.lastError]), [["pending", 1, "Persona answered 503"]]);

  await runPersonaRedactions(flaky, { userId }); // the lookup works now; redacting act_r fails once
  assert.deepEqual((await tasks(userId, "account")).map((r) => [r.status, r.attempts, r.lastError]), [["pending", 1, "Persona answered 500"]]);
  assert.deepEqual((await tasks(userId, "account_lookup")).map((r) => r.status), ["redacted"]);

  await runPersonaRedactions(flaky, { userId });
  assert.deepEqual((await tasks(userId, "account")).map((r) => [r.status, r.attempts]), [["redacted", 2]]);
  await runPersonaRedactions(flaky, { userId });
  assert.equal((await tasks(userId, "account")).length, 1, "still one account row");
});

test("an account that cannot be redacted is capped like an inquiry: failed after 10 attempts, one notice to the admins", async () => {
  const userId = await member([inq("cap-acct")]);
  await db.update(users).set({ accountStatus: "deleted" }).where(eq(users.id, userId));
  await db.insert(personaRedactions).values({ userId, inquiryId: "act_stuck", kind: "account", attempts: PERSONA_REDACTION_MAX_ATTEMPTS - 1 });
  const stuck = client(async () => {}, { redactAccount: async () => { throw new Error("Persona answered 403"); } });
  const result = await runPersonaRedactions(stuck, { userId, adminIds: async () => [userId] });
  assert.equal(result.gaveUp, 1);
  assert.deepEqual((await tasks(userId, "account")).map((r) => [r.status, r.attempts]), [["failed", PERSONA_REDACTION_MAX_ATTEMPTS]]);
  const [note] = (await db.select().from(notifications).where(eq(notifications.userId, userId))).filter((n) => n.type === PERSONA_REDACTION_FAILED_NOTIFICATION);
  assert.match(note.message, /Persona account act_stuck/);
});
