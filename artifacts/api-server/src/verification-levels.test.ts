import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, users, verifications } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { computeVerification, googleEmailIsVerified } from "./verification.js";
import { giftClaimLimitRejection } from "./verification-gate.js";

const NONE = { idApproved: false, cardOnFile: false };

test("computeVerification: unverified, verified account, and fully verified", () => {
  const unverified = computeVerification({ emailVerified: false, ...NONE });
  assert.equal(unverified.level, "unverified");
  assert.deepEqual(
    [unverified.canSwap, unverified.canClaimGift, unverified.canList, unverified.canBorrow, unverified.canRent],
    [false, false, false, false, false],
  );
  assert.deepEqual(unverified.missing, ["email", "id", "card"]);

  const account = computeVerification({ emailVerified: true, ...NONE });
  assert.equal(account.level, "email_only");
  assert.deepEqual(
    [account.canSwap, account.canClaimGift, account.canList, account.canBorrow, account.canRent],
    [true, true, true, false, false],
  );
  assert.deepEqual(account.missing, ["id", "card"]);

  const full = computeVerification({ emailVerified: true, idApproved: true, cardOnFile: true });
  assert.equal(full.level, "fully_verified");
  assert.deepEqual(
    [full.canSwap, full.canClaimGift, full.canList, full.canBorrow, full.canRent],
    [true, true, true, true, true],
  );
  assert.deepEqual(full.missing, []);
});

test("computeVerification: ID or a card alone never make a verified account, and each is reported missing on its own", () => {
  const idOnly = computeVerification({ emailVerified: false, idApproved: true, cardOnFile: false });
  assert.equal(idOnly.level, "unverified");
  assert.equal(idOnly.canBorrow, false);
  assert.deepEqual(idOnly.missing, ["email", "card"]);

  const noCard = computeVerification({ emailVerified: true, idApproved: true, cardOnFile: false });
  assert.equal(noCard.canBorrow, false);
  assert.equal(noCard.canList, true);
  assert.deepEqual(noCard.missing, ["card"]);

  const noId = computeVerification({ emailVerified: true, idApproved: false, cardOnFile: true });
  assert.equal(noId.canRent, false);
  assert.deepEqual(noId.missing, ["id"]);
});

test("a phone sign-up is a verified account, and an unconfirmed phone is not", () => {
  const phone = computeVerification({ emailVerified: false, phoneVerified: true, ...NONE });
  assert.equal(phone.level, "email_only");
  assert.equal(phone.canSwap && phone.canClaimGift && phone.canList, true);
  assert.equal(phone.canBorrow || phone.canRent, false);
  assert.deepEqual(phone.missing, ["id", "card"]);

  const unconfirmed = computeVerification({ emailVerified: false, phoneVerified: false, ...NONE });
  assert.equal(unconfirmed.canSwap, false);
});

test("a Google sign-in only counts when Google says email_verified", () => {
  assert.equal(googleEmailIsVerified({ emails: [{ value: "a@b.c", verified: true }] }), true);
  assert.equal(googleEmailIsVerified({ emails: [{ value: "a@b.c" }], _json: { email_verified: true } }), true);
  assert.equal(googleEmailIsVerified({ emails: [{ value: "a@b.c", verified: "true" }] }), true);
  assert.equal(googleEmailIsVerified({ emails: [{ value: "a@b.c", verified: false }] }), false);
  assert.equal(googleEmailIsVerified({ emails: [{ value: "a@b.c" }], _json: { email_verified: false } }), false);
  assert.equal(googleEmailIsVerified({ emails: [{ value: "a@b.c" }] }), false);
  assert.equal(googleEmailIsVerified({}), false);
});

test("the gift claim limit applies to gifts only and says what to do", () => {
  assert.equal(giftClaimLimitRejection("GIFT", 2), null);
  for (const type of ["SWAP", "BORROW", "RENT", undefined]) assert.equal(giftClaimLimitRejection(type, 9), null, String(type));
  const rejection = giftClaimLimitRejection("GIFT", 3);
  assert.equal(rejection?.code, "GIFT_CLAIM_LIMIT_REACHED");
  assert.equal(rejection?.limit, 3);
  assert.match(rejection?.error ?? "", /up to 3 open gift claims/);
});

const UNIQUE = `verification-levels-${Date.now()}`;
const PASSWORD = "VerificationLevels!42";
const userIds: number[] = [];
const itemIds: number[] = [];

let baseUrl: string;
let closeServer: () => Promise<void>;

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
  get(path: string) {
    return this.request(path);
  }
  post(path: string, body: unknown) {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  }
}

const clients: Record<"unverified" | "phone" | "email" | "full", TestClient> = {
  unverified: new TestClient(),
  phone: new TestClient(),
  email: new TestClient(),
  full: new TestClient(),
};
const giftIds: number[] = [];
let emailUserId: number;

before(async () => {
  const password = await hashPassword(PASSWORD);
  const [owner, unverified, phone, email, full] = await db.insert(users).values([
    { username: `${UNIQUE}-owner`, password, emailVerified: true },
    { username: `${UNIQUE}-unverified`, password, emailVerified: false },
    { username: `${UNIQUE}-phone`, password, emailVerified: false, phoneVerified: true, authProvider: "phone" },
    { username: `${UNIQUE}-email`, password, emailVerified: true },
    { username: `${UNIQUE}-full`, password, emailVerified: true, stripePaymentMethodId: `pm_${UNIQUE}` },
  ]).returning({ id: users.id, username: users.username });
  emailUserId = email.id;
  userIds.push(owner.id, unverified.id, phone.id, email.id, full.id);
  await db.insert(verifications).values({ userId: full.id, status: "approved" });

  const gifts = await db.insert(items).values(
    Array.from({ length: 5 }, (_, i) => ({
      ownerId: owner.id, name: `${UNIQUE}-gift-${i}`, description: "verification levels gift", conditionRating: 4, photos: [],
      isGift: true, isAvailable: true, shareCoinsReward: "0",
    })),
  ).returning({ id: items.id });
  for (const gift of gifts) {
    itemIds.push(gift.id);
    giftIds.push(gift.id);
  }

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

  await clients.unverified.login(unverified.username);
  await clients.phone.login(phone.username);
  await clients.email.login(email.username);
  await clients.full.login(full.username);
});

after(async () => {
  if (userIds.length) {
    const requestRows = await db.select({ id: itemRequests.id }).from(itemRequests).where(inArray(itemRequests.requesterId, userIds));
    const requestIds = requestRows.map((row) => row.id);
    if (requestIds.length) {
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
      await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    }
  }
  if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
  if (userIds.length) {
    await db.delete(verifications).where(inArray(verifications.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }
  if (closeServer) await closeServer();
  await pool.end();
});

async function currentUser(client: TestClient) {
  const response = await client.get("/api/user");
  assert.equal(response.status, 200);
  return (await response.json()) as any;
}

function flags(user: any) {
  return [user.canSwap, user.canClaimGift, user.canList, user.canBorrow, user.canRent];
}

test("/api/user reports the capability flags and what is missing for every level", async () => {
  const unverified = await currentUser(clients.unverified);
  assert.deepEqual(flags(unverified), [false, false, false, false, false]);
  assert.deepEqual(unverified.missing, ["email", "id", "card"]);
  assert.equal(unverified.verificationLevel, "unverified");

  const phone = await currentUser(clients.phone);
  assert.deepEqual(flags(phone), [true, true, true, false, false]);
  assert.deepEqual(phone.missing, ["id", "card"]);

  const email = await currentUser(clients.email);
  assert.deepEqual(flags(email), [true, true, true, false, false]);
  assert.deepEqual(email.missing, ["id", "card"]);
  assert.equal(email.verificationLevel, "email_only");

  const full = await currentUser(clients.full);
  assert.deepEqual(flags(full), [true, true, true, true, true]);
  assert.deepEqual(full.missing, []);
  assert.equal(full.verificationLevel, "fully_verified");
});

test("an unverified account cannot claim a gift or list an item", async () => {
  const claim = await clients.unverified.post(`/api/items/${giftIds[0]}/request`, { requestType: "GIFT" });
  assert.equal(claim.status, 403);
  assert.equal(((await claim.json()) as any).code, "EMAIL_NOT_VERIFIED");

  const list = await clients.unverified.post("/api/items", { name: `${UNIQUE}-listing` });
  assert.equal(list.status, 403);
  assert.equal(((await list.json()) as any).code, "EMAIL_NOT_VERIFIED");
});

test("a phone sign-up can claim a gift, but cannot borrow or rent", async () => {
  const claim = await clients.phone.post(`/api/items/${giftIds[0]}/request`, { requestType: "GIFT" });
  assert.equal(claim.status, 201);

  for (const requestType of ["BORROW", "RENT"]) {
    const response = await clients.phone.post(`/api/items/${giftIds[0]}/request`, { requestType, depositMethod: "in_app", startDate: "2026-09-06", endDate: "2026-09-13" });
    assert.equal(response.status, 403, requestType);
    assert.equal(((await response.json()) as any).code, "FULL_VERIFICATION_REQUIRED");
  }
});

test("a fully verified requester is not stopped by the verification gate", async () => {
  const response = await clients.full.post(`/api/items/${giftIds[0]}/request`, { requestType: "BORROW", depositMethod: "in_app", startDate: "2026-09-06", endDate: "2026-09-13" });
  const body = (await response.json().catch(() => ({}))) as any;
  assert.notEqual(body.code, "FULL_VERIFICATION_REQUIRED");
  assert.notEqual(body.code, "EMAIL_NOT_VERIFIED");
});

test("a fourth open gift claim is refused with a clear message, and a decided claim frees a slot", async () => {
  const client = clients.email;
  for (const id of giftIds.slice(0, 3)) {
    const response = await client.post(`/api/items/${id}/request`, { requestType: "GIFT" });
    assert.equal(response.status, 201);
  }

  const fourth = await client.post(`/api/items/${giftIds[3]}/request`, { requestType: "GIFT" });
  assert.equal(fourth.status, 403);
  const body = (await fourth.json()) as any;
  assert.equal(body.code, "GIFT_CLAIM_LIMIT_REACHED");
  assert.equal(body.limit, 3);
  assert.match(body.error, /up to 3 open gift claims/);

  // A swap is not a gift claim, so the limit does not block it.
  const swap = await client.post(`/api/items/${giftIds[3]}/request`, { requestType: "SWAP" });
  assert.notEqual(((await swap.json().catch(() => ({}))) as any).code, "GIFT_CLAIM_LIMIT_REACHED");

  // Once an owner declines one, the person has a free slot again.
  const [declined] = await db.select({ id: itemRequests.id }).from(itemRequests)
    .where(and(eq(itemRequests.itemId, giftIds[0]), eq(itemRequests.requesterId, emailUserId))).limit(1);
  await db.update(itemRequests).set({ status: "DECLINED" }).where(eq(itemRequests.id, declined.id));
  const again = await client.post(`/api/items/${giftIds[3]}/request`, { requestType: "GIFT" });
  assert.equal(again.status, 201);
});
