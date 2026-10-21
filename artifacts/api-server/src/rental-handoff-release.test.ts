import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, pool, rentalPayouts, users } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { releaseHeldRentalPayout } from "./rental-payout-service.js";
import { ensureCancellationRecord, ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";
import { fakeStripe } from "./test-fixtures/fake-stripe.js";

const CLOCK = new Date("2026-10-03T19:00:00.000Z"); // Oct 3, noon in Vancouver
const UNIQUE = `rental-handoff-release-${Date.now()}`;
const PASSWORD = "RentalHandoffRelease!42";
const userIds: number[] = [];
const itemIds: number[] = [];

const stripe = fakeStripe({});
let baseUrl: string;
let closeServer: () => Promise<void>;
let borrower: TestClient;
let ownerId: number;
let borrowerId: number;

class TestClient {
  private cookies = new Map<string, string>();
  private csrfToken = "";
  async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (!(init.body instanceof FormData)) headers.set("content-type", "application/json");
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
    return this.request(path, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body) });
  }
  patch(path: string, body: unknown = {}) {
    return this.request(path, { method: "PATCH", body: JSON.stringify(body) });
  }
  async login(username: string) {
    const response = await this.request("/api/login", { method: "POST", body: JSON.stringify({ username, password: PASSWORD }) });
    assert.equal(response.status, 200);
    const csrf = await this.request("/api/csrf-token");
    this.csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken;
  }
}


async function rentalAwaitingBorrower(opts: { held: boolean }) {
  const [item] = await db.insert(items).values({
    ownerId, name: `${UNIQUE}-item-${itemIds.length}`, description: "Rental handoff release test", conditionRating: 4, photos: [],
    isRentable: true, isAvailable: true, replacementValue: 100, securityDeposit: "10.00", lendingDuration: 7, shareCoinsReward: "0",
  }).returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db.insert(itemRequests).values({
    itemId: item.id, requesterId: borrowerId, requestType: "RENT", status: "AWAITING_HANDOFF_CONFIRM",
    startDate: new Date("2026-10-03T00:00:00.000Z"), endDate: new Date("2026-10-06T00:00:00.000Z"),
    depositMethod: "in_app", depositPaymentIntentId: "pi_deposit_hold", depositStatus: "authorized", depositMode: "authorization",
    trustDepositAmount: "10.00", rentalAmount: "100.00", ownerConfirmedHandoff: true, ownerConfirmedHandoffAt: CLOCK,
  } as any).returning({ id: itemRequests.id });
  if (opts.held) {
    await db.insert(rentalPayouts).values({
      userId: ownerId, requestId: request.id, amount: "100.00", rentalAmount: "100.00", platformFee: "5.00",
      processingFee: "0.00", netAmount: "95.00", status: "held",
    });
    await db.update(users).set({ rentalBalance: "0.00", pendingRentalBalance: "95.00" }).where(eq(users.id, ownerId));
  } else {
    await db.update(users).set({ rentalBalance: "0.00", pendingRentalBalance: "0.00" }).where(eq(users.id, ownerId));
  }
  return { requestId: request.id, itemId: item.id };
}

const ownerWallet = async () => (await db.select({ available: users.rentalBalance, pending: users.pendingRentalBalance }).from(users).where(eq(users.id, ownerId)))[0];
const payoutsFor = (requestId: number) => db.select().from(rentalPayouts).where(eq(rentalPayouts.requestId, requestId));

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  await ensureCancellationRecord();
  const password = await hashPassword(PASSWORD);
  const [ownerUser, borrowerUser] = await db.insert(users).values([
    { username: `${UNIQUE}-owner`, password, emailVerified: true, trustScore: 80, reputationLevel: "Neighbour" },
    { username: `${UNIQUE}-borrower`, password, emailVerified: true, trustScore: 80, reputationLevel: "Neighbour" },
  ]).returning({ id: users.id, username: users.username });
  [ownerId, borrowerId] = [ownerUser.id, borrowerUser.id];
  userIds.push(ownerId, borrowerId);

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const server = registerRoutes(app, { startBackgroundJobs: false, now: () => CLOCK, stripe: stripe.client });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  borrower = new TestClient();
  await borrower.login(borrowerUser.username);
});

/** Deletes every row that points at the given ids through a foreign key, so the test leaves nothing behind. */
async function purgeReferences(table: string, ids: number[]) {
  if (!ids.length) return;
  const refs = await pool.query<{ table_name: string; column_name: string }>(`
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = $1 AND tc.table_schema = 'public'`, [table]);
  for (let pass = 0; pass < 3; pass += 1) {
    for (const { table_name, column_name } of refs.rows) {
      await pool.query(`DELETE FROM "${table_name}" WHERE "${column_name}" = ANY($1::int[])`, [ids]).catch(() => undefined);
    }
  }
}

after(async () => {
  try {
    const requests = itemIds.length ? await db.select({ id: itemRequests.id }).from(itemRequests).where(inArray(itemRequests.itemId, itemIds)) : [];
    const requestIds = requests.map((r) => r.id);
    await purgeReferences("item_requests", requestIds);
    if (requestIds.length) await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    await purgeReferences("items", itemIds);
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    await purgeReferences("users", userIds);
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    if (closeServer) await closeServer();
    await pool.end();
  }
});

test("concurrent confirmations of a rental handoff credit the owner exactly once", async () => {
  const { requestId } = await rentalAwaitingBorrower({ held: true });

  const responses = await Promise.all(Array.from({ length: 5 }, () => borrower.post(`/api/requests/${requestId}/handoff`, { confirmedBy: "borrower" })));
  const statuses = responses.map((r) => r.status);

  assert.equal(statuses.filter((s) => s === 200).length, 1, `exactly one confirmation completes the handoff (${statuses})`);
  assert.deepEqual(await ownerWallet(), { available: "95.00", pending: "0.00" });
  const rows = await payoutsFor(requestId);
  assert.equal(rows.length, 1, "no extra payout row is created");
  assert.equal(rows[0].status, "released");
  assert.equal(rows[0].netAmount, "95.00");
  const [request] = await db.select({ status: itemRequests.status }).from(itemRequests).where(eq(itemRequests.id, requestId));
  assert.equal(request.status, "IN_PROGRESS");

  // A later repeat does nothing either.
  const again = await borrower.post(`/api/requests/${requestId}/handoff`, { confirmedBy: "borrower" });
  assert.notEqual(again.status, 200);
  assert.deepEqual(await ownerWallet(), { available: "95.00", pending: "0.00" });
});

test("a rental with no held payout completes the handoff but credits nothing", async () => {
  const { requestId } = await rentalAwaitingBorrower({ held: false });
  const response = await borrower.post(`/api/requests/${requestId}/handoff`, { confirmedBy: "borrower" });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await ownerWallet(), { available: "0.00", pending: "0.00" });
  assert.equal((await payoutsFor(requestId)).length, 0, "no fallback payout row is invented");
});

test("releasing the held payout twice credits once", async () => {
  const { requestId, itemId } = await rentalAwaitingBorrower({ held: true });
  const args = { requestId, ownerId, itemId, itemName: "Test item", logTag: "Test" };
  const results = await Promise.all([releaseHeldRentalPayout(args), releaseHeldRentalPayout(args), releaseHeldRentalPayout(args)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.deepEqual(await ownerWallet(), { available: "95.00", pending: "0.00" });
  assert.equal(await releaseHeldRentalPayout(args), false);
  assert.deepEqual(await ownerWallet(), { available: "95.00", pending: "0.00" });
});
