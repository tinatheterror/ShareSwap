import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, users, verifications } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { fullVerificationRejection } from "./verification-gate.js";

test("only BORROW and RENT need full verification, and the rejection says what is missing", () => {
  const emailOnly = { level: "email_only", idVerified: false, paymentVerified: false };
  for (const type of ["BORROW", "RENT"]) {
    assert.deepEqual(fullVerificationRejection(type, emailOnly), {
      error: "Please complete identity and payment verification to borrow or rent items",
      code: "FULL_VERIFICATION_REQUIRED",
      missing: { idVerified: false, paymentVerified: false },
    });
  }
  assert.deepEqual(fullVerificationRejection("RENT", { level: "email_only", idVerified: true, paymentVerified: false })?.missing, { idVerified: true, paymentVerified: false });
  assert.deepEqual(fullVerificationRejection("BORROW", { level: "email_only", idVerified: false, paymentVerified: true })?.missing, { idVerified: false, paymentVerified: true });
  for (const type of ["SWAP", "GIFT", "LEND", undefined, null, "borrow"]) {
    assert.equal(fullVerificationRejection(type, emailOnly), null, String(type));
  }
  assert.equal(fullVerificationRejection("BORROW", { level: "fully_verified", idVerified: true, paymentVerified: true }), null);
});

const UNIQUE = `verification-gate-${Date.now()}`;
const PASSWORD = "VerificationGate!42";
const userIds: number[] = [];
const itemIds: number[] = [];
const requestIds: number[] = [];

let baseUrl: string;
let closeServer: () => Promise<void>;
let itemId: number;

class TestClient {
  private cookies = new Map<string, string>();
  private csrfToken = "";
  async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    headers.set("x-forwarded-proto", "https");
    if (this.cookies.size) headers.set("cookie", [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "));
    if (this.csrfToken && init.method && init.method !== "GET") headers.set("x-csrf-token", this.csrfToken);
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";", 1);
      const separator = pair.indexOf("=");
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }
  async login(username: string) {
    const response = await this.request("/api/login", { method: "POST", body: JSON.stringify({ username, password: PASSWORD }) });
    assert.equal(response.status, 200);
    const csrf = await this.request("/api/csrf-token");
    this.csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken;
  }
  post(path: string, body: unknown) {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  }
}

let emailOnlyRequester: TestClient;
let idOnlyRequester: TestClient;

before(async () => {
  const password = await hashPassword(PASSWORD);
  const [owner, emailOnly, idOnly] = await db.insert(users).values([
    { username: `${UNIQUE}-owner`, password, emailVerified: true },
    { username: `${UNIQUE}-email-only`, password, emailVerified: true },
    { username: `${UNIQUE}-id-only`, password, emailVerified: true },
  ]).returning({ id: users.id, username: users.username });
  userIds.push(owner.id, emailOnly.id, idOnly.id);
  await db.insert(verifications).values({ userId: idOnly.id, status: "approved" });

  const [item] = await db.insert(items).values({
    ownerId: owner.id, name: `${UNIQUE}-item`, description: "verification gate test item", conditionRating: 4, photos: [],
    isLendable: true, isRentable: true, isGift: true, isAvailable: true, replacementValue: 100, securityDeposit: "10.00",
    lendingDuration: 7, shareCoinsReward: "0",
  }).returning({ id: items.id });
  itemId = item.id;
  itemIds.push(item.id);

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const server = registerRoutes(app, { startBackgroundJobs: false, now: () => new Date("2026-09-01T12:00:00Z") });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  emailOnlyRequester = new TestClient();
  idOnlyRequester = new TestClient();
  await emailOnlyRequester.login(emailOnly.username);
  await idOnlyRequester.login(idOnly.username);
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

const dates = { startDate: "2026-09-06", endDate: "2026-09-13" };

test("an email-only requester cannot borrow or rent, and is told both ID and payment are missing", async () => {
  for (const requestType of ["BORROW", "RENT"]) {
    const response = await emailOnlyRequester.post(`/api/items/${itemId}/request`, { requestType, depositMethod: "in_app", ...dates });
    assert.equal(response.status, 403, requestType);
    const body = (await response.json()) as any;
    assert.equal(body.code, "FULL_VERIFICATION_REQUIRED");
    assert.deepEqual(body.missing, { idVerified: false, paymentVerified: false });
  }
});

test("a requester with ID but no card is told only the payment method is missing", async () => {
  const response = await idOnlyRequester.post(`/api/items/${itemId}/request`, { requestType: "BORROW", depositMethod: "in_app", ...dates });
  assert.equal(response.status, 403);
  assert.deepEqual(((await response.json()) as any).missing, { idVerified: true, paymentVerified: false });
});

test("an email-only requester can still ask for a gift", async () => {
  const response = await emailOnlyRequester.post(`/api/items/${itemId}/request`, { requestType: "GIFT", ...dates });
  assert.equal(response.status, 201);
  requestIds.push(((await response.json()) as { id: number }).id);
});
