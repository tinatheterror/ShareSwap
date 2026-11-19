import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, requestLifecycleEvents, users } from "@workspace/db";
import app from "./app.js";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { requestHandoffCutoff, runRequestExpirySweep, type RequestExpiryDeps } from "./request-expiry-service.js";
import { formatHandoffCutoff } from "./request-dates.js";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";

// The owner-only warning, 24 hours before the handoff cutoff, for a borrow or rental whose code has not been entered:
// "[name] hasn't entered the handoff code. If you've handed it over, report a problem before [date, time]."
// Behind HANDOFF_OWNER_WARNING (on unless off), separate from the expiry reminders switch.

const UNIQUE = `handoff-owner-warning-${Date.now()}`;
const PASSWORD = "OwnerWarning!42";
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




const pushes: { userId: number; body: string }[] = [];
const sweepDeps = { push: (userId: number, payload: { body: string }) => void pushes.push({ userId, body: payload.body }) } as unknown as RequestExpiryDeps;
const dayMs = 24 * HOUR;

async function borrow(fields: Partial<typeof itemRequests.$inferInsert> = {}) {
  const id = await seed({
    requestType: "BORROW", status: "ACCEPTED", depositMethod: "in_person",
    startDate: new Date("2031-03-10T12:00:00Z"), endDate: new Date("2031-03-12T12:00:00Z"),
    ...fields,
  } as any);
  const cutoff = requestHandoffCutoff(await load(id))!;
  return { id, cutoff };
}
const warnings = (id: number) => db.select().from(notifications).where(eq(notifications.requestId, id)).then((rows) => rows.filter((n) => n.type === "handoff_code_warning"));
const sweep = (id: number, now: Date, extra: Record<string, unknown> = {}) => runRequestExpirySweep(sweepDeps, { now, onlyRequestIds: [id], reminders: false, ...extra });

test("24 hours before the cutoff the owner, and only the owner, is warned once, in the exact words", async () => {
  const { id, cutoff } = await borrow();
  const early = await sweep(id, new Date(cutoff.getTime() - dayMs - 60_000));
  assert.equal(early.warnedCount ?? 0, 0, "not yet");
  assert.deepEqual(await warnings(id), []);

  const result = await sweep(id, new Date(cutoff.getTime() - dayMs + 60_000));
  assert.equal(result.warnedCount, 1);
  const sent = await warnings(id);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].userId, ownerId);
  assert.equal(sent[0].message, `Remy Requester hasn't entered the handoff code. If you've handed it over, report a problem before ${formatHandoffCutoff(cutoff)}.`);
  assert.ok(pushes.some((p) => p.userId === ownerId && p.body === sent[0].message));
  assert.ok(!pushes.some((p) => p.userId === requesterId), "the requester gets nothing");

  assert.equal((await sweep(id, new Date(cutoff.getTime() - 5 * HOUR))).warnedCount ?? 0, 0, "once only");
  assert.equal((await warnings(id)).length, 1);
});

test("a rental is warned too, and it needs no expiry reminders to be switched on", async () => {
  const { id, cutoff } = await borrow({ requestType: "RENT" });
  assert.equal((await sweep(id, new Date(cutoff.getTime() - 2 * HOUR), { reminders: false })).warnedCount, 1);
});

test("no warning once the code has been entered, in a dispute, for a swap or after the cutoff", async () => {
  const cases: [string, Partial<typeof itemRequests.$inferInsert>][] = [
    ["code entered", { pinUsed: true }],
    ["disputed", { status: "HANDOFF_DISPUTED" }],
    ["in progress", { status: "IN_PROGRESS" }],
  ];
  for (const [label, fields] of cases) {
    const { id, cutoff } = await borrow(fields);
    await sweep(id, new Date(cutoff.getTime() - 2 * HOUR));
    assert.deepEqual(await warnings(id), [], label);
  }
  const { id: late, cutoff } = await borrow();
  await sweep(late, new Date(cutoff.getTime() + HOUR), { expireDryRun: true });
  assert.deepEqual(await warnings(late), [], "past the cutoff the request is expiring, not warning");
  const swap = await seed({ requestType: "SWAP", status: "ACCEPTED" });
  await sweep(swap, new Date());
  assert.deepEqual(await warnings(swap), []);
});

test("a courier delivery is warned like any other", async () => {
  const { id, cutoff } = await borrow({ deliveryMethod: "courier" });
  assert.equal((await sweep(id, new Date(cutoff.getTime() - 2 * HOUR))).warnedCount, 1);
  assert.equal((await warnings(id)).length, 1);
});

test("while expiry is in dry-run nobody is warned, and when it goes live the waiting request is", async () => {
  const { id, cutoff } = await borrow();
  const now = new Date(cutoff.getTime() - 3 * HOUR);
  const dry = await sweep(id, now, { expireDryRun: true });
  assert.equal(dry.warnedCount ?? 0, 0);
  assert.deepEqual(await warnings(id), []);
  const live = await sweep(id, now, { expireDryRun: false });
  assert.equal(live.warnedCount, 1);
});

test("a dry run warns nobody, and HANDOFF_OWNER_WARNING=off turns the warning off without touching the reminders", async () => {
  const { id, cutoff } = await borrow();
  const now = new Date(cutoff.getTime() - 3 * HOUR);
  await sweep(id, now, { dryRun: true });
  assert.deepEqual(await warnings(id), []);
  await withEnv({ HANDOFF_OWNER_WARNING: "off" }, async () => {
    const result = await sweep(id, now, { reminders: true });
    assert.equal(result.warnedCount ?? 0, 0);
    assert.equal(result.remindedCount > 0, true, "the 4-hour reminder is a separate switch and still works");
  });
  assert.deepEqual(await warnings(id), []);
  await withEnv({ HANDOFF_OWNER_WARNING: undefined }, async () => {
    assert.equal((await sweep(id, now)).warnedCount, 1, "switched back on, the waiting request is warned");
  });
});
