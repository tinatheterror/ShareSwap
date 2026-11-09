import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, items, notifications, pool, reputationActivities, shareCoinsTransactions, users, verifications } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { getIdVerificationSummary, getVerificationForUser } from "./verification.js";

const unique = `id-verification-${Date.now()}`;
const PASSWORD = "IdVerification!42";
let server: Awaited<ReturnType<typeof startApp>>;
const ids: Record<string, number> = {};
const clients: Record<string, Client> = {};
const itemIds: number[] = [];

before(async () => {
  const password = await hashPassword(PASSWORD);
  // idOnly: approved ID, no card. both: approved ID and a card. none: nothing. retry: approved, then started again (a later pending row).
  const names = ["idonly", "both", "none", "retry", "viewer"];
  const created = await db.insert(users).values(names.map((n) => ({ username: `${unique}-${n}`, password, emailVerified: true }))).returning();
  names.forEach((n, i) => (ids[n] = created[i].id));
  await db.update(users).set({ stripePaymentMethodId: "pm_test_card", isVerified: true, idVerified: true }).where(eq(users.id, ids.both));
  await db.update(users).set({ idVerified: true }).where(inArray(users.id, [ids.idonly, ids.retry]));
  await db.insert(verifications).values([
    { userId: ids.idonly, fullName: "Ida Only", idNumber: "PERSONA_VERIFIED", status: "approved" },
    { userId: ids.both, fullName: "Bo Both", idNumber: "PERSONA_VERIFIED", status: "approved" },
    { userId: ids.retry, fullName: "Rita Retry", idNumber: "PERSONA_VERIFIED", status: "approved", createdAt: new Date(Date.now() - 86_400_000) },
    { userId: ids.retry, status: "pending", idNumber: "x", personaStatus: "completed" },
  ] as any);
  for (const n of ["idonly", "both"]) {
    const [item] = await db.insert(items).values({ ownerId: ids[n], name: `${unique}-${n}`, description: "d", conditionRating: 5, photos: [], shareCoinsReward: "0" }).returning();
    itemIds.push(item.id);
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
    await db.delete(notifications).where(inArray(notifications.userId, all));
    await db.delete(reputationActivities).where(inArray(reputationActivities.userId, all));
    await db.delete(shareCoinsTransactions).where(inArray(shareCoinsTransactions.userId, all));
    await db.delete(items).where(inArray(items.id, itemIds));
    await db.delete(verifications).where(inArray(verifications.userId, all));
    await db.delete(users).where(inArray(users.id, all));
  } finally {
    await server.close();
    await pool.end();
  }
});

test("the ID verified badge follows an approved ID, with or without a card; isVerified (ID and card) is unchanged", async () => {
  const profile = async (who: string) => ((await (await clients.viewer.get(`/api/users/${ids[who]}/public-profile`)).json()) as any);
  const idOnly = await profile("idonly");
  assert.equal(idOnly.idVerified ?? idOnly.user?.idVerified, true, "approved ID, no card: badge shown");
  assert.equal(idOnly.isVerified ?? idOnly.user?.isVerified, false, "...but not ID + card");
  const both = await profile("both");
  assert.deepEqual([both.idVerified ?? both.user?.idVerified, both.isVerified ?? both.user?.isVerified], [true, true]);
  const none = await profile("none");
  assert.deepEqual([none.idVerified ?? none.user?.idVerified, none.isVerified ?? none.user?.isVerified], [false, false]);

  const item = (await (await clients.viewer.get(`/api/items/${itemIds[0]}`)).json()) as any;
  assert.deepEqual([item.owner?.idVerified ?? item.idVerified, item.owner?.isVerified ?? item.isVerified], [true, false], "listing owner");
});

test("gating still needs ID and a card: an ID-only member can list but not borrow or rent", async () => {
  const idOnly = await getVerificationForUser(ids.idonly);
  assert.deepEqual([idOnly.idVerified, idOnly.paymentVerified, idOnly.canBorrow, idOnly.canRent, idOnly.canList], [true, false, false, false, true]);
  const both = await getVerificationForUser(ids.both);
  assert.deepEqual([both.canBorrow, both.canRent], [true, true]);
  const me = (await (await clients.idonly.get("/api/user")).json()) as any;
  assert.deepEqual([me.idVerified, me.isVerified, me.canBorrow], [true, false, false]);
});

test("an approved Persona inquiry sets idVerified at once, even with no card, and leaves isVerified for the card", async () => {
  process.env.PERSONA_API_KEY = "persona_test_key";
  await db.delete(verifications).where(eq(verifications.userId, ids.none));
  await db.insert(verifications).values({ userId: ids.none, status: "pending", idNumber: "x", personaInquiryId: "inq_test_1", personaStatus: "created" } as any);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    if (url.includes("api.withpersona.com")) return new Response(JSON.stringify({ data: { attributes: { status: "approved", nameFirst: "Nia", nameLast: "None" } } }), { status: 200, headers: { "content-type": "application/json" } });
    return realFetch(input, init);
  }) as typeof fetch;
  try {
    const res = await clients.none.post("/api/persona/inquiry-complete", { inquiryId: "inq_test_1" });
    assert.equal(res.status, 200);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.PERSONA_API_KEY;
  }
  const [row] = await db.select({ idVerified: users.idVerified, isVerified: users.isVerified }).from(users).where(eq(users.id, ids.none));
  assert.deepEqual([row.idVerified, row.isVerified], [true, false]);
  const profile = (await (await clients.viewer.get(`/api/users/${ids.none}/public-profile`)).json()) as any;
  assert.equal(profile.idVerified ?? profile.user?.idVerified, true);
});
