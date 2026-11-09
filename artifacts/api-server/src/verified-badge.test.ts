import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, notifications, userAchievements, pool, reputationActivities, shareCoinsTransactions, users, verifications } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";

// The Verified badge is users.isVerified: an approved ID AND a card on file.
const unique = `verified-badge-${Date.now()}`;
const PASSWORD = "VerifiedBadge!42";
let server: Awaited<ReturnType<typeof startApp>>;
const ids: Record<string, number> = {};
const clients: Record<string, Client> = {};

before(async () => {
  const password = await hashPassword(PASSWORD);
  const names = ["nocard", "withcard", "viewer"];
  const created = await db.insert(users).values(names.map((n) => ({ username: `${unique}-${n}`, password, emailVerified: true }))).returning();
  names.forEach((n, i) => (ids[n] = created[i].id));
  await db.update(users).set({ stripePaymentMethodId: "pm_test_card" }).where(eq(users.id, ids.withcard));
  for (const n of ["nocard", "withcard"]) {
    await db.insert(verifications).values({ userId: ids[n], status: "pending", idNumber: "x", personaInquiryId: `inq_${unique}_${n}`, personaStatus: "created" } as any);
  }
  server = await startApp();
  for (const n of names) {
    const c = new Client(server.baseUrl);
    assert.equal((await c.post("/api/login", { username: `${unique}-${n}`, password: PASSWORD })).status, 200);
    await c.fetchCsrfToken();
    clients[n] = c;
  }
});

after(async () => {
  try {
    const all = Object.values(ids);
    await db.delete(userAchievements).where(inArray(userAchievements.userId, all));
    await db.delete(notifications).where(inArray(notifications.userId, all));
    await db.delete(reputationActivities).where(inArray(reputationActivities.userId, all));
    await db.delete(shareCoinsTransactions).where(inArray(shareCoinsTransactions.userId, all));
    await db.delete(verifications).where(inArray(verifications.userId, all));
    await db.delete(users).where(inArray(users.id, all));
  } finally {
    await server.close();
    await pool.end();
  }
});

async function approveWithPersona(who: string) {
  process.env.PERSONA_API_KEY = "persona_test_key";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    if (url.includes("api.withpersona.com")) return new Response(JSON.stringify({ data: { attributes: { status: "approved", nameFirst: "Test", nameLast: who } } }), { status: 200, headers: { "content-type": "application/json" } });
    return realFetch(input, init);
  }) as typeof fetch;
  try {
    assert.equal((await clients[who].post("/api/persona/inquiry-complete", { inquiryId: `inq_${unique}_${who}` })).status, 200);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.PERSONA_API_KEY;
  }
}
const badge = async (who: string) => {
  const body = (await (await clients.viewer.get(`/api/users/${ids[who]}/public-profile`)).json()) as any;
  return body.isVerified ?? body.user?.isVerified;
};

test("an approved ID without a card gets no badge: isVerified stays false and the public profile shows none", async () => {
  await approveWithPersona("nocard");
  const [row] = await db.select({ isVerified: users.isVerified }).from(users).where(eq(users.id, ids.nocard));
  assert.equal(row.isVerified, false);
  assert.equal(await badge("nocard"), false);
  const status = (await (await clients.nocard.get("/api/verification-status")).json()) as any;
  assert.equal(status.status, "verified", "the ID itself is approved");
  const me = (await (await clients.nocard.get("/api/user")).json()) as any;
  assert.deepEqual([me.isVerified, me.canBorrow, me.canRent], [false, false, false]);
});

test("an approved ID with a card on file gets the badge, and can borrow and rent", async () => {
  await approveWithPersona("withcard");
  const [row] = await db.select({ isVerified: users.isVerified }).from(users).where(eq(users.id, ids.withcard));
  assert.equal(row.isVerified, true);
  assert.equal(await badge("withcard"), true);
  const me = (await (await clients.withcard.get("/api/user")).json()) as any;
  assert.deepEqual([me.isVerified, me.canBorrow, me.canRent], [true, true, true]);
});
