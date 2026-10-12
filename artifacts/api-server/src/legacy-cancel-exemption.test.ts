import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, reputationActivities, users } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
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

// A requester with a fresh history (so main's first-offence grace pass is the same for everyone) and an
// accepted in-person BORROW to cancel.
async function scenario(headers: Record<string, string>) {
  const password = await hashPassword(PASSWORD);
  const [user] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-r${userIds.length}`, password, emailVerified: true, shareCoins: "50.00" })
    .returning({ id: users.id, username: users.username });
  userIds.push(user.id);
  const [item] = await db
    .insert(items)
    .values({
      ownerId, name: `${UNIQUE}-item-${itemIds.length}`, description: "legacy cancel test", conditionRating: 4, photos: [],
      isLendable: true, isRentable: false, isSwappable: false, isGift: false, isAvailable: false,
      replacementValue: 100, securityDeposit: "10.00", lendingDuration: 7, shareCoinsReward: "0", shareCoinPrice: "7.00",
    })
    .returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db
    .insert(itemRequests)
    .values({
      itemId: item.id, requesterId: user.id, requestType: "BORROW", status: "ACCEPTED", depositMethod: "in_person",
      startDate: new Date("2026-11-02T00:00:00Z"), endDate: new Date("2026-11-05T00:00:00Z"),
    })
    .returning({ id: itemRequests.id });
  requestIds.push(request.id);
  const client = new TestClient(headers);
  await client.login(user.username);
  return { userId: user.id, requestId: request.id, client };
}

async function penaltyRows(userId: number) {
  const rows = await db.select({ type: reputationActivities.activityType }).from(reputationActivities).where(eq(reputationActivities.userId, userId));
  return rows.filter((r) => r.type === "cancel_after_acceptance" || r.type === "grace_pass_warning").length;
}

async function status(requestId: number) {
  const [row] = await db.select({ status: itemRequests.status }).from(itemRequests).where(eq(itemRequests.id, requestId));
  return row.status;
}

before(async () => {
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
  const server = registerRoutes(app, { startBackgroundJobs: false });
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

test("legacy request, flag in the future: the cancel goes through and no penalty is recorded", async () => {
  setFlag(FAR_FUTURE);
  const { userId, requestId, client } = await scenario({});
  const response = await client.post(`/api/requests/${requestId}/cancel`, {});
  assert.equal(response.status, 200);
  assert.equal(await status(requestId), "CANCELLED");
  assert.equal(await penaltyRows(userId), 0);
});

test("legacy request, flag expired: the penalty rules apply as before", async () => {
  setFlag(PAST);
  const { userId, requestId, client } = await scenario({});
  assert.equal((await client.post(`/api/requests/${requestId}/cancel`, {})).status, 200);
  assert.equal(await status(requestId), "CANCELLED");
  assert.equal(await penaltyRows(userId), 1, "main's first-offence grace warning is recorded");
});

test("legacy request, flag unset: the penalty rules apply as before", async () => {
  setFlag(undefined);
  const { userId, requestId, client } = await scenario({});
  assert.equal((await client.post(`/api/requests/${requestId}/cancel`, {})).status, 200);
  assert.equal(await penaltyRows(userId), 1);
});

test("a request with x-app-version never gets the exemption, even with the flag in the future", async () => {
  setFlag(FAR_FUTURE);
  for (const version of ["1.0.0", "web"]) {
    const { userId, requestId, client } = await scenario({ "x-app-version": version, "x-app-build": "12" });
    assert.equal((await client.post(`/api/requests/${requestId}/cancel`, {})).status, 200);
    assert.equal(await penaltyRows(userId), 1, `version ${version}`);
  }
});
