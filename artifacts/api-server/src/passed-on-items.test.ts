import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, notifications, pool, users } from "@workspace/db";
import app from "./app.js";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";
import { goneItemFor, ITEM_NO_LONGER_AVAILABLE_MESSAGE } from "./item-availability.js";
import { ITEM_PASSED_ON_CODE, ITEM_PASSED_ON_MESSAGE } from "./passed-on-items.js";
import { cancelDeletion } from "./account-deletion/service.js";

// A swapped or given-away item is gone for good: it cannot be relisted, account reactivation and cancelling a deletion do
// not turn it back on, the apps are told it was gifted, the pickers leave it out and accepting counts it as gone.

const UNIQUE = `passed-on-${Date.now()}`;
const PASSWORD = "PassedOn!42";
const DAY = 24 * 3_600_000;
const userIds: number[] = [];
const itemIds: number[] = [];
const requestIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;

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

  private async call(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.csrfToken) headers["x-csrf-token"] = this.csrfToken;
    const response = await this.send(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: response.status, json, text };
  }

  get(path: string) { return this.call("GET", path); }
  post(path: string, body: unknown = {}) { return this.call("POST", path, body); }

  async prime() {
    this.csrfToken = ((await (await this.send("/api/csrf-token")).json()) as { csrfToken: string }).csrfToken;
    return this;
  }

  async signIn(username: string) {
    assert.equal((await this.post("/api/login", { username, password: PASSWORD })).status, 200);
    return this.prime();
  }
}

async function newUser(tag: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db.insert(users).values({ username: `${UNIQUE}-${tag}`, displayName: `Pat ${tag}`, password: await hashPassword(PASSWORD), emailVerified: true, shareCoins: "100.00", ...extra } as typeof users.$inferInsert).returning({ id: users.id });
  userIds.push(u.id);
  return { id: u.id, username: `${UNIQUE}-${tag}` };
}

async function newItem(by: number, extra: Partial<typeof items.$inferInsert> = {}) {
  const [item] = await db.insert(items).values({
    ownerId: by, name: `${UNIQUE}-item-${itemIds.length}`, description: "x", conditionRating: 4, photos: [], isAvailable: true,
    isGift: true, isSwappable: true, isLendable: true, replacementValue: 100, shareCoinsReward: "0", shareCoinPrice: "14.00", tier: 2, ...extra,
  } as typeof items.$inferInsert).returning({ id: items.id });
  itemIds.push(item.id);
  return item.id;
}

async function request(itemId: number, by: number, requestType: string, fields: Partial<typeof itemRequests.$inferInsert> = {}) {
  const [row] = await db.insert(itemRequests).values({
    itemId, requesterId: by, requestType, status: "PENDING",
    ...(requestType === "BORROW" ? { startDate: new Date(Date.now() + 10 * DAY), endDate: new Date(Date.now() + 17 * DAY), depositMethod: "in_person" } : {}),
    ...fields,
  } as typeof itemRequests.$inferInsert).returning({ id: itemRequests.id });
  requestIds.push(row.id);
  return row.id;
}

/** An owner with a swapped item, a gifted item (completed gift) and an ordinary one, all unlisted. */
async function scenario(tag: string, askerId: number) {
  const user = await newUser(tag);
  const swapped = await newItem(user.id, { isAvailable: false, isSwapped: true });
  const gifted = await newItem(user.id, { isAvailable: false });
  await request(gifted, askerId, "GIFT", { status: "COMPLETED" });
  const plain = await newItem(user.id, { isAvailable: false });
  return { ...user, swapped, gifted, plain };
}

const availableOf = async (id: number) => (await db.select({ a: items.isAvailable }).from(items).where(eq(items.id, id)))[0].a;

let asker: { id: number; username: string };

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  asker = await newUser("asker");
  const server = registerRoutes(app, { startBackgroundJobs: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

after(async () => {
  try {
    const created = itemIds.length ? await db.select({ id: itemRequests.id }).from(itemRequests).where(inArray(itemRequests.itemId, itemIds)) : [];
    const all = [...new Set([...requestIds, ...created.map((r) => r.id)])];
    if (all.length) {
      await db.delete(notifications).where(inArray(notifications.requestId, all));
      await db.delete(itemRequests).where(inArray(itemRequests.id, all));
    }
    if (userIds.length) await db.delete(notifications).where(inArray(notifications.userId, userIds));
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    await closeServer();
    await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
    await pool.end();
  }
});

test("relist refuses a swapped item and a gifted item, and still relists an ordinary one", async () => {
  const s = await scenario("relist", asker.id);
  const client = await new Client().signIn(s.username);

  for (const id of [s.swapped, s.gifted]) {
    const refused = await client.post(`/api/items/${id}/relist`, {});
    assert.equal(refused.status, 409);
    assert.equal(refused.json.code, ITEM_PASSED_ON_CODE);
    assert.equal(refused.json.error, ITEM_PASSED_ON_MESSAGE);
    assert.equal(await availableOf(id), false, "the refused relist left the item unlisted");
  }

  const ok = await client.post(`/api/items/${s.plain}/relist`, {});
  assert.equal(ok.status, 200);
  assert.equal(await availableOf(s.plain), true);
});

test("relist also refuses a gift that completed early", async () => {
  const user = await newUser("relist-early");
  const item = await newItem(user.id, { isAvailable: false });
  await request(item, asker.id, "GIFT", { status: "COMPLETED_EARLY" });
  const client = await new Client().signIn(user.username);
  assert.equal((await client.post(`/api/items/${item}/relist`, {})).status, 409);
  assert.equal(await availableOf(item), false);
});

