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
import { depositSettlementOperations, requestLifecycleEvents, securityClaims, shareCoinsTransactions } from "@workspace/db";
import { fakeStripe, noStripeCalls } from "./test-fixtures/fake-stripe.js";

const CLOCK = new Date("2026-10-03T19:00:00.000Z"); // Oct 3, noon in Vancouver
const UNIQUE = `return-damage-in-person-${Date.now()}`;
const PASSWORD = "ReturnDamage!42";
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
      description: "Return damage test item",
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
const score = async (id: number) => (await db.select({ s: users.trustScore }).from(users).where(eq(users.id, id)))[0].s;
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
        trustScore: 80,
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
      await db.delete(depositSettlementOperations).where(inArray(depositSettlementOperations.requestId, requestIds));
      await db.delete(securityClaims).where(inArray(securityClaims.requestId, requestIds));
      await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, requestIds));
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
      await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    }
    if (userIds.length) {
      await db.delete(reputationActivities).where(inArray(reputationActivities.userId, userIds));
      await db.delete(shareCoinsTransactions).where(inArray(shareCoinsTransactions.userId, userIds));
      await db.delete(notifications).where(inArray(notifications.userId, userIds));
    }
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) {
      // A confirmed return awards coins, achievements and so on; clear every row that still points at the test users.
      const refs = await pool.query<{ table_name: string; column_name: string }>(`
        SELECT kcu.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'users' AND tc.table_schema = 'public'`);
      for (let pass = 0; pass < 3; pass += 1) {
        for (const { table_name, column_name } of refs.rows) {
          await pool.query(`DELETE FROM "${table_name}" WHERE "${column_name}" = ANY($1::int[])`, [userIds]).catch(() => undefined);
        }
      }
      await db.delete(users).where(inArray(users.id, userIds));
    }
  } finally {
    if (closeServer) await closeServer();
    await pool.end();
  }
});

// ── Reporting damage on an in-person deposit ──────────────────────────────────

const IN_PERSON_NOTICE = "This deposit was paid in person, so it can’t be charged through ShareSwap. Please settle any damage with the borrower directly.";
const inPersonDeposit = (): Partial<typeof itemRequests.$inferInsert> => ({
  status: "RETURN_REQUESTED",
  depositMethod: "in_person",
  depositPaymentIntentId: null,
  trustDepositAmount: "42.00",
});
const claimsFor = (requestId: number) => db.select().from(securityClaims).where(eq(securityClaims.requestId, requestId));

test("reporting damage on an in-person deposit still confirms the return but opens no claim and charges nothing", async () => {
  stripe.calls.capture.length = 0;
  stripe.calls.create.length = 0;
  const { id } = await newRequest(inPersonDeposit());
  const response = await owner.post(`/api/requests/${id}/confirm-return`, {
    triggerDispute: true, conditionRating: 2, conditionNotes: "Cracked screen", sameCondition: false,
  });
  assert.equal(response.status, 200);
  const body: any = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.claimNotOpened, true);
  assert.equal(body.claimNotOpenedReason, IN_PERSON_NOTICE);
  assert.match(body.message, new RegExp(IN_PERSON_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(body.disputeOpened, undefined);

  const after = await load(id);
  assert.notEqual(after.status, "DISPUTED");
  assert.ok(["COMPLETED", "COMPLETED_EARLY"].includes(after.status!), `return confirmed (${after.status})`);
  assert.equal(after.returnConditionNotes, "Cracked screen", "the damage report is kept on the request");
  assert.equal((await claimsFor(id)).length, 0, "no claim is created");
  assert.equal(stripe.calls.capture.length + stripe.calls.create.length, 0, "no charge is attempted");
  const chat = await db.select().from(messages).where(eq(messages.requestId, id));
  assert.ok(chat.some((m) => m.content === "✅ Item returned in good condition. In-person deposit can be returned."));
  assert.ok(!chat.some((m) => /Claim opened/.test(m.content ?? "")));
});

test("the claim route refuses an in-person deposit with the same 409 message", async () => {
  const { id } = await newRequest(inPersonDeposit());
  const response = await owner.post(`/api/requests/${id}/claims`, {
    requestedAmount: 20, reason: "Cracked screen", claimType: "damage", evidence: ["https://example.test/photo.jpg"],
  });
  assert.equal(response.status, 409);
  assert.equal(((await response.json()) as { error: string }).error, IN_PERSON_NOTICE);
  assert.equal((await claimsFor(id)).length, 0);
});

test("a damage report on an in-app deposit is unchanged: it still opens a dispute", async () => {
  const { id } = await newRequest({
    status: "RETURN_REQUESTED", depositMethod: "in_app", depositPaymentIntentId: "pi_deposit_hold",
    depositStatus: "authorized", depositMode: "authorization", trustDepositAmount: "42.00",
  });
  const response = await owner.post(`/api/requests/${id}/confirm-return`, {
    triggerDispute: true, conditionRating: 2, conditionNotes: "Cracked screen", sameCondition: false,
  });
  const body: any = await response.json();
  assert.notEqual(body.claimNotOpened, true);
  assert.equal(response.status === 200 ? body.disputeOpened : undefined, response.status === 200 ? true : undefined);
});

// ── Claim type rename: missing_components → missing_parts ─────────────────────

test("the claim route takes missing_parts, and still takes the old missing_components name from older app builds", async () => {
  for (const sent of ["missing_parts", "missing_components"]) {
    const { id } = await newRequest(hold({ status: "IN_PROGRESS", overdueStage: "OVERDUE", endDate: new Date("2026-09-20T00:00:00.000Z") }));
    const response = await owner.post(`/api/requests/${id}/claims`, {
      requestedAmount: 20, reason: "Lens cap missing", claimType: sent, evidence: ["https://example.test/photo.jpg"],
    });
    assert.equal(response.status, 201, `${sent} accepted`);
    const claims = await claimsFor(id);
    assert.equal(claims.length, 1);
    assert.equal(claims[0].claimType, "missing_parts", `${sent} is stored under the new name`);
  }
});

test("an unknown claim type is still refused", async () => {
  const { id } = await newRequest(hold({ status: "IN_PROGRESS", overdueStage: "OVERDUE" }));
  const response = await owner.post(`/api/requests/${id}/claims`, {
    requestedAmount: 20, reason: "x", claimType: "missing_widgets", evidence: ["https://example.test/photo.jpg"],
  });
  assert.equal(response.status, 400);
  assert.equal((await claimsFor(id)).length, 0);
});

// ── Date-based flags come from the server, in the request's zone ──────────────

const dayAt = (value: string) => new Date(`${value}T00:00:00.000Z`);

test("the request list and the lifecycle endpoint both send isOverdue / isEarlyReturn / daysLate", async () => {
  // The route clock is Oct 3, noon in Vancouver.
  const cases = [
    { due: "2026-10-02", isOverdue: true, isEarlyReturn: false, daysLate: 1 },
    { due: "2026-10-03", isOverdue: false, isEarlyReturn: false, daysLate: 0 }, // the due day itself is on time
    { due: "2026-10-04", isOverdue: false, isEarlyReturn: true, daysLate: 0 },
  ];
  const list = (await (await owner.get("/api/requests")).json()) as any[];
  for (const c of cases) {
    const { id } = await newRequest(hold({ status: "IN_PROGRESS", startDate: dayAt("2026-09-28"), endDate: dayAt(c.due) }));
    const lifecycle: any = (await (await owner.get(`/api/requests/${id}/lifecycle`)).json() as any).lifecycle;
    const expected = { isOverdue: c.isOverdue, isEarlyReturn: c.isEarlyReturn, daysLate: c.daysLate };
    assert.deepEqual({ isOverdue: lifecycle.isOverdue, isEarlyReturn: lifecycle.isEarlyReturn, daysLate: lifecycle.daysLate }, expected, `lifecycle, due ${c.due}`);
    assert.equal(lifecycle.deadline, c.due, "the due day is sent as a calendar date");
    const fresh = (await (await owner.get("/api/requests")).json()) as any[];
    const row = fresh.find((r) => r.id === id) ?? list.find((r) => r.id === id);
    assert.ok(row, `request ${id} is in the list`);
    assert.deepEqual({ isOverdue: row.isOverdue, isEarlyReturn: row.isEarlyReturn, daysLate: row.daysLate }, expected, `list, due ${c.due}`);
  }
});

test("the list says whether the start day is still ahead (isBeforeStart) or already behind (startDatePassed)", async () => {
  // The route clock is Oct 3, noon in Vancouver.
  const cases = [
    { start: "2026-10-04", isBeforeStart: true, startDatePassed: false },
    { start: "2026-10-03", isBeforeStart: false, startDatePassed: false }, // starts today
    { start: "2026-10-02", isBeforeStart: false, startDatePassed: true },
  ];
  const ids = new Map<string, number>();
  for (const c of cases) {
    ids.set(c.start, (await newRequest(hold({ status: "IN_PROGRESS", requestType: "RENT", startDate: dayAt(c.start), endDate: dayAt("2026-10-10") }))).id);
  }
  const list = (await (await owner.get("/api/requests")).json()) as any[];
  for (const c of cases) {
    const row = list.find((r) => r.id === ids.get(c.start));
    assert.ok(row, `start ${c.start} is in the list`);
    assert.equal(row.isBeforeStart, c.isBeforeStart, `isBeforeStart, start ${c.start}`);
    assert.equal(row.startDatePassed, c.startDatePassed, `startDatePassed, start ${c.start}`);
  }
});
