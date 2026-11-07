import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { eq } from "drizzle-orm";
import { db, pool, users, walletChargebacks, walletTransactions } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { getWalletSummary, labelForKind, parseCursor, parsePageLimit } from "./wallet-summary.js";

const unique = `wallet-summary-${Date.now()}`;
const PASSWORD = "WalletSummary!42";
let userId: number;
let baseUrl: string;
let closeServer: () => Promise<void>;
const cookies = new Map<string, string>();

async function get(path: string) {
  const headers = new Headers({ "x-forwarded-proto": "https" });
  if (cookies.size) headers.set("cookie", [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "));
  const response = await fetch(`${baseUrl}${path}`, { headers });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";", 1);
    const separator = pair.indexOf("=");
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return response;
}

before(async () => {
  const [user] = await db.insert(users).values({ username: unique, password: await hashPassword(PASSWORD), emailVerified: true, rentalBalance: "42.50", pendingRentalBalance: "10.00" }).returning({ id: users.id });
  userId = user.id;
  const kinds: Array<[string, number]> = [
    ["rental_payout", 5000], ["claim_award", 3000], ["withdrawal", -2000], ["chargeback", -1500], ["currency_conversion", 250], ["debt_payment", -300],
  ];
  for (const [index, [kind, amountCents]] of kinds.entries()) {
    await db.insert(walletTransactions).values({ userId, kind, amountCents, currency: "cad", idempotencyKey: `${unique}-${index}` });
  }
  await db.insert(walletChargebacks).values({ userId, disputeId: `du_${unique}`, currency: "cad", principalCents: 4000, feeCents: 1500, collectedCents: 1500, status: "open" });

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const server = registerRoutes(app, { startBackgroundJobs: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

after(async () => {
  await closeServer();
  await db.delete(walletChargebacks).where(eq(walletChargebacks.userId, userId));
  await db.delete(walletTransactions).where(eq(walletTransactions.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

test("the wallet summary has the balance, pending, what is owed, and labelled history newest first", async () => {
  const summary = await getWalletSummary(userId);
  assert.deepEqual(summary.balance, { available: "42.50", pending: "10.00", debt: "40.00", total: "52.50" });
  assert.equal(summary.currency, "cad");
  assert.deepEqual(summary.transactions.map(t => [t.label, t.amount]), [
    ["Chargeback repayment", "-3.00"], ["Currency conversion", "2.50"], ["Chargeback", "-15.00"], ["Withdrawal", "-20.00"], ["Claim award", "30.00"], ["Rental earnings", "50.00"],
  ]);
  assert.equal(summary.nextCursor, null);
});

test("history is paged by cursor, newest first, with no row repeated or skipped", async () => {
  const first = await getWalletSummary(userId, { limit: 4 });
  assert.equal(first.transactions.length, 4);
  assert.ok(first.nextCursor);
  const second = await getWalletSummary(userId, { limit: 4, cursor: first.nextCursor });
  assert.equal(second.transactions.length, 2);
  assert.equal(second.nextCursor, null);
  const ids = [...first.transactions, ...second.transactions].map(t => t.id);
  assert.equal(new Set(ids).size, 6);
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
});

test("limit and cursor are clamped, and every ledger kind has a label", () => {
  assert.equal(parsePageLimit(undefined), 20);
  assert.equal(parsePageLimit("500"), 100);
  assert.equal(parsePageLimit("-3"), 20);
  assert.equal(parseCursor("abc"), null);
  assert.equal(parseCursor("12"), 12);
  for (const kind of ["rental_payout", "claim_award", "withdrawal", "chargeback", "currency_conversion"]) assert.notEqual(labelForKind(kind), "Wallet activity");
  assert.equal(labelForKind("something_new"), "Wallet activity");
});

test("GET /api/wallet needs a signed-in user and then returns that user's wallet", async () => {
  assert.equal((await get("/api/wallet")).status, 401);
  const login = await fetch(`${baseUrl}/api/login`, {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-proto": "https" }, body: JSON.stringify({ username: unique, password: PASSWORD }),
  });
  assert.equal(login.status, 200);
  for (const cookie of login.headers.getSetCookie()) {
    const [pair] = cookie.split(";", 1);
    const separator = pair.indexOf("=");
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  const response = await get("/api/wallet?limit=2");
  assert.equal(response.status, 200);
  const body = (await response.json()) as any;
  assert.equal(body.balance.debt, "40.00");
  assert.equal(body.transactions.length, 2);
  assert.ok(body.nextCursor);
});
