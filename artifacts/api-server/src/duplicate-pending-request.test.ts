import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, requestLifecycleEvents, shareCoinHolds, users } from "@workspace/db";
import app from "./app.js";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";
import { DUPLICATE_PENDING_REQUEST_CODE, DUPLICATE_PENDING_REQUEST_MESSAGE } from "./item-availability.js";

// One pending request per person per item: a second one from the same person for the same item is refused until the first
// is answered or withdrawn.

const UNIQUE = `dup-pending-${Date.now()}`;
const PASSWORD = "DupPending!42";
const userIds: number[] = [];
const itemIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;
let ownerId: number;
let alice: Client;
let bob: Client;
let aliceId: number;

class Client {
  private cookies = new Map<string, string>();
  private csrfToken = "";

  private async send(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("x-forwarded-proto", "https");
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";", 1);
      const i = pair.indexOf("=");
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return response;
  }

  private async call(method: string, path: string, body: unknown) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.csrfToken) headers["x-csrf-token"] = this.csrfToken;
    const response = await this.send(path, { method, headers, body: JSON.stringify(body) });
    const text = await response.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: response.status, json, text };
  }

  post(path: string, body: unknown = {}) { return this.call("POST", path, body); }

  async signIn(username: string) {
    assert.equal((await this.post("/api/login", { username, password: PASSWORD })).status, 200);
    this.csrfToken = ((await (await this.send("/api/csrf-token")).json()) as { csrfToken: string }).csrfToken;
    return this;
  }
}

async function newItem(by: number) {
  const [item] = await db.insert(items).values({
    ownerId: by, name: `${UNIQUE}-item-${itemIds.length}`, description: "x", conditionRating: 4, photos: [], isAvailable: true,
    isGift: true, isSwappable: true, replacementValue: 100, shareCoinsReward: "0", shareCoinPrice: "14.00", tier: 2,
  } as typeof items.$inferInsert).returning({ id: items.id });
  itemIds.push(item.id);
  return item.id;
}

const askForGift = (who: Client, itemId: number) => who.post(`/api/items/${itemId}/request`, { requestType: "GIFT", message: "please" });
const pendingCount = async (itemId: number, by: number) =>
  (await db.select({ id: itemRequests.id }).from(itemRequests).where(and(eq(itemRequests.itemId, itemId), eq(itemRequests.requesterId, by), eq(itemRequests.status, "PENDING")))).length;

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  const password = await hashPassword(PASSWORD);
  const [o, a, b] = await db.insert(users).values([
    { username: `${UNIQUE}-owner`, displayName: "Odin Owner", password, emailVerified: true, shareCoins: "100.00" },
    { username: `${UNIQUE}-alice`, displayName: "Alma Asker", password, emailVerified: true, shareCoins: "100.00" },
    { username: `${UNIQUE}-bob`, displayName: "Beau Asker", password, emailVerified: true, shareCoins: "100.00" },
  ]).returning({ id: users.id });
  [ownerId, aliceId] = [o.id, a.id];
  userIds.push(o.id, a.id, b.id);
  const server = registerRoutes(app, { startBackgroundJobs: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  alice = await new Client().signIn(`${UNIQUE}-alice`);
  bob = await new Client().signIn(`${UNIQUE}-bob`);
});

after(async () => {
  try {
    const created = itemIds.length ? await db.select({ id: itemRequests.id }).from(itemRequests).where(inArray(itemRequests.itemId, itemIds)) : [];
    const all = created.map((r) => r.id);
    if (all.length) {
      await db.delete(messages).where(inArray(messages.requestId, all));
      await db.delete(notifications).where(inArray(notifications.requestId, all));
      await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, all));
      await db.delete(shareCoinHolds).where(inArray(shareCoinHolds.requestId, all));
      await db.delete(itemRequests).where(inArray(itemRequests.id, all));
    }
    if (userIds.length) await db.delete(notifications).where(inArray(notifications.userId, userIds));
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    await closeServer();
    await pool.end();
  }
});

test("a second pending request from the same person for the same item is refused, with a clear message, and creates nothing", async () => {
  const item = await newItem(ownerId);
  const first = await askForGift(alice, item);
  assert.equal(first.status, 201, first.text.slice(0, 200));
  const second = await askForGift(alice, item);
  assert.equal(second.status, 409);
  assert.equal(second.json.code, DUPLICATE_PENDING_REQUEST_CODE);
  assert.equal(second.json.error, DUPLICATE_PENDING_REQUEST_MESSAGE);
  assert.equal(second.json.requestId, first.json.id, "it points at the request already waiting");
  assert.equal(await pendingCount(item, aliceId), 1);
});

test("whatever the type: a swap request for an item already requested as a gift is refused too", async () => {
  const item = await newItem(ownerId);
  const mine = await newItem(aliceId);
  assert.equal((await askForGift(alice, item)).status, 201);
  const swap = await alice.post(`/api/items/${item}/request`, { requestType: "SWAP", swapOfferedItemIds: [mine] });
  assert.equal(swap.status, 409);
  assert.equal(swap.json.code, DUPLICATE_PENDING_REQUEST_CODE);
});

test("someone else can still ask for the item, and the same person can ask for another item", async () => {
  const item = await newItem(ownerId);
  const other = await newItem(ownerId);
  assert.equal((await askForGift(alice, item)).status, 201);
  assert.equal((await askForGift(bob, item)).status, 201, "a different person");
  assert.equal((await askForGift(alice, other)).status, 201, "a different item");
});

test("once the first request is withdrawn there is room for another", async () => {
  const item = await newItem(ownerId);
  const first = await askForGift(alice, item);
  assert.equal(first.status, 201);
  assert.equal((await askForGift(alice, item)).status, 409);
  assert.equal((await alice.post(`/api/requests/${first.json.id}/withdraw`)).status, 200);
  assert.equal((await askForGift(alice, item)).status, 201);
  assert.equal(await pendingCount(item, aliceId), 1);
});

test("two taps at once: exactly one request is created", async () => {
  const item = await newItem(ownerId);
  const [a, b] = await Promise.all([askForGift(alice, item), askForGift(alice, item)]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(await pendingCount(item, aliceId), 1);
});
