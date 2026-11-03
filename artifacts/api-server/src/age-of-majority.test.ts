import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, pool, users } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { REGIONS, ageConfirmationRequired, ageInYears, checkAgeEligibility, regionByCode } from "./age-of-majority.js";
import { TERMS_VERSION } from "./legal-config.js";

// The minimum age is the age of majority where the person lives. The birth date answers the question and is never stored;
// the place and the date it was confirmed are. Enforced like the Terms: no writes until confirmed.

const UNIQUE = `age-${Date.now()}`;
const PASSWORD = "Agecheck!4242";
const NOW = new Date("2026-11-03T12:00:00Z");
const userIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;
const previousEnforcement = process.env.TERMS_ENFORCEMENT;
const clearLimiter = () => pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");

before(async () => {
  process.env.TERMS_ENFORCEMENT = "on";
  ({ baseUrl, close: closeServer } = await startApp());
  await clearLimiter();
});

after(async () => {
  try {
    await pool.query("DELETE FROM content_reports WHERE target_user_id IN (SELECT id FROM users WHERE username LIKE $1) OR reporter_id IN (SELECT id FROM users WHERE username LIKE $1)", [`${UNIQUE}-%`]);
    await pool.query("DELETE FROM messages WHERE sender_id IN (SELECT id FROM users WHERE username LIKE $1) OR receiver_id IN (SELECT id FROM users WHERE username LIKE $1)", [`${UNIQUE}-%`]);
    await pool.query("DELETE FROM users WHERE username LIKE $1", [`${UNIQUE}-%`]);
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await clearLimiter();
  } finally {
    if (previousEnforcement === undefined) delete process.env.TERMS_ENFORCEMENT;
    else process.env.TERMS_ENFORCEMENT = previousEnforcement;
    await closeServer?.();
    await pool.end();
  }
});

async function makeUser(label: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${label}`, password: await hashPassword(PASSWORD), emailVerified: true, termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION, ...extra })
    .returning();
  userIds.push(row.id);
  return row;
}
async function signIn(user: { username: string }) {
  await clearLimiter();
  const client = new Client(baseUrl);
  assert.equal((await client.post("/api/login", { username: user.username, password: PASSWORD })).status, 200);
  await client.fetchCsrfToken();
  return client;
}
const row = async (id: number) => (await db.select().from(users).where(eq(users.id, id)))[0];

test("the table: Canada 19 in BC NB NL NS NT NU YT and 18 elsewhere; US 18 except AL and NE 19, MS 21", () => {
  const ca19 = ["BC", "NB", "NL", "NS", "NT", "NU", "YT"];
  const ca18 = ["AB", "MB", "ON", "PE", "QC", "SK"];
  for (const code of ca19) assert.equal(regionByCode(`CA-${code}`)?.ageOfMajority, 19, code);
  for (const code of ca18) assert.equal(regionByCode(`CA-${code}`)?.ageOfMajority, 18, code);
  const us = REGIONS.filter((region) => region.country === "US");
  assert.equal(us.length, 51, "50 states and DC");
  for (const region of us) assert.equal(region.ageOfMajority, { "US-AL": 19, "US-NE": 19, "US-MS": 21 }[region.code] ?? 18, region.code);
  assert.equal(REGIONS.filter((region) => region.country === "CA").length, 13);
  assert.equal(new Set(REGIONS.map((region) => region.code)).size, REGIONS.length, "codes are unique");
  assert.equal(regionByCode("US-PR"), undefined, "territories are not offered");
});

test("age is counted in whole years, on the birthday itself, and only for real dates", () => {
  assert.equal(ageInYears("2007-11-03", NOW), 19, "birthday today");
  assert.equal(ageInYears("2007-11-04", NOW), 18, "birthday tomorrow");
  assert.equal(ageInYears("2008-02-29", NOW), 18);
  for (const bad of ["2007-02-30", "07-11-03", "2007/11/03", "", null, undefined, 20071103, "2027-01-01", "1800-01-01"]) assert.equal(ageInYears(bad, NOW), null, String(bad));
});

test("eligibility depends on the place: the same birth date passes in Ontario and fails in British Columbia and Mississippi", () => {
  const dob = "2007-06-01"; // 19 on the test date
  assert.equal(checkAgeEligibility({ dateOfBirth: dob, region: "CA-ON" }, NOW).ok, true);
  assert.equal(checkAgeEligibility({ dateOfBirth: dob, region: "CA-BC" }, NOW).ok, true);
  const young = "2008-06-01"; // 18
  assert.equal(checkAgeEligibility({ dateOfBirth: young, region: "CA-ON" }, NOW).ok, true);
  const bc = checkAgeEligibility({ dateOfBirth: young, region: "CA-BC" }, NOW);
  assert.deepEqual(bc.ok === false && bc.reason, "underage");
  assert.equal(checkAgeEligibility({ dateOfBirth: "2000-01-01", region: "US-MS" }, NOW).ok, true, "26 in Mississippi");
  assert.equal(checkAgeEligibility({ dateOfBirth: "2007-06-01", region: "US-MS" }, NOW).ok, false, "19 in Mississippi");
  assert.equal(checkAgeEligibility({ dateOfBirth: young, region: "US-AL" }, NOW).ok, false, "18 in Alabama");
  assert.deepEqual(checkAgeEligibility({ dateOfBirth: dob, region: "US-PR" }, NOW), { ok: false, reason: "unknown_region" });
  assert.deepEqual(checkAgeEligibility({ dateOfBirth: "nope", region: "CA-ON" }, NOW), { ok: false, reason: "invalid_date" });
});

test("ageConfirmationRequired: needs both the date and a known place", () => {
  assert.equal(ageConfirmationRequired({}), true);
  assert.equal(ageConfirmationRequired({ ageConfirmedAt: new Date(), ageRegion: null }), true);
  assert.equal(ageConfirmationRequired({ ageConfirmedAt: new Date(), ageRegion: "XX-ZZ" }), true);
  assert.equal(ageConfirmationRequired({ ageConfirmedAt: null, ageRegion: "CA-ON" }), true);
  assert.equal(ageConfirmationRequired({ ageConfirmedAt: new Date(), ageRegion: "CA-ON" }), false);
});

test("sign-up needs a date of birth and a place, refuses someone under the age of majority there, and stores the place but not the birth date", async () => {
  const username = `${UNIQUE}-new@example.com`;
  const base = { username, password: PASSWORD, acceptedTerms: true };
  const count = async () => (await pool.query("SELECT count(*)::int AS n FROM users WHERE username = $1", [username])).rows[0].n;

  await clearLimiter();
  const missing = await new Client(baseUrl).post("/api/register", base);
  assert.equal(missing.status, 400);
  assert.equal(((await missing.json()) as { code: string }).code, "AGE_INVALID");
  assert.equal((await new Client(baseUrl).post("/api/register", { ...base, dateOfBirth: "1990-01-01", region: "CA-XX" })).status, 400);

  const year = new Date().getUTCFullYear();
  const under = await new Client(baseUrl).post("/api/register", { ...base, dateOfBirth: `${year - 17}-01-01`, region: "CA-ON" });
  assert.equal(under.status, 403);
  const body = (await under.json()) as { code: string; minimumAge: number; message: string };
  assert.equal(body.code, "AGE_NOT_ELIGIBLE");
  assert.equal(body.minimumAge, 18);
  assert.match(body.message, /at least 18/);
  const underBc = await new Client(baseUrl).post("/api/register", { ...base, dateOfBirth: `${year - 18}-01-01`, region: "CA-BC" });
  assert.equal(underBc.status, 403, "18 is not enough in British Columbia (once the birthday has passed this year)");
  assert.equal(await count(), 0, "no account for a refusal");

  await clearLimiter();
  const before = Date.now();
  const ok = await new Client(baseUrl).post("/api/register", { ...base, dateOfBirth: "1990-05-05", region: "CA-ON" });
  assert.equal(ok.status, 201);
  const [created] = await db.select().from(users).where(eq(users.username, username));
  assert.equal(created.ageRegion, "CA-ON");
  assert.ok(created.ageConfirmedAt && created.ageConfirmedAt.getTime() >= before - 1000);
  assert.ok(!JSON.stringify(created).includes("1990-05-05"), "the birth date is stored nowhere on the account");
});

test("an existing account is asked on the same screen, cannot write until confirmed, and a refusal stores nothing", async () => {
  const legacy = await makeUser("legacy");
  const other = await makeUser("legacy-other", { ageConfirmedAt: new Date(), ageRegion: "CA-ON" });
  const client = await signIn(legacy);

  const me = (await (await client.get("/api/user")).json()) as { ageConfirmationRequired: boolean; termsAcceptanceRequired: boolean };
  assert.equal(me.ageConfirmationRequired, true);
  assert.equal(me.termsAcceptanceRequired, false);

  const refused = await client.post("/api/messages", { receiverId: other.id, content: "hello" });
  assert.equal(refused.status, 403);
  const refusedBody = (await refused.json()) as { code: string; message: string };
  assert.equal(refusedBody.code, "AGE_CONFIRMATION_REQUIRED");
  assert.doesNotMatch(refusedBody.message, /csrf|token/i);
  assert.notEqual((await client.post("/api/reports", { targetType: "user", targetId: other.id, reason: "spam" })).status, 403, "reporting is never locked");

  const year = new Date().getUTCFullYear();
  const young = await client.post("/api/account/confirm-age", { dateOfBirth: `${year - 15}-03-03`, region: "US-NY" });
  assert.equal(young.status, 403);
  assert.equal(((await young.json()) as { code: string }).code, "AGE_NOT_ELIGIBLE");
  assert.equal((await row(legacy.id)).ageConfirmedAt, null, "nothing recorded for a refusal");
  assert.equal((await client.post("/api/account/confirm-age", { dateOfBirth: "1985-03-03", region: "nowhere" })).status, 400);

  const ok = await client.post("/api/account/confirm-age", { dateOfBirth: "1985-03-03", region: "US-NY" });
  assert.equal(ok.status, 200);
  const after = await row(legacy.id);
  assert.equal(after.ageRegion, "US-NY");
  assert.ok(after.ageConfirmedAt);
  assert.equal(((await (await client.get("/api/user")).json()) as { ageConfirmationRequired: boolean }).ageConfirmationRequired, false);
  const write = await client.post("/api/messages", { receiverId: other.id, content: "hello" });
  assert.notEqual(((await write.json()) as { code?: string }).code, "AGE_CONFIRMATION_REQUIRED", "after confirmation the write reaches its route");

  const anonymous = new Client(baseUrl);
  await anonymous.fetchCsrfToken();
  assert.equal((await anonymous.post("/api/account/confirm-age", { dateOfBirth: "1985-03-03", region: "US-NY" })).status, 401);
});

test("terms are asked before age when both are missing, and the age config is public", async () => {
  const both = await makeUser("both", { termsAcceptedAt: null, termsVersion: null });
  const client = await signIn(both);
  const refused = await client.post("/api/messages", { receiverId: both.id, content: "x" });
  assert.equal(((await refused.json()) as { code: string }).code, "TERMS_ACCEPTANCE_REQUIRED");
  const config = await new Client(baseUrl).get("/api/legal/age-config");
  assert.equal(config.status, 200);
  assert.equal(((await config.json()) as { regions: unknown[] }).regions.length, REGIONS.length);
});
