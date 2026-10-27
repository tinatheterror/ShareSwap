import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, pool, userPushTokens, users } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";

const UNIQUE = `push-logout-${Date.now()}`;
const PASSWORD = "PushLogout!42";
const userIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;

const tokensOf = async (userId: number) =>
  (await db.select({ token: userPushTokens.token }).from(userPushTokens).where(eq(userPushTokens.userId, userId))).map((r) => r.token).sort();

async function signedInUser(label: string, tokens: string[]) {
  const [user] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${label}`, password: await hashPassword(PASSWORD), emailVerified: true })
    .returning({ id: users.id, username: users.username });
  userIds.push(user.id);
  if (tokens.length) await db.insert(userPushTokens).values(tokens.map((token) => ({ userId: user.id, token })));
  const client = new Client(baseUrl);
  assert.equal((await client.post("/api/login", { username: user.username, password: PASSWORD })).status, 200);
  await client.fetchCsrfToken();
  return { user, client };
}

before(async () => {
  ({ baseUrl, close: closeServer } = await startApp());
});

after(async () => {
  try {
    if (userIds.length) {
      await db.delete(userPushTokens).where(inArray(userPushTokens.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  } finally {
    await closeServer?.();
    await pool.end();
  }
});

test("logout without a token removes every push token of the account and no one else's", async () => {
  const { user, client } = await signedInUser("all", [`${UNIQUE}-a1`, `${UNIQUE}-a2`]);
  const other = await signedInUser("other", [`${UNIQUE}-o1`]);
  assert.equal((await client.post("/api/logout")).status, 200);
  assert.deepEqual(await tokensOf(user.id), []);
  assert.deepEqual(await tokensOf(other.user.id), [`${UNIQUE}-o1`]);
  assert.equal((await client.get("/api/user")).status, 401);
});

test("logout with a token removes only that device, and ignores a token that is someone else's", async () => {
  const { user, client } = await signedInUser("one", [`${UNIQUE}-b1`, `${UNIQUE}-b2`]);
  const other = await signedInUser("victim", [`${UNIQUE}-v1`]);
  assert.equal((await client.post("/api/logout", { token: `${UNIQUE}-v1` })).status, 200);
  assert.deepEqual(await tokensOf(other.user.id), [`${UNIQUE}-v1`]);
  assert.deepEqual(await tokensOf(user.id), [`${UNIQUE}-b1`, `${UNIQUE}-b2`]);

  const again = await signedInUser("one-again", [`${UNIQUE}-c1`, `${UNIQUE}-c2`]);
  assert.equal((await again.client.post("/api/logout", { token: `${UNIQUE}-c1` })).status, 200);
  assert.deepEqual(await tokensOf(again.user.id), [`${UNIQUE}-c2`]);
});

test("logout while signed out succeeds and touches nothing", async () => {
  const keeper = await signedInUser("keeper", [`${UNIQUE}-k1`]);
  const anonymous = new Client(baseUrl);
  await anonymous.fetchCsrfToken();
  assert.equal((await anonymous.post("/api/logout", { token: `${UNIQUE}-k1` })).status, 200);
  assert.deepEqual(await tokensOf(keeper.user.id), [`${UNIQUE}-k1`]);
});
