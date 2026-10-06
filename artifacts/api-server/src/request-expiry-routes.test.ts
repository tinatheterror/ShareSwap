import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  itemRequests,
  items,
  messages,
  notifications,
  pool,
  shareCoinsTransactions,
  users,
} from "@workspace/db";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";

// The platform zone is America/Vancouver (PDT, UTC-7 in October 2026). A BORROW
// request for Oct 2–5 must be handed off by Oct 4 at 11:59 PM = 2026-10-05T06:59:59Z.
const OCT_2_NOON_PDT = new Date("2026-10-02T19:00:00Z");
const OCT_4_EVENING_PDT = new Date("2026-10-05T01:00:00Z"); // Oct 4, 6 PM
const OCT_4_LAST_SECOND_PDT = new Date("2026-10-05T06:59:59Z");
const OCT_5_FIRST_SECOND_PDT = new Date("2026-10-05T07:00:00Z");

const UNIQUE = `request-expiry-routes-${Date.now()}`;
const PASSWORD = "RequestExpiryRoute!42";
const requestIds: number[] = [];
const itemIds: number[] = [];
const userIds: number[] = [];

let clock = OCT_4_EVENING_PDT;
let baseUrl: string;
let closeServer: () => Promise<void>;
let owner: TestClient;
let borrower: TestClient;
let stranger: TestClient;
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
      description: "Request expiry route test item",
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
      status: "DEPOSIT_CONFIRMED",
      startDate: new Date("2026-10-02T00:00:00.000Z"),
      endDate: new Date("2026-10-05T00:00:00.000Z"),
      depositMethod: "in_person",
      handoffPin: "4321",
      // verify-pin's own code-expiry check reads the real clock; the injected test clock only
      // drives the request cutoff, so keep this far away from both.
      pinExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      ...overrides,
    })
    .returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return { id: request.id, itemId: item.id };
}

async function load(requestId: number) {
  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
  return request;
}

async function coins(userId: number) {
  const [row] = await db.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, userId));
  return Number(row.shareCoins);
}

async function setCoins(userId: number, amount: string) {
  await db.update(users).set({ shareCoins: amount }).where(eq(users.id, userId));
}

before(async () => {
  const password = await hashPassword(PASSWORD);
  const created = await db
    .insert(users)
    .values(
      ["owner", "borrower", "stranger"].map((role) => ({
        username: `${UNIQUE}-${role}`,
        password,
        emailVerified: true,
        shareCoins: "50.00",
      })),
    )
    .returning({ id: users.id, username: users.username });
  userIds.push(...created.map((user) => user.id));
  [ownerId, borrowerId] = [created[0].id, created[1].id];

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const server = registerRoutes(app, { startBackgroundJobs: false, now: () => clock });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  owner = new TestClient();
  borrower = new TestClient();
  stranger = new TestClient();
  await owner.login(created[0].username);
  await borrower.login(created[1].username);
  await stranger.login(created[2].username);
});

after(async () => {
  try {
    if (requestIds.length) {
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
      await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    }
    if (userIds.length) {
      await db.delete(notifications).where(inArray(notifications.userId, userIds));
      await db.delete(shareCoinsTransactions).where(inArray(shareCoinsTransactions.userId, userIds));
    }
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    if (closeServer) await closeServer();
    await pool.end();
  }
});

const EXPIRED_MESSAGE = "This request expired Oct 4 at 11:59 PM.";

// ── A late handoff is allowed, and keeps the original dates ───────────────────

test("a handoff on the last day (Oct 4) works and the agreed dates and ShareCoin cost stay put", async () => {
  clock = OCT_4_EVENING_PDT;
  await setCoins(borrowerId, "50.00");
  await setCoins(ownerId, "0.00");
  const { id } = await newRequest();

  const response = await borrower.post(`/api/requests/${id}/verify-pin`, { pin: "4321" });
  assert.equal(response.status, 200);

  const request = await load(id);
  assert.equal(request.status, "IN_PROGRESS");
  assert.equal(request.startDate?.toISOString(), "2026-10-02T00:00:00.000Z");
  assert.equal(request.endDate?.toISOString(), "2026-10-05T00:00:00.000Z", "no automatic date shifting");
  assert.ok(request.actualHandoffAt, "the actual handoff is recorded separately");
  // Oct 2 → Oct 5 is 3 usage days at 7 SC/week: round(7/7 × 3) = 3, however late the handoff.
  assert.equal(await coins(borrowerId), 47);
  assert.equal(await coins(ownerId), 3 + 1, "3 SC lend reward plus the existing first-time-lend bonus");
});

test("a manual handoff confirmation also works right up to the last second", async () => {
  clock = OCT_4_LAST_SECOND_PDT;
  const { id } = await newRequest();
  const response = await borrower.post(`/api/requests/${id}/handoff`, { confirmedBy: "borrower" });
  assert.equal(response.status, 200);
  assert.equal((await load(id)).status, "AWAITING_HANDOFF_CONFIRM");
});

test("once one person confirmed, the other can still confirm after the cutoff", async () => {
  clock = OCT_4_LAST_SECOND_PDT;
  const { id } = await newRequest();
  assert.equal((await borrower.post(`/api/requests/${id}/handoff`, { confirmedBy: "borrower" })).status, 200);

  clock = new Date(OCT_5_FIRST_SECOND_PDT.getTime() + 3_600_000);
  const response = await owner.post(`/api/requests/${id}/handoff`, { confirmedBy: "owner" });
  assert.equal(response.status, 200, "the request is not expired once someone confirmed");
  assert.equal((await load(id)).status, "IN_PROGRESS");
});

// ── After the cutoff ──────────────────────────────────────────────────────────

test("redeeming the code after the cutoff says the request expired, not 'invalid code'", async () => {
  clock = OCT_5_FIRST_SECOND_PDT;
  await setCoins(borrowerId, "50.00");
  const { id } = await newRequest();

  const response = await borrower.post(`/api/requests/${id}/verify-pin`, { pin: "4321" });
  assert.equal(response.status, 410);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.error, EXPIRED_MESSAGE);
  assert.equal(body.code, "REQUEST_EXPIRED");
  assert.equal(body.handoffCutoffAt, "2026-10-05T06:59:59.000Z");

  const request = await load(id);
  assert.equal(request.status, "EXPIRED");
  assert.equal(request.handoffPin, null);
  assert.equal(await coins(borrowerId), 50, "no ShareCoins move for an expired request");
});

test("even a wrong code on an expired request gets the expiry message", async () => {
  clock = OCT_5_FIRST_SECOND_PDT;
  const { id } = await newRequest();
  const response = await borrower.post(`/api/requests/${id}/verify-pin`, { pin: "0000" });
  assert.equal(response.status, 410);
  assert.equal(((await response.json()) as { error: string }).error, EXPIRED_MESSAGE);
});

test("the manual handoff, a denial and the owner's code view are all closed after the cutoff", async () => {
  clock = OCT_5_FIRST_SECOND_PDT;
  const { id } = await newRequest();

  const handoff = await owner.post(`/api/requests/${id}/handoff`, { confirmedBy: "owner" });
  assert.equal(handoff.status, 410);
  assert.equal(((await handoff.json()) as { error: string }).error, EXPIRED_MESSAGE);
  assert.equal((await load(id)).status, "EXPIRED");

  assert.equal((await borrower.post(`/api/requests/${id}/deny-handoff`)).status, 410);
  const pinView = await owner.request(`/api/requests/${id}/handoff-pin`);
  assert.equal(pinView.status, 410);
});

test("payment steps are closed too, so an expired request cannot be paid into", async () => {
  clock = OCT_5_FIRST_SECOND_PDT;
  const { id } = await newRequest({ status: "ACCEPTED" });
  const payDeposit = await borrower.post(`/api/requests/${id}/pay-deposit`, { depositAmount: 25 });
  assert.equal(payDeposit.status, 410);
  assert.equal((await load(id)).status, "EXPIRED");
  const confirmRental = await borrower.post(`/api/requests/${id}/confirm-rental-deposit`, { paymentIntentId: "not-a-stripe-id" });
  assert.equal(confirmRental.status, 410);
  const hold = await borrower.post("/api/rentals/create-payment-hold", { requestId: id });
  assert.equal(hold.status, 410);
});

test("an expired request cannot be cancelled back into another state", async () => {
  clock = OCT_5_FIRST_SECOND_PDT;
  const { id } = await newRequest();
  await borrower.post(`/api/requests/${id}/verify-pin`, { pin: "4321" }); // triggers the expiry
  const cancel = await borrower.post(`/api/requests/${id}/cancel`, {});
  assert.equal(cancel.status, 400);
  assert.equal((await load(id)).status, "EXPIRED");
});

test("someone outside the request learns nothing and cannot trigger its expiry", async () => {
  clock = OCT_5_FIRST_SECOND_PDT;
  const { id } = await newRequest();
  const response = await stranger.post(`/api/requests/${id}/verify-pin`, { pin: "4321" });
  assert.equal(response.status, 403);
  assert.equal((await load(id)).status, "DEPOSIT_CONFIRMED");
});

// ── Racing the deadline ───────────────────────────────────────────────────────

test("the same code redeemed twice at once is accepted once and moves ShareCoins once", async () => {
  clock = OCT_4_LAST_SECOND_PDT;
  await setCoins(borrowerId, "50.00");
  await setCoins(ownerId, "0.00");
  const { id } = await newRequest();

  const results = await Promise.all([
    borrower.post(`/api/requests/${id}/verify-pin`, { pin: "4321" }),
    borrower.post(`/api/requests/${id}/verify-pin`, { pin: "4321" }),
    borrower.post(`/api/requests/${id}/verify-pin`, { pin: "4321" }),
  ]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.ok(results.every((r) => [200, 400, 409].includes(r.status)));
  assert.equal((await load(id)).status, "IN_PROGRESS");
  assert.equal(await coins(borrowerId), 47, "charged exactly once");
  assert.equal(await coins(ownerId), 3);
});

test("a handoff made on the last second is not undone by the request expiring just after", async () => {
  clock = OCT_4_LAST_SECOND_PDT;
  await setCoins(borrowerId, "50.00");
  await setCoins(ownerId, "0.00");
  const { id } = await newRequest();
  assert.equal((await borrower.post(`/api/requests/${id}/verify-pin`, { pin: "4321" })).status, 200);

  // The deadline passes; every read (and an owner's view) must leave the handed-off request alone.
  clock = OCT_5_FIRST_SECOND_PDT;
  await owner.request("/api/requests");
  await borrower.request("/api/inbox");
  const request = await load(id);
  assert.equal(request.status, "IN_PROGRESS");
  assert.equal(request.expiredAt, null);
  assert.equal(await coins(borrowerId), 47);
});

test("a manual first confirmation on the last second also survives the deadline passing", async () => {
  clock = OCT_4_LAST_SECOND_PDT;
  const { id } = await newRequest();
  assert.equal((await owner.post(`/api/requests/${id}/handoff`, { confirmedBy: "owner" })).status, 200);
  clock = OCT_5_FIRST_SECOND_PDT;
  await borrower.request("/api/requests");
  assert.equal((await load(id)).status, "AWAITING_HANDOFF_CONFIRM");
});

test("a redemption that arrives while the request is being expired is refused, and nothing is charged", async () => {
  // Hold the row the way an in-flight expiry does (operation token set), then redeem.
  clock = OCT_4_LAST_SECOND_PDT;
  await setCoins(borrowerId, "50.00");
  await setCoins(ownerId, "0.00");
  const { id } = await newRequest({
    depositRenewalStatus: "terminal_action",
    depositOperationToken: "expiry-in-flight",
    depositOperationType: "cancel",
    depositRenewalAttemptedAt: new Date(),
  });
  const response = await borrower.post(`/api/requests/${id}/verify-pin`, { pin: "4321" });
  assert.equal(response.status, 409);
  assert.equal((await load(id)).status, "DEPOSIT_CONFIRMED");
  assert.equal(await coins(borrowerId), 50);
  assert.equal(await coins(ownerId), 0);
});

// ── Reading requests ──────────────────────────────────────────────────────────

test("an open request shows the exact deadline; reading it after the cutoff shows it expired", async () => {
  clock = OCT_2_NOON_PDT;
  const { id } = await newRequest({ status: "ACCEPTED" });

  const open = (await (await borrower.request("/api/requests")).json()) as any[];
  const before = open.find((r) => r.id === id);
  assert.equal(before.status, "ACCEPTED");
  assert.equal(before.handoffCutoffAt, "2026-10-05T06:59:59.000Z");
  assert.equal(before.handoffDeadlineLabel, "Hand off by Oct 4, 11:59 PM");
  assert.equal(before.canRequestAgain, false);

  clock = OCT_5_FIRST_SECOND_PDT; // nothing scheduled ran: the read itself must catch up
  const borrowerView = ((await (await borrower.request("/api/requests")).json()) as any[]).find((r) => r.id === id);
  assert.equal(borrowerView.status, "EXPIRED");
  assert.equal(borrowerView.handoffDeadlineLabel, null);
  assert.equal(borrowerView.expiredMessage, EXPIRED_MESSAGE);
  assert.equal(borrowerView.canRequestAgain, true);
  assert.ok(borrowerView.expiredAt);

  const ownerView = ((await (await owner.request("/api/requests")).json()) as any[]).find((r) => r.id === id);
  assert.equal(ownerView.status, "EXPIRED");
  assert.equal(ownerView.canRequestAgain, false, "only the borrower can request again");
});

test("an expired request keeps its old details so a new request can be prefilled", async () => {
  clock = OCT_5_FIRST_SECOND_PDT;
  const { id, itemId } = await newRequest({ message: "Need it for the weekend", deliveryMethod: "in_person", depositMethod: "in_app" });
  const view = ((await (await borrower.request("/api/requests")).json()) as any[]).find((r) => r.id === id);
  assert.equal(view.status, "EXPIRED");
  assert.equal(view.itemId, itemId);
  assert.equal(view.item.id, itemId);
  assert.equal(view.requestType, "BORROW");
  assert.equal(view.message, "Need it for the weekend");
  assert.equal(view.deliveryMethod, "in_person");
  assert.equal(view.depositMethod, "in_app");
  assert.equal(view.startDate, "2026-10-02T00:00:00.000Z");
  assert.equal(view.endDate, "2026-10-05T00:00:00.000Z");
});

// ── Chat: auto-archive 7 days after expiry, back to active on a new message ───

test("an expired chat stays active for 7 days, archives, and returns on a new message", async () => {
  clock = OCT_5_FIRST_SECOND_PDT;
  const { id } = await newRequest();
  await owner.request("/api/requests"); // expires it; writes the expiry system message

  const inbox = async (client: TestClient, archived: boolean) =>
    ((await (await client.request(`/api/inbox?archived=${archived}`)).json()) as any[]).filter((t) => t.requestId === id);
  const day = 86_400_000;
  const expiredAt = (await load(id)).expiredAt!;

  clock = new Date(expiredAt.getTime() + 6 * day);
  assert.equal((await inbox(borrower, false)).length, 1, "active on day 6");
  assert.equal((await inbox(borrower, true)).length, 0);
  assert.equal((await inbox(borrower, false))[0].requestStatus, "EXPIRED");

  clock = new Date(expiredAt.getTime() + 8 * day);
  assert.equal((await inbox(borrower, false)).length, 0, "archived on day 8 with no new messages");
  assert.equal((await inbox(borrower, true)).length, 1);

  // A new message on day 8 brings it back for another 7 days.
  await db.insert(messages).values({
    senderId: ownerId,
    receiverId: borrowerId,
    content: "Still want it? Happy to lend next week.",
    requestId: id,
    createdAt: new Date(expiredAt.getTime() + 8 * day),
  });
  assert.equal((await inbox(borrower, false)).length, 1, "active again after a new message");
  assert.equal((await inbox(borrower, true)).length, 0);

  clock = new Date(expiredAt.getTime() + 14 * day);
  assert.equal((await inbox(borrower, false)).length, 1, "still active 6 days after that message");
  clock = new Date(expiredAt.getTime() + 16 * day);
  assert.equal((await inbox(borrower, true)).length, 1, "archived again 8 days after it");
});
