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
  users,
  verifications,
} from "@workspace/db";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";

const UNIQUE = `request-start-dates-${Date.now()}`;
const PASSWORD = "StartDateRouteTest!42";
const requestIds: number[] = [];
const itemIds: number[] = [];
const userIds: number[] = [];

// The platform zone is America/Vancouver (PDT, UTC-7 in October 2026).
// Oct 4 21:00 PDT is already Oct 5 in UTC: a UTC comparison would wrongly treat
// an Oct 4 start as over, a calendar-day comparison in the platform zone does not.
const OCT_4_EVENING_PDT = new Date("2026-10-05T04:00:00Z");
const OCT_4_LAST_SECOND_PDT = new Date("2026-10-05T06:59:59Z");
const OCT_5_FIRST_SECOND_PDT = new Date("2026-10-05T07:00:00Z");

let clock = OCT_4_EVENING_PDT;
let baseUrl: string;
let closeServer: () => Promise<void>;
let owner: TestClient;
let requester: TestClient;
let itemId: number;

class TestClient {
  private cookies = new Map<string, string>();
  private csrfToken = "";

  async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    headers.set("x-forwarded-proto", "https");
    if (this.cookies.size) {
      headers.set(
        "cookie",
        [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    }
    if (this.csrfToken && init.method && init.method !== "GET") {
      headers.set("x-csrf-token", this.csrfToken);
    }

    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";", 1);
      const separator = pair.indexOf("=");
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
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

async function createPendingRequest(
  requestType: string,
  startDate: string,
  options: {
    negotiationStatus?: string;
    counterProposedBy?: number;
    counterRound?: number;
    counterStartDate?: string;
  } = {},
) {
  const [request] = await db
    .insert(itemRequests)
    .values({
      itemId,
      requesterId: userIds[1],
      requestType,
      status: "PENDING",
      startDate: new Date(`${startDate}T00:00:00.000Z`),
      endDate: new Date("2026-10-20T00:00:00.000Z"),
      negotiationStatus: options.negotiationStatus ?? "pending_owner",
      counterProposedBy: options.counterProposedBy,
      counterRound: options.counterRound ?? 0,
      counterStartDate: options.counterStartDate
        ? new Date(`${options.counterStartDate}T00:00:00.000Z`)
        : undefined,
      counterEndDate: options.counterStartDate
        ? new Date("2026-10-25T00:00:00.000Z")
        : undefined,
    })
    .returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return request.id;
}

async function requestStatus(requestId: number) {
  const [row] = await db
    .select({ status: itemRequests.status })
    .from(itemRequests)
    .where(eq(itemRequests.id, requestId));
  return row.status;
}

before(async () => {
  const password = await hashPassword(PASSWORD);
  const [ownerUser, requesterUser] = await db
    .insert(users)
    .values([
      {
        username: `${UNIQUE}-owner`,
        password,
        emailVerified: true,
        stripePaymentMethodId: `pm_${UNIQUE}_owner`,
        subscriptionTier: "member",
      },
      {
        username: `${UNIQUE}-requester`,
        password,
        emailVerified: true,
        stripePaymentMethodId: `pm_${UNIQUE}_requester`,
        subscriptionTier: "member",
      },
    ])
    .returning({ id: users.id, username: users.username });
  userIds.push(ownerUser.id, requesterUser.id);

  await db.insert(verifications).values([
    { userId: ownerUser.id, status: "approved" },
    { userId: requesterUser.id, status: "approved" },
  ]);

  const [item] = await db
    .insert(items)
    .values({
      ownerId: ownerUser.id,
      name: `${UNIQUE}-all-types`,
      description: "Start-date route test item",
      conditionRating: 4,
      photos: [],
      isLendable: true,
      isRentable: true,
      isSwappable: true,
      isGift: true,
      isAvailable: true,
      replacementValue: 100,
      securityDeposit: "10.00",
      lendingDuration: 7,
      shareCoinsReward: "0",
    })
    .returning({ id: items.id });
  itemId = item.id;
  itemIds.push(item.id);

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const server = registerRoutes(app, {
    startBackgroundJobs: false,
    now: () => clock,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });

  owner = new TestClient();
  requester = new TestClient();
  await owner.login(ownerUser.username);
  await requester.login(requesterUser.username);
});

after(async () => {
  if (requestIds.length) {
    await db.delete(messages).where(inArray(messages.requestId, requestIds));
    await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
    await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
  }
  if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
  if (userIds.length) {
    await db.delete(verifications).where(inArray(verifications.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }
  if (closeServer) await closeServer();
  await pool.end();
});

async function createViaApi(requestType: string, startDate: string) {
  const response = await requester.request(`/api/items/${itemId}/request`, {
    method: "POST",
    body: JSON.stringify({
      requestType,
      startDate,
      endDate: "2026-10-20",
      deliveryMethod: "in_person",
      depositMethod: "in_app",
    }),
  });
  if (response.status === 201) {
    requestIds.push(((await response.json()) as { id: number }).id);
    return { status: 201 as const, body: null };
  }
  return { status: response.status, body: (await response.json()) as { code?: string; error?: string } };
}

// ── (b) creation ───────────────────────────────────────────────────────────────

test("creation rejects a past start date for every request type", async () => {
  clock = OCT_4_EVENING_PDT;
  for (const requestType of ["BORROW", "RENT", "SWAP", "GIFT"]) {
    const result = await createViaApi(requestType, "2026-10-03");
    assert.equal(result.status, 400, `${requestType} should reject a past start`);
    assert.equal(result.body?.code, "START_DATE_IN_PAST", requestType);
    assert.match(result.body?.error ?? "", /today or later/);
  }
});

test("creation accepts a start on its own day while UTC has already rolled over", async () => {
  // Oct 4, 21:00 and 23:59:59 in Vancouver; the UTC day is already Oct 5.
  for (const now of [OCT_4_EVENING_PDT, OCT_4_LAST_SECOND_PDT]) {
    clock = now;
    for (const requestType of ["BORROW", "RENT", "SWAP", "GIFT"]) {
      const result = await createViaApi(requestType, "2026-10-04");
      assert.equal(result.status, 201, `${requestType} on its own start day at ${now.toISOString()}`);
    }
  }
});

test("creation flips to rejecting at local midnight, not at UTC midnight", async () => {
  clock = OCT_5_FIRST_SECOND_PDT;
  for (const requestType of ["BORROW", "RENT", "SWAP", "GIFT"]) {
    const past = await createViaApi(requestType, "2026-10-04");
    assert.equal(past.status, 400, `${requestType} Oct 4 after local midnight`);
    assert.equal(past.body?.code, "START_DATE_IN_PAST");

    const today = await createViaApi(requestType, "2026-10-05");
    assert.equal(today.status, 201, `${requestType} Oct 5 on its own day`);
  }
});

// ── (b) counter-proposals ──────────────────────────────────────────────────────

test("counter-proposals reject a past start date and accept today, for every type", async () => {
  clock = OCT_4_EVENING_PDT;
  for (const requestType of ["BORROW", "RENT", "SWAP", "GIFT"]) {
    const rejectedId = await createPendingRequest(requestType, "2026-10-10");
    const rejected = await owner.request(`/api/requests/${rejectedId}/counter-proposal`, {
      method: "POST",
      body: JSON.stringify({ startDate: "2026-10-03", endDate: "2026-10-15" }),
    });
    assert.equal(rejected.status, 400, `${requestType} past counter`);
    assert.equal(((await rejected.json()) as { code: string }).code, "START_DATE_IN_PAST");

    const acceptedId = await createPendingRequest(requestType, "2026-10-10");
    const accepted = await owner.request(`/api/requests/${acceptedId}/counter-proposal`, {
      method: "POST",
      body: JSON.stringify({ startDate: "2026-10-04", endDate: "2026-10-15" }),
    });
    assert.equal(accepted.status, 200, `${requestType} counter on its own start day`);
  }
});

test("a counter that omits dates cannot carry a stale start forward", async () => {
  clock = OCT_4_EVENING_PDT;
  const staleId = await createPendingRequest("RENT", "2026-10-02");
  const stale = await owner.request(`/api/requests/${staleId}/counter-proposal`, {
    method: "POST",
    body: JSON.stringify({ depositMethod: "in_person" }),
  });
  assert.equal(stale.status, 400);
  assert.equal(((await stale.json()) as { code: string }).code, "START_DATE_IN_PAST");

  const currentId = await createPendingRequest("RENT", "2026-10-04");
  const current = await owner.request(`/api/requests/${currentId}/counter-proposal`, {
    method: "POST",
    body: JSON.stringify({ depositMethod: "in_person" }),
  });
  assert.equal(current.status, 200);
});

test("counter-backs reject a past start date and accept today, for every type", async () => {
  clock = OCT_4_EVENING_PDT;
  for (const requestType of ["BORROW", "RENT", "SWAP", "GIFT"]) {
    const fixture = {
      negotiationStatus: "counter_proposed",
      counterProposedBy: userIds[0],
      counterRound: 1,
      counterStartDate: "2026-10-10",
    };

    const rejectedId = await createPendingRequest(requestType, "2026-10-10", fixture);
    const rejected = await requester.request(`/api/requests/${rejectedId}/respond-to-counter`, {
      method: "POST",
      body: JSON.stringify({ counter: { startDate: "2026-10-03", endDate: "2026-10-15" } }),
    });
    assert.equal(rejected.status, 400, `${requestType} past counter-back`);
    assert.equal(((await rejected.json()) as { code: string }).code, "START_DATE_IN_PAST");

    const acceptedId = await createPendingRequest(requestType, "2026-10-10", fixture);
    const accepted = await requester.request(`/api/requests/${acceptedId}/respond-to-counter`, {
      method: "POST",
      body: JSON.stringify({ counter: { startDate: "2026-10-04", endDate: "2026-10-15" } }),
    });
    assert.equal(accepted.status, 200, `${requestType} counter-back on its own start day`);
  }
});

// ── (a) accepting a PENDING request ────────────────────────────────────────────

test("accepting a PENDING request whose start has passed returns 409 and changes nothing", async () => {
  clock = OCT_4_EVENING_PDT;
  for (const requestType of ["BORROW", "RENT", "GIFT"]) {
    const requestId = await createPendingRequest(requestType, "2026-10-03");
    const response = await owner.request(`/api/requests/${requestId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "ACCEPTED" }),
    });
    assert.equal(response.status, 409, requestType);
    const body = (await response.json()) as { code: string; error: string };
    assert.equal(body.code, "REQUEST_DATES_PASSED");
    assert.equal(body.error, "These dates have passed. Counter with new dates or decline.");
    assert.equal(await requestStatus(requestId), "PENDING");
  }
});

test("a request on its own start day is still acceptable late that evening", async () => {
  for (const now of [OCT_4_EVENING_PDT, OCT_4_LAST_SECOND_PDT]) {
    clock = now;
    const requestId = await createPendingRequest("RENT", "2026-10-04");
    const response = await owner.request(`/api/requests/${requestId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "ACCEPTED" }),
    });
    assert.equal(response.status, 200, `accept at ${now.toISOString()}`);
    assert.equal(await requestStatus(requestId), "ACCEPTED");
  }
});

test("the same request becomes unacceptable at local midnight", async () => {
  clock = OCT_4_LAST_SECOND_PDT;
  const requestId = await createPendingRequest("RENT", "2026-10-04");

  clock = OCT_5_FIRST_SECOND_PDT;
  const response = await owner.request(`/api/requests/${requestId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "ACCEPTED" }),
  });
  assert.equal(response.status, 409);
  assert.equal(await requestStatus(requestId), "PENDING");
});

test("acceptance is judged on the counter's start date when one is pending", async () => {
  clock = OCT_4_EVENING_PDT;
  // The original dates are stale, but the agreed counter dates are still ahead.
  const requestId = await createPendingRequest("RENT", "2026-10-02", {
    negotiationStatus: "terms_accepted",
    counterStartDate: "2026-10-08",
  });
  const response = await owner.request(`/api/requests/${requestId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "ACCEPTED" }),
  });
  assert.equal(response.status, 200);
  assert.equal(await requestStatus(requestId), "ACCEPTED");
});

test("declining a request whose dates have passed still works", async () => {
  clock = OCT_4_EVENING_PDT;
  const requestId = await createPendingRequest("RENT", "2026-10-01");
  const response = await owner.request(`/api/requests/${requestId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "DECLINED" }),
  });
  assert.equal(response.status, 200);
  assert.equal(await requestStatus(requestId), "DECLINED");
});

// ── (a) accepting a counter-proposal ───────────────────────────────────────────

async function counterState(requestId: number) {
  const [row] = await db
    .select({ status: itemRequests.status, negotiationStatus: itemRequests.negotiationStatus })
    .from(itemRequests)
    .where(eq(itemRequests.id, requestId));
  return row;
}

test("accepting a counter whose countered start has passed returns 409 for either party", async () => {
  clock = OCT_4_EVENING_PDT;
  const counteredByOwner = await createPendingRequest("RENT", "2026-10-10", {
    negotiationStatus: "counter_proposed",
    counterProposedBy: userIds[0],
    counterRound: 1,
    counterStartDate: "2026-10-03",
  });
  const byRequester = await requester.request(`/api/requests/${counteredByOwner}/respond-to-counter`, {
    method: "POST",
    body: JSON.stringify({ accept: true }),
  });
  assert.equal(byRequester.status, 409);
  const requesterBody = (await byRequester.json()) as { code: string; error: string };
  assert.equal(requesterBody.code, "REQUEST_DATES_PASSED");
  assert.equal(requesterBody.error, "These dates have passed. Counter with new dates or decline.");
  assert.deepEqual(await counterState(counteredByOwner), { status: "PENDING", negotiationStatus: "counter_proposed" });

  const counteredByRequester = await createPendingRequest("BORROW", "2026-10-10", {
    negotiationStatus: "counter_proposed",
    counterProposedBy: userIds[1],
    counterRound: 1,
    counterStartDate: "2026-10-03",
  });
  const byOwner = await owner.request(`/api/requests/${counteredByRequester}/respond-to-counter`, {
    method: "POST",
    body: JSON.stringify({ accept: true }),
  });
  assert.equal(byOwner.status, 409);
  assert.equal(((await byOwner.json()) as { code: string }).code, "REQUEST_DATES_PASSED");
  assert.deepEqual(await counterState(counteredByRequester), { status: "PENDING", negotiationStatus: "counter_proposed" });
});

test("a counter on its own start day is acceptable until local midnight, then not", async () => {
  for (const now of [OCT_4_EVENING_PDT, OCT_4_LAST_SECOND_PDT]) {
    clock = now;
    const requestId = await createPendingRequest("RENT", "2026-10-10", {
      negotiationStatus: "counter_proposed",
      counterProposedBy: userIds[0],
      counterRound: 1,
      counterStartDate: "2026-10-04",
    });
    const response = await requester.request(`/api/requests/${requestId}/respond-to-counter`, {
      method: "POST",
      body: JSON.stringify({ accept: true }),
    });
    assert.equal(response.status, 200, `accept at ${now.toISOString()}`);
  }

  clock = OCT_4_LAST_SECOND_PDT;
  const lateId = await createPendingRequest("RENT", "2026-10-10", {
    negotiationStatus: "counter_proposed",
    counterProposedBy: userIds[0],
    counterRound: 1,
    counterStartDate: "2026-10-04",
  });
  clock = OCT_5_FIRST_SECOND_PDT;
  const late = await requester.request(`/api/requests/${lateId}/respond-to-counter`, {
    method: "POST",
    body: JSON.stringify({ accept: true }),
  });
  assert.equal(late.status, 409);
  assert.equal((await counterState(lateId)).negotiationStatus, "counter_proposed");
});

test("the countered start date decides, not the stale original", async () => {
  clock = OCT_4_EVENING_PDT;
  const requestId = await createPendingRequest("RENT", "2026-10-02", {
    negotiationStatus: "counter_proposed",
    counterProposedBy: userIds[0],
    counterRound: 1,
    counterStartDate: "2026-10-08",
  });
  const response = await requester.request(`/api/requests/${requestId}/respond-to-counter`, {
    method: "POST",
    body: JSON.stringify({ accept: true }),
  });
  assert.equal(response.status, 200);
});

test("declining a counter whose dates have passed still works", async () => {
  clock = OCT_4_EVENING_PDT;
  const requestId = await createPendingRequest("RENT", "2026-10-10", {
    negotiationStatus: "counter_proposed",
    counterProposedBy: userIds[0],
    counterRound: 1,
    counterStartDate: "2026-10-03",
  });
  const response = await requester.request(`/api/requests/${requestId}/respond-to-counter`, {
    method: "POST",
    body: JSON.stringify({ accept: false }),
  });
  assert.equal(response.status, 200);
});

// ── (c) the flag clients use to disable Accept ────────────────────────────────

test("GET /api/requests flags passed start dates using the same rule as accept", async () => {
  clock = OCT_4_EVENING_PDT;
  const stale = await createPendingRequest("RENT", "2026-10-03");
  const current = await createPendingRequest("RENT", "2026-10-04");
  const counterAhead = await createPendingRequest("RENT", "2026-10-02", {
    negotiationStatus: "counter_proposed",
    counterProposedBy: userIds[1],
    counterStartDate: "2026-10-08",
  });

  const flags = async () => {
    const response = await owner.request("/api/requests");
    assert.equal(response.status, 200);
    const rows = (await response.json()) as { id: number; startDatePassed: boolean }[];
    return new Map(rows.map((row) => [row.id, row.startDatePassed]));
  };

  let byId = await flags();
  assert.equal(byId.get(stale), true);
  assert.equal(byId.get(current), false);
  assert.equal(byId.get(counterAhead), false);

  clock = OCT_5_FIRST_SECOND_PDT;
  byId = await flags();
  assert.equal(byId.get(stale), true);
  assert.equal(byId.get(current), true);
  assert.equal(byId.get(counterAhead), false);
});
