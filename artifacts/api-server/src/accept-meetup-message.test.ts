import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, requestLifecycleEvents, users } from "@workspace/db";
import app from "./app.js";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";

// Accepting a request posts "When and where can you meet?" from the owner, as a normal chat message. A borrow or rental names
// the day it starts; a gift or swap has no date to name.

const UNIQUE = `accept-meetup-${Date.now()}`;
const PASSWORD = "AcceptMeetup!42";
const HOUR = 3_600_000;
const userIds: number[] = [];
const itemIds: number[] = [];
const requestIds: number[] = [];
let ownerId: number;
let requesterId: number;
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
  post(path: string, body: unknown = {}) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.csrfToken) headers["x-csrf-token"] = this.csrfToken;
    return this.send(path, { method: "POST", headers, body: JSON.stringify(body) });
  }
  get(path: string) {
    return this.send(path);
  }
  patch(path: string, body: unknown = {}) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.csrfToken) headers["x-csrf-token"] = this.csrfToken;
    return this.send(path, { method: "PATCH", headers, body: JSON.stringify(body) });
  }
  async signIn(username: string) {
    assert.equal((await this.post("/api/login", { username, password: PASSWORD })).status, 200);
    this.csrfToken = ((await (await this.send("/api/csrf-token")).json()) as { csrfToken: string }).csrfToken;
    return this;
  }
}
let owner: Client;
let requester: Client;


async function seed(requestType: string, fields: Partial<typeof itemRequests.$inferInsert> = {}) {
  const [item] = await db.insert(items).values({
    ownerId, name: `${UNIQUE}-${itemIds.length}`, description: "x", conditionRating: 4, photos: [],
    isAvailable: true, replacementValue: 100, shareCoinsReward: "0", shareCoinPrice: "0",
    isGift: requestType === "GIFT", isLendable: requestType === "BORROW",
  }).returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db.insert(itemRequests).values({
    itemId: item.id, requesterId, requestType, status: "PENDING", message: "hi", ...fields,
  } as typeof itemRequests.$inferInsert).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return request.id;
}
const chat = async (id: number) =>
  (await db.select().from(messages).where(eq(messages.requestId, id))).filter((m) => m.messageType !== "event" && m.messageType !== "system");

test("accepting a gift posts the plain meet-up question from the owner", async () => {
  const id = await seed("GIFT");
  const res = await owner.patch(`/api/requests/${id}`, { status: "ACCEPTED" });
  assert.equal(res.status, 200, await res.clone().text());
  const sent = await chat(id);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, "When and where can you meet?");
  assert.equal(sent[0].senderId, ownerId);
  assert.equal(sent[0].receiverId, requesterId);
});

test("accepting a borrow names the day it starts", async () => {
  await db.update(users).set({ shareCoins: 1000 }).where(eq(users.id, requesterId));
  const id = await seed("BORROW", { startDate: new Date("2031-03-22T12:00:00Z"), endDate: new Date("2031-03-25T12:00:00Z"), depositMethod: "in_person" });
  const res = await owner.patch(`/api/requests/${id}`, { status: "ACCEPTED" });
  assert.equal(res.status, 200, await res.clone().text());
  const sent = await chat(id);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, "When and where can you meet on March 22nd?");
});

test("accepting after a counter and a counter-back names the day of the last counter", async () => {
  await db.update(users).set({ shareCoins: 1000 }).where(eq(users.id, requesterId));
  const id = await seed("BORROW", { startDate: new Date("2031-03-22T12:00:00Z"), endDate: new Date("2031-03-25T12:00:00Z"), depositMethod: "in_person" });
  // The owner counters with the 24th, the requester counters back with the 27th, and the owner accepts that.
  const first = await owner.post(`/api/requests/${id}/counter-proposal`, { startDate: "2031-03-24", endDate: "2031-03-26" });
  assert.equal(first.status, 200, await first.clone().text());
  const second = await requester.post(`/api/requests/${id}/respond-to-counter`, { counter: { startDate: "2031-03-27", endDate: "2031-03-29" } });
  assert.equal(second.status, 200, await second.clone().text());
  const accepted = await owner.post(`/api/requests/${id}/respond-to-counter`, { accept: true });
  assert.equal(accepted.status, 200, await accepted.clone().text());
  const sent = await chat(id);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, "When and where can you meet on March 27th?");
  assert.equal(sent[0].senderId, ownerId);
});

test("a counter that leaves the date blank keeps the earlier counter's day", async () => {
  await db.update(users).set({ shareCoins: 1000 }).where(eq(users.id, requesterId));
  const id = await seed("BORROW", { startDate: new Date("2031-04-01T12:00:00Z"), endDate: new Date("2031-04-04T12:00:00Z"), depositMethod: "in_person" });
  const first = await owner.post(`/api/requests/${id}/counter-proposal`, { startDate: "2031-04-02", endDate: "2031-04-05" });
  assert.equal(first.status, 200, await first.clone().text());
  const second = await requester.post(`/api/requests/${id}/respond-to-counter`, { counter: { counterNote: "Same day, please" } });
  assert.equal(second.status, 200, await second.clone().text());
  const accepted = await owner.post(`/api/requests/${id}/respond-to-counter`, { accept: true });
  assert.equal(accepted.status, 200, await accepted.clone().text());
  const sent = await chat(id);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, "When and where can you meet on April 2nd?");
});

test("a gift can't be countered", async () => {
  const id = await seed("GIFT");
  const res = await owner.post(`/api/requests/${id}/counter-proposal`, { counterNote: "How about tomorrow?" });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /can't be countered/);
});

test("declining a request posts no meet-up question", async () => {
  const id = await seed("GIFT");
  const res = await owner.patch(`/api/requests/${id}`, { status: "DECLINED" });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await chat(id)).length, 0);
});

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  const password = await hashPassword(PASSWORD);
  const [o, r] = await db.insert(users).values([
    { username: `${UNIQUE}-owner`, displayName: "Olive Owner", password, emailVerified: true },
    { username: `${UNIQUE}-requester`, displayName: "Remy Requester", password, emailVerified: true },
  ]).returning({ id: users.id });
  ownerId = o.id;
  requesterId = r.id;
  userIds.push(o.id, r.id);
  const server = registerRoutes(app, { startBackgroundJobs: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  owner = await new Client().signIn(`${UNIQUE}-owner`);
  requester = await new Client().signIn(`${UNIQUE}-requester`);
});

after(async () => {
  try {
    if (requestIds.length) {
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
      await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, requestIds));
      await pool.query("DELETE FROM reputation_activities WHERE request_id = ANY($1)", [requestIds]);
    }
    if (userIds.length) {
      await pool.query("DELETE FROM user_achievements WHERE user_id = ANY($1)", [userIds]);
      await db.delete(notifications).where(inArray(notifications.userId, userIds));
    }
    if (requestIds.length) await pool.query("DELETE FROM delivery_arrangements WHERE request_id = ANY($1)", [requestIds]);
    await pool.query("DELETE FROM sharecoin_holds WHERE payer_id = ANY($1)", [userIds]);
    await pool.query("DELETE FROM user_reviews WHERE reviewer_id = ANY($1)", [userIds]);
    if (requestIds.length) await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    await closeServer();
    await pool.end();
  }
});
