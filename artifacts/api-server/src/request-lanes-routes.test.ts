import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, userReviews, users } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";

const UNIQUE = `request-lanes-routes-${Date.now()}`;
const PASSWORD = "RequestLaneRoute!42";
const NOW = new Date("2026-10-30T18:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const requestIds: number[] = [];
const itemIds: number[] = [];
const userIds: number[] = [];

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
    if (this.cookies.size) {
      headers.set("cookie", [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "));
    }
    if (this.csrfToken && init.method && init.method !== "GET") headers.set("x-csrf-token", this.csrfToken);

    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";", 1);
      const separator = pair.indexOf("=");
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }

  async post(path: string, body: unknown = {}) {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  }

  async login(username: string) {
    const response = await this.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password: PASSWORD }),
    });
    assert.equal(response.status, 200);
    const csrfResponse = await this.request("/api/csrf-token");
    assert.equal(csrfResponse.status, 200);
    this.csrfToken = ((await csrfResponse.json()) as { csrfToken: string }).csrfToken;
  }
}

async function newRequest(overrides: Partial<typeof itemRequests.$inferInsert> = {}) {
  const [item] = await db
    .insert(items)
    .values({
      ownerId,
      name: `${UNIQUE}-item-${itemIds.length}`,
      description: "Request lane route test item",
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
    })
    .returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db
    .insert(itemRequests)
    .values({
      itemId: item.id,
      requesterId: borrowerId,
      requestType: "BORROW",
      status: "PENDING",
      startDate: new Date("2026-11-01T00:00:00.000Z"),
      endDate: new Date("2026-11-03T00:00:00.000Z"),
      depositMethod: "in_person",
      ...overrides,
    })
    .returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return request.id;
}

type Row = { id: number; lane: { section: string; actionLabel: string | null; statusLine: string; dueDay: string | null } };
const listRequests = async (client: TestClient, query = "") => (await (await client.request(`/api/requests${query}`)).json()) as Row[];
const laneOf = (rows: Row[], id: number) => rows.find((r) => r.id === id)?.lane;

before(async () => {
  const password = await hashPassword(PASSWORD);
  const created = await db
    .insert(users)
    .values(["owner", "borrower"].map((role) => ({ username: `${UNIQUE}-${role}`, password, emailVerified: true, shareCoins: "50.00" })))
    .returning({ id: users.id, username: users.username });
  userIds.push(...created.map((user) => user.id));
  [ownerId, borrowerId] = [created[0].id, created[1].id];

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const server = registerRoutes(app, { startBackgroundJobs: false, now: () => NOW });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  owner = new TestClient();
  borrower = new TestClient();
  await owner.login(created[0].username);
  await borrower.login(created[1].username);
});

after(async () => {
  try {
    if (requestIds.length) {
      await db.delete(userReviews).where(inArray(userReviews.transactionId, requestIds));
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
      await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    }
    if (userIds.length) await db.delete(notifications).where(inArray(notifications.userId, userIds));
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    if (closeServer) await closeServer();
    await pool.end();
  }
});

test("GET /api/requests gives each request a section for the person asking", async () => {
  const pending = await newRequest();
  const inProgress = await newRequest({ status: "IN_PROGRESS" });
  const overdue = await newRequest({ status: "RETURN_DUE" });
  const cancelled = await newRequest({ status: "CANCELLED" });

  const asOwner = await listRequests(owner);
  assert.equal(laneOf(asOwner, pending)?.section, "action");
  assert.equal(laneOf(asOwner, inProgress)?.section, "in_progress");
  assert.equal(laneOf(asOwner, cancelled)?.section, "history");

  const asBorrower = await listRequests(borrower);
  assert.equal(laneOf(asBorrower, pending)?.section, "in_progress");
  assert.match(laneOf(asBorrower, pending)!.statusLine, /^Waiting on .* to respond$/);
  // The test accounts' usernames are not email addresses, but a status line must never carry one.
  assert.ok(!JSON.stringify(asBorrower.map((r) => r.lane)).includes("@"));
  assert.equal(laneOf(asBorrower, inProgress)?.statusLine, "Return by Nov 3");
  assert.equal(laneOf(asBorrower, inProgress)?.dueDay, "2026-11-03");
  assert.equal(laneOf(asBorrower, overdue)?.section, "action");
  assert.equal(laneOf(asBorrower, overdue)?.actionLabel, "Return the item");
});

test("a completed request asks for a review for 14 days, until the viewer has reviewed it", async () => {
  const recent = await newRequest({ status: "COMPLETED", returnConfirmedAt: new Date(NOW.getTime() - 3 * DAY) });
  const old = await newRequest({ status: "COMPLETED", returnConfirmedAt: new Date(NOW.getTime() - 20 * DAY) });
  const reviewed = await newRequest({ status: "COMPLETED", returnConfirmedAt: new Date(NOW.getTime() - 3 * DAY) });
  await db.insert(userReviews).values({ reviewerId: ownerId, reviewedUserId: borrowerId, rating: 5, transactionId: reviewed });

  const asOwner = await listRequests(owner);
  assert.equal(laneOf(asOwner, recent)?.actionLabel, "Leave a review");
  assert.equal(laneOf(asOwner, old)?.section, "history");
  assert.equal(laneOf(asOwner, reviewed)?.section, "history");
  // The borrower has not reviewed it, so it is still theirs to do.
  assert.equal(laneOf(await listRequests(borrower), reviewed)?.actionLabel, "Leave a review");
});

test("?filter=blocking-deletion lists only requests that block deleting the account", async () => {
  const autoCancelled = await newRequest(); // PENDING, nothing moved: deletion cancels it by itself
  const blocking = await newRequest({ status: "IN_PROGRESS" });
  const finished = await newRequest({ status: "COMPLETED", returnConfirmedAt: new Date(NOW.getTime() - 30 * DAY) });

  const ids = (await listRequests(owner, "?filter=blocking-deletion")).map((r) => r.id);
  assert.ok(ids.includes(blocking));
  assert.ok(!ids.includes(autoCancelled));
  assert.ok(!ids.includes(finished));
  assert.ok((await listRequests(owner)).some((r) => r.id === autoCancelled), "the unfiltered list still has it");
});

test("GET /api/inbox carries the same section and honours the blocking filter", async () => {
  const live = await newRequest({ status: "IN_PROGRESS" });
  const inbox = (await (await borrower.request("/api/inbox")).json()) as Array<{ requestId: number; lane: Row["lane"] }>;
  assert.equal(inbox.find((t) => t.requestId === live)?.lane.statusLine, "Return by Nov 3");

  const blocking = (await (await borrower.request("/api/inbox?filter=blocking-deletion")).json()) as Array<{ requestId: number }>;
  assert.ok(blocking.some((t) => t.requestId === live));
  assert.ok(blocking.every((t) => t.requestId !== requestIds[0]), "the auto-cancelled PENDING request is not listed");
});
