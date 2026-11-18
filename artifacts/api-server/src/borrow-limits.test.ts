import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, requestLifecycleEvents, shareCoinHolds, users, verifications } from "@workspace/db";
import app from "./app.js";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";
import {
  BORROW_LIMIT_MESSAGE,
  FREE_MONTHLY_BORROW_LIMIT,
  FREE_PENDING_BORROW_LIMIT,
  PENDING_BORROW_LIMIT_MESSAGE,
} from "./borrow-allowance.js";
import { REQUEST_NOT_ACCEPTABLE_NOW_CODE, REQUEST_NOT_ACCEPTABLE_NOW_MESSAGE, releaseHold } from "./sharecoin-funds.js";
import { processHandoffDeadlines } from "./handoff-deadline-service.js";

// The Free plan's borrow limits: a borrow counts against the 3 a month when it is ACCEPTED (not when it is sent), at most 3
// borrow requests may wait for an answer at once, and accepting past the monthly limit is refused: the requester gets the
// plan-limit answer, the owner only the neutral one.

const UNIQUE = `borrow-limits-${Date.now()}`;
const PASSWORD = "BorrowLimits!42";
const DAY = 24 * 3_600_000;
const userIds: number[] = [];
const itemIds: number[] = [];
const requestIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;
let owner: Client;
let requester: Client;
let member: Client;
let ownerId: number;
let requesterId: number;
let memberId: number;

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
  patch(path: string, body: unknown = {}) { return this.call("PATCH", path, body); }

  async signIn(username: string) {
    assert.equal((await this.post("/api/login", { username, password: PASSWORD })).status, 200);
    this.csrfToken = ((await (await this.send("/api/csrf-token")).json()) as { csrfToken: string }).csrfToken;
    return this;
  }
}

const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

async function newItem() {
  const [item] = await db.insert(items).values({
    ownerId, name: `${UNIQUE}-item-${itemIds.length}`, description: "x", conditionRating: 4, photos: [], isLendable: true, isAvailable: true,
    replacementValue: 100, shareCoinsReward: "0", shareCoinPrice: "14.00", tier: 2,
  } as typeof items.$inferInsert).returning({ id: items.id, name: items.name });
  itemIds.push(item.id);
  return item;
}

const sendBorrow = (who: Client, itemId: number) =>
  who.post(`/api/items/${itemId}/request`, { requestType: "BORROW", startDate: day(10), endDate: day(17), depositMethod: "in_person" });

/** A pending borrow made straight in the database (so it exists even when sending one would be refused). */
async function pendingBorrow(by: number, extra: Partial<typeof itemRequests.$inferInsert> = {}) {
  const item = await newItem();
  const [request] = await db.insert(itemRequests).values({
    itemId: item.id, requesterId: by, requestType: "BORROW", status: "PENDING", startDate: new Date(Date.now() + 10 * DAY), endDate: new Date(Date.now() + 17 * DAY),
    depositMethod: "in_person", ...extra,
  } as typeof itemRequests.$inferInsert).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return { id: request.id, item };
}

const counters = async (id: number) => (await db.select({ n: users.monthlyBorrowCount, at: users.monthlyBorrowResetAt }).from(users).where(eq(users.id, id)))[0];
const setAllowance = (id: number, count: number, resetAt: Date | null) =>
  db.update(users).set({ monthlyBorrowCount: count, monthlyBorrowResetAt: resetAt } as any).where(eq(users.id, id));
const clearPending = async (by: number) => {
  const open = await db.select({ id: itemRequests.id }).from(itemRequests).where(and(eq(itemRequests.requesterId, by), eq(itemRequests.status, "PENDING")));
  if (open.length) await db.update(itemRequests).set({ status: "CANCELLED" }).where(inArray(itemRequests.id, open.map((r) => r.id)));
};
const requestStatus = async (id: number) => (await db.select({ s: itemRequests.status }).from(itemRequests).where(eq(itemRequests.id, id)))[0].s;
const notesFor = (userId: number, type: string) =>
  db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.type, type)));

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  const password = await hashPassword(PASSWORD);
  const [o, r, m] = await db.insert(users).values([
    { username: `${UNIQUE}-owner`, displayName: "Bram Owner", password, emailVerified: true, subscriptionTier: "member", shareCoins: "0.00" },
    { username: `${UNIQUE}-free`, displayName: "Fern Free", password, emailVerified: true, subscriptionTier: "free", stripePaymentMethodId: `pm_${UNIQUE}_free`, shareCoins: "1000.00" },
    { username: `${UNIQUE}-member`, displayName: "Mina Member", password, emailVerified: true, subscriptionTier: "member", stripePaymentMethodId: `pm_${UNIQUE}_member`, shareCoins: "1000.00" },
  ]).returning({ id: users.id });
  [ownerId, requesterId, memberId] = [o.id, r.id, m.id];
  userIds.push(o.id, r.id, m.id);
  await db.insert(verifications).values([{ userId: requesterId, status: "approved" }, { userId: memberId, status: "approved" }] as any);
  const server = registerRoutes(app, { startBackgroundJobs: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  owner = await new Client().signIn(`${UNIQUE}-owner`);
  requester = await new Client().signIn(`${UNIQUE}-free`);
  member = await new Client().signIn(`${UNIQUE}-member`);
});

after(async () => {
  try {
    const created = itemIds.length ? await db.select({ id: itemRequests.id }).from(itemRequests).where(inArray(itemRequests.itemId, itemIds)) : [];
    const all = [...new Set([...requestIds, ...created.map((r) => r.id)])];
    if (all.length) {
      await pool.query("DELETE FROM delivery_arrangements WHERE request_id = ANY($1)", [all]);
      await db.delete(messages).where(inArray(messages.requestId, all));
      await db.delete(notifications).where(inArray(notifications.requestId, all));
      await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, all));
      await db.delete(shareCoinHolds).where(inArray(shareCoinHolds.requestId, all));
      await db.delete(itemRequests).where(inArray(itemRequests.id, all));
    }
    if (userIds.length) await db.delete(notifications).where(inArray(notifications.userId, userIds));
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) {
      await db.delete(verifications).where(inArray(verifications.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  } finally {
    await closeServer();
    await pool.end();
  }
});

// ── Counted at accept, not at send ───────────────────────────────────────────────

test("sending a borrow request does not count against the monthly limit, and declining one never does", async () => {
  await setAllowance(requesterId, 0, null);
  const item = await newItem();
  const sent = await sendBorrow(requester, item.id);
  assert.equal(sent.status, 201, sent.text.slice(0, 300));
  requestIds.push(sent.json.id);
  assert.equal((await counters(requesterId)).n, 0, "sent, not counted");

  assert.equal((await owner.patch(`/api/requests/${sent.json.id}`, { status: "DECLINED" })).status, 200);
  assert.equal((await counters(requesterId)).n, 0, "declined, not counted");
});

test("accepting a borrow counts it: the first one starts the window, the next ones add to it", async () => {
  await setAllowance(requesterId, 0, null);
  const first = await pendingBorrow(requesterId);
  assert.equal((await owner.patch(`/api/requests/${first.id}`, { status: "ACCEPTED" })).status, 200);
  const afterFirst = await counters(requesterId);
  assert.equal(afterFirst.n, 1);
  assert.ok(afterFirst.at, "the window starts at the first counted borrow");

  const second = await pendingBorrow(requesterId);
  assert.equal((await owner.patch(`/api/requests/${second.id}`, { status: "ACCEPTED" })).status, 200);
  const afterSecond = await counters(requesterId);
  assert.equal(afterSecond.n, 2);
  assert.equal(afterSecond.at?.getTime(), afterFirst.at?.getTime(), "the window does not move");
});

test("accepting the same request again does not count it twice", async () => {
  await setAllowance(requesterId, 0, new Date());
  const request = await pendingBorrow(requesterId);
  assert.equal((await owner.patch(`/api/requests/${request.id}`, { status: "ACCEPTED" })).status, 200);
  assert.equal((await counters(requesterId)).n, 1);
  await owner.patch(`/api/requests/${request.id}`, { status: "ACCEPTED" });
  assert.equal((await counters(requesterId)).n, 1);
});

test("a window that ran out (more than 30 days ago) starts again at the next accepted borrow", async () => {
  await setAllowance(requesterId, FREE_MONTHLY_BORROW_LIMIT, new Date(Date.now() - 31 * DAY));
  const request = await pendingBorrow(requesterId);
  assert.equal((await owner.patch(`/api/requests/${request.id}`, { status: "ACCEPTED" })).status, 200);
  const row = await counters(requesterId);
  assert.equal(row.n, 1);
  assert.ok(Date.now() - row.at!.getTime() < 60_000, "a fresh window");
});

test("the Member plan has no limit: accepting never refuses and never counts", async () => {
  const request = await pendingBorrow(memberId);
  await db.update(users).set({ monthlyBorrowCount: 9, monthlyBorrowResetAt: new Date() } as any).where(eq(users.id, memberId));
  assert.equal((await owner.patch(`/api/requests/${request.id}`, { status: "ACCEPTED" })).status, 200);
  assert.equal((await counters(memberId)).n, 9);
});

// ── At most 3 pending at once ────────────────────────────────────────────────────

test("a Free-plan member can have 3 pending borrow requests; the 4th is refused with a clear message, until one is answered", async () => {
  await setAllowance(requesterId, 0, null);
  await clearPending(requesterId);
  const sent: number[] = [];
  for (let i = 0; i < FREE_PENDING_BORROW_LIMIT; i++) {
    const response = await sendBorrow(requester, (await newItem()).id);
    assert.equal(response.status, 201, `request ${i + 1}: ${response.text.slice(0, 200)}`);
    sent.push(response.json.id);
    requestIds.push(response.json.id);
  }
  const fourth = await sendBorrow(requester, (await newItem()).id);
  assert.equal(fourth.status, 403);
  assert.equal(fourth.json.code, "PENDING_BORROW_LIMIT");
  assert.equal(fourth.json.error, PENDING_BORROW_LIMIT_MESSAGE);
  assert.match(fourth.json.error, /3 borrow requests/);

  assert.equal((await owner.patch(`/api/requests/${sent[0]}`, { status: "DECLINED" })).status, 200);
  const retry = await sendBorrow(requester, (await newItem()).id);
  assert.equal(retry.status, 201, "once one is answered there is room");
  requestIds.push(retry.json.id);
  await clearPending(requesterId);
});

test("the pending cap is the Free plan's only: a Member can send more", async () => {
  await clearPending(memberId);
  for (let i = 0; i < FREE_PENDING_BORROW_LIMIT + 1; i++) {
    const response = await sendBorrow(member, (await newItem()).id);
    assert.equal(response.status, 201, `request ${i + 1}: ${response.text.slice(0, 200)}`);
    requestIds.push(response.json.id);
  }
  await clearPending(memberId);
});

test("a request cannot be sent once the month is already used up (it could never be accepted)", async () => {
  await clearPending(requesterId);
  await setAllowance(requesterId, FREE_MONTHLY_BORROW_LIMIT, new Date());
  const response = await sendBorrow(requester, (await newItem()).id);
  assert.equal(response.status, 403);
  assert.equal(response.json.code, "BORROW_LIMIT_REACHED");
  assert.equal(response.json.error, BORROW_LIMIT_MESSAGE);
  assert.equal(response.json.limit, 3);
});

// ── Accepting past the limit ─────────────────────────────────────────────────────

test("accepting past the monthly limit: the owner gets only the neutral answer, the requester is told once, nothing changes", async () => {
  await clearPending(requesterId);
  await setAllowance(requesterId, FREE_MONTHLY_BORROW_LIMIT, new Date());
  const request = await pendingBorrow(requesterId);

  const first = await owner.patch(`/api/requests/${request.id}`, { status: "ACCEPTED" });
  assert.equal(first.status, 409);
  assert.deepEqual(first.json, { code: REQUEST_NOT_ACCEPTABLE_NOW_CODE, error: REQUEST_NOT_ACCEPTABLE_NOW_MESSAGE });
  assert.doesNotMatch(first.text, /limit|plan|free|member|borrow|\d/i, "nothing about the requester's plan reaches the owner");
  assert.equal(await requestStatus(request.id), "PENDING");
  assert.deepEqual(await db.select().from(shareCoinHolds).where(eq(shareCoinHolds.requestId, request.id)), [], "no coins were reserved");
  assert.equal((await counters(requesterId)).n, FREE_MONTHLY_BORROW_LIMIT, "nothing was counted");

  const again = await owner.patch(`/api/requests/${request.id}`, { status: "ACCEPTED" });
  assert.equal(again.status, 409);

  const told = (await notesFor(requesterId, "borrow_limit_reached")).filter((n) => n.requestId === request.id);
  assert.equal(told.length, 1, "told once, not once per attempt");
  assert.equal(told[0].message, BORROW_LIMIT_MESSAGE);
  assert.deepEqual(await notesFor(ownerId, "borrow_limit_reached"), [], "and the owner is told nothing");
});

test("the requester accepting a counter past the limit gets the plan-limit answer itself", async () => {
  await setAllowance(requesterId, FREE_MONTHLY_BORROW_LIMIT, new Date());
  const request = await pendingBorrow(requesterId, {
    negotiationStatus: "counter_proposed", counterProposedBy: ownerId, counterRound: 1,
    counterStartDate: new Date(Date.now() + 10 * DAY), counterEndDate: new Date(Date.now() + 18 * DAY),
  } as any);
  const response = await requester.post(`/api/requests/${request.id}/respond-to-counter`, { accept: true });
  assert.equal(response.status, 403);
  assert.equal(response.json.code, "BORROW_LIMIT_REACHED");
  assert.equal(response.json.error, BORROW_LIMIT_MESSAGE);
  assert.equal(await requestStatus(request.id), "PENDING");
});

test("two simultaneous accepts for the last slot of the month: exactly one gets it", async () => {
  await setAllowance(requesterId, FREE_MONTHLY_BORROW_LIMIT - 1, new Date());
  const a = await pendingBorrow(requesterId);
  const b = await pendingBorrow(requesterId);
  const [ra, rb] = await Promise.all([
    owner.patch(`/api/requests/${a.id}`, { status: "ACCEPTED" }),
    owner.patch(`/api/requests/${b.id}`, { status: "ACCEPTED" }),
  ]);
  assert.deepEqual([ra.status, rb.status].sort(), [200, 409]);
  assert.equal((await counters(requesterId)).n, FREE_MONTHLY_BORROW_LIMIT);
  const statuses = [await requestStatus(a.id), await requestStatus(b.id)].map((s) => (s === "PENDING" ? "PENDING" : "ACCEPTED"));
  assert.deepEqual(statuses.sort(), ["ACCEPTED", "PENDING"]);
});

// ── The slot comes back when the accepted borrow never reaches the handoff ───────

test("cancelling an accepted borrow before the handoff gives the monthly slot back, once", async () => {
  await clearPending(requesterId);
  await setAllowance(requesterId, 0, null);
  const request = await pendingBorrow(requesterId);
  assert.equal((await owner.patch(`/api/requests/${request.id}`, { status: "ACCEPTED" })).status, 200);
  assert.equal((await counters(requesterId)).n, 1);

  const cancelled = await requester.post(`/api/requests/${request.id}/cancel`, { reason: "changed_plans", acknowledgePenalty: true });
  assert.equal(cancelled.status, 200, cancelled.text.slice(0, 300));
  assert.equal((await counters(requesterId)).n, 0, "the slot is back");
  assert.equal(await requestStatus(request.id), "CANCELLED");

  assert.equal(await releaseHold(db, request.id, "cancelled"), false, "nothing left to release");
  assert.equal((await counters(requesterId)).n, 0, "and it is not given back twice");
  // The slot is usable again: three more can still be accepted this month.
  for (let i = 0; i < FREE_MONTHLY_BORROW_LIMIT; i++) {
    const next = await pendingBorrow(requesterId);
    assert.equal((await owner.patch(`/api/requests/${next.id}`, { status: "ACCEPTED" })).status, 200, `borrow ${i + 1}`);
  }
  assert.equal((await counters(requesterId)).n, FREE_MONTHLY_BORROW_LIMIT);
});

test("a borrow counted in an earlier window gives nothing back, and a Member's count is never touched", async () => {
  // Accepted a month and a half ago, in a window that has since started over.
  await clearPending(requesterId);
  await setAllowance(requesterId, 0, null);
  const oldRequest = await pendingBorrow(requesterId);
  assert.equal((await owner.patch(`/api/requests/${oldRequest.id}`, { status: "ACCEPTED" })).status, 200);
  await db.update(itemRequests).set({ acceptedAt: new Date(Date.now() - 45 * DAY) }).where(eq(itemRequests.id, oldRequest.id));
  await setAllowance(requesterId, 2, new Date(Date.now() - 10 * DAY));
  assert.ok(await releaseHold(db, oldRequest.id, "cancelled"));
  assert.equal((await counters(requesterId)).n, 2, "this month's count is not reduced by last month's borrow");

  const request = await pendingBorrow(memberId);
  assert.equal((await owner.patch(`/api/requests/${request.id}`, { status: "ACCEPTED" })).status, 200);
  await setAllowance(memberId, 2, new Date());
  assert.ok(await releaseHold(db, request.id, "cancelled"));
  assert.equal((await counters(memberId)).n, 2);
});

test("an unpaid in-app deposit that times out gives the slot back too", async () => {
  await clearPending(requesterId);
  await setAllowance(requesterId, 0, null);
  const request = await pendingBorrow(requesterId, { depositMethod: "in_app" } as any);
  assert.equal((await owner.patch(`/api/requests/${request.id}`, { status: "ACCEPTED" })).status, 200);
  assert.equal((await counters(requesterId)).n, 1);
  // It was accepted three days ago (and that is when this month's window began).
  await db.update(itemRequests).set({ acceptedAt: new Date(Date.now() - 3 * DAY) }).where(eq(itemRequests.id, request.id));
  await setAllowance(requesterId, 1, new Date(Date.now() - 3 * DAY));
  const result = await processHandoffDeadlines({ onSwapAutoConfirmed: async () => {}, onGiftAutoConfirmed: async () => {} }, { onlyRequestIds: [request.id] });
  assert.equal(result.depositExpiredCount, 1);
  assert.equal((await counters(requesterId)).n, 0);
});
