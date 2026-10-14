import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, reputationActivities, users } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureCancellationRecord, ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";
import { fakeStripe } from "./test-fixtures/fake-stripe.js";
import { legacyCancelPenaltyExempt } from "./legacy-cancel-exemption.js";

const NOW = new Date("2026-10-12T12:00:00Z");
const FUTURE = "2026-11-01T00:00:00Z";
const PAST = "2026-10-01T00:00:00Z";
const on = { LEGACY_CANCEL_ACK_UNTIL: FUTURE } as NodeJS.ProcessEnv;

// ── The decision ──────────────────────────────────────────────────────────────

test("a legacy request (no x-app-version) with the flag in the future is exempt", () => {
  assert.equal(legacyCancelPenaltyExempt({}, on, NOW), true);
  assert.equal(legacyCancelPenaltyExempt({ "x-app-build": "7" }, on, NOW), true, "only x-app-version marks a current client");
});

test("flag unset, blank, unparseable, expired, or exactly at the deadline: not exempt", () => {
  for (const value of [undefined, "", "   ", "soon", PAST, "2026-10-12T12:00:00Z"]) {
    const env = (value === undefined ? {} : { LEGACY_CANCEL_ACK_UNTIL: value }) as NodeJS.ProcessEnv;
    assert.equal(legacyCancelPenaltyExempt({}, env, NOW), false, `value ${JSON.stringify(value)}`);
  }
});

test("a request with an x-app-version header is never exempt, whatever the value or the flag", () => {
  for (const version of ["1.0.0", "web", "0", ""]) {
    assert.equal(legacyCancelPenaltyExempt({ "x-app-version": version }, on, NOW), false, `version ${JSON.stringify(version)}`);
  }
});

// ── The cancel route ──────────────────────────────────────────────────────────

const UNIQUE = `legacy-cancel-${Date.now()}`;
const PASSWORD = "LegacyCancel!42";
const userIds: number[] = [];
const itemIds: number[] = [];
const requestIds: number[] = [];
const previousFlag = process.env.LEGACY_CANCEL_ACK_UNTIL;
const stripe = fakeStripe({ refundIdPrefix: "re_legacy_" });
let baseUrl: string;
let closeServer: () => Promise<void>;
let ownerId: number;

class TestClient {
  private cookies = new Map<string, string>();
  private csrfToken = "";
  constructor(private extraHeaders: Record<string, string> = {}) {}

  async post(path: string, body: unknown = {}) {
    const headers = new Headers({ "content-type": "application/json", "x-forwarded-proto": "https", ...this.extraHeaders });
    if (this.cookies.size) headers.set("cookie", [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "));
    if (this.csrfToken && path !== "/api/login") headers.set("x-csrf-token", this.csrfToken);
    return this.send(path, { method: "POST", headers, body: JSON.stringify(body) });
  }

  private async send(path: string, init: RequestInit) {
    const response = await fetch(`${baseUrl}${path}`, init);
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";", 1);
      const i = pair.indexOf("=");
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return response;
  }

  async login(username: string) {
    assert.equal((await this.post("/api/login", { username, password: PASSWORD })).status, 200);
    const headers = new Headers({ "x-forwarded-proto": "https", cookie: [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ") });
    const csrf = await this.send("/api/csrf-token", { headers });
    this.csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken;
  }
}

const START_SCORE = 80;

// A requester with a fresh history and an accepted request to cancel. BORROW has an authorized in-app
// deposit (so the -5 penalty and its acknowledgment apply); SWAP goes through the original handler.
async function scenario(headers: Record<string, string>, kind: "BORROW_WITH_HOLD" | "SWAP" = "BORROW_WITH_HOLD") {
  const password = await hashPassword(PASSWORD);
  const [user] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-r${userIds.length}`, password, emailVerified: true, shareCoins: "50.00", trustScore: START_SCORE, reputationLevel: "Neighbour" })
    .returning({ id: users.id, username: users.username });
  userIds.push(user.id);
  const [item] = await db
    .insert(items)
    .values({
      ownerId, name: `${UNIQUE}-item-${itemIds.length}`, description: "legacy cancel test", conditionRating: 4, photos: [],
      isLendable: true, isRentable: false, isSwappable: true, isGift: false, isAvailable: false,
      replacementValue: 100, securityDeposit: "10.00", lendingDuration: 7, shareCoinsReward: "0", shareCoinPrice: "7.00",
    })
    .returning({ id: items.id });
  itemIds.push(item.id);
  const hold =
    kind === "BORROW_WITH_HOLD"
      ? { status: "DEPOSIT_CONFIRMED", depositMethod: "in_app", depositPaymentIntentId: `pi_legacy_${requestIds.length}`, depositStatus: "authorized", depositMode: "authorization", trustDepositAmount: "10.00" }
      : { status: "ACCEPTED", depositMethod: "in_person" };
  const [request] = await db
    .insert(itemRequests)
    .values({
      itemId: item.id, requesterId: user.id, requestType: kind === "SWAP" ? "SWAP" : "BORROW",
      startDate: new Date("2026-11-02T00:00:00Z"), endDate: new Date("2026-11-05T00:00:00Z"),
      ...hold,
    })
    .returning({ id: itemRequests.id });
  requestIds.push(request.id);
  const client = new TestClient(headers);
  await client.login(user.username);
  return { userId: user.id, requestId: request.id, client };
}

const score = async (userId: number) => (await db.select({ s: users.trustScore }).from(users).where(eq(users.id, userId)))[0].s;
const load = async (requestId: number) => (await db.select().from(itemRequests).where(eq(itemRequests.id, requestId)))[0];
const penaltyActivities = async (userId: number) =>
  (await db.select({ type: reputationActivities.activityType }).from(reputationActivities).where(eq(reputationActivities.userId, userId)))
    .filter((r) => r.type === "cancel_after_deposit" || r.type === "cancel_after_acceptance" || r.type === "grace_pass_warning").length;

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  await ensureCancellationRecord();
  const password = await hashPassword(PASSWORD);
  const [owner] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-owner`, password, emailVerified: true })
    .returning({ id: users.id });
  ownerId = owner.id;
  userIds.push(owner.id);
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const server = registerRoutes(app, { startBackgroundJobs: false, stripe: stripe.client });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

after(async () => {
  try {
    if (userIds.length) await db.delete(reputationActivities).where(inArray(reputationActivities.userId, userIds));
    if (requestIds.length) {
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
      await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    }
    if (userIds.length) {
      await db.delete(notifications).where(inArray(notifications.userId, userIds));
    }
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    if (previousFlag === undefined) delete process.env.LEGACY_CANCEL_ACK_UNTIL;
    else process.env.LEGACY_CANCEL_ACK_UNTIL = previousFlag;
    if (closeServer) await closeServer();
    await pool.end();
  }
});

function setFlag(value: string | undefined) {
  if (value === undefined) delete process.env.LEGACY_CANCEL_ACK_UNTIL;
  else process.env.LEGACY_CANCEL_ACK_UNTIL = value;
}

const FAR_FUTURE = "2099-01-01T00:00:00Z";

// ── BORROW/RENT (cancel-service.ts) ───────────────────────────────────────────

test("BORROW with a hold, legacy request, flag off: 409 PENALTY_ACK_REQUIRED and nothing changes", async () => {
  for (const value of [undefined, "", "soon", PAST]) {
    setFlag(value);
    const { userId, requestId, client } = await scenario({});
    const response = await client.post(`/api/requests/${requestId}/cancel`, {});
    assert.equal(response.status, 409, `flag ${JSON.stringify(value)}`);
    assert.equal(((await response.json()) as { code: string }).code, "PENALTY_ACK_REQUIRED");
    assert.equal((await load(requestId)).status, "DEPOSIT_CONFIRMED");
    assert.equal(await score(userId), START_SCORE);
  }
});

test("BORROW with a hold, legacy request, flag on: cancels with no points deducted and the record says no penalty", async () => {
  setFlag(FAR_FUTURE);
  const { userId, requestId, client } = await scenario({});
  const response = await client.post(`/api/requests/${requestId}/cancel`, {});
  assert.equal(response.status, 200);
  const body: any = await response.json();
  assert.equal(body.outcome.penaltyApplied, false);
  assert.equal(body.outcome.penaltyPoints, 0);
  const row = await load(requestId);
  assert.equal(row.status, "CANCELLED");
  assert.equal(row.cancelledWithPenalty, false);
  assert.equal(row.cancelDepositState, "authorized", "the deposit state is still recorded as it was");
  assert.equal(await score(userId), START_SCORE);
  assert.equal(await penaltyActivities(userId), 0);
});

test("BORROW with a hold: a request with x-app-version never gets the exemption, even with the flag on", async () => {
  setFlag(FAR_FUTURE);
  for (const version of ["1.0.0", "web"]) {
    const { userId, requestId, client } = await scenario({ "x-app-version": version, "x-app-build": "12" });
    const challenged = await client.post(`/api/requests/${requestId}/cancel`, {});
    assert.equal(challenged.status, 409, `version ${version}`);
    assert.equal((await load(requestId)).status, "DEPOSIT_CONFIRMED");
    const done = await client.post(`/api/requests/${requestId}/cancel`, { acknowledgePenalty: 5 });
    assert.equal(done.status, 200);
    assert.equal((await load(requestId)).cancelledWithPenalty, true);
    assert.equal(await score(userId), START_SCORE - 5, `version ${version}`);
  }
});

test("BORROW with a hold: flag unset means off, even for a legacy request that acknowledges", async () => {
  setFlag(undefined);
  const { userId, requestId, client } = await scenario({});
  assert.equal((await client.post(`/api/requests/${requestId}/cancel`, {})).status, 409);
  assert.equal((await client.post(`/api/requests/${requestId}/cancel`, { acknowledgePenalty: 5 })).status, 200);
  assert.equal(await score(userId), START_SCORE - 5);
});

test("BORROW with no deposit stays free for everyone: the flag changes nothing", async () => {
  setFlag(FAR_FUTURE);
  const { userId, requestId, client } = await scenario({});
  await db.update(itemRequests).set({ status: "PENDING", depositPaymentIntentId: null, depositStatus: null, depositMode: null }).where(eq(itemRequests.id, requestId));
  assert.equal((await client.post(`/api/requests/${requestId}/cancel`, {})).status, 200);
  assert.equal((await load(requestId)).cancelledWithPenalty, false);
  assert.equal(await score(userId), START_SCORE);
});

// ── SWAP and GIFT keep the original handler (and its exemption) ───────────────

test("SWAP, legacy request, flag in the future: cancels with no penalty and no grace-pass warning", async () => {
  setFlag(FAR_FUTURE);
  const { userId, requestId, client } = await scenario({}, "SWAP");
  assert.equal((await client.post(`/api/requests/${requestId}/cancel`, {})).status, 200);
  assert.equal((await load(requestId)).status, "CANCELLED");
  assert.equal(await penaltyActivities(userId), 0);
});

test("SWAP, legacy request, flag off: the original penalty rules apply (first-offence grace warning)", async () => {
  for (const value of [undefined, PAST]) {
    setFlag(value);
    const { userId, requestId, client } = await scenario({}, "SWAP");
    assert.equal((await client.post(`/api/requests/${requestId}/cancel`, {})).status, 200);
    assert.equal(await penaltyActivities(userId), 1, `flag ${JSON.stringify(value)}`);
  }
});

test("SWAP: a request with x-app-version never gets the exemption", async () => {
  setFlag(FAR_FUTURE);
  const { userId, requestId, client } = await scenario({ "x-app-version": "1.0.0" }, "SWAP");
  assert.equal((await client.post(`/api/requests/${requestId}/cancel`, {})).status, 200);
  assert.equal(await penaltyActivities(userId), 1);
});
