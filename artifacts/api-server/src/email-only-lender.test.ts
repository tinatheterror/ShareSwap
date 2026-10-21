import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, pool, users, verifications } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureCancellationRecord, ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";
import { fakeStripe } from "./test-fixtures/fake-stripe.js";

// Lending policy: only the person borrowing or renting needs ID and a card. The owner needs a verified email.
const CLOCK = new Date("2026-10-03T19:00:00.000Z"); // Oct 3, noon in Vancouver
const UNIQUE = `email-only-lender-${Date.now()}`;
const PASSWORD = "EmailOnlyLender!42";
const userIds: number[] = [];
const itemIds: number[] = [];

const stripe = fakeStripe({});
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

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  await ensureCancellationRecord();
  const password = await hashPassword(PASSWORD);
  const [ownerUser, borrowerUser] = await db.insert(users).values([
    // The lender: a verified email and nothing else (no ID check, no card, no payout account).
    { username: `${UNIQUE}-owner`, password, emailVerified: true, trustScore: 80, reputationLevel: "Neighbour", shareCoins: "50.00" },
    { username: `${UNIQUE}-borrower`, password, emailVerified: true, trustScore: 80, reputationLevel: "Neighbour", shareCoins: "50.00", stripePaymentMethodId: `pm_${UNIQUE}` },
  ]).returning({ id: users.id, username: users.username });
  [ownerId, borrowerId] = [ownerUser.id, borrowerUser.id];
  userIds.push(ownerId, borrowerId);
  await db.insert(verifications).values({ userId: borrowerId, status: "approved" });

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
  await owner.login(ownerUser.username);
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

test("the lender really is email-only", async () => {
  const [row] = await db.select({ emailVerified: users.emailVerified, pm: users.stripePaymentMethodId, connect: users.stripeConnectedAccountId }).from(users).where(eq(users.id, ownerId));
  assert.equal(row.emailVerified, true);
  assert.equal(row.pm, null);
  assert.equal(row.connect, null);
  assert.equal((await db.select().from(verifications).where(eq(verifications.userId, ownerId))).length, 0);
});

test("an email-only owner can list an item", async () => {
  const form = new FormData();
  form.set("name", `${UNIQUE}-listed`);
  form.set("description", "Listed by an owner with only a verified email");
  form.set("isLendable", "true");
  const response = await owner.post("/api/items", form);
  assert.equal(response.status, 201, await response.clone().text());
  const body = (await response.json()) as { id: number };
  itemIds.push(body.id);
  const [row] = await db.select({ ownerId: items.ownerId }).from(items).where(eq(items.id, body.id));
  assert.equal(row.ownerId, ownerId);
});

test("an email-only lender accepts a borrow, confirms the handoff and confirms the return", async () => {
  const [item] = await db.insert(items).values({
    ownerId, name: `${UNIQUE}-borrowed`, description: "Borrowed from an email-only lender", conditionRating: 4, photos: [],
    isLendable: true, isAvailable: true, replacementValue: 100, securityDeposit: "10.00", lendingDuration: 7, shareCoinsReward: "0", shareCoinPrice: "7.00",
  }).returning({ id: items.id });
  itemIds.push(item.id);

  const requested = await borrower.post(`/api/items/${item.id}/request`, {
    requestType: "BORROW", depositMethod: "in_person", startDate: "2026-10-03", endDate: "2026-10-06",
  });
  assert.equal(requested.status, 201, await requested.clone().text());
  const { id } = (await requested.json()) as { id: number };

  const accepted = await owner.patch(`/api/requests/${id}`, { status: "ACCEPTED" });
  assert.equal(accepted.status, 200, await accepted.clone().text());

  const ownerHandoff = await owner.post(`/api/requests/${id}/handoff`, { confirmedBy: "owner" });
  assert.equal(ownerHandoff.status, 200, await ownerHandoff.clone().text());
  const borrowerHandoff = await borrower.post(`/api/requests/${id}/handoff`, { confirmedBy: "borrower" });
  assert.equal(borrowerHandoff.status, 200, await borrowerHandoff.clone().text());

  const returned = await borrower.post(`/api/requests/${id}/return`, {});
  assert.equal(returned.status, 200, await returned.clone().text());

  const confirmed = await owner.post(`/api/requests/${id}/confirm-return`, { conditionRating: 5, sameCondition: true });
  assert.equal(confirmed.status, 200, await confirmed.clone().text());

  const [row] = await db.select({ status: itemRequests.status }).from(itemRequests).where(eq(itemRequests.id, id));
  assert.ok(["COMPLETED", "COMPLETED_EARLY"].includes(row.status!), `completed (${row.status})`);
});
