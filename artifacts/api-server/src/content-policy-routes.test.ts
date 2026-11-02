import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray, or } from "drizzle-orm";
import { db, items, messages, pool, userReviews, users, wishlists } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { CONTENT_NOT_ALLOWED_CODE } from "./content-policy.js";

// Every route that stores words other people will read refuses disallowed language, and refuses before it stores anything.

const UNIQUE = `pol-${Date.now()}`;
const PASSWORD = "Policy!4242";
const BAD = "what a fucking mess";
const userIds: number[] = [];
const itemIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;
let counter = 0;

async function makeUser(label: string) {
  const n = ++counter;
  const [row] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${label}@example.com`, password: await hashPassword(PASSWORD), emailVerified: true, handle: `${UNIQUE}h${n}`, displayName: `Name ${label}`, referralCode: `${UNIQUE}r${n}` })
    .returning();
  userIds.push(row.id);
  return row;
}

async function signIn(user: { username: string }) {
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
  const client = new Client(baseUrl);
  assert.equal((await client.post("/api/login", { username: user.username, password: PASSWORD })).status, 200);
  await client.fetchCsrfToken();
  return client;
}

async function refused(response: Response, field: string) {
  assert.equal(response.status, 422, `${field} -> ${response.status}`);
  const body = (await response.json()) as { code: string; field: string; error: string; message: string };
  assert.equal(body.code, CONTENT_NOT_ALLOWED_CODE);
  assert.equal(body.field, field);
  assert.ok(body.error && body.message);
}

before(async () => {
  ({ baseUrl, close: closeServer } = await startApp());
});

after(async () => {
  try {
    if (userIds.length) {
      await db.delete(messages).where(or(inArray(messages.senderId, userIds), inArray(messages.receiverId, userIds)));
      await db.delete(wishlists).where(inArray(wishlists.userId, userIds));
      await db.delete(userReviews).where(inArray(userReviews.reviewerId, userIds));
    }
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    await pool.query("DELETE FROM users WHERE username LIKE $1", [`${UNIQUE}-reg%`]);
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%' OR key LIKE 'messages:%'");
  } finally {
    await closeServer?.();
    await pool.end();
  }
});

test("a message, a wishlist post, a profile, a review and a listing are each refused, and nothing is stored", async () => {
  const me = await makeUser("me");
  const other = await makeUser("other");
  const client = await signIn(me);

  await refused(await client.post("/api/messages", { receiverId: other.id, content: BAD }), "content");
  assert.equal((await db.select().from(messages).where(eq(messages.senderId, me.id))).length, 0);

  await refused(await client.post("/api/wishlists", { itemName: BAD }), "itemName");
  await refused(await client.post("/api/wishlists", { itemName: "A ladder", description: BAD }), "description");
  assert.equal((await db.select().from(wishlists).where(eq(wishlists.userId, me.id))).length, 0);
  const created = await client.post("/api/wishlists", { itemName: "A ladder", description: "Anything sturdy" });
  assert.ok(created.status < 300, `a clean post is fine (${created.status})`);
  const [wish] = await db.select().from(wishlists).where(eq(wishlists.userId, me.id));
  await refused(await client.patch(`/api/wishlists/${wish.id}`, { description: BAD }), "description");
  assert.equal((await db.select().from(wishlists).where(eq(wishlists.id, wish.id)))[0].description, "Anything sturdy");

  await refused(await client.patch("/api/user-profile", { bio: BAD }), "bio");
  await refused(await client.patch("/api/user-profile", { displayName: "Big f u c k" }), "displayName");
  assert.equal((await db.select().from(users).where(eq(users.id, me.id)))[0].displayName, "Name me");

  await refused(await client.post(`/api/users/${other.id}/reviews`, { rating: 1, comment: BAD, transactionId: 1 }), "comment");
  assert.equal((await db.select().from(userReviews).where(eq(userReviews.reviewerId, me.id))).length, 0);

  await refused(await client.post("/api/items", { name: BAD, description: "Fine" }), "name");
  await refused(await client.post("/api/items", { name: "A drill", description: BAD }), "description");
  await refused(await client.post("/api/items", { name: "A drill", description: "Fine", brand: "sh1t" }), "brand");
  const listed = await db.select().from(items).where(eq(items.ownerId, me.id));
  assert.equal(listed.length, 0, "no listing was created");
});

test("editing a listing is checked too, and the stored text is untouched", async () => {
  const owner = await makeUser("owner");
  const [item] = await db
    .insert(items)
    .values({ ownerId: owner.id, name: `${UNIQUE}-drill`, description: "Cordless", conditionRating: 3, photos: [], shareCoinsReward: "0", isLendable: true } as any)
    .returning();
  itemIds.push(item.id);
  const client = await signIn(owner);
  await refused(await client.patch(`/api/items/${item.id}`, { name: "Renamed", description: BAD }), "description");
  const [row] = await db.select().from(items).where(eq(items.id, item.id));
  assert.equal(row.name, `${UNIQUE}-drill`);
  assert.equal(row.description, "Cordless");
});

test("the note on a request and on a counter-offer are checked", async () => {
  const owner = await makeUser("req-owner");
  const asker = await makeUser("req-asker");
  const [item] = await db
    .insert(items)
    .values({ ownerId: owner.id, name: `${UNIQUE}-gift`, description: "Free", conditionRating: 3, photos: [], shareCoinsReward: "0", isGift: true, isAvailable: true } as any)
    .returning();
  itemIds.push(item.id);
  const client = await signIn(asker);
  await refused(await client.post(`/api/items/${item.id}/request`, { requestType: "GIFT", message: BAD }), "message");
  await refused(await client.post("/api/requests/1/counter-proposal", { counterNote: BAD }), "counterNote");
});

test("sign-up refuses a name that is not allowed, before it looks at anything else", async () => {
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
  const client = new Client(baseUrl);
  const response = await client.post("/api/register", { username: `${UNIQUE}-reg@example.com`, password: PASSWORD, fullName: "sh1t head" });
  await refused(response, "fullName");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM users WHERE username = $1", [`${UNIQUE}-reg@example.com`])).rows[0].n, 0);
});

test("clean text passes every one of those checks", async () => {
  const me = await makeUser("clean");
  const other = await makeUser("clean-other");
  const client = await signIn(me);
  assert.equal((await client.post("/api/messages", { receiverId: other.id, content: "Is the shiitake grower still available? Thanks!" })).status, 201);
  assert.equal((await client.patch("/api/user-profile", { bio: "I lend tools and plants. Maine Coon owner." })).status, 200);
  assert.ok((await db.select().from(messages).where(and(eq(messages.senderId, me.id)))).length === 1);
});
