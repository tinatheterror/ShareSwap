import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import passport from "passport";
import { db, items, pool, users } from "@workspace/db";
import { NATIVE_TOKEN_TTL_MS, REACTIVATE_TOKEN_PREFIX, hashPassword, reactivationRedirect } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";

const UNIQUE = `google-reactivate-${Date.now()}`;
const userIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;
let counter = 0;
const previousGoogle = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };

async function makeGoogleUser(accountStatus: string) {
  const googleId = `${UNIQUE}-gid-${counter++}`;
  const [row] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${counter}`, email: `${googleId}@example.com`, googleId, authProvider: "google", password: null, emailVerified: true, accountStatus, deactivatedAt: accountStatus === "deactivated" ? new Date() : null })
    .returning({ id: users.id, googleId: users.googleId });
  userIds.push(row.id);
  return row;
}

async function issue(userId: number, token: string, expiresInSeconds = 300) {
  await pool.query(`INSERT INTO native_oauth_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval)`, [token, userId, String(expiresInSeconds)]);
}

before(async () => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  ({ baseUrl, close: closeServer } = await startApp());
  await new Client(baseUrl).post("/api/auth/exchange-token", { token: "warm-up" }); // creates the token table
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
});

after(async () => {
  try {
    if (userIds.length) {
      await db.delete(items).where(inArray(items.ownerId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
  } finally {
    for (const [name, value] of [["GOOGLE_CLIENT_ID", previousGoogle.id], ["GOOGLE_CLIENT_SECRET", previousGoogle.secret]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await closeServer?.();
    await pool.end();
  }
});

// The login limiter counts refused attempts per IP across every test file running at once, so each refusal
// starts from an empty counter.
const refusedPost = async (path: string, body: unknown) => {
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
  return new Client(baseUrl).post(path, body);
};

const verify = (googleId: string) =>
  new Promise<{ user: unknown; info: any }>((resolve) => {
    const profile = { id: googleId, emails: [{ value: `${googleId}@example.com`, verified: true }], _json: { email_verified: true } };
    (passport as any)._strategy("google")._verify({ session: {} }, "a", "r", profile, (_e: unknown, user: unknown, info: unknown) => resolve({ user, info }));
  });

test("the Google strategy offers reactivation for a deactivated account, and for no other refused one", async () => {
  const deactivated = await makeGoogleUser("deactivated");
  const banned = await makeGoogleUser("banned");
  const offered = await verify(deactivated.googleId!);
  assert.equal(offered.user, false);
  assert.equal(offered.info.reactivateUserId, deactivated.id);
  const refused = await verify(banned.googleId!);
  assert.equal(refused.user, false);
  assert.equal(refused.info.reactivateUserId, undefined);
});

test("the callback redirect carries the token back to the web page or the native app", () => {
  assert.equal(reactivationRedirect(undefined, "t1"), "/auth?reactivate=google&token=t1");
  assert.equal(reactivationRedirect("shareswap://login", "t1"), "shareswap://login?reactivate=1&token=t1");
  assert.equal(reactivationRedirect("shareswap://login?x=1", "t1"), "shareswap://login?x=1&reactivate=1&token=t1");
});

test("a reactivation token brings a deactivated account back, signs it in once, and cannot be reused", async () => {
  const user = await makeGoogleUser("deactivated");
  await db.insert(items).values({ name: `${UNIQUE}-i`, description: "x", photos: [], conditionRating: 5, shareCoinsReward: "1", ownerId: user.id, isAvailable: false });
  const token = `${REACTIVATE_TOKEN_PREFIX}${UNIQUE}-ok`;
  await issue(user.id, token);
  const client = new Client(baseUrl);
  const response = await client.post("/api/auth/google-reactivate", { token });
  assert.equal(response.status, 200);
  const [row] = await db.select().from(users).where(eq(users.id, user.id));
  assert.equal(row.accountStatus, "active");
  assert.equal(row.deactivatedAt, null);
  assert.equal((await db.select().from(items).where(eq(items.ownerId, user.id)))[0].isAvailable, true);
  assert.equal((await client.get("/api/user")).status, 200);
  assert.equal((await refusedPost("/api/auth/google-reactivate", { token })).status, 401);
});

test("a reactivation token is refused for a banned account, an active one, an expired one and a plain token", async () => {
  const banned = await makeGoogleUser("banned");
  const bannedToken = `${REACTIVATE_TOKEN_PREFIX}${UNIQUE}-banned`;
  await issue(banned.id, bannedToken);
  assert.equal((await refusedPost("/api/auth/google-reactivate", { token: bannedToken })).status, 401);
  assert.equal((await db.select().from(users).where(eq(users.id, banned.id)))[0].accountStatus, "banned");

  const active = await makeGoogleUser("active");
  const activeToken = `${REACTIVATE_TOKEN_PREFIX}${UNIQUE}-active`;
  await issue(active.id, activeToken);
  assert.equal((await refusedPost("/api/auth/google-reactivate", { token: activeToken })).status, 400);

  const stale = await makeGoogleUser("deactivated");
  const staleToken = `${REACTIVATE_TOKEN_PREFIX}${UNIQUE}-stale`;
  await issue(stale.id, staleToken, -60);
  assert.equal((await refusedPost("/api/auth/google-reactivate", { token: staleToken })).status, 401);
  assert.equal((await db.select().from(users).where(eq(users.id, stale.id)))[0].accountStatus, "deactivated");

  const plain = await makeGoogleUser("deactivated");
  const plainToken = `${UNIQUE}-plain`;
  await issue(plain.id, plainToken);
  assert.equal((await refusedPost("/api/auth/google-reactivate", { token: plainToken })).status, 400);
});

test("a reactivation token is refused for a pending-deletion or deleted account, and leaves the account untouched", async () => {
  for (const status of ["pending_deletion", "deleted"]) {
    const user = await makeGoogleUser(status);
    const token = `${REACTIVATE_TOKEN_PREFIX}${UNIQUE}-${status}`;
    await issue(user.id, token);
    const client = new Client(baseUrl);
    await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
    assert.equal((await client.post("/api/auth/google-reactivate", { token })).status, 400, status);
    assert.equal((await client.get("/api/user")).status, 401, status);
    assert.equal((await db.select().from(users).where(eq(users.id, user.id)))[0].accountStatus, status);
  }

  // The account row is gone altogether: a token that outlived it opens nothing.
  const gone = await makeGoogleUser("deactivated");
  const goneToken = `${REACTIVATE_TOKEN_PREFIX}${UNIQUE}-gone`;
  await issue(gone.id, goneToken);
  await db.delete(users).where(eq(users.id, gone.id));
  assert.equal((await refusedPost("/api/auth/google-reactivate", { token: goneToken })).status, 401);
});

test("Google sign-in offers reactivation only for a deactivated account, not a pending-deletion or deleted one", async () => {
  for (const status of ["pending_deletion", "deleted"]) {
    const user = await makeGoogleUser(status);
    const { info } = await verify(user.googleId!);
    assert.equal(info?.reactivateUserId, undefined, status);
  }
});

test("a token is single-use and short-lived: spent by the first request, even a refused one, and valid for five minutes", async () => {
  const user = await makeGoogleUser("pending_deletion");
  const token = `${REACTIVATE_TOKEN_PREFIX}${UNIQUE}-spent`;
  await issue(user.id, token);
  assert.equal((await refusedPost("/api/auth/google-reactivate", { token })).status, 400);
  assert.equal((await pool.query("SELECT 1 FROM native_oauth_tokens WHERE token = $1", [token])).rowCount, 0);

  assert.equal(NATIVE_TOKEN_TTL_MS, 5 * 60 * 1000);
});

test("a reactivation token cannot sign anyone in through the normal exchange, and is not spent by trying", async () => {
  const user = await makeGoogleUser("deactivated");
  const token = `${REACTIVATE_TOKEN_PREFIX}${UNIQUE}-exchange`;
  await issue(user.id, token);
  const client = new Client(baseUrl);
  assert.equal((await client.post("/api/auth/exchange-token", { token })).status, 401);
  assert.equal((await client.get("/api/user")).status, 401);
  const stillThere = await pool.query("SELECT 1 FROM native_oauth_tokens WHERE token = $1", [token]);
  assert.equal(stillThere.rowCount, 1);
});
