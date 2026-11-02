import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray, or } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, userBlocks, users, wishlistOffers, wishlists } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { MAX_MESSAGE_LENGTH, MESSAGES_PER_WINDOW } from "./message-limit.js";

// A block hides each person from the other, whoever pressed it: listings, profiles, wishlist posts, messages. Messages are
// also validated and rate limited, since they are how one person reaches another.

const UNIQUE = `blk-${Date.now()}`;
const PASSWORD = "Blocked!42";
const userIds: number[] = [];
const itemIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;
let counter = 0;

async function makeUser(label: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const n = ++counter;
  const [row] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${label}`, password: await hashPassword(PASSWORD), emailVerified: true, handle: `${UNIQUE}h${n}`, displayName: `Name ${label}`, referralCode: `${UNIQUE}r${n}`, ...extra })
    .returning();
  userIds.push(row.id);
  return row;
}

async function makeItem(ownerId: number, extra: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(items)
    .values({ ownerId, name: `${UNIQUE}-item-${++counter}`, description: "A description", conditionRating: 3, photos: ["/uploads/item-photo.jpg"], shareCoinsReward: "0", isLendable: true, isGift: true, latitude: 45.5, longitude: -73.5, address: "1 Home St", ...extra } as any)
    .returning();
  itemIds.push(row.id);
  return row;
}

async function signIn(user: { username: string }) {
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
  const client = new Client(baseUrl);
  assert.equal((await client.post("/api/login", { username: user.username, password: PASSWORD })).status, 200);
  await client.fetchCsrfToken();
  return client;
}

const browseIds = async (client: Client) => ((await (await client.get("/api/items")).json()) as { id: number }[]).map((i) => i.id);
const wishlistIds = async (client: Client) => ((await (await client.get("/api/wishlists")).json()) as { id: number }[]).map((w) => w.id);
const thread = async (client: Client, partnerId: number) => (await (await client.get(`/api/messages/${partnerId}`)).json()) as { content: string; messageType: string }[];
const conversationPartners = async (client: Client) => ((await (await client.get("/api/conversations")).json()) as { userId: number }[]).map((c) => c.userId);
const send = (client: Client, receiverId: unknown, content: unknown, extra: Record<string, unknown> = {}) => client.post("/api/messages", { receiverId, content, ...extra });

before(async () => {
  ({ baseUrl, close: closeServer } = await startApp());
});

after(async () => {
  try {
    if (userIds.length) {
      await db.delete(messages).where(or(inArray(messages.senderId, userIds), inArray(messages.receiverId, userIds)));
      await db.delete(wishlistOffers).where(inArray(wishlistOffers.userId, userIds));
      await db.delete(wishlists).where(inArray(wishlists.userId, userIds));
      await db.delete(userBlocks).where(or(inArray(userBlocks.blockerId, userIds), inArray(userBlocks.blockedId, userIds)));
    }
    if (itemIds.length) {
      await db.delete(notifications).where(inArray(notifications.itemId, itemIds));
      await db.delete(itemRequests).where(inArray(itemRequests.itemId, itemIds));
      await db.delete(items).where(inArray(items.id, itemIds));
    }
    if (userIds.length) await db.delete(notifications).where(inArray(notifications.userId, userIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%' OR key LIKE 'messages:%'");
  } finally {
    await closeServer?.();
    await pool.end();
  }
});

test("the block endpoints need a sign-in, refuse bad targets, and are idempotent", async () => {
  const me = await makeUser("api-me");
  const other = await makeUser("api-other");
  const banned = await makeUser("api-banned", { accountStatus: "banned" });
  const client = await signIn(me);

  const anonymous = new Client(baseUrl);
  await anonymous.fetchCsrfToken();
  assert.equal((await anonymous.get("/api/blocks")).status, 401);
  assert.equal((await anonymous.post(`/api/blocks/${other.id}`)).status, 401);

  assert.equal((await client.post(`/api/blocks/${me.id}`)).status, 400, "yourself");
  assert.equal((await client.post("/api/blocks/not-a-number")).status, 400);
  assert.equal((await client.post("/api/blocks/999999999")).status, 404, "missing");
  assert.equal((await client.post(`/api/blocks/${banned.id}`)).status, 404, "an account that is already gone");

  assert.equal((await client.post(`/api/blocks/${other.id}`)).status, 201);
  assert.equal((await client.post(`/api/blocks/${other.id}`)).status, 200, "a repeat is not an error");
  const list = (await (await client.get("/api/blocks")).json()) as { userId: number; username: string; blockedAt: string }[];
  assert.deepEqual(list.map((b) => b.userId), [other.id]);
  assert.ok(!JSON.stringify(list).includes("@"), "no email address in the list");
  assert.equal((await db.select().from(userBlocks).where(eq(userBlocks.blockerId, me.id))).length, 1);

  assert.equal((await client.delete(`/api/blocks/${other.id}`)).status, 200);
  assert.equal((await client.delete(`/api/blocks/${other.id}`)).status, 200, "unblocking twice is fine");
  assert.deepEqual(await (await client.get("/api/blocks")).json(), []);
});

test("a block hides listings, profiles and wishlist posts both ways, and unblocking brings them back", async () => {
  const a = await makeUser("vis-a");
  const b = await makeUser("vis-b");
  const bystander = await makeUser("vis-c");
  const itemA = await makeItem(a.id);
  const itemB = await makeItem(b.id);
  const [wishA] = await db.insert(wishlists).values({ userId: a.id, itemName: `${UNIQUE}-wish-a` }).returning();
  const [wishB] = await db.insert(wishlists).values({ userId: b.id, itemName: `${UNIQUE}-wish-b` }).returning();
  const ca = await signIn(a);
  const cb = await signIn(b);
  const cc = await signIn(bystander);

  assert.ok((await browseIds(ca)).includes(itemB.id) && (await browseIds(cb)).includes(itemA.id));
  assert.ok((await wishlistIds(ca)).includes(wishB.id));

  assert.equal((await ca.post(`/api/blocks/${b.id}`)).status, 201);

  for (const [who, client, theirs, theirWish, theirUser] of [
    ["the blocker", ca, itemB, wishB, b],
    ["the blocked person", cb, itemA, wishA, a],
  ] as const) {
    assert.ok(!(await browseIds(client)).includes(theirs.id), `${who}: browse`);
    assert.equal((await client.get(`/api/items/${theirs.id}`)).status, 404, `${who}: item page`);
    assert.ok(!(await wishlistIds(client)).includes(theirWish.id), `${who}: wishlist feed`);
    for (const path of [`/api/users/${theirUser.id}/public-profile`, `/api/users/${theirUser.id}/reputation`, `/api/users/username/${theirUser.handle}`, `/api/users/username/${theirUser.handle}/items`]) {
      assert.equal((await client.get(path)).status, 404, `${who}: ${path}`);
    }
    const request = await client.post(`/api/items/${theirs.id}/request`, { requestType: "GIFT" });
    assert.equal(request.status, 404, `${who}: cannot request`);
  }

  // Everyone else is untouched, and a gift request from them is not refused for being hidden.
  const unblocked = await cc.post(`/api/items/${itemA.id}/request`, { requestType: "GIFT" });
  assert.notEqual(unblocked.status, 404, `a bystander's request is not hidden (${unblocked.status})`);
  assert.ok(unblocked.status < 500, `${unblocked.status}`);

  assert.ok((await browseIds(cc)).includes(itemA.id) && (await browseIds(cc)).includes(itemB.id));
  assert.equal((await cc.get(`/api/users/${a.id}/public-profile`)).status, 200);
  assert.ok((await wishlistIds(cc)).includes(wishA.id));

  assert.equal((await cb.delete(`/api/blocks/${a.id}`)).status, 200, "the blocked person cannot lift it");
  assert.ok(!(await browseIds(cb)).includes(itemA.id));
  assert.equal((await ca.delete(`/api/blocks/${b.id}`)).status, 200);
  assert.ok((await browseIds(ca)).includes(itemB.id) && (await browseIds(cb)).includes(itemA.id));
  assert.equal((await ca.get(`/api/users/${b.id}/public-profile`)).status, 200);
});

test("messages cannot cross a block, whoever blocked, and the refusal does not say who", async () => {
  const a = await makeUser("msg-a");
  const b = await makeUser("msg-b");
  const ca = await signIn(a);
  const cb = await signIn(b);
  assert.equal((await send(ca, b.id, "hello")).status, 201);

  assert.equal((await ca.post(`/api/blocks/${b.id}`)).status, 201);
  const fromBlocker = await send(ca, b.id, "still there?");
  const fromBlocked = await send(cb, a.id, "hello?");
  assert.equal(fromBlocker.status, 403);
  assert.equal(fromBlocked.status, 403);
  assert.deepEqual(await fromBlocker.json(), await fromBlocked.json(), "identical bodies");

  assert.equal((await ca.delete(`/api/blocks/${b.id}`)).status, 200);
  assert.equal((await send(cb, a.id, "back again")).status, 201);
});

test("text across a block is hidden for both sides while system events stay, and unblocking restores the text", async () => {
  const a = await makeUser("thr-a");
  const b = await makeUser("thr-b");
  const ca = await signIn(a);
  const cb = await signIn(b);
  await send(ca, b.id, "text from a");
  await send(cb, a.id, "text from b");
  await db.insert(messages).values({ senderId: a.id, receiverId: b.id, content: "Handoff confirmed", messageType: "event", metadata: { eventType: "handoff_confirmed" } } as any);
  assert.deepEqual((await thread(ca, b.id)).map((m) => m.content), ["text from a", "text from b", "Handoff confirmed"]);
  assert.ok((await conversationPartners(ca)).includes(b.id));

  await ca.post(`/api/blocks/${b.id}`);
  for (const [who, client, partner] of [["blocker", ca, b], ["blocked", cb, a]] as const) {
    assert.deepEqual((await thread(client, partner.id)).map((m) => m.content), ["Handoff confirmed"], `${who}: only the system event`);
  }
  // The conversation list shows the system event as its last line, never the hidden text.
  const list = (await (await ca.get("/api/conversations")).json()) as { userId: number; lastMessage: string }[];
  assert.equal(list.find((c) => c.userId === b.id)?.lastMessage, "Handoff confirmed");

  await ca.delete(`/api/blocks/${b.id}`);
  assert.deepEqual((await thread(ca, b.id)).map((m) => m.content), ["text from a", "text from b", "Handoff confirmed"]);
});

test("a message needs a real recipient, real text of a sensible length, and a real request id", async () => {
  const a = await makeUser("val-a");
  const b = await makeUser("val-b");
  const gone = await makeUser("val-gone", { accountStatus: "deleted" });
  const ca = await signIn(a);

  for (const [label, receiver, content, extra, status] of [
    ["no receiver", undefined, "hi", {}, 400],
    ["receiver is text", "someone", "hi", {}, 400],
    ["receiver is negative", -3, "hi", {}, 400],
    ["receiver is fractional", 1.5, "hi", {}, 400],
    ["messaging yourself", a.id, "hi", {}, 400],
    ["no content", b.id, undefined, {}, 400],
    ["content is a number", b.id, 42, {}, 400],
    ["content is an object", b.id, { text: "hi" }, {}, 400],
    ["content is blank", b.id, "   \n\t ", {}, 400],
    ["content is too long", b.id, "x".repeat(MAX_MESSAGE_LENGTH + 1), {}, 400],
    ["request id is text", b.id, "hi", { requestId: "abc" }, 400],
    ["request id is zero", b.id, "hi", { requestId: 0 }, 400],
    ["receiver does not exist", 999999999, "hi", {}, 404],
    ["receiver was deleted", gone.id, "hi", {}, 404],
  ] as const) {
    const response = await send(ca, receiver, content, extra as Record<string, unknown>);
    assert.equal(response.status, status, label);
  }
  assert.equal((await db.select().from(messages).where(eq(messages.senderId, a.id))).length, 0, "nothing was stored");

  const ok = await send(ca, String(b.id), `  ${"x".repeat(MAX_MESSAGE_LENGTH - 4)}  `);
  assert.equal(ok.status, 201, "a numeric-string id and surrounding spaces are fine");
  const stored = (await ok.json()) as { content: string; receiverId: number };
  assert.equal(stored.receiverId, b.id);
  assert.equal(stored.content.length, MAX_MESSAGE_LENGTH - 4, "stored trimmed");
});

test("sending is limited per signed-in user, and one user's limit is not another's", async () => {
  const spammer = await makeUser("rate-a");
  const other = await makeUser("rate-b");
  const target = await makeUser("rate-c");
  const cs = await signIn(spammer);
  const co = await signIn(other);
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'messages:%'");

  for (let i = 0; i < MESSAGES_PER_WINDOW; i++) {
    const response = await send(cs, target.id, `message ${i}`);
    assert.equal(response.status, 201, `message ${i}`);
  }
  const limited = await send(cs, target.id, "one too many");
  assert.equal(limited.status, 429);
  assert.equal(((await limited.json()) as { code: string }).code, "MESSAGE_RATE_LIMITED");
  assert.equal((await send(co, target.id, "I am a different user")).status, 201);
  assert.equal((await db.select().from(messages).where(eq(messages.senderId, spammer.id))).length, MESSAGES_PER_WINDOW, "the refused one was not stored");
});

test("offers and match notifications cannot cross a block, and a notification only goes to the real wishlist owner", async () => {
  const wisher = await makeUser("wl-wisher");
  const lister = await makeUser("wl-lister");
  const third = await makeUser("wl-third");
  const [wish] = await db.insert(wishlists).values({ userId: wisher.id, itemName: `${UNIQUE}-wanted` }).returning();
  const item = await makeItem(lister.id);
  const cl = await signIn(lister);
  const cw = await signIn(wisher);

  const notify = (body: Record<string, unknown>) => cl.post("/api/wishlist-match-notification", body);
  assert.equal((await notify({ itemId: item.id, wishlistId: wish.id, wishlistOwnerId: third.id })).status, 404, "not that wishlist's owner");
  assert.equal((await notify({ itemId: item.id, wishlistId: 999999999, wishlistOwnerId: wisher.id })).status, 404, "no such wishlist");
  assert.equal((await notify({ itemId: item.id, wishlistId: wish.id, wishlistOwnerId: wisher.id })).status, 200);

  await cw.post(`/api/blocks/${lister.id}`);
  assert.equal((await notify({ itemId: item.id, wishlistId: wish.id, wishlistOwnerId: wisher.id })).status, 404, "blocked: no notification");
  assert.equal((await cl.post("/api/wishlist-offers", { wishlistId: wish.id })).status, 404, "blocked: no offer");
  await cw.delete(`/api/blocks/${lister.id}`);
  assert.equal((await cl.post("/api/wishlist-offers", { wishlistId: wish.id })).status, 200);
});

test("a review cannot be left across a block", async () => {
  const a = await makeUser("rev-a");
  const b = await makeUser("rev-b");
  const ca = await signIn(a);
  await ca.post(`/api/blocks/${b.id}`);
  const response = await ca.post(`/api/users/${b.id}/reviews`, { rating: 1, comment: "bad", transactionId: 1 });
  assert.equal(response.status, 403);
});
