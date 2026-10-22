/**
 * New charges are created in the platform currency (CAD); a request that already has Stripe objects in USD
 * keeps creating, capturing, refunding and releasing in USD; wallet payouts are CAD.
 *
 * The charge creators run against a fake Stripe client and the real Postgres test database, so the
 * assertions are on the exact `currency` each PaymentIntent was created with and on what the request
 * records afterwards.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  itemRequests,
  items,
  LEGACY_PAYMENT_CURRENCY,
  messages,
  notifications,
  PLATFORM_CURRENCY,
  pool,
  rentalPayouts,
  users,
} from "@workspace/db";
import { hashPassword } from "./auth.js";
import { formatMoney } from "./deposit-copy.js";
import {
  currencyForNewCharge,
  hasStripeObjects,
  recordCurrency,
} from "./payment-currency.js";
import { sendPayout } from "./rental-payout-service.js";
import { confirmRefundableDeposit, confirmRentalDeposit, createRentalPaymentHold, registerRoutes } from "./routes/routes.js";
import { ensurePaymentCurrencyColumn } from "./startup-migrations.js";

const UNIQUE = `payment-currency-${Date.now()}`;
const PASSWORD = "PaymentCurrency!42";

// ── A fake Stripe that keeps the currency each PaymentIntent was created with ──

interface FakeIntent {
  id: string;
  client_secret: string;
  status: string;
  amount: number;
  currency: string;
  customer: string | null;
  payment_method: string | null;
  metadata: Record<string, string>;
  capture_method: string;
  latest_charge: { id: string; payment_method_details: { card: { capture_before: number } } };
}

function fakeStripe() {
  const store = new Map<string, FakeIntent>();
  const calls = { create: [] as any[], cancel: [] as string[], capture: [] as any[], refunds: [] as any[] };
  let seq = 0;
  const create = async (params: any, opts?: any) => {
    calls.create.push({ params, opts });
    const id = `pi_${UNIQUE}_${++seq}`;
    const manual = params.capture_method === "manual";
    const intent: FakeIntent = {
      id,
      client_secret: `${id}_secret`,
      status: manual ? (params.confirm ? "requires_capture" : "requires_payment_method") : params.confirm ? "succeeded" : "requires_payment_method",
      amount: params.amount,
      currency: params.currency,
      customer: params.customer ?? null,
      payment_method: params.payment_method ?? null,
      metadata: params.metadata ?? {},
      capture_method: params.capture_method ?? "automatic",
      latest_charge: { id: `ch_${id}`, payment_method_details: { card: { capture_before: Math.floor(Date.now() / 1000) + 7 * 86_400 } } },
    };
    store.set(id, intent);
    return intent;
  };
  return {
    calls,
    store,
    customers: { create: async () => ({ id: `cus_${UNIQUE}` }) },
    paymentIntents: {
      create,
      retrieve: async (id: string) => {
        const intent = store.get(id);
        if (!intent) throw new Error(`No such payment_intent: ${id}`);
        return intent;
      },
      cancel: async (id: string) => {
        calls.cancel.push(id);
        const intent = store.get(id);
        if (!intent) throw new Error(`No such payment_intent: ${id}`);
        intent.status = "canceled";
        return intent;
      },
      capture: async (id: string, params: any) => {
        calls.capture.push({ id, params });
        const intent = store.get(id)!;
        intent.status = "succeeded";
        return intent;
      },
    },
    refunds: {
      create: async (params: any, opts?: any) => {
        calls.refunds.push({ params, opts });
        return { id: `re_${UNIQUE}_${calls.refunds.length}` };
      },
    },
    transfers: { create: async (params: any) => { calls.create.push({ params, transfer: true }); return { id: `tr_${UNIQUE}` }; } },
    /** An earlier, already-cancelled PaymentIntent from before the move to CAD. */
    seedCancelled(id: string, currency: string) {
      store.set(id, { ...({} as FakeIntent), id, status: "canceled", currency, amount: 5000, metadata: {} } as FakeIntent);
    },
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const userIds: number[] = [];
const itemIds: number[] = [];
const requestIds: number[] = [];
let ownerId: number;
let rentItemId: number;
let borrowItemId: number;

async function newBorrower(prefix: string) {
  const [user] = await db
    .insert(users)
    .values({
      username: `${UNIQUE}-${prefix}-${userIds.length}`,
      password: await hashPassword(PASSWORD),
      emailVerified: true,
      trustScore: 100,
      shareCoins: "100",
      stripeCustomerId: `cus_${UNIQUE}`,
      stripePaymentMethodId: `pm_${UNIQUE}`,
    })
    .returning({ id: users.id, username: users.username });
  userIds.push(user.id);
  return user;
}

async function newRequest(requesterId: number, overrides: Partial<typeof itemRequests.$inferInsert> = {}) {
  const rent = (overrides.requestType ?? "RENT") === "RENT";
  const [request] = await db
    .insert(itemRequests)
    .values({
      itemId: rent ? rentItemId : borrowItemId,
      requesterId,
      requestType: "RENT",
      status: "ACCEPTED",
      startDate: new Date(Date.now() + 60 * 60 * 1000),
      endDate: new Date(Date.now() + 25 * 60 * 60 * 1000),
      ...overrides,
    })
    .returning();
  requestIds.push(request.id);
  return request;
}

const load = async (id: number) => (await db.select().from(itemRequests).where(eq(itemRequests.id, id)))[0];

before(async () => {
  await ensurePaymentCurrencyColumn();
  const [owner] = await db.insert(users).values({ username: `${UNIQUE}-owner`, trustScore: 100 }).returning({ id: users.id });
  ownerId = owner.id;
  userIds.push(owner.id);
  const base = {
    ownerId,
    description: "payment currency test item",
    category: "Home & Kitchen",
    tier: 2,
    conditionRating: 4,
    photos: [],
    securityDeposit: "50",
    dollarsPrice: "70",
    lendingDuration: 7,
    shareCoinsReward: "0",
    replacementValue: 200,
  };
  const [rentItem, borrowItem] = await db
    .insert(items)
    .values([{ ...base, name: `${UNIQUE}-rent` }, { ...base, name: `${UNIQUE}-borrow` }])
    .returning({ id: items.id });
  rentItemId = rentItem.id;
  borrowItemId = borrowItem.id;
  itemIds.push(rentItem.id, borrowItem.id);
});

after(async () => {
  if (requestIds.length) {
    await db.delete(messages).where(inArray(messages.requestId, requestIds));
    await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
    await db.delete(rentalPayouts).where(inArray(rentalPayouts.requestId, requestIds));
    await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
  }
  if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

// ── The rule ──────────────────────────────────────────────────────────────────

test("PLATFORM_CURRENCY is CAD and legacy requests are USD", () => {
  assert.equal(PLATFORM_CURRENCY, "cad");
  assert.equal(LEGACY_PAYMENT_CURRENCY, "usd");
});

test("a request with no Stripe object takes the platform currency; one with any object keeps its recorded currency", () => {
  assert.equal(currencyForNewCharge({ paymentCurrency: "usd" }), "cad", "default-stamped but nothing created yet");
  assert.equal(currencyForNewCharge({ paymentCurrency: "usd", depositHoldAttemptId: "pi_1" }), "usd");
  assert.equal(currencyForNewCharge({ paymentCurrency: "usd", depositPaymentIntentId: "pi_1" }), "usd");
  assert.equal(currencyForNewCharge({ paymentCurrency: "usd", platformFeeChargeId: "pi_fee" }), "usd");
  assert.equal(currencyForNewCharge({ paymentCurrency: "cad", depositPaymentIntentId: "pi_1" }), "cad");
  assert.equal(hasStripeObjects({ paymentCurrency: "usd" }), false);
  assert.equal(recordCurrency({ paymentCurrency: " CAD " }), "cad");
  assert.equal(recordCurrency({ paymentCurrency: null }), "usd", "a row that never recorded a currency is a legacy request");
});

test("the column exists with a USD default, so existing rows stay USD", async () => {
  const { rows } = await pool.query(
    `SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'item_requests' AND column_name = 'payment_currency'`,
  );
  assert.equal(rows.length, 1);
  assert.match(rows[0].column_default, /'usd'/);
  assert.equal(rows[0].is_nullable, "NO");
});

// ── Rental deposit hold and rental charge ────────────────────────────────────

test("a new rental: the deposit hold and the rental charge are created in CAD, and the request records it", async () => {
  const renter = await newBorrower("renter");
  const request = await newRequest(renter.id);
  assert.equal(request.paymentCurrency, "usd", "the column default before anything is charged");
  const stripe = fakeStripe();

  const hold = await createRentalPaymentHold({ requestId: request.id, userId: renter.id, confirmIfSaved: true, stripeClient: stripe as any });
  assert.equal(hold.status, 200, JSON.stringify(hold.body));
  assert.equal(stripe.calls.create.length, 1);
  assert.equal(stripe.calls.create[0].params.currency, "cad");
  assert.equal((await load(request.id)).paymentCurrency, "cad");

  const confirmed = await confirmRentalDeposit({ requestId: request.id, userId: renter.id, paymentIntentId: hold.body.paymentIntentId, stripeClient: stripe as any });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed));
  assert.deepEqual(stripe.calls.create.map((c) => c.params.currency), ["cad", "cad"], "hold and rental charge");
});

test("a USD rental already in progress: a new attempt, and the rental charge, are created in USD", async () => {
  const renter = await newBorrower("usd-renter");
  const request = await newRequest(renter.id, { paymentCurrency: "usd", depositHoldAttemptId: `pi_${UNIQUE}_old_usd`, depositHoldAttemptNum: 0 });
  const stripe = fakeStripe();
  stripe.seedCancelled(`pi_${UNIQUE}_old_usd`, "usd");

  const hold = await createRentalPaymentHold({ requestId: request.id, userId: renter.id, confirmIfSaved: true, stripeClient: stripe as any });
  assert.equal(hold.status, 200, JSON.stringify(hold.body));
  assert.equal(stripe.calls.create[0].params.currency, "usd");
  assert.equal((await load(request.id)).paymentCurrency, "usd", "never flipped to CAD mid-request");

  const confirmed = await confirmRentalDeposit({ requestId: request.id, userId: renter.id, paymentIntentId: hold.body.paymentIntentId, stripeClient: stripe as any });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed));
  assert.deepEqual(stripe.calls.create.map((c) => c.params.currency), ["usd", "usd"]);
  assert.deepEqual(stripe.calls.cancel, [], "nothing was released");
  assert.equal((await load(request.id)).paymentCurrency, "usd");
});

// ── Refundable deposit ─────────────────────────────────────────────────────────

test("refundable deposit: CAD for a new request, USD when a USD hold attempt already exists", async () => {
  const renter = await newBorrower("refundable");
  const fresh = await newRequest(renter.id, { requestType: "BORROW", depositMode: "refundable_charge", depositSelectionState: "consent_required" });
  const freshStripe = fakeStripe();
  const first = await confirmRefundableDeposit({ requestId: fresh.id, userId: renter.id, stripeClient: freshStripe as any });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(freshStripe.calls.create[0].params.currency, "cad");
  assert.equal((await load(fresh.id)).paymentCurrency, "cad");

  const legacy = await newRequest(renter.id, {
    requestType: "BORROW", depositMode: "refundable_charge", depositSelectionState: "consent_required",
    paymentCurrency: "usd", depositHoldAttemptId: `pi_${UNIQUE}_legacy_hold`,
  });
  const legacyStripe = fakeStripe();
  const second = await confirmRefundableDeposit({ requestId: legacy.id, userId: renter.id, stripeClient: legacyStripe as any });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(legacyStripe.calls.create[0].params.currency, "usd");
  assert.equal((await load(legacy.id)).paymentCurrency, "usd");
});

// ── Routes: borrow deposit hold and platform fee ──────────────────────────────

let baseUrl: string;
let closeServer: () => Promise<void>;
let routeStripe: ReturnType<typeof fakeStripe>;
const cookies = new Map<string, string>();
let csrfToken = "";

async function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("x-forwarded-proto", "https");
  if (cookies.size) headers.set("cookie", [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "));
  if (csrfToken && init.method && init.method !== "GET") headers.set("x-csrf-token", csrfToken);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";", 1);
    const separator = pair.indexOf("=");
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return response;
}

let routeUser: { id: number; username: string };

async function startRoutes() {
  routeUser = await newBorrower("route");
  routeStripe = fakeStripe();
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: console.error, warn: console.warn, info: () => {} }; next(); });
  const server = registerRoutes(app, { startBackgroundJobs: false, stripe: routeStripe as any });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  const login = await call("/api/login", { method: "POST", body: JSON.stringify({ username: routeUser.username, password: PASSWORD }) });
  assert.equal(login.status, 200);
  csrfToken = ((await (await call("/api/csrf-token")).json()) as { csrfToken: string }).csrfToken;
}

test("borrow deposit hold and platform fee: CAD for a new request, USD for a USD request in progress", async () => {
  await startRoutes();
  try {
    // Three completed transactions so the platform fee is not waived.
    for (let i = 0; i < 3; i++) await newRequest(routeUser.id, { requestType: "BORROW", status: "COMPLETED" });

    const fresh = await newRequest(routeUser.id, { requestType: "BORROW", endDate: new Date(Date.now() + 25 * 3_600_000) });
    const hold = await call("/api/stripe/create-deposit-hold", { method: "POST", body: JSON.stringify({ requestId: fresh.id }) });
    assert.equal(hold.status, 200, await hold.clone().text());
    assert.equal(routeStripe.calls.create.at(-1).params.currency, "cad");
    assert.equal((await load(fresh.id)).paymentCurrency, "cad");
    const fee = await call("/api/stripe/charge-platform-fee", { method: "POST", body: JSON.stringify({ requestId: fresh.id, platformFeeAmount: 2 }) });
    assert.equal(fee.status, 200, await fee.clone().text());
    assert.equal(routeStripe.calls.create.at(-1).params.currency, "cad");

    // A USD borrow whose first hold was already created before the move: the retry and its fee stay USD.
    routeStripe.seedCancelled(`pi_${UNIQUE}_borrow_usd`, "usd");
    const legacy = await newRequest(routeUser.id, {
      requestType: "BORROW", endDate: new Date(Date.now() + 25 * 3_600_000),
      paymentCurrency: "usd", depositHoldAttemptId: `pi_${UNIQUE}_borrow_usd`,
    });
    const legacyHold = await call("/api/stripe/create-deposit-hold", { method: "POST", body: JSON.stringify({ requestId: legacy.id }) });
    assert.equal(legacyHold.status, 200, await legacyHold.clone().text());
    assert.equal(routeStripe.calls.create.at(-1).params.currency, "usd");
    const legacyFee = await call("/api/stripe/charge-platform-fee", { method: "POST", body: JSON.stringify({ requestId: legacy.id, platformFeeAmount: 2 }) });
    assert.equal(legacyFee.status, 200, await legacyFee.clone().text());
    assert.equal(routeStripe.calls.create.at(-1).params.currency, "usd");
    assert.equal((await load(legacy.id)).paymentCurrency, "usd");
  } finally {
    await closeServer();
  }
});

// ── Capture, refund and release stay in the request's currency ──────────────

test("a USD request: the claim capture and the refund are plain calls on the existing intent, never a new CAD charge", async () => {
  const { ensureClaimDepositCaptured, settleApprovedClaim } = await import("./security-claims-service.js");
  const { securityClaims, depositSettlementOperations, requestLifecycleEvents } = await import("@workspace/db");
  const renter = await newBorrower("claim");
  const intentId = `pi_${UNIQUE}_claim_usd`;
  const request = await newRequest(renter.id, {
    requestType: "BORROW", status: "RETURN_REQUESTED", paymentCurrency: "usd", depositPaymentIntentId: intentId,
    depositMode: "authorization", depositStatus: "authorized", trustDepositAmount: "100.00",
  });
  const [claim] = await db.insert(securityClaims).values({
    requestId: request.id, ownerId, borrowerId: renter.id, claimType: "damage", status: "APPROVED", reason: "currency test",
    evidence: ["https://example.invalid/e.jpg"], borrowerNotifiedAt: new Date(), requestedAmount: "100.00", approvedAmount: "40.00",
  }).returning();
  const stripe = fakeStripe();
  stripe.store.set(intentId, {
    id: intentId, client_secret: "x", status: "requires_capture", amount: 10000, currency: "usd", customer: null, payment_method: null,
    metadata: {}, capture_method: "manual",
    latest_charge: { id: "ch_usd", payment_method_details: { card: { capture_before: Math.floor(Date.now() / 1000) + 86_400 } } },
  });
  try {
    const captured = await ensureClaimDepositCaptured(claim.id, stripe as any);
    assert.equal(captured.status, "captured");
    const settled = await settleApprovedClaim(claim.id, stripe as any);
    assert.ok(settled);
    assert.equal(stripe.calls.capture.length, 1);
    assert.equal(stripe.calls.capture[0].id, intentId);
    assert.equal(stripe.calls.capture[0].params.currency, undefined);
    assert.equal(stripe.calls.refunds.length, 1);
    assert.equal(stripe.calls.refunds[0].params.payment_intent, intentId);
    assert.equal(stripe.calls.refunds[0].params.currency, undefined);
    assert.equal(stripe.calls.create.length, 0, "nothing new was charged");
    assert.equal(stripe.store.get(intentId)!.currency, "usd");
    assert.equal((await load(request.id)).paymentCurrency, "usd");
  } finally {
    await db.delete(depositSettlementOperations).where(eq(depositSettlementOperations.requestId, request.id));
    await db.delete(requestLifecycleEvents).where(eq(requestLifecycleEvents.requestId, request.id));
    await db.delete(securityClaims).where(eq(securityClaims.requestId, request.id));
  }
});

// ── Wallet payouts stay CAD ────────────────────────────────────────────────────

test("a wallet payout transfer is created in CAD", async () => {
  const [owner] = await db.insert(users).values({ username: `${UNIQUE}-payee`, stripeConnectedAccountId: `acct_${UNIQUE}`, rentalBalance: "0.00" }).returning({ id: users.id });
  userIds.push(owner.id);
  const [payout] = await db.insert(rentalPayouts).values({
    userId: owner.id, amount: "12.00", rentalAmount: "12.00", netAmount: "12.00", status: "pending_payout",
  }).returning();
  const stripe = fakeStripe();
  const outcome = await sendPayout(payout, `acct_${UNIQUE}`, stripe as any);
  assert.equal(outcome.ok, true);
  const transfer = stripe.calls.create.find((c) => c.transfer)!;
  assert.equal(transfer.params.currency, "cad");
  assert.equal(transfer.params.amount, 1200);
  await db.delete(rentalPayouts).where(eq(rentalPayouts.userId, owner.id));
});

// ── No literal currency left behind ───────────────────────────────────────────

async function sourceFiles(dir: URL): Promise<URL[]> {
  const out: URL[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) out.push(...(await sourceFiles(child)));
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(child);
  }
  return out;
}

test("no source file writes a currency literal: every create call reads the constant or the request's record", async () => {
  const offenders: string[] = [];
  for (const file of await sourceFiles(new URL("./", import.meta.url))) {
    if (file.pathname.includes("/test-fixtures/") || file.pathname.includes("/scripts/")) continue;
    const text = await readFile(file, "utf8");
    // Code only: a currency code inside a comment or a prompt sentence is not a currency decision.
    text.split("\n").forEach((line, index) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (/\bcurrency\s*[:=]\s*["'`](usd|cad)["'`]/i.test(line) || /\?\?\s*["'`](usd|cad)["'`]/i.test(line)) {
        offenders.push(`${file.pathname.split("/src/")[1]}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});

test("every Stripe create site takes its currency from the constant or the request, and payouts use the constant", async () => {
  const routes = await readFile(new URL("./routes/routes.ts", import.meta.url), "utf8");
  for (const expected of [
    "currency,\n    capture_method: \"manual\"", // rental hold: currencyForNewCharge via the attempt
    "currency: chargeCurrency", // refundable deposit
    "currency: recordCurrency(request.item_requests)", // rental charge
    "currency: holdCurrency", // borrow hold
    "currency: feeCurrency", // platform fee
    "currency: PLATFORM_CURRENCY,", // private courier fee
  ]) {
    assert.ok(routes.includes(expected), `routes.ts should contain ${expected}`);
  }
  assert.ok(routes.includes("currency: PLATFORM_CURRENCY, limit: 1"), "subscription checkout prefers a Price in the platform currency");
  const payout = await readFile(new URL("./rental-payout-service.ts", import.meta.url), "utf8");
  assert.match(payout, /currency: PLATFORM_CURRENCY/);
});

test("amounts read as CAD by default, with a US$ prefix only for USD requests", () => {
  assert.equal(formatMoney(20), "$20");
  assert.equal(formatMoney(20.5), "$20.50");
  assert.equal(formatMoney(20, "usd"), "US$20");
  assert.equal(formatMoney(20.5, "USD"), "US$20.50");
  assert.equal(formatMoney(20, "eur"), "EUR 20");
});
