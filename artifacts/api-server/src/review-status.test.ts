import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, requestLifecycleEvents, users } from "@workspace/db";
import app from "./app.js";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";

// One code per request: the same for the whole request, never regenerated. 5 wrong tries lock entry for 15 minutes, then the
// same code works again. Behind HANDOFF_ONE_CODE (on unless off).

const UNIQUE = `review-status-${Date.now()}`;
const PASSWORD = "ReviewStatus!42";
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

async function seed(fields: Partial<typeof itemRequests.$inferInsert> = {}) {
  const [item] = await db.insert(items).values({
    ownerId, name: `${UNIQUE}-${itemIds.length}`, description: "x", conditionRating: 4, photos: [],
    isAvailable: true, replacementValue: 100, shareCoinsReward: "0", shareCoinPrice: "0",
  }).returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db.insert(itemRequests).values({
    itemId: item.id, requesterId, requestType: "SWAP", status: "ACCEPTED", acceptedAt: new Date(),
    ownerConfirmedHandoff: false, borrowerConfirmedHandoff: false,
    ...fields,
  } as typeof itemRequests.$inferInsert).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return request.id;
}
const load = async (id: number) => (await db.select().from(itemRequests).where(eq(itemRequests.id, id)))[0];
const deps = { onSwapAutoConfirmed: async () => {}, onGiftAutoConfirmed: async () => {} };

async function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  try {
    return await run();
  } finally {
    for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  }
}

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
    await pool.query("DELETE FROM user_reviews WHERE reviewer_id = ANY($1)", [userIds]);
    if (requestIds.length) await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    await closeServer();
    await pool.end();
  }
});




const status = async (client: Client, id: number) => (await (await client.get(`/api/requests/${id}/review-status`)).json()) as { reviewed: boolean; shouldPrompt: boolean };
const done = (type: string, fields: Partial<typeof itemRequests.$inferInsert> = {}) =>
  seed({ requestType: type, status: "COMPLETED", handoffConfirmedAt: new Date(), ...fields } as any);

for (const type of ["SWAP", "GIFT"]) {
  test(`a completed ${type}: both people are asked, the owner included`, async () => {
    const id = await done(type);
    assert.equal((await status(owner, id)).shouldPrompt, true);
    assert.equal((await status(requester, id)).shouldPrompt, true);
  });
}

test("a completed borrow or rental asks the borrower or renter; the owner already rated the condition at the return", async () => {
  for (const type of ["BORROW", "RENT"]) {
    const id = await done(type);
    assert.equal((await status(requester, id)).shouldPrompt, true, type);
    assert.equal((await status(owner, id)).shouldPrompt, false, type);
  }
});

test("nobody is asked twice, or when the request is not completed, or after the review window", async () => {
  const id = await done("SWAP");
  await pool.query("INSERT INTO user_reviews (reviewer_id, reviewed_user_id, transaction_id, rating, comment) VALUES ($1, $2, $3, 5, 'great')", [ownerId, requesterId, id]);
  assert.deepEqual(await status(owner, id), { reviewed: true, shouldPrompt: false });
  assert.equal((await status(requester, id)).shouldPrompt, true, "the other person's review does not count");

  const open = await seed({ requestType: "SWAP", status: "ACCEPTED" });
  assert.equal((await status(owner, open)).shouldPrompt, false);
  const old = await done("SWAP", { handoffConfirmedAt: new Date(Date.now() - 20 * 24 * HOUR) });
  assert.equal((await status(owner, old)).shouldPrompt, false);
});

test("only the two people on the request can ask", async () => {
  const id = await done("SWAP");
  const [u] = await db.insert(users).values({ username: `${UNIQUE}-stranger`, displayName: "Sam", password: await hashPassword(PASSWORD), emailVerified: true }).returning({ id: users.id });
  userIds.push(u.id);
  const stranger = await new Client().signIn(`${UNIQUE}-stranger`);
  assert.equal((await stranger.get(`/api/requests/${id}/review-status`)).status, 403);
});
