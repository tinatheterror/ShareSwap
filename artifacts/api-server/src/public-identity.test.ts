import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { inArray } from "drizzle-orm";
import { db, messages, pool, users } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { publicUsername } from "./public-identity.js";

const UNIQUE = `public-identity-${Date.now()}`;
const PASSWORD = "PublicIdentity!42";
const EMAIL = `${UNIQUE}-mail@example.com`;
const GOOGLE_NAME = `${UNIQUE}-g`;
const userIds: number[] = [];
let emailUserId: number;
let googleUserId: number;
let viewerId: number;
let baseUrl: string;
let closeServer: () => Promise<void>;

before(async () => {
  const password = await hashPassword(PASSWORD);
  const rows = await db
    .insert(users)
    .values([
      { username: EMAIL, email: EMAIL, handle: `E${Date.now() % 100000}`, displayName: "Email Person", password, emailVerified: true, authProvider: "local" },
      { username: GOOGLE_NAME, email: `${GOOGLE_NAME}@example.com`, handle: `G${Date.now() % 100000}`, displayName: "Google Person", password: null, emailVerified: true, authProvider: "google", googleId: `${UNIQUE}-gid` },
      { username: `${UNIQUE}-viewer`, handle: `V${Date.now() % 100000}`, password, emailVerified: true },
    ])
    .returning({ id: users.id });
  [emailUserId, googleUserId, viewerId] = rows.map((r) => r.id);
  userIds.push(...rows.map((r) => r.id));
  await db.insert(messages).values([
    { content: "hi", senderId: viewerId, receiverId: emailUserId },
    { content: "hello", senderId: viewerId, receiverId: googleUserId },
  ]);
  ({ baseUrl, close: closeServer } = await startApp());
});

after(async () => {
  try {
    if (userIds.length) {
      await db.delete(messages).where(inArray(messages.senderId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  } finally {
    await closeServer?.();
    await pool.end();
  }
});

test("publicUsername hides an email account's address behind its handle, and leaves other providers alone", () => {
  const base = { handle: "ABC123", displayName: "Name" };
  assert.equal(publicUsername({ ...base, username: "a@b.com", authProvider: "local" }), "ABC123");
  assert.equal(publicUsername({ ...base, username: "a@b.com", authProvider: null }), "ABC123");
  assert.equal(publicUsername({ ...base, handle: null, username: "a@b.com", authProvider: "local" }), "Name");
  assert.equal(publicUsername({ handle: null, displayName: null, username: "a@b.com", authProvider: "local" }), null);
  assert.equal(publicUsername({ ...base, username: "someone", authProvider: "google" }), "someone");
});

test("public-profile never returns an email account's email address", async () => {
  const response = await new Client(baseUrl).get(`/api/users/${emailUserId}/public-profile`);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes(EMAIL), "the email address appears in the response");
  const body = JSON.parse(text) as Record<string, unknown>;
  assert.equal(body.username, body.handle);
  assert.ok(!("authProvider" in body), "authProvider is not part of the public profile");
});

test("public-profile still returns a Google account's username", async () => {
  const body = (await (await new Client(baseUrl).get(`/api/users/${googleUserId}/public-profile`)).json()) as Record<string, unknown>;
  assert.equal(body.username, GOOGLE_NAME);
});

test("conversations never return a partner's email address, and show the Google partner's username", async () => {
  const client = new Client(baseUrl);
  assert.equal((await client.post("/api/login", { username: `${UNIQUE}-viewer`, password: PASSWORD })).status, 200);
  const response = await client.get("/api/conversations");
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes(EMAIL), "the email address appears in the response");
  const rows = JSON.parse(text) as { userId: number; username: string }[];
  const email = rows.find((r) => r.userId === emailUserId);
  const google = rows.find((r) => r.userId === googleUserId);
  assert.ok(email && google);
  assert.notEqual(email.username, EMAIL);
  assert.equal(google.username, GOOGLE_NAME);
});
