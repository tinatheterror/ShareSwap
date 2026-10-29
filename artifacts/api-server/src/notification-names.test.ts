import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, reputationActivities, userReviews, users } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";

// A notification is text another user reads, so it must name the sender by display name (or a username that
// is not an address), never by the email address an email account uses as its username. These tests look at
// the stored rows, not at what the API serves: the read-side scrub would hide a leak that is already written.

const UNIQUE = `notification-names-${Date.now()}`;
const PASSWORD = "NotificationNames!42";
const SENDER_EMAIL = `${UNIQUE}-sender@example.com`;
const NAMED_EMAIL = `${UNIQUE}-named@example.com`;
const RECIPIENT_EMAIL = `${UNIQUE}-recipient@example.com`;
const userIds: number[] = [];
let senderId: number;
let namedId: number;
let recipientId: number;
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
      // No display name: publicName has nothing to offer, so the route's own fallback must be used.
      { username: SENDER_EMAIL, email: SENDER_EMAIL, handle: `S${stamp}`, password, emailVerified: true, authProvider: "local" },
      { username: NAMED_EMAIL, email: NAMED_EMAIL, handle: `N${stamp}`, displayName: "Nina", password, emailVerified: true, authProvider: "local" },
      { username: RECIPIENT_EMAIL, email: RECIPIENT_EMAIL, handle: `R${stamp}`, displayName: "Rae", password, emailVerified: true, authProvider: "local" },
    ])
    .returning({ id: users.id });
  userIds.push(...rows.map((r) => r.id));
  [senderId, namedId, recipientId] = rows.map((r) => r.id);

  const [item] = await db
    .insert(items)
    .values({ name: `${UNIQUE}-item`, description: "x", photos: [], conditionRating: 5, shareCoinsReward: "1", ownerId: recipientId, isAvailable: true, isLendable: true, isGift: true })
    .returning({ id: items.id });
  itemId = item.id;
  const [request] = await db
    .insert(itemRequests)
    .values({ itemId, requesterId: senderId, requestType: "BORROW", status: "COMPLETED" })
    .returning({ id: itemRequests.id });
  requestId = request.id;
  ({ baseUrl, close: closeServer } = await startApp());
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
});

after(async () => {
  try {
    await db.delete(notifications).where(inArray(notifications.userId, userIds));
    await db.delete(userReviews).where(inArray(userReviews.reviewerId, userIds));
    await db.delete(reputationActivities).where(inArray(reputationActivities.userId, userIds));
    await db.delete(messages).where(inArray(messages.senderId, userIds));
    await db.delete(itemRequests).where(eq(itemRequests.itemId, itemId));
    await db.delete(items).where(eq(items.id, itemId));
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
  await client.fetchCsrfToken();
  return client;
}

const latest = async (type: string) => {
  const [row] = await db
    .select({ title: notifications.title, message: notifications.message })
    .from(notifications)
    .where(and(eq(notifications.userId, recipientId), eq(notifications.type, type)))
    .orderBy(desc(notifications.id))
    .limit(1);
  assert.ok(row, `a ${type} notification was written`);
  return row;
};

const noAddress = (row: { title: string; message: string }) => {
  for (const text of [row.title, row.message]) {
    assert.ok(!/[^\s@]+@[^\s@]+/.test(text), `notification text carries an address: ${text.replace(/[^\s@]+@[^\s@]+/g, "<address>")}`);
  }
};

test("wishlist_match names the lister by display name, or 'A neighbour' when there is none", async () => {
  const noName = await signIn(SENDER_EMAIL);
  const sent = await noName.post("/api/wishlist-match-notification", { itemId, wishlistId: 1, wishlistOwnerId: recipientId });
  assert.equal(sent.status, 200);
  const first = await latest("wishlist_match");
  noAddress(first);
  assert.match(first.message, /listed by A neighbour$/);

  const named = await signIn(NAMED_EMAIL);
  assert.equal((await named.post("/api/wishlist-match-notification", { itemId, wishlistId: 1, wishlistOwnerId: recipientId })).status, 200);
  const second = await latest("wishlist_match");
  noAddress(second);
  assert.match(second.message, /listed by Nina$/);
});

test("item_request names the requester by display name, or 'Someone' when there is none", async () => {
  for (const [email, expected] of [[SENDER_EMAIL, /^Someone wants to /], [NAMED_EMAIL, /^Nina wants to /]] as const) {
    const client = await signIn(email);
    const sent = await client.post(`/api/items/${itemId}/request`, { requestType: "GIFT", message: "hello" });
    assert.ok(sent.status < 300, `request answered ${sent.status}: ${await sent.clone().text()}`);
    const row = await latest("item_request");
    noAddress(row);
    assert.match(row.message, expected);
  }
});

test("new_review_received names the reviewer by display name, or 'A ShareSwap member' when there is none", async () => {
  const noName = await signIn(SENDER_EMAIL);
  const review = await noName.post(`/api/users/${recipientId}/reviews`, { rating: 5, comment: "lovely", transactionId: requestId });
  assert.ok(review.status < 300, `review answered ${review.status}: ${await review.clone().text()}`);
  const row = await latest("new_review_received");
  noAddress(row);
  assert.match(row.message, /^A ShareSwap member /);
});

test("trust_score_changed text never interpolates a person's name", () => {
  // These notifications are built from points, levels and item names. If a name is ever added to one, it has to
  // go through publicName and get a behavioural test like the three above, so fail until that is done.
  const sources = ["src/routes/routes.ts", "src/cancel-service.ts"].map((p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
  let sites = 0;
  for (const source of sources) {
    for (const match of source.matchAll(/type: "trust_score_changed"([\s\S]{0,900}?)isRead/g)) {
      sites += 1;
      const text = match[1];
      assert.ok(!/\b(username|displayName|fullName|handle|email|\w*Name)\b/.test(text.replace(/item\.name|itemName/g, "")), `a trust_score_changed notification builds text from a name:\n${text.trim().slice(0, 300)}`);
    }
  }
  assert.ok(sites >= 10, `expected to find the trust_score_changed insert sites, found ${sites}`);
});
