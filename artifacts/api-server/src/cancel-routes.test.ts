import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  itemRequests,
  items,
  messages,
  notifications,
  pool,
  reputationActivities,
  users,
} from "@workspace/db";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureCancellationRecord, ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";
import { fakeStripe, noStripeCalls } from "./test-fixtures/fake-stripe.js";

const CLOCK = new Date("2026-10-03T19:00:00.000Z"); // Oct 3, noon in Vancouver
const UNIQUE = `cancel-routes-${Date.now()}`;
const PASSWORD = "CancelRoutes!42";
const requestIds: number[] = [];
const itemIds: number[] = [];
const userIds: number[] = [];

const stripe = fakeStripe({ refundAmounts: { pi_platform_fee: 350 } });
let baseUrl: string;
let closeServer: () => Promise<void>;
let owner: TestClient;
let borrower: TestClient;
let ownerId: number;
let borrowerId: number;

class TestClient {
  private cookies = new Map<string, string>();
  private csrfToken = "";

  async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    headers.set("x-forwarded-proto", "https");
    if (this.cookies.size) headers.set("cookie", [...this.cookies.entries()].map(([n, v]) => `${n}=${v}`).join("; "));
    if (this.csrfToken && init.method && init.method !== "GET") headers.set("x-csrf-token", this.csrfToken);
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";", 1);
      const separator = pair.indexOf("=");
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }
  post(path: string, body: unknown = {}) {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  }
  patch(path: string, body: unknown = {}) {
    return this.request(path, { method: "PATCH", body: JSON.stringify(body) });
  }
  get(path: string) {
    return this.request(path);
  }
  async login(username: string) {
    const response = await this.request("/api/login", { method: "POST", body: JSON.stringify({ username, password: PASSWORD }) });
    assert.equal(response.status, 200);
    const csrf = await this.request("/api/csrf-token");
    this.csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken;
  }
}

async function newRequest(overrides: Partial<typeof itemRequests.$inferInsert> = {}, itemOverrides: Partial<typeof items.$inferInsert> = {}) {
  const [item] = await db
    .insert(items)
    .values({
      ownerId,
      name: `${UNIQUE}-item-${itemIds.length}`,
      description: "Cancel route test item",
      conditionRating: 4,
      photos: [],
      isLendable: true,
      isRentable: true,
      isSwappable: true,
      isGift: true,
      isAvailable: false,
      replacementValue: 100,
      securityDeposit: "10.00",
      lendingDuration: 7,
      shareCoinsReward: "0",
      shareCoinPrice: "7.00",
      ...itemOverrides,
    })
    .returning({ id: items.id, name: items.name });
  itemIds.push(item.id);
  const [request] = await db
    .insert(itemRequests)
    .values({
      itemId: item.id,
      requesterId: borrowerId,
      requestType: "BORROW",
      status: "PENDING",
      startDate: new Date("2026-10-05T00:00:00.000Z"),
      endDate: new Date("2026-10-08T00:00:00.000Z"),
      depositMethod: "in_app",
      ...overrides,
    })
    .returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return { id: request.id, itemId: item.id, itemName: item.name };
}

const hold = (overrides: Partial<typeof itemRequests.$inferInsert> = {}): Partial<typeof itemRequests.$inferInsert> => ({
  status: "DEPOSIT_CONFIRMED",
  depositPaymentIntentId: "pi_deposit_hold",
  depositStatus: "authorized",
  depositMode: "authorization",
  trustDepositAmount: "42.00",
  ...overrides,
});

const load = async (id: number) => (await db.select().from(itemRequests).where(eq(itemRequests.id, id)))[0];
const score = async (id: number) => (await db.select({ s: users.reputationScore }).from(users).where(eq(users.id, id)))[0].s;
const acts = (userId: number, requestId?: number) =>
  db.select().from(reputationActivities).where(requestId ? and(eq(reputationActivities.userId, userId), eq(reputationActivities.requestId, requestId)) : eq(reputationActivities.userId, userId));

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  await ensureCancellationRecord();
  const password = await hashPassword(PASSWORD);
  const created = await db
    .insert(users)
    .values(
      ["owner", "borrower"].map((role) => ({
        username: `${UNIQUE}-${role}`,
        password,
        emailVerified: true,
        reputationScore: 80,
        reputationLevel: "Neighbour",
        shareCoins: "50.00",
      })),
    )
    .returning({ id: users.id, username: users.username });
  userIds.push(...created.map((u) => u.id));
  [ownerId, borrowerId] = [created[0].id, created[1].id];

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const server = registerRoutes(app, { startBackgroundJobs: false, now: () => CLOCK, stripe: stripe.client });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));

  owner = new TestClient();
  borrower = new TestClient();
  await owner.login(created[0].username);
  await borrower.login(created[1].username);
});

after(async () => {
  try {
    if (requestIds.length) {
      await db.delete(reputationActivities).where(inArray(reputationActivities.requestId, requestIds));
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
      await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    }
    if (userIds.length) {
      await db.delete(reputationActivities).where(inArray(reputationActivities.userId, userIds));
      await db.delete(notifications).where(inArray(notifications.userId, userIds));
    }
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    if (closeServer) await closeServer();
    await pool.end();
  }
});

// ── The cancel contract over HTTP ─────────────────────────────────────────────

test("a free cancel is one call with an outcome message; no confirmation step", async () => {
  const { id } = await newRequest();
  const response = await borrower.post(`/api/requests/${id}/cancel`, {});
  assert.equal(response.status, 200);
  const body: any = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.alreadyCancelled, false);
  assert.equal(body.message, "Request cancelled.");
  assert.equal(body.request.cancelledFromStatus, "PENDING");
  assert.equal(body.request.cancelledBy, borrowerId);
  assert.equal((await load(id)).status, "CANCELLED");
});

test("with a hold placed: 409 PENALTY_ACK_REQUIRED, then the same call with acknowledgePenalty goes through; a repeat is harmless", async () => {
  stripe.calls.cancel.length = 0;
  stripe.calls.refunds.length = 0;
  const { id } = await newRequest(hold({ platformFeeChargeId: "pi_platform_fee" }));
  const before = (await score(borrowerId))!;

  const challenged = await borrower.post(`/api/requests/${id}/cancel`, {});
  assert.equal(challenged.status, 409);
  const challengeBody: any = await challenged.json();
  assert.equal(challengeBody.code, "PENALTY_ACK_REQUIRED");
  assert.equal(challengeBody.error, "A trust score penalty of -5 will be applied for this cancellation");
  assert.deepEqual(challengeBody.penalty, { points: 5, type: "cancel_after_deposit" });
  assert.equal((await load(id)).status, "DEPOSIT_CONFIRMED");
  assert.equal(stripe.calls.cancel.length + stripe.calls.refunds.length, 0);

  const done = await borrower.post(`/api/requests/${id}/cancel`, { acknowledgePenalty: 5, reason: "changed_plans" });
  assert.equal(done.status, 200);
  const body: any = await done.json();
  assert.deepEqual(body.outcome, {
    deposit: "hold_released", depositAmount: 42, platformFeeRefunded: 3.5, rentalRefunded: null,
    penaltyApplied: true, penaltyPoints: 5, newScore: before - 5,
  });
  assert.match(body.message, /^Request cancelled\. Your \$42 temporary hold was released\. You were not charged\. Your \$3\.50 platform fee was refunded\./);
  assert.equal(stripe.calls.capture.length, 0);

  const again = await borrower.post(`/api/requests/${id}/cancel`, { acknowledgePenalty: 5 });
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as any).alreadyCancelled, true);
  assert.equal(await score(borrowerId), before - 5);
});

test("an owner can cancel a BORROW after acceptance through the API, with the same rule", async () => {
  const { id } = await newRequest(hold());
  assert.equal((await owner.post(`/api/requests/${id}/cancel`, {})).status, 409);
  const done = await owner.post(`/api/requests/${id}/cancel`, { acknowledgePenalty: 5 });
  assert.equal(done.status, 200);
  assert.equal(((await done.json()) as any).outcome.penaltyPoints, 5);
  assert.equal((await acts(ownerId, id))[0].activityType, "cancel_after_deposit");
});

test("withdrawing a PENDING request records itself too: free, no deposit, reason 'withdrawn'", async () => {
  const { id } = await newRequest();
  const response = await borrower.post(`/api/requests/${id}/withdraw`, {});
  assert.equal(response.status, 200);
  const row = await load(id);
  assert.equal(row.status, "CANCELLED");
  assert.deepEqual(
    [row.cancelledBy, row.cancelledFromStatus, row.cancelReason, row.cancelledWithPenalty, row.cancelDepositState, row.cancelledAt instanceof Date],
    [borrowerId, "PENDING", "withdrawn", false, "none", true],
  );
  assert.deepEqual(await acts(borrowerId, id), [], "withdrawing has no penalty");
});

test("the cancel route writes the record over HTTP too", async () => {
  const { id } = await newRequest(hold());
  await owner.post(`/api/requests/${id}/cancel`, { acknowledgePenalty: 5, reason: "item_unavailable" });
  const row = await load(id);
  assert.deepEqual(
    [row.cancelledBy, row.cancelledFromStatus, row.cancelReason, row.cancelledWithPenalty, row.cancelDepositState],
    [ownerId, "DEPOSIT_CONFIRMED", "item_unavailable", true, "authorized"],
  );
});

// ── SWAP and GIFT keep the original handler ───────────────────────────────────

test("SWAP keeps the original rule: grace pass first, then -20 cancel_after_acceptance, original response shape; the new record stays empty", async () => {
  const user = await db.insert(users).values({ username: `${UNIQUE}-swapper`, password: await hashPassword(PASSWORD), emailVerified: true, reputationScore: 80 }).returning({ id: users.id, username: users.username });
  userIds.push(user[0].id);
  const swapper = new TestClient();
  await swapper.login(user[0].username);

  const first = await newRequest({ requestType: "SWAP", status: "ACCEPTED", requesterId: user[0].id });
  const r1 = await swapper.post(`/api/requests/${first.id}/cancel`, {});
  assert.equal(r1.status, 200);
  const b1: any = await r1.json();
  assert.equal(b1.outcome, undefined, "not the BORROW/RENT shape");
  assert.equal(b1.depositReleased, false);
  assert.match(b1.message, /first cancellation - no penalty applied/);
  assert.equal(await score(user[0].id), 80);

  const second = await newRequest({ requestType: "SWAP", status: "ACCEPTED", requesterId: user[0].id });
  const r2 = await swapper.post(`/api/requests/${second.id}/cancel`, {});
  const b2: any = await r2.json();
  assert.match(b2.message, /trust score penalty has been applied/);
  assert.equal(await score(user[0].id), 60);
  assert.equal((await acts(user[0].id, second.id))[0].activityType, "cancel_after_acceptance");
  assert.equal((await acts(user[0].id, second.id))[0].points, -20);
  assert.equal((await load(second.id)).cancelledAt, null, "SWAP/GIFT cancels do not write the BORROW/RENT record");
});

test("GIFT: the giver cancelling their own accepted gift is still penalty-free with the original message", async () => {
  const { id } = await newRequest({ requestType: "GIFT", status: "ACCEPTED" });
  const response = await owner.post(`/api/requests/${id}/cancel`, {});
  assert.equal(response.status, 200);
  const body: any = await response.json();
  assert.equal(body.message, "Gift cancelled. Your item is available again.");
  assert.equal(body.outcome, undefined);
  assert.deepEqual(await acts(ownerId, id), []);
});

// ── Decline only answers a pending request ────────────────────────────────────

test("an owner cannot 'decline' an accepted request with a hold on it: 409, nothing changes; a pending one declines", async () => {
  const live = await newRequest(hold());
  const refused = await owner.patch(`/api/requests/${live.id}`, { status: "DECLINED" });
  assert.equal(refused.status, 409);
  const body: any = await refused.json();
  assert.equal(body.code, "DECLINE_ONLY_WHEN_PENDING");
  assert.equal(body.currentStatus, "DEPOSIT_CONFIRMED");
  assert.equal((await load(live.id)).status, "DEPOSIT_CONFIRMED");

  const pending = await newRequest();
  const declined = await owner.patch(`/api/requests/${pending.id}`, { status: "DECLINED" });
  assert.equal(declined.status, 200);
  assert.equal((await load(pending.id)).status, "DECLINED");
});

// ── A rental is always paid in the app ────────────────────────────────────────

test("RENT with an in-person deposit is rejected when it is created", async () => {
  const { itemId } = await newRequest({ status: "CANCELLED" }, { isAvailable: true });
  const refused = await borrower.post(`/api/items/${itemId}/request`, {
    requestType: "RENT", depositMethod: "in_person", startDate: "2026-10-06", endDate: "2026-10-08",
  });
  assert.equal(refused.status, 400);
  const body: any = await refused.json();
  assert.equal(body.code, "RENT_REQUIRES_IN_APP_DEPOSIT");

  // The same request with an in-app deposit gets past this rule (it then stops at verification).
  const allowed = await borrower.post(`/api/items/${itemId}/request`, {
    requestType: "RENT", depositMethod: "in_app", startDate: "2026-10-06", endDate: "2026-10-08",
  });
  assert.equal(((await allowed.json()) as any).code, "FULL_VERIFICATION_REQUIRED");

  // BORROW may still settle its deposit in person.
  const borrowInPerson = await borrower.post(`/api/items/${itemId}/request`, {
    requestType: "BORROW", depositMethod: "in_person", startDate: "2026-10-06", endDate: "2026-10-08",
  });
  assert.equal(((await borrowInPerson.json()) as any).code, "FULL_VERIFICATION_REQUIRED");
});

test("RENT cannot be countered to an in-person deposit, by either side", async () => {
  const { id } = await newRequest({ requestType: "RENT" });
  const direct = await owner.post(`/api/requests/${id}/counter-proposal`, { depositMethod: "in_person" });
  assert.equal(direct.status, 400);
  assert.equal(((await direct.json()) as any).code, "RENT_REQUIRES_IN_APP_DEPOSIT");

  const countered = await newRequest({ requestType: "RENT", negotiationStatus: "counter_proposed", counterProposedBy: ownerId, counterRound: 1 });
  const back = await borrower.post(`/api/requests/${countered.id}/respond-to-counter`, { counter: { depositMethod: "in_person" } });
  assert.equal(back.status, 400);
  assert.equal(((await back.json()) as any).code, "RENT_REQUIRES_IN_APP_DEPOSIT");

  // A BORROW counter to in-person is fine.
  const borrowCounter = await newRequest({ requestType: "BORROW" });
  const ok = await owner.post(`/api/requests/${borrowCounter.id}/counter-proposal`, { depositMethod: "in_person" });
  assert.equal(ok.status, 200);
});

// ── Score history shows the old and the new rows, and its limit is what it says ─

test("score history renders old -20 and new -5 rows by type, with the item name", async () => {
  const history = await db.insert(users).values({ username: `${UNIQUE}-history`, password: "x", emailVerified: true, reputationScore: 200 }).returning({ id: users.id });
  userIds.push(history[0].id);
  const oldReq = await newRequest({ status: "CANCELLED" });
  const newReq = await newRequest({ status: "CANCELLED" });
  await db.insert(reputationActivities).values([
    { userId: history[0].id, activityType: "cancel_after_acceptance", points: -20, description: "old text", requestId: oldReq.id, itemId: oldReq.itemId, createdAt: new Date("2026-09-01T00:00:00Z") },
    { userId: history[0].id, activityType: "cancel_after_deposit", points: -5, description: "stored text", requestId: newReq.id, itemId: newReq.itemId, createdAt: new Date("2026-09-02T00:00:00Z") },
  ]);

  const response = await borrower.get(`/api/users/${history[0].id}/reputation`);
  const body: any = await response.json();
  const byType = Object.fromEntries(body.recentActivities.map((a: any) => [a.activityType, a]));
  assert.equal(byType.cancel_after_acceptance.points, -20);
  assert.equal(byType.cancel_after_acceptance.description, `An accepted request was cancelled on "${oldReq.itemName}"`);
  assert.equal(byType.cancel_after_deposit.points, -5);
  assert.equal(byType.cancel_after_deposit.description, `Cancelled after a deposit was placed on "${newReq.itemName}"`);
});

test("score history limit (documented): only the 10 newest non-zero changes come back, zero-point rows are left out", async () => {
  const history = await db.insert(users).values({ username: `${UNIQUE}-limit`, password: "x", emailVerified: true, reputationScore: 200 }).returning({ id: users.id });
  userIds.push(history[0].id);
  const rows = Array.from({ length: 12 }, (_, i) => ({
    userId: history[0].id,
    activityType: "lending_smooth",
    points: 5,
    description: `change ${i}`,
    createdAt: new Date(Date.UTC(2026, 8, 1 + i)),
  }));
  await db.insert(reputationActivities).values([
    ...rows,
    { userId: history[0].id, activityType: "grace_pass_warning", points: 0, description: "zero", createdAt: new Date(Date.UTC(2026, 8, 30)) },
  ]);

  const body: any = await (await borrower.get(`/api/users/${history[0].id}/reputation`)).json();
  assert.equal(body.recentActivities.length, 10);
  assert.ok(body.recentActivities.every((a: any) => a.points !== 0));
  const dates = body.recentActivities.map((a: any) => new Date(a.createdAt).getTime());
  assert.deepEqual(dates, [...dates].sort((a, b) => b - a), "newest first");
  // The two oldest changes are not reachable: there is no paging.
  assert.equal(body.recentActivities.some((a: any) => a.description === "change 0" || a.description === "change 1"), false);
});

test("no Stripe call was ever a capture or a payment creation", () => {
  assert.deepEqual(stripe.calls.capture, noStripeCalls.capture);
  assert.deepEqual(stripe.calls.create, noStripeCalls.create);
});
