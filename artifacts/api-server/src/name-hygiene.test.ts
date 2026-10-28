import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { WebSocket } from "ws";
import { db, messages, pool, users } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { isEmailShaped } from "./public-identity.js";
import { scrubEmailUsernames } from "./username-scrub.js";

// A display name is shown to other users, so it cannot be an address: it is refused when written, and
// anything that still carries one (an older row, a full name) is rewritten on the way out.

const UNIQUE = `name-hygiene-${Date.now()}`;
const PASSWORD = "NameHygiene!42";
const userIds: number[] = [];
let userId: number;
let otherId: number;
let baseUrl: string;
let closeServer: () => Promise<void>;

before(async () => {
  const password = await hashPassword(PASSWORD);
  const rows = await db
    .insert(users)
    .values([
      { username: `${UNIQUE}-a@example.com`, email: `${UNIQUE}-a@example.com`, handle: `NA${Date.now() % 100000}`, password, emailVerified: true, authProvider: "local" },
      { username: `${UNIQUE}-b@example.com`, email: `${UNIQUE}-b@example.com`, handle: `NB${Date.now() % 100000}`, password, emailVerified: true, authProvider: "local" },
    ])
    .returning({ id: users.id });
  [userId, otherId] = rows.map((r) => r.id);
  userIds.push(...rows.map((r) => r.id));
  ({ baseUrl, close: closeServer } = await startApp());
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
});

after(async () => {
  try {
    await db.delete(messages).where(inArray(messages.senderId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    await closeServer?.();
    await pool.end();
  }
});

async function signIn(n: 0 | 1) {
  const client = new Client(baseUrl);
  const login = await client.post("/api/login", { username: `${UNIQUE}-${n ? "b" : "a"}@example.com`, password: PASSWORD });
  assert.equal(login.status, 200);
  await client.fetchCsrfToken();
  return client;
}

test("isEmailShaped: addresses are, ordinary names (even with an @) are not", () => {
  for (const bad of ["a@b.com", "someone@example.org", "x@y", "Anna anna@live.ca"]) assert.equal(isEmailShaped(bad), true, bad);
  for (const ok of ["Anna L.", "@anna", "anna@", "Anna @ Bike Shop", "", null, undefined, 5]) assert.equal(isEmailShaped(ok), false, String(ok));
});

test("a display name shaped like an address is refused, stored nowhere, and does not start the 30-day wait", async () => {
  const client = await signIn(0);
  const refused = await client.patch("/api/user-profile", { displayName: "me@example.com" });
  assert.equal(refused.status, 400);
  assert.match(((await refused.json()) as { error: string }).error, /email/i);
  const [row] = await db.select({ displayName: users.displayName, changedAt: users.displayNameChangedAt }).from(users).where(eq(users.id, userId));
  assert.equal(row.displayName, null);
  assert.equal(row.changedAt, null);

  const accepted = await client.patch("/api/user-profile", { displayName: "Anna L." });
  assert.equal(accepted.status, 200);
  assert.equal(((await accepted.json()) as { displayName: string }).displayName, "Anna L.");
});

test("the scrub also rewrites display names, full names and handles that are addresses, and only those", () => {
  const viewer = { id: 1, username: "me@example.com" };
  const payload = {
    a: { id: 2, displayName: "them@example.com", handle: "H2", fullName: "Them T." },
    b: { id: 3, displayName: "x@example.com", fullName: "y@example.com" },
    c: { id: 4, displayName: "Anna @ Bike Shop", fullName: "Anna L." },
    me: { id: 1, displayName: "me@example.com", fullName: "me@example.com" },
    row: { partnerDisplayName: "p@example.com", partnerHandle: "PH", ownerFullName: "o@example.com", ownerDisplayName: "Owen" },
    list: [{ requesterDisplayName: "r@example.com" }],
    bad: { id: 5, handle: "h@example.com", displayName: "D5" },
    sibling: { id: 6, username: "u@example.com", displayName: "d@example.com", handle: "h@example.com" },
  };
  const out = scrubEmailUsernames(payload, viewer);
  assert.equal(out.a.displayName, "H2");
  assert.equal(out.a.fullName, "Them T.");
  assert.equal(out.b.displayName, "ShareSwap member");
  assert.equal(out.b.fullName, "ShareSwap member");
  assert.deepEqual(out.c, payload.c, "a name that only contains an @ is left alone");
  assert.deepEqual(out.me, payload.me, "the viewer's own record is left alone");
  assert.equal(out.row.partnerDisplayName, "PH");
  assert.equal(out.row.ownerFullName, "Owen");
  assert.equal(out.list[0].requesterDisplayName, "ShareSwap member");
  assert.equal(out.bad.handle, "D5");
  assert.deepEqual([out.sibling.username, out.sibling.displayName, out.sibling.handle], ["ShareSwap member", "ShareSwap member", "ShareSwap member"], "a replacement is never itself an address");
});

test("a row that already holds an address as its display name is served without it", async () => {
  await db.update(users).set({ displayName: `${UNIQUE}-leak@example.com`, fullName: `${UNIQUE}-full@example.com` }).where(eq(users.id, otherId));
  const viewer = await signIn(0);
  const response = await viewer.get(`/api/users/${otherId}/public-profile`);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes(`${UNIQUE}-leak@example.com`) && !text.includes(`${UNIQUE}-full@example.com`), text);
});

test("a new_message frame still reaches a connected user, with the message text untouched", async () => {
  const sender = await signIn(0);
  const receiver = await signIn(1);
  const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws/chat`, { headers: { cookie: receiver.cookieHeader() } });
  const frames: any[] = [];
  socket.on("message", (data) => frames.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => { socket.once("open", () => resolve()); socket.once("error", reject); });
  const waitFor = async (type: string) => {
    for (let i = 0; i < 100; i++) {
      const frame = frames.find((f) => f.type === type);
      if (frame) return frame;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.fail(`no ${type} frame`);
  };
  try {
    await waitFor("auth_success");
    const content = "my address is someone@example.com";
    assert.equal((await sender.post("/api/messages", { receiverId: otherId, content })).status, 201);
    const frame = await waitFor("new_message");
    assert.equal(frame.message.content, content);
    assert.equal(frame.message.senderId, userId);
  } finally {
    socket.close();
  }
});
