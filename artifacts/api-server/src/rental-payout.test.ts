import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, notifications, pool, rentalPayouts, users } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";

const UNIQUE = `rental-payout-${Date.now()}`;
const PASSWORD = "RentalPayoutTest!42";
const userIds: number[] = [];

interface TransferCall { params: any; options: any }
let transferCalls: TransferCall[] = [];
let transferImpl: (call: TransferCall) => Promise<{ id: string }>;

let baseUrl: string;
let closeServer: () => Promise<void>;
let userId: number;
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

const withdraw = (body: Record<string, unknown>) => call("/api/rental-balance/payout", { method: "POST", body: JSON.stringify(body) });

async function setBalance(balance: string) {
  await db.update(users).set({ rentalBalance: balance }).where(eq(users.id, userId));
}
async function balance() {
  const [row] = await db.select({ rentalBalance: users.rentalBalance }).from(users).where(eq(users.id, userId));
  return row.rentalBalance;
}
const payoutRows = () => db.select().from(rentalPayouts).where(eq(rentalPayouts.userId, userId));

const stripeError = (props: Record<string, unknown>) => Object.assign(new Error("stripe"), props);

before(async () => {
  const [user] = await db
    .insert(users)
    .values({
      username: UNIQUE,
      password: await hashPassword(PASSWORD),
      emailVerified: true,
      stripeConnectedAccountId: `acct_${UNIQUE}`,
    })
    .returning({ id: users.id, username: users.username });
  userId = user.id;
  userIds.push(user.id);

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const fakeStripe = {
    transfers: {
      create: async (params: any, options: any) => {
        const entry = { params, options };
        transferCalls.push(entry);
        return transferImpl(entry);
      },
    },
  };
  const server = registerRoutes(app, { startBackgroundJobs: false, stripe: fakeStripe });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  const login = await call("/api/login", { method: "POST", body: JSON.stringify({ username: user.username, password: PASSWORD }) });
  assert.equal(login.status, 200);
  const csrf = await call("/api/csrf-token");
  csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken;
});

beforeEach(async () => {
  transferCalls = [];
  transferImpl = async () => ({ id: `tr_${transferCalls.length}` });
  await db.delete(rentalPayouts).where(eq(rentalPayouts.userId, userId));
  await setBalance("0.00");
});

after(async () => {
  if (userIds.length) {
    await db.delete(notifications).where(inArray(notifications.userId, userIds));
    await db.delete(rentalPayouts).where(inArray(rentalPayouts.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }
  if (closeServer) await closeServer();
  await pool.end();
});

test("two concurrent withdrawals of the same money: exactly one succeeds", async () => {
  await setBalance("15.00");
  transferImpl = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { id: "tr_slow" };
  };

  const [first, second] = await Promise.all([withdraw({ amount: 10 }), withdraw({ amount: 10 })]);

  assert.deepEqual([first.status, second.status].sort(), [200, 400]);
  const loser = first.status === 400 ? first : second;
  assert.equal(((await loser.json()) as { error: string }).error, "Insufficient balance");
  assert.equal(transferCalls.length, 1);
  assert.equal(await balance(), "5.00");
  const rows = await payoutRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "paid_out");
  assert.equal(rows[0].stripeTransferId, "tr_slow");
});

test("a successful withdrawal uses the payout row's id as the transfer idempotency key", async () => {
  await setBalance("25.50");
  const response = await withdraw({ amount: 12.5 });
  assert.equal(response.status, 200);
  const [row] = await payoutRows();
  assert.equal(row.status, "paid_out");
  assert.equal(row.netAmount, "12.50");
  assert.equal(transferCalls[0].options.idempotencyKey, `rental-payout-${row.id}`);
  assert.equal(transferCalls[0].params.amount, 1250);
  assert.equal(await balance(), "13.00");
});

test("a definitive Stripe failure restores the balance and marks the row failed", async () => {
  await setBalance("30.00");
  transferImpl = async () => {
    throw stripeError({ type: "StripeInvalidRequestError", code: "balance_insufficient", statusCode: 400 });
  };

  const response = await withdraw({ amount: 20 });

  assert.equal(response.status, 503);
  const body = (await response.json()) as { code: string; error: string };
  assert.equal(body.code, "PAYOUT_UNAVAILABLE");
  assert.match(body.error, /temporarily unavailable/);
  assert.equal(await balance(), "30.00");
  const [row] = await payoutRows();
  assert.equal(row.status, "failed");

  transferImpl = async () => {
    throw stripeError({ type: "StripeInvalidRequestError", code: "account_invalid", statusCode: 400 });
  };
  const second = await withdraw({ amount: 20 });
  assert.equal(second.status, 502);
  assert.equal(((await second.json()) as { code: string }).code, "PAYOUT_FAILED");
  assert.equal(await balance(), "30.00");
});

test("an indeterminate Stripe failure keeps the money reserved and flags the row for manual review", async () => {
  await setBalance("30.00");
  transferImpl = async () => {
    throw stripeError({ type: "StripeConnectionError" });
  };

  const response = await withdraw({ amount: 20 });

  assert.equal(response.status, 502);
  const body = (await response.json()) as { code: string; payoutId: number };
  assert.equal(body.code, "PAYOUT_UNCONFIRMED");
  assert.equal(await balance(), "10.00");
  const [row] = await payoutRows();
  assert.equal(row.status, "manual_review");
  assert.equal(row.id, body.payoutId);
});

test("an in-progress replay of the idempotency key is treated as unknown, not as a refusal", async () => {
  await setBalance("30.00");
  transferImpl = async () => {
    throw stripeError({ type: "StripeIdempotencyError", code: "idempotency_key_in_use", statusCode: 409 });
  };
  const response = await withdraw({ amount: 10 });
  assert.equal(response.status, 502);
  assert.equal(await balance(), "20.00");
  assert.equal((await payoutRows())[0].status, "manual_review");
});

test("retrying an unfinished withdrawal reuses the same idempotency key and never reserves the money twice", async () => {
  await setBalance("30.00");
  transferImpl = async () => {
    throw stripeError({ type: "StripeConnectionError" });
  };
  const first = await withdraw({ amount: 20 });
  const { payoutId } = (await first.json()) as { payoutId: number };
  assert.equal(await balance(), "10.00");

  transferImpl = async () => ({ id: "tr_replayed" });
  const retry = await withdraw({ payoutId });

  assert.equal(retry.status, 200);
  assert.equal(transferCalls.length, 2);
  assert.equal(transferCalls[0].options.idempotencyKey, `rental-payout-${payoutId}`);
  assert.equal(transferCalls[1].options.idempotencyKey, transferCalls[0].options.idempotencyKey);
  assert.equal(transferCalls[1].params.amount, 2000);
  assert.equal(await balance(), "10.00");
  const rows = await payoutRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "paid_out");
  assert.equal(rows[0].stripeTransferId, "tr_replayed");

  // A settled withdrawal cannot be retried.
  const again = await withdraw({ payoutId });
  assert.equal(again.status, 404);
  assert.equal(transferCalls.length, 2);
});

test("a retry that Stripe definitively refuses restores the balance exactly once", async () => {
  await setBalance("30.00");
  transferImpl = async () => {
    throw stripeError({ type: "StripeConnectionError" });
  };
  const first = await withdraw({ amount: 20 });
  const { payoutId } = (await first.json()) as { payoutId: number };

  transferImpl = async () => {
    throw stripeError({ type: "StripeInvalidRequestError", code: "account_invalid", statusCode: 400 });
  };
  const retry = await withdraw({ payoutId });
  assert.equal(retry.status, 502);
  assert.equal(await balance(), "30.00");

  const again = await withdraw({ payoutId });
  assert.equal(again.status, 404);
  assert.equal(await balance(), "30.00");
});

test("an unfinished withdrawal older than Stripe's idempotency window is not retried automatically", async () => {
  await setBalance("30.00");
  transferImpl = async () => {
    throw stripeError({ type: "StripeConnectionError" });
  };
  const first = await withdraw({ amount: 20 });
  const { payoutId } = (await first.json()) as { payoutId: number };
  await db.update(rentalPayouts).set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }).where(eq(rentalPayouts.id, payoutId));

  transferImpl = async () => ({ id: "tr_must_not_happen" });
  const retry = await withdraw({ payoutId });

  assert.equal(retry.status, 409);
  assert.equal(((await retry.json()) as { code: string }).code, "PAYOUT_REVIEW_REQUIRED");
  assert.equal(transferCalls.length, 1);
  assert.equal(await balance(), "10.00");
});

test("validation: invalid and below-minimum amounts reserve nothing", async () => {
  await setBalance("30.00");
  for (const amount of [0, -5, "abc", 9.99]) {
    const response = await withdraw({ amount });
    assert.equal(response.status, 400);
  }
  assert.equal(transferCalls.length, 0);
  assert.equal(await balance(), "30.00");
  assert.equal((await payoutRows()).length, 0);
});
