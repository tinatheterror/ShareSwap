import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, userReviews, users, wishlists } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { scrubEmailUsernames } from "./username-scrub.js";

// An email account's username is its address. Whatever another user (or an admin looking at a booking) can
// fetch must not carry it, whichever route builds the response.

const UNIQUE = `username-sweep-${Date.now()}`;
const PASSWORD = "UsernameSweep!42";
const OWNER_EMAIL = `${UNIQUE}-owner@example.com`;
const VIEWER_EMAIL = `${UNIQUE}-viewer@example.com`;
const ADMIN_EMAIL = `${UNIQUE}-admin@example.com`;
const userIds: number[] = [];
let ownerId: number;
let ownerHandle: string;
let viewerId: number;
let itemId: number;
let requestId: number;
let baseUrl: string;
let closeServer: () => Promise<void>;

before(async () => {
  const password = await hashPassword(PASSWORD);
  const stamp = String(Date.now() % 1000000);
  const rows = await db
    .insert(users)
    .values([
      { username: OWNER_EMAIL, email: OWNER_EMAIL, handle: `O${stamp}`, password, emailVerified: true, authProvider: "local" },
      { username: VIEWER_EMAIL, email: VIEWER_EMAIL, handle: `V${stamp}`, displayName: "Vee", password, emailVerified: true, authProvider: "local" },
      { username: ADMIN_EMAIL, email: ADMIN_EMAIL, handle: `A${stamp}`, password, emailVerified: true, authProvider: "local", isAdmin: true },
    ])
    .returning({ id: users.id, handle: users.handle });
  userIds.push(...rows.map((r) => r.id));
  [ownerId, viewerId] = rows.map((r) => r.id);
  ownerHandle = rows[0].handle!;

  const [item] = await db
    .insert(items)
    .values({ name: `${UNIQUE}-item`, description: "x", photos: [], conditionRating: 5, shareCoinsReward: "1", ownerId, isAvailable: true, isLendable: true })
    .returning({ id: items.id });
  itemId = item.id;
  const [request] = await db
    .insert(itemRequests)
    .values({ itemId, requesterId: viewerId, requestType: "BORROW", status: "PENDING" })
    .returning({ id: itemRequests.id });
  requestId = request.id;
  await db.insert(messages).values([
    { content: "hello", senderId: viewerId, receiverId: ownerId, requestId },
    { content: "hi back", senderId: ownerId, receiverId: viewerId, requestId },
  ]);
  await db.insert(userReviews).values([
    { reviewerId: ownerId, reviewedUserId: viewerId, rating: 5, comment: "great", transactionId: requestId },
    { reviewerId: viewerId, reviewedUserId: ownerId, rating: 4, comment: "fine" },
  ]);
  await db.insert(notifications).values({ userId: viewerId, type: "request_accepted", title: "Accepted", message: "ok", itemId, requestId });
  await db.insert(wishlists).values({ userId: ownerId, itemName: `${UNIQUE}-wish`, needType: "borrow", urgency: "low", isActive: true });
  ({ baseUrl, close: closeServer } = await startApp());
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
});

after(async () => {
  try {
    await db.delete(wishlists).where(inArray(wishlists.userId, userIds));
    await db.delete(notifications).where(inArray(notifications.userId, userIds));
    await db.delete(userReviews).where(inArray(userReviews.reviewerId, userIds));
    await db.delete(messages).where(inArray(messages.senderId, userIds));
    await db.delete(itemRequests).where(inArray(itemRequests.requesterId, userIds));
    await db.delete(items).where(inArray(items.ownerId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    await closeServer?.();
    await pool.end();
  }
});

async function signIn(email: string) {
  const client = new Client(baseUrl);
  const login = await client.post("/api/login", { username: email, password: PASSWORD });
  assert.equal(login.status, 200, `login ${email}`);
  return client;
}

async function fetchAll(client: Client, paths: string[]) {
  const out: { path: string; status: number; text: string }[] = [];
  for (const path of paths) {
    const response = await client.get(path);
    out.push({ path, status: response.status, text: await response.text() });
  }
  return out;
}

test("scrubEmailUsernames rewrites other people's addresses and keeps the viewer's own", () => {
  const viewer = { id: 1, username: "me@example.com" };
  const payload = {
    me: { id: 1, username: "me@example.com" },
    other: { id: 2, username: "them@example.com", handle: "H2", displayName: "Them" },
    noHandle: { id: 3, username: "x@example.com", displayName: "Ex" },
    bare: { id: 4, username: "y@example.com" },
    partnerUsername: "z@example.com",
    partnerHandle: "PZ",
    list: [{ ownerUsername: "w@example.com", ownerDisplayName: "Dub" }],
    plain: { id: 5, username: "google-person" },
    when: new Date(0),
  };
  const out = scrubEmailUsernames(payload, viewer);
  assert.equal(out.me.username, "me@example.com");
  assert.equal(out.other.username, "H2");
  assert.equal(out.noHandle.username, "Ex");
  assert.equal(out.bare.username, "ShareSwap member");
  assert.equal(out.partnerUsername, "PZ");
  assert.equal(out.list[0].ownerUsername, "Dub");
  assert.equal(out.plain.username, "google-person");
  assert.equal(out.when, payload.when);
  assert.equal(payload.other.username, "them@example.com", "the input is not mutated");
  assert.equal(scrubEmailUsernames(payload.plain, viewer), payload.plain, "an unchanged object comes back as the same object");
});

test("nothing a signed-in user can fetch carries another email account's address", async () => {
  const viewer = await signIn(VIEWER_EMAIL);
  const results = await fetchAll(viewer, [
    "/api/items",
    `/api/items/${itemId}`,
    `/api/items/${itemId}/verifications`,
    "/api/wishlists",
    "/api/requests",
    "/api/inbox",
    "/api/inbox?archived=true",
    "/api/conversations",
    `/api/messages/${ownerId}`,
    "/api/notifications",
    `/api/users/${ownerId}/public-profile`,
    `/api/users/username/${ownerHandle}`,
    `/api/users/username/${ownerHandle}/items`,
    `/api/users/username/${ownerHandle}/reviews`,
    `/api/requests/${requestId}/deposit-details`,
  ]);
  for (const { path, status, text } of results) {
    assert.ok(status < 500, `${path} answered ${status}`);
    assert.ok(!text.includes(OWNER_EMAIL), `${path} returned the owner's email address`);
  }
  // The fixtures really are in the responses, so the check above is not vacuous.
  const body = (path: string) => results.find((r) => r.path === path)!;
  for (const path of ["/api/items", `/api/items/${itemId}`, "/api/requests", "/api/conversations", "/api/inbox", `/api/users/username/${ownerHandle}/reviews`, "/api/wishlists"]) {
    assert.equal(body(path).status, 200, path);
    assert.ok(body(path).text.includes(ownerHandle) || body(path).text.includes(UNIQUE), `${path} has the fixture data`);
  }
});

test("the owner's own address is still returned to the owner", async () => {
  const owner = await signIn(OWNER_EMAIL);
  const me = await (await owner.get("/api/user")).text();
  assert.ok(me.includes(OWNER_EMAIL));
});

test("admin lists never show the address of a user whose booking, item or dispute they list", async () => {
  const admin = await signIn(ADMIN_EMAIL);
  const results = await fetchAll(admin, ["/api/admin/items", "/api/admin/transactions", "/api/admin/disputes", "/api/admin/claims"]);
  for (const { path, status, text } of results) {
    assert.equal(status, 200, path);
    assert.ok(!text.includes(OWNER_EMAIL) && !text.includes(VIEWER_EMAIL), `${path} returned a user's email address`);
  }
  const items = results.find((r) => r.path === "/api/admin/items")!;
  assert.ok(items.text.includes(UNIQUE), "the fixture item is listed");
});

test("the admin user directory is the one place an admin can search and see addresses", async () => {
  const admin = await signIn(ADMIN_EMAIL);
  const response = await admin.get(`/api/admin/users?search=${encodeURIComponent(UNIQUE)}`);
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes(OWNER_EMAIL));
});
