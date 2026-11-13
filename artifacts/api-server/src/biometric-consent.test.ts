import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { biometricConsents, db, pool, users, verifications } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { DELETION_GRACE_DAYS } from "./account-deletion/retention.js";
import {
  BIOMETRIC_CHECKBOX_LABEL, BIOMETRIC_CONSENT_REQUIRED_CODE, BIOMETRIC_CONSENT_VERSION, BIOMETRIC_NOTICE, BIOMETRIC_POLICY_HEADING, BIOMETRIC_POLICY_PATH,
} from "./biometric-consent.js";

const unique = `biometric-consent-${Date.now()}`;
const PASSWORD = "BiometricConsent!42";
let server: Awaited<ReturnType<typeof startApp>>;
let userId: number;
let client: Client;

before(async () => {
  const [user] = await db.insert(users).values({ username: unique, password: await hashPassword(PASSWORD), emailVerified: true }).returning();
  userId = user.id;
  server = await startApp();
  client = new Client(server.baseUrl);
  assert.equal((await client.post("/api/login", { username: unique, password: PASSWORD })).status, 200);
  await client.fetchCsrfToken();
});

after(async () => {
  try {
    await db.delete(biometricConsents).where(eq(biometricConsents.userId, userId));
    await db.delete(verifications).where(eq(verifications.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  } finally {
    await server.close();
    await pool.end();
  }
});

/** Runs fn with Persona's API stubbed; returns what the server asked Persona for. */
async function withPersona<T>(fn: () => Promise<T>): Promise<{ result: T; calls: string[] }> {
  process.env.PERSONA_API_KEY = "persona_test_key";
  process.env.PERSONA_TEMPLATE_ID = "itmpl_test";
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    if (url.includes("api.withpersona.com")) {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(JSON.stringify({ data: { id: "inq_biometric_test" } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  try {
    return { result: await fn(), calls };
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.PERSONA_API_KEY;
    delete process.env.PERSONA_TEMPLATE_ID;
  }
}

test("create-inquiry refuses without consent: no Persona call, no verification row", async () => {
  const { result: res, calls } = await withPersona(() => client.post("/api/persona/create-inquiry"));
  assert.equal(res.status, 403);
  const body = (await res.json()) as { code: string; message: string };
  assert.equal(body.code, BIOMETRIC_CONSENT_REQUIRED_CODE);
  assert.doesNotMatch(body.message, /csrf|token/i, "both apps retry a 403 that mentions either");
  assert.deepEqual(calls, []);
  assert.equal((await db.select().from(verifications).where(eq(verifications.userId, userId))).length, 0);
});

test("the consent endpoint shows the wording, needs the box ticked and the current version, and records user, time and version", async () => {
  assert.equal((await new Client(server.baseUrl).get("/api/biometric-consent")).status, 401);
  const before = (await (await client.get("/api/biometric-consent")).json()) as any;
  assert.deepEqual([before.consented, before.version, before.notice, before.checkboxLabel, before.policyPath], [false, BIOMETRIC_CONSENT_VERSION, BIOMETRIC_NOTICE, BIOMETRIC_CHECKBOX_LABEL, BIOMETRIC_POLICY_PATH]);

  assert.equal((await client.post("/api/biometric-consent", { version: BIOMETRIC_CONSENT_VERSION })).status, 400, "box not ticked");
  assert.equal((await client.post("/api/biometric-consent", { version: BIOMETRIC_CONSENT_VERSION, agreed: "true" })).status, 400, "only a real true counts");
  assert.equal((await client.post("/api/biometric-consent", { version: "1999-01-01", agreed: true })).status, 409, "the wording they saw is out of date");
  assert.equal((await db.select().from(biometricConsents).where(eq(biometricConsents.userId, userId))).length, 0);

  const nocsrf = new Client(server.baseUrl);
  await nocsrf.post("/api/login", { username: unique, password: PASSWORD });
  assert.equal((await nocsrf.post("/api/biometric-consent", { version: BIOMETRIC_CONSENT_VERSION, agreed: true })).status, 403, "a cross-site post is refused");

  const t0 = Date.now();
  const res = await client.post("/api/biometric-consent", { version: BIOMETRIC_CONSENT_VERSION, agreed: true });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as any).consented, true);
  const [row] = await db.select().from(biometricConsents).where(eq(biometricConsents.userId, userId));
  assert.deepEqual([row.userId, row.version], [userId, BIOMETRIC_CONSENT_VERSION]);
  assert.ok(row.consentedAt.getTime() >= t0 - 2000 && row.consentedAt.getTime() <= Date.now() + 2000);
  assert.equal(((await (await client.get("/api/biometric-consent")).json()) as any).consented, true);
});

test("with consent at the current version create-inquiry goes to Persona; an older version is refused again", async () => {
  const ok = await withPersona(() => client.post("/api/persona/create-inquiry"));
  assert.equal(ok.result.status, 200);
  assert.equal(((await ok.result.json()) as any).inquiryId, "inq_biometric_test");
  assert.equal(ok.calls.length, 1, "Persona was asked for one inquiry");
  assert.equal((await db.select().from(verifications).where(eq(verifications.userId, userId))).length, 1);

  await db.update(biometricConsents).set({ version: "2000-01-01" }).where(eq(biometricConsents.userId, userId));
  const stale = await withPersona(() => client.post("/api/persona/create-inquiry"));
  assert.equal(stale.result.status, 403, "consent to older wording does not count");
  assert.deepEqual(stale.calls, []);
  assert.equal(((await (await client.get("/api/biometric-consent")).json()) as any).consented, false);
});

test("the wording cannot change without a new version, and the Privacy Policy has the section the notice links to", () => {
  const fingerprint = createHash("sha256").update(`${BIOMETRIC_NOTICE}\n${BIOMETRIC_CHECKBOX_LABEL}`).digest("hex").slice(0, 16);
  assert.equal(
    `${BIOMETRIC_CONSENT_VERSION}:${fingerprint}`, "2026-11-13.1:798574708a470f88",
    "The consent wording changed: bump BIOMETRIC_CONSENT_VERSION (so everyone is asked again) and update this line.",
  );
  assert.match(BIOMETRIC_NOTICE, /Persona/);
  assert.match(BIOMETRIC_NOTICE, /ID/);
  assert.match(BIOMETRIC_NOTICE, /selfie/);
  assert.match(BIOMETRIC_NOTICE, /only the result and your name/);
  // The purposes and the deletion schedule, in step with the Privacy Policy.
  assert.match(BIOMETRIC_NOTICE, /verify your identity/);
  assert.match(BIOMETRIC_NOTICE, /detect fraud/);
  assert.match(BIOMETRIC_NOTICE, /improve its own service/);
  assert.match(BIOMETRIC_NOTICE, /ID images, selfie and other personal data 30 days after your verification is decided, keeping only the decision/);
  assert.match(BIOMETRIC_NOTICE, /If you delete your account, we ask Persona to delete them once the deletion completes: after a 14-day grace period, or sooner if you delete immediately/);
  assert.doesNotMatch(BIOMETRIC_NOTICE, /straight away|sooner if you close/, "Persona is asked when the deletion is completed, not when it is requested");
  assert.equal(DELETION_GRACE_DAYS, 14, "the policy and the notice say 14 days");
  assert.equal(BIOMETRIC_CHECKBOX_LABEL, "I agree to ShareSwap and Persona collecting and using my ID and face data to verify my identity, detect fraud and improve Persona's service.");
  assert.notEqual(BIOMETRIC_CONSENT_VERSION, "2026-11-10.1", "the wording changed, so everyone who agreed to the earlier text is asked again");

  const policy = readFileSync(new URL("../../../docs/legal/privacy-policy.md", import.meta.url), "utf8");
  assert.ok(policy.split("\n").includes(`## ${BIOMETRIC_POLICY_HEADING}`), "the policy has the heading the notice links to");
  const slug = BIOMETRIC_POLICY_HEADING.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  assert.equal(BIOMETRIC_POLICY_PATH, `/privacy#${slug}`);
  const section = policy.slice(policy.indexOf(`## ${BIOMETRIC_POLICY_HEADING}`)).split("\n## ")[0];
  for (const needle of [/Persona/, /selfie/, /face/i, /tick a box/, /version/]) assert.match(section, needle);
  for (const needle of [/ID images, selfie and other personal data 30 days after your verification is decided \(whether it was approved, declined or failed, or expired\), keeping only the decision/, /after the 14-day grace period, or sooner if you choose to delete your account immediately/, /detect fraud/, /improve its service/]) assert.match(section, needle, "the policy says what the notice says");
});
