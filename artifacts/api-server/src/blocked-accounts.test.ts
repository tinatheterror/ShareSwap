import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import passport from "passport";
import { db, pool, users } from "@workspace/db";
import { accountIsBlocked, hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";

// Banned and deactivated accounts must not sign in (password, Google, native token) and must lose any
// session they already hold, because deserializeUser reads the account on every request.

const UNIQUE = `blocked-${Date.now()}`;
const PASSWORD = "Blocked!42";
const userIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;
const previousGoogle = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };

async function makeUser(label: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${label}`, password: await hashPassword(PASSWORD), emailVerified: true, ...extra })
    .returning();
  userIds.push(row.id);
  return row;
}

const setStatus = (id: number, accountStatus: string) => db.update(users).set({ accountStatus }).where(eq(users.id, id));

// The login limiter counts refused attempts per IP in Postgres; this file refuses a few on purpose, so it
// clears the counters before and after rather than leave them for other files or for the next run.
const clearLoginLimiter = () => pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");

before(async () => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  ({ baseUrl, close: closeServer } = await startApp());
  await clearLoginLimiter();
});

after(async () => {
  try {
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await clearLoginLimiter();
  } finally {
    for (const [name, value] of [["GOOGLE_CLIENT_ID", previousGoogle.id], ["GOOGLE_CLIENT_SECRET", previousGoogle.secret]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await closeServer?.();
    await pool.end();
  }
});

test("accountIsBlocked covers banned and deactivated only", () => {
  assert.equal(accountIsBlocked({ accountStatus: "banned" }), true);
  assert.equal(accountIsBlocked({ accountStatus: "deactivated" }), true);
  assert.equal(accountIsBlocked({ accountStatus: "active" }), false);
  assert.equal(accountIsBlocked({ accountStatus: null }), false);
});

test("password login is refused for a banned account and for a deactivated one, and no session starts", async () => {
  for (const status of ["banned", "deactivated"]) {
    const user = await makeUser(`login-${status}`, { accountStatus: status });
    const client = new Client(baseUrl);
    await clearLoginLimiter();
    const login = await client.post("/api/login", { username: user.username, password: PASSWORD });
    assert.equal(login.status, 403, status);
    assert.equal(((await login.json()) as { accountStatus: string }).accountStatus, status);
    assert.equal((await client.get("/api/user")).status, 401, status);
  }
});

test("a wrong password still answers 401, so a ban is not revealed without the password", async () => {
  const user = await makeUser("wrongpw", { accountStatus: "banned" });
  await clearLoginLimiter();
  const login = await new Client(baseUrl).post("/api/login", { username: user.username, password: "nope" });
  assert.equal(login.status, 401);
});

test("an open session stops working the moment the account is banned or deactivated, and stays closed after reinstatement until the next sign-in", async () => {
  const user = await makeUser("session");
  const client = new Client(baseUrl);
  assert.equal((await client.post("/api/login", { username: user.username, password: PASSWORD })).status, 200);
  assert.equal((await client.get("/api/user")).status, 200);
  for (const status of ["banned", "deactivated"]) {
    await setStatus(user.id, status);
    assert.equal((await client.get("/api/user")).status, 401, status);
    assert.equal((await client.get("/api/conversations")).status, 401, status);
  }
  // The session is gone for good (passport drops it), so reinstatement needs a fresh sign-in.
  await setStatus(user.id, "active");
  assert.equal((await client.get("/api/user")).status, 401);
  assert.equal((await client.post("/api/login", { username: user.username, password: PASSWORD })).status, 200);
  assert.equal((await client.get("/api/user")).status, 200);
});

test("Google sign-in resolves no user for a banned or deactivated account, and does for an active one", async () => {
  const strategy = (passport as any)._strategy("google");
  const verify = (googleId: string) =>
    new Promise<{ err: unknown; user: unknown; info: any }>((resolve) => {
      const profile = { id: googleId, emails: [{ value: `${googleId}@example.com`, verified: true }], _json: { email_verified: true } };
      strategy._verify({ session: {} }, "access", "refresh", profile, (err: unknown, user: unknown, info: unknown) => resolve({ err, user, info }));
    });
  for (const status of ["banned", "deactivated", "active"]) {
    const googleId = `${UNIQUE}-gid-${status}`;
    const user = await makeUser(`google-${status}`, { googleId, authProvider: "google", email: `${googleId}@example.com`, accountStatus: status });
    const result = await verify(googleId);
    assert.equal(result.err, null, status);
    if (status === "active") assert.equal((result.user as { id: number }).id, user.id);
    else {
      assert.equal(result.user, false, status);
      assert.match(result.info.message, new RegExp(status));
    }
  }
});

test("the native Google token exchange refuses a banned account and accepts an active one", async () => {
  await new Client(baseUrl).post("/api/auth/exchange-token", { token: "warm-up" }); // creates the table
  for (const status of ["banned", "active"]) {
    const user = await makeUser(`native-${status}`, { accountStatus: status });
    const token = `${UNIQUE}-token-${status}`;
    await pool.query(`INSERT INTO native_oauth_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + interval '5 minutes')`, [token, user.id]);
    const client = new Client(baseUrl);
    const exchange = await client.post("/api/auth/exchange-token", { token });
    assert.equal(exchange.status, status === "active" ? 200 : 401, status);
    assert.equal((await client.get("/api/user")).status, status === "active" ? 200 : 401, status);
  }
});
