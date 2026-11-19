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

const UNIQUE = `handoff-code-lockout-${Date.now()}`;
const PASSWORD = "CodeLockout!42";
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
    if (requestIds.length) await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    await closeServer();
    await pool.end();
  }
});



let currentId = 0;
const verify = (pin: string) => requester.post(`/api/requests/${currentId}/verify-pin`, { pin });
const futureCutoff = () => new Date(Date.now() + 5 * 24 * HOUR);

async function giftWithCode(pin = "4821") {
  const id = await seed({ requestType: "GIFT", status: "ACCEPTED", handoffPin: pin, pinExpiresAt: futureCutoff(), pinAttempts: 0 } as any);
  currentId = id;
  return id;
}

test("five wrong tries lock entry for 15 minutes; during the lockout even the right code is refused", async () => {
  const id = await giftWithCode();
  for (const remaining of [4, 3, 2, 1]) {
    const res = await verify("0000");
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as any).attemptsRemaining, remaining);
  }
  const before = Date.now();
  const fifth = await verify("0000");
  assert.equal(fifth.status, 429);
  const body = (await fifth.json()) as any;
  assert.equal(body.rateLimited, true);
  assert.equal(body.minutesRemaining, 15);
  assert.equal(body.error, "Too many tries. Try again in 15 minutes.");
  const locked = (await load(id)) as any;
  const left = locked.pinLockedUntil.getTime() - before;
  assert.ok(left > 14.9 * 60_000 && left < 15.1 * 60_000, "locked for 15 minutes");

  const right = await verify("4821");
  assert.equal(right.status, 429, "the right code is refused while locked");
  assert.equal((await load(id)).status, "ACCEPTED");

  // The requester's screen is told how long is left.
  const state = (await (await requester.get(`/api/requests/${id}/handoff-code-state`)).json()) as any;
  assert.equal(state.locked, true);
  assert.equal(state.minutesRemaining, 15);
  assert.equal(state.otherName, "Olive Owner");
  assert.equal(state.role, "requester");
});

test("when the lockout ends the same code works again, with a fresh set of tries", async () => {
  const id = await giftWithCode();
  for (let i = 0; i < 5; i++) await verify("1111");
  await pool.query("UPDATE item_requests SET pin_locked_until = now() - interval '1 second' WHERE id = $1", [id]);

  const state = (await (await requester.get(`/api/requests/${id}/handoff-code-state`)).json()) as any;
  assert.equal(state.locked, false);
  const wrong = await verify("2222");
  assert.equal(wrong.status, 400, "tries start over after a lockout");
  assert.equal(((await wrong.json()) as any).attemptsRemaining, 4);

  const right = await verify("4821");
  assert.equal(right.status, 200);
  const done = await load(id);
  assert.equal(done.status, "COMPLETED");
  assert.equal(done.pinUsed, true);
});

test("the owner always sees the same code, and nobody else can fetch it", async () => {
  const id = await giftWithCode("7305");
  const first = (await (await owner.get(`/api/requests/${id}/handoff-pin`)).json()) as any;
  const second = (await (await owner.get(`/api/requests/${id}/handoff-pin`)).json()) as any;
  assert.equal(first.pin, "7305");
  assert.equal(second.pin, "7305");
  assert.equal((await requester.get(`/api/requests/${id}/handoff-pin`)).status, 403);
  const state = (await (await owner.get(`/api/requests/${id}/handoff-code-state`)).json()) as any;
  assert.equal(state.role, "owner");
  assert.equal(state.otherName, "Remy Requester");
});

test("accepting a request issues one code; accepting again keeps it and its tries", async () => {
  const id = await seed({ requestType: "GIFT", status: "PENDING" });
  const accept = () => owner.patch(`/api/requests/${id}`, { status: "ACCEPTED" });
  assert.equal((await accept()).status, 200);
  const first = (await load(id)) as any;
  assert.match(first.handoffPin, /^\d{4}$/);
  assert.ok(first.pinExpiresAt.getTime() - Date.now() > 5 * 24 * HOUR, "a gift's code lasts until the gift expires, not 24 hours");

  await pool.query("UPDATE item_requests SET status = 'PENDING', pin_attempts = 3 WHERE id = $1", [id]);
  await pool.query("DELETE FROM sharecoin_holds WHERE request_id = $1", [id]);
  assert.equal((await accept()).status, 200);
  const second = (await load(id)) as any;
  assert.equal(second.handoffPin, first.handoffPin, "the code is never regenerated");
  assert.equal(second.pinAttempts, 3, "and its tries are kept");
});

test("HANDOFF_ONE_CODE=off keeps the old rule of a permanent lock after 5 tries", async () => {
  await withEnv({ HANDOFF_ONE_CODE: "off" }, async () => {
    const id = await giftWithCode();
    for (let i = 0; i < 5; i++) await verify("0000");
    const locked = await verify("4821");
    assert.equal(locked.status, 429);
    assert.equal(((await locked.json()) as any).lockedUntil, undefined);
    assert.equal(((await load(id)) as any).pinLockedUntil, null);
    assert.equal((await load(id)).status, "ACCEPTED");
  });
});
