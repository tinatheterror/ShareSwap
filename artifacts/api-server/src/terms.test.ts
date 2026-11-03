import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import passport from "passport";
import { db, pool, users } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { DEFAULT_SUPPORT_EMAIL, TERMS_VERSION, supportEmail, termsAcceptanceRequired } from "./legal-config.js";

// Creating an account means accepting the Terms and Community Guidelines. The server records when and which version, and
// anyone who has not accepted the current text (older accounts, new Google sign-ins) is told so and can accept.

const UNIQUE = `terms-${Date.now()}`;
const PASSWORD = "Terms!4242";
const userIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;
const previousGoogle = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };

const clearLimiter = () => pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");

const previousEnforcement = process.env.TERMS_ENFORCEMENT;

before(async () => {
  process.env.TERMS_ENFORCEMENT = "on"; // the test script turns it off for the suites that sign in users who never accepted
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  ({ baseUrl, close: closeServer } = await startApp());
  await clearLimiter();
});

after(async () => {
  try {
    await pool.query("DELETE FROM content_reports WHERE target_user_id IN (SELECT id FROM users WHERE username LIKE $1) OR reporter_id IN (SELECT id FROM users WHERE username LIKE $1)", [`${UNIQUE}-%`]);
    await pool.query("DELETE FROM user_blocks WHERE blocker_id IN (SELECT id FROM users WHERE username LIKE $1) OR blocked_id IN (SELECT id FROM users WHERE username LIKE $1)", [`${UNIQUE}-%`]);
    await pool.query("DELETE FROM users WHERE username LIKE $1", [`${UNIQUE}-%`]);
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await clearLimiter();
  } finally {
    for (const [name, value] of [["GOOGLE_CLIENT_ID", previousGoogle.id], ["GOOGLE_CLIENT_SECRET", previousGoogle.secret]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (previousEnforcement === undefined) delete process.env.TERMS_ENFORCEMENT;
    else process.env.TERMS_ENFORCEMENT = previousEnforcement;
    await closeServer?.();
    await pool.end();
  }
});

async function makeUser(label: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${label}`, password: await hashPassword(PASSWORD), emailVerified: true, ageConfirmedAt: new Date(), ageRegion: "CA-ON", ...extra })
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

test("the pure rules: acceptance is required until the current version is accepted", () => {
  assert.equal(termsAcceptanceRequired({}), true);
  assert.equal(termsAcceptanceRequired({ termsAcceptedAt: new Date(), termsVersion: null }), true);
  assert.equal(termsAcceptanceRequired({ termsAcceptedAt: new Date(), termsVersion: "2020-01-01" }), true);
  assert.equal(termsAcceptanceRequired({ termsAcceptedAt: null, termsVersion: TERMS_VERSION }), true);
  assert.equal(termsAcceptanceRequired({ termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION }), false);
});

test("the support address comes from configuration, falls back to the default, and ignores nonsense", () => {
  assert.equal(supportEmail({} as NodeJS.ProcessEnv), DEFAULT_SUPPORT_EMAIL);
  assert.equal(DEFAULT_SUPPORT_EMAIL, "support@shareswap.app");
  assert.equal(supportEmail({ SUPPORT_EMAIL: " help@example.org " } as NodeJS.ProcessEnv), "help@example.org");
  for (const bad of ["", "   ", "not an address", "a@b c"]) assert.equal(supportEmail({ SUPPORT_EMAIL: bad } as NodeJS.ProcessEnv), DEFAULT_SUPPORT_EMAIL, bad);
});

test("sign-up needs the box ticked, and records when and which version", async () => {
  const username = `${UNIQUE}-new@example.com`;
  await clearLimiter();
  for (const acceptedTerms of [undefined, false, "true", 1, null]) {
    const response = await new Client(baseUrl).post("/api/register", { username, password: PASSWORD, acceptedTerms, dateOfBirth: "1990-05-05", region: "CA-ON" });
    assert.equal(response.status, 400, String(acceptedTerms));
    assert.equal(((await response.json()) as { code: string }).code, "TERMS_REQUIRED");
  }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM users WHERE username = $1", [username])).rows[0].n, 0, "no account without acceptance");

  await clearLimiter();
  const before = Date.now();
  const ok = await new Client(baseUrl).post("/api/register", { username, password: PASSWORD, acceptedTerms: true, dateOfBirth: "1990-05-05", region: "CA-ON" });
  assert.equal(ok.status, 201);
  const [created] = await db.select().from(users).where(eq(users.username, username));
  assert.equal(created.termsVersion, TERMS_VERSION);
  assert.ok(created.termsAcceptedAt && created.termsAcceptedAt.getTime() >= before - 1000);
});

test("/api/user says whether the current text still has to be accepted, and the public config names the version and the support address", async () => {
  const accepted = await makeUser("accepted", { termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION });
  const legacy = await makeUser("legacy");
  const stale = await makeUser("stale", { termsAcceptedAt: new Date("2025-01-01"), termsVersion: "2025-01-01" });

  const meOf = async (u: { username: string }) => (await (await (await signIn(u)).get("/api/user")).json()) as { termsAcceptanceRequired: boolean; currentTermsVersion: string; supportEmail: string };
  assert.equal((await meOf(accepted)).termsAcceptanceRequired, false);
  const legacyMe = await meOf(legacy);
  assert.equal(legacyMe.termsAcceptanceRequired, true);
  assert.equal(legacyMe.currentTermsVersion, TERMS_VERSION);
  assert.equal(legacyMe.supportEmail, "support@shareswap.app");
  assert.equal((await meOf(stale)).termsAcceptanceRequired, true);

  const config = await new Client(baseUrl).get("/api/legal/config");
  assert.equal(config.status, 200);
  assert.deepEqual(await config.json(), { termsVersion: TERMS_VERSION, supportEmail: "support@shareswap.app" });
});

test("an existing account accepts the current text once; an old or missing version is refused; it needs a sign-in", async () => {
  const legacy = await makeUser("accept");
  const client = await signIn(legacy);

  assert.equal((await client.post("/api/account/accept-terms", {})).status, 409);
  const stale = await client.post("/api/account/accept-terms", { version: "2020-01-01" });
  assert.equal(stale.status, 409);
  assert.deepEqual(((await stale.json()) as { currentVersion: string; code: string }), { code: "TERMS_VERSION_CHANGED", message: "The Terms were updated. Please read the latest version and accept again.", currentVersion: TERMS_VERSION } as never);
  assert.equal((await row(legacy.id)).termsAcceptedAt, null, "nothing recorded for a refused acceptance");

  const accepted = await client.post("/api/account/accept-terms", { version: TERMS_VERSION });
  assert.equal(accepted.status, 200);
  assert.equal(((await accepted.json()) as { termsAcceptanceRequired: boolean }).termsAcceptanceRequired, false);
  const after = await row(legacy.id);
  assert.equal(after.termsVersion, TERMS_VERSION);
  assert.ok(after.termsAcceptedAt);
  assert.equal(((await (await client.get("/api/user")).json()) as { termsAcceptanceRequired: boolean }).termsAcceptanceRequired, false);
  assert.equal((await client.post("/api/account/accept-terms", { version: TERMS_VERSION })).status, 200, "accepting twice is fine");

  const anonymous = new Client(baseUrl);
  await anonymous.fetchCsrfToken();
  assert.equal((await anonymous.post("/api/account/accept-terms", { version: TERMS_VERSION })).status, 401);
});

test("a new Google sign-in has not accepted anything yet, so it is asked on first use", async () => {
  const strategy = (passport as any)._strategy("google");
  const googleId = `${UNIQUE}-gid`;
  const result = await new Promise<{ user: { id: number } | false }>((resolve) => {
    const profile = { id: googleId, emails: [{ value: `${googleId}@example.com`, verified: true }], displayName: "Gina", _json: { email_verified: true } };
    strategy._verify({ session: {} }, "access", "refresh", profile, (_err: unknown, user: any) => resolve({ user }));
  });
  assert.ok(result.user);
  userIds.push((result.user as { id: number }).id);
  const created = await row((result.user as { id: number }).id);
  assert.equal(created.termsAcceptedAt, null);
  assert.equal(termsAcceptanceRequired(created), true);
});

test("write actions are refused with TERMS_ACCEPTANCE_REQUIRED until the current text is accepted; reads, reports, blocks and accepting still work", async () => {
  const other = await makeUser("write-other", { termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION });
  for (const [label, extra] of [
    ["write-legacy", {}],
    ["write-stale", { termsAcceptedAt: new Date("2025-01-01"), termsVersion: "2025-01-01" }],
  ] as const) {
    const user = await makeUser(label, extra);
    const client = await signIn(user);
    const messages = await client.post("/api/messages", { receiverId: other.id, content: "hello" });
    assert.equal(messages.status, 403, label);
    const body = (await messages.json()) as { code: string; message: string };
    assert.equal(body.code, "TERMS_ACCEPTANCE_REQUIRED");
    assert.doesNotMatch(body.message, /csrf|token/i, "clients retry a 403 that mentions these");
    for (const [method, path] of [["post", "/api/items"], ["post", "/api/wishlists"], ["post", `/api/users/${other.id}/reviews`], ["post", `/api/items/1/request`], ["patch", "/api/user-profile"]] as const) {
      const response = await (client as any)[method](path, {});
      assert.equal(response.status, 403, `${method} ${path}`);
      assert.equal(((await response.json()) as { code: string }).code, "TERMS_ACCEPTANCE_REQUIRED", path);
    }
    assert.equal((await client.get("/api/user")).status, 200, "reading still works");
    const report = await client.post("/api/reports", { targetType: "user", targetId: other.id, reason: "spam" });
    assert.notEqual(((await report.json()) as { code?: string }).code, "TERMS_ACCEPTANCE_REQUIRED", "reports are never locked");
    assert.equal((await client.post(`/api/blocks/${other.id}`, {})).status, 201, "blocking is never locked");
    assert.equal((await client.post("/api/account/accept-terms", { version: TERMS_VERSION })).status, 200);
    const after = await client.post("/api/messages", { receiverId: other.id, content: "hello" });
    assert.notEqual(((await after.json()) as { code?: string }).code, "TERMS_ACCEPTANCE_REQUIRED", "after acceptance the write goes through to the route");
  }
});

test("the exemptions are exactly the safety and account paths", async () => {
  const { isExemptFromTermsAcceptance: exempt } = await import("./terms-enforcement.js");
  for (const path of ["/api/account/accept-terms", "/api/account/deletion/request", "/api/account/deletion/cancel", "/api/account/deletion/confirm", "/api/account/confirm-age", "/api/reports", "/api/blocks/5", "/api/logout", "/api/admin/users/3/ban", "/api/user/push-token"]) assert.equal(exempt(path), true, path);
  for (const path of ["/api/messages", "/api/items", "/api/items/4/request", "/api/users/9/reviews", "/api/wishlists", "/api/accounts-x", "/api/reports-archive", "/api/blocksmith"]) assert.equal(exempt(path), false, path);
});

test("TERMS_ENFORCEMENT=off lets writes through; anything else keeps the rule", async () => {
  const { termsEnforced } = await import("./terms-enforcement.js");
  assert.equal(termsEnforced({} as NodeJS.ProcessEnv), true);
  assert.equal(termsEnforced({ TERMS_ENFORCEMENT: "on" } as NodeJS.ProcessEnv), true);
  assert.equal(termsEnforced({ TERMS_ENFORCEMENT: "nonsense" } as NodeJS.ProcessEnv), true);
  assert.equal(termsEnforced({ TERMS_ENFORCEMENT: " OFF " } as NodeJS.ProcessEnv), false);
});

test("TERMS_ENFORCEMENT=off in production is announced at boot; in development, or with enforcement on, nothing is said", async () => {
  const { termsEnforcementBootWarning } = await import("./terms-enforcement.js");
  const warning = termsEnforcementBootWarning({ NODE_ENV: "production", TERMS_ENFORCEMENT: "off" } as NodeJS.ProcessEnv);
  assert.match(warning ?? "", /TERMS_ENFORCEMENT=off in production/);
  assert.match(termsEnforcementBootWarning({ NODE_ENV: "production", TERMS_ENFORCEMENT: " OFF " } as NodeJS.ProcessEnv) ?? "", /NOT refused/);
  assert.equal(termsEnforcementBootWarning({ NODE_ENV: "production" } as NodeJS.ProcessEnv), null);
  assert.equal(termsEnforcementBootWarning({ NODE_ENV: "production", TERMS_ENFORCEMENT: "on" } as NodeJS.ProcessEnv), null);
  assert.equal(termsEnforcementBootWarning({ NODE_ENV: "development", TERMS_ENFORCEMENT: "off" } as NodeJS.ProcessEnv), null);
  assert.equal(termsEnforcementBootWarning({ TERMS_ENFORCEMENT: "off" } as NodeJS.ProcessEnv), null);
});

test("someone who has not accepted or confirmed their age can still reach the deletion flow", async () => {
  const user = await makeUser("deleter", { termsAcceptedAt: null, termsVersion: null, ageConfirmedAt: null, ageRegion: null });
  const client = await signIn(user);
  assert.equal(((await (await client.post("/api/messages", { receiverId: user.id, content: "x" })).json()) as { code: string }).code, "TERMS_ACCEPTANCE_REQUIRED");
  assert.equal((await client.get("/api/account/deletion-eligibility")).status, 200);
  const request = await client.post("/api/account/deletion/request", {});
  assert.notEqual(request.status, 403, "the gate does not stop a deletion request");
  assert.notEqual(((await request.json()) as { code?: string }).code, "TERMS_ACCEPTANCE_REQUIRED");
  assert.equal((await client.post("/api/logout", {})).status < 400, true, "and signing out works");
});
