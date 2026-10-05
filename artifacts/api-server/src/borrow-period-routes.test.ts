import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { eq, inArray, sql } from "drizzle-orm";
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

const UNIQUE = `borrow-period-routes-${Date.now()}`;
const PASSWORD = "BorrowPeriodRouteTest!42";
const requestIds: number[] = [];
const itemIds: number[] = [];
const userIds: number[] = [];

let baseUrl: string;
let closeServer: () => Promise<void>;
let owner: TestClient;
let requester: TestClient;
let allTypesItemId: number;

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

async function createRequestFixture(
  requestType: string,
  options: {
    negotiationStatus?: string;
    counterProposedBy?: number;
    counterRound?: number;
  } = {},
) {
  const [request] = await db
    .insert(itemRequests)
    .values({
      itemId: allTypesItemId,
      requesterId: userIds[1],
      requestType,
      status: "PENDING",
      startDate: new Date("2026-09-06T00:00:00.000Z"),
      endDate: new Date("2026-09-13T00:00:00.000Z"),
      negotiationStatus: options.negotiationStatus ?? "pending_owner",
      counterProposedBy: options.counterProposedBy,
      counterRound: options.counterRound ?? 0,
      counterStartDate: options.negotiationStatus
        ? new Date("2026-09-06T00:00:00.000Z")
        : undefined,
      counterEndDate: options.negotiationStatus
        ? new Date("2026-09-20T00:00:00.000Z")
        : undefined,
    })
    .returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return request.id;
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
      description: "Route-level borrow-period test item",
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
  allTypesItemId = item.id;
  itemIds.push(item.id);

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  // These fixtures use fixed September 2026 dates; pin the clock so the
  // start-date-not-in-the-past rule does not depend on when the suite runs.
  const server = registerRoutes(app, {
    startBackgroundJobs: false,
    now: () => new Date("2026-09-01T12:00:00Z"),
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

test("initial BORROW requests accept exactly 12 months and reject anything longer", async () => {
  const exactResponse = await requester.request(`/api/items/${allTypesItemId}/request`, {
    method: "POST",
    body: JSON.stringify({
      requestType: "BORROW",
      startDate: "2026-09-06",
      endDate: "2027-09-06",
      deliveryMethod: "in_person",
      depositMethod: "in_app",
    }),
  });
  assert.equal(exactResponse.status, 201);
  const exactRequest = await exactResponse.json() as { id: number };
  requestIds.push(exactRequest.id);

  const tooLongResponse = await requester.request(`/api/items/${allTypesItemId}/request`, {
    method: "POST",
    body: JSON.stringify({
      requestType: "BORROW",
      startDate: "2026-09-06",
      endDate: "2027-09-07",
    }),
  });
  assert.equal(tooLongResponse.status, 400);
  assert.equal(
    ((await tooLongResponse.json()) as { code: string }).code,
    "BORROW_PERIOD_TOO_LONG",
  );
});

test("owner lifecycle keeps confirm_return available while a requested return is overdue", async () => {
  const requestId = await createRequestFixture("BORROW");
  await db.execute(sql`
    update item_requests
    set overdue_stage = 'OVERDUE'
    where id = ${requestId}
  `);
  await db
    .update(itemRequests)
    .set({
      status: "RETURN_REQUESTED",
      endDate: new Date("2026-08-01T00:00:00.000Z"),
    })
    .where(eq(itemRequests.id, requestId));

  const response = await owner.request(`/api/requests/${requestId}/lifecycle`);
  assert.equal(response.status, 200);
  const body = await response.json() as {
    lifecycle: { role: string; stage: string; actions: string[] };
  };

  assert.equal(body.lifecycle.role, "owner");
  assert.equal(body.lifecycle.stage, "OVERDUE");
  assert(body.lifecycle.actions.includes("confirm_return"));
});

test("direct counter-proposals enforce the BORROW boundary", async () => {
  const exactRequestId = await createRequestFixture("BORROW");
  const exactResponse = await owner.request(
    `/api/requests/${exactRequestId}/counter-proposal`,
    {
      method: "POST",
      body: JSON.stringify({
        startDate: "2026-09-06",
        endDate: "2027-09-06",
      }),
    },
  );
  assert.equal(exactResponse.status, 200);

  const tooLongRequestId = await createRequestFixture("BORROW");
  const response = await owner.request(`/api/requests/${tooLongRequestId}/counter-proposal`, {
    method: "POST",
    body: JSON.stringify({
      startDate: "2026-09-06",
      endDate: "2027-09-07",
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { code: string }).code, "BORROW_PERIOD_TOO_LONG");
});

test("counter-backs enforce the BORROW boundary", async () => {
  const exactRequestId = await createRequestFixture("BORROW", {
    negotiationStatus: "counter_proposed",
    counterProposedBy: userIds[0],
    counterRound: 1,
  });
  const exactResponse = await requester.request(
    `/api/requests/${exactRequestId}/respond-to-counter`,
    {
      method: "POST",
      body: JSON.stringify({
        counter: {
          startDate: "2026-09-06",
          endDate: "2027-09-06",
        },
      }),
    },
  );
  assert.equal(exactResponse.status, 200);

  const tooLongRequestId = await createRequestFixture("BORROW", {
    negotiationStatus: "counter_proposed",
    counterProposedBy: userIds[0],
    counterRound: 1,
  });

  const response = await requester.request(`/api/requests/${tooLongRequestId}/respond-to-counter`, {
    method: "POST",
    body: JSON.stringify({
      counter: {
        startDate: "2026-09-06",
        endDate: "2027-09-07",
      },
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { code: string }).code, "BORROW_PERIOD_TOO_LONG");
});

test("RENT, SWAP, and GIFT initial requests keep accepting dates over 12 months", async () => {
  for (const requestType of ["RENT", "SWAP", "GIFT"]) {
    const response = await requester.request(`/api/items/${allTypesItemId}/request`, {
      method: "POST",
      body: JSON.stringify({
        requestType,
        startDate: "2026-09-06",
        endDate: "2027-09-07",
        deliveryMethod: "in_person",
      }),
    });
    assert.equal(response.status, 201, `${requestType} should remain unchanged`);
    requestIds.push(((await response.json()) as { id: number }).id);
  }
});

test("non-BORROW negotiation routes keep accepting dates over 12 months", async () => {
  for (const requestType of ["RENT", "SWAP", "GIFT"]) {
    const directId = await createRequestFixture(requestType);
    const directResponse = await owner.request(`/api/requests/${directId}/counter-proposal`, {
      method: "POST",
      body: JSON.stringify({
        startDate: "2026-09-06",
        endDate: "2027-09-07",
      }),
    });
    assert.equal(directResponse.status, 200, `${requestType} direct counter should remain unchanged`);

    const counterBackId = await createRequestFixture(requestType, {
      negotiationStatus: "counter_proposed",
      counterProposedBy: userIds[0],
      counterRound: 1,
    });
    const counterBackResponse = await requester.request(
      `/api/requests/${counterBackId}/respond-to-counter`,
      {
        method: "POST",
        body: JSON.stringify({
          counter: {
            startDate: "2026-09-06",
            endDate: "2027-09-07",
          },
        }),
      },
    );
    assert.equal(counterBackResponse.status, 200, `${requestType} counter-back should remain unchanged`);
  }
});