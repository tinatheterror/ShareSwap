import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db, itemRequests, items, messages, notifications, pool, rentalPayouts, requestLifecycleEvents, requestRefunds, users, walletChargebacks, walletTransactions,
} from "@workspace/db";
import { hashPassword } from "./auth.js";
import { freezeRentalEarnings } from "./rental-earnings-freeze.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureCancellationRecord, ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";
import { fakeStripe } from "./test-fixtures/fake-stripe.js";
import { recordWalletEntry, rentalEarningKey } from "./wallet-ledger.js";

const UNIQUE = `handoff-resolve-${Date.now()}`;
const PASSWORD = "HandoffResolve!42";
const userIds: number[] = [];
const itemIds: number[] = [];
const requestIds: number[] = [];

let failRefunds = false;
const stripe = fakeStripe({ failRefund: () => failRefunds, refundIdPrefix: `re_${UNIQUE}_` });
let baseUrl: string;
let closeServer: () => Promise<void>;
let admin: TestClient;
let plain: TestClient;
let ownerId: number;
let borrowerId: number;
let counter = 0;

class TestClient {
  private cookies = new Map<string, string>();
  private csrfToken = "";
  async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    headers.set("x-forwarded-proto", "https");
    if (this.cookies.size) headers.set("cookie", [...this.cookies.entries()].map(([n, v]) => `${n}=${v}`).join("; "));
    if (this.csrfToken && init.method && init.method !== "GET") headers.set("x-csrf-token", this.csrfToken);
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";", 1);
      const separator = pair.indexOf("=");
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }
  resolve(requestId: number | string, body: unknown) {
    return this.request(`/api/admin/handoff-disputes/${requestId}/resolve`, { method: "POST", body: JSON.stringify(body) });
  }
  async login(username: string) {
    const response = await this.request("/api/login", { method: "POST", body: JSON.stringify({ username, password: PASSWORD }) });
    assert.equal(response.status, 200);
    const csrf = await this.request("/api/csrf-token");
    this.csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken;
  }
}

/** A rental whose handoff auto-confirmed, then was disputed: earnings released (95.00 in the wallet) and frozen, deposit held. */
async function disputedRental(opts: { freeze?: boolean; status?: string } = {}) {
  const n = ++counter;
  const [item] = await db.insert(items).values({
    ownerId, name: `${UNIQUE}-item-${n}`, description: "handoff dispute route test", conditionRating: 4, photos: [], isRentable: true, isAvailable: false,
    replacementValue: 100, securityDeposit: "10.00", lendingDuration: 7, shareCoinsReward: "0",
  }).returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db.insert(itemRequests).values({
    itemId: item.id, requesterId: borrowerId, requestType: "RENT", status: opts.status ?? "HANDOFF_DISPUTED", paymentCurrency: "cad", handoffAutoAdvanced: true,
    startDate: new Date("2026-10-05T00:00:00.000Z"), endDate: new Date("2026-10-08T00:00:00.000Z"), depositMethod: "in_app",
    depositPaymentIntentId: `pi_dep_${n}`, depositStatus: "held", depositMode: "authorization", trustDepositAmount: "10.00",
    platformFeeChargeId: `pi_fee_${n}`, rentalAmount: "100.00",
  } as any).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  const [payout] = await db.insert(rentalPayouts).values({
    userId: ownerId, requestId: request.id, amount: "100.00", rentalAmount: "100.00", netAmount: "95.00", status: "released", stripePaymentIntentId: `pi_rental_${n}`,
  }).returning();
  await db.delete(walletTransactions).where(eq(walletTransactions.userId, ownerId));
  await db.update(users).set({ rentalBalance: "95.00", pendingRentalBalance: "0.00" }).where(eq(users.id, ownerId));
  await recordWalletEntry(db, { userId: ownerId, kind: "rental_payout", amountCents: 9500, currency: "cad", requestId: request.id, rentalPayoutId: payout.id, idempotencyKey: rentalEarningKey(payout.id) });
  if (opts.freeze !== false) await freezeRentalEarnings(request.id);
  return { id: request.id, itemId: item.id, payoutId: payout.id, n };
}

const load = async (id: number) => (await db.select().from(itemRequests).where(eq(itemRequests.id, id)))[0];
const payoutStatus = async (id: number) => (await db.select({ s: rentalPayouts.status }).from(rentalPayouts).where(eq(rentalPayouts.id, id)))[0].s;
const wallet = async () => {
  const [row] = await db.select({ b: users.rentalBalance, p: users.pendingRentalBalance }).from(users).where(eq(users.id, ownerId));
  return { balance: Math.round(Number(row.b) * 100), pending: Math.round(Number(row.p) * 100) };
};
// The refund ledger keeps Stripe refund ids unique, so the fake's call lists are never cleared: each test reads from its own offset.
let refundBase = 0;
let cancelBase = 0;
const resetStripe = () => {
  refundBase = stripe.calls.refunds.length;
  cancelBase = stripe.calls.cancel.length;
  stripe.intentStatus.clear();
};
const refundsNow = () => stripe.calls.refunds.slice(refundBase);
const cancelsNow = () => stripe.calls.cancel.slice(cancelBase);

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  await ensureCancellationRecord();
  const password = await hashPassword(PASSWORD);
  const created = await db.insert(users).values([
    { username: `${UNIQUE}-owner`, password, emailVerified: true },
    { username: `${UNIQUE}-borrower`, password, emailVerified: true },
    { username: `${UNIQUE}-admin`, password, emailVerified: true, isAdmin: true },
    { username: `${UNIQUE}-plain`, password, emailVerified: true },
  ]).returning({ id: users.id, username: users.username });
  userIds.push(...created.map((u) => u.id));
  [ownerId, borrowerId] = [created[0].id, created[1].id];

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const server = registerRoutes(app, { startBackgroundJobs: false, stripe: stripe.client as any });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  admin = new TestClient();
  plain = new TestClient();
  await admin.login(created[2].username);
  await plain.login(created[3].username);
});

after(async () => {
  try {
    await db.delete(walletChargebacks).where(eq(walletChargebacks.userId, ownerId));
    await db.delete(walletTransactions).where(eq(walletTransactions.userId, ownerId));
    if (requestIds.length) {
      await db.delete(requestRefunds).where(inArray(requestRefunds.requestId, requestIds));
      await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, requestIds));
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
      await db.delete(rentalPayouts).where(inArray(rentalPayouts.requestId, requestIds));
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

test("only a signed-in admin can resolve, and the decision and the request must be valid", async () => {
  const { id } = await disputedRental();
  const anonymous = await fetch(`${baseUrl}/api/admin/handoff-disputes/${id}/resolve`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-proto": "https" }, body: "{}" });
  assert.ok([401, 403].includes(anonymous.status), "no session: refused");
  assert.equal((await plain.resolve(id, { decision: "borrower" })).status, 403);
  assert.equal((await admin.resolve(id, { decision: "nobody" })).status, 400);
  assert.equal((await admin.resolve(99_999_999, { decision: "owner" })).status, 404);
  const notDisputed = await disputedRental({ status: "IN_PROGRESS" });
  assert.equal((await admin.resolve(notDisputed.id, { decision: "owner" })).status, 400);
  assert.equal((await load(id)).status, "HANDOFF_DISPUTED", "nothing changed");
});

test("borrower wins: the payment and platform fee are refunded, the deposit released, the rental cancelled, the earnings reversed; each Stripe call has a stable key", async () => {
  resetStripe();
  const { id, itemId, payoutId, n } = await disputedRental();
  assert.deepEqual(await wallet(), { balance: 0, pending: 9500 }, "the earnings are frozen");

  const response = await admin.resolve(id, { decision: "borrower" });
  assert.equal(response.status, 200);
  const body: any = await response.json();
  assert.equal(body.success, true);

  assert.deepEqual(refundsNow().map(r => [r.params.payment_intent, r.options?.idempotencyKey]).sort(), [
    [`pi_fee_${n}`, `handoff-dispute-refund-${id}-pi_fee_${n}`],
    [`pi_rental_${n}`, `handoff-dispute-refund-${id}-pi_rental_${n}`],
  ].sort());
  assert.deepEqual(cancelsNow().map(c => [c.id, c.options?.idempotencyKey]), [[`pi_dep_${n}`, `handoff-dispute-${id}-pi_dep_${n}`]]);

  const request = await load(id);
  assert.equal(request.status, "CANCELLED");
  assert.equal(request.cancelReason, "handoff_dispute_borrower");
  assert.equal(request.cancelledFromStatus, "HANDOFF_DISPUTED");
  assert.equal(request.depositStatus, "released");
  assert.equal(request.depositOperationToken, null, "the deposit fence is released");
  assert.equal(await payoutStatus(payoutId), "reversed");
  assert.deepEqual(await wallet(), { balance: 0, pending: 0 });
  assert.equal((await db.select({ a: items.isAvailable }).from(items).where(eq(items.id, itemId)))[0].a, true);
  const refunds = await db.select().from(requestRefunds).where(eq(requestRefunds.requestId, id));
  assert.deepEqual(refunds.map(r => r.kind).sort(), ["deposit_hold_release", "platform_fee_refund", "rental_refund"]);
  const [event] = await db.select().from(requestLifecycleEvents).where(eq(requestLifecycleEvents.idempotencyKey, `handoff-dispute-resolved-${id}`));
  assert.equal((event.details as any).decision, "borrower");
  const told = await db.select().from(notifications).where(eq(notifications.requestId, id));
  assert.ok(told.some(x => x.userId === borrowerId && /refunded and your deposit released/.test(x.message)));
  assert.ok(told.some(x => x.userId === ownerId && /reversed/.test(x.message)));
});

test("a repeated borrower resolution does nothing more; the opposite decision is refused", async () => {
  resetStripe();
  const { id } = await disputedRental();
  assert.equal((await admin.resolve(id, { decision: "borrower" })).status, 200);
  const refundCalls = refundsNow().length;
  const cancelCalls = cancelsNow().length;
  assert.ok(refundCalls > 0 && cancelCalls > 0);

  const again = await admin.resolve(id, { decision: "borrower" });
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as any).alreadyResolved, true);
  assert.equal(refundsNow().length, refundCalls, "no second refund");
  assert.equal(cancelsNow().length, cancelCalls, "no second hold release");
  assert.equal((await admin.resolve(id, { decision: "owner" })).status, 409);
  assert.equal((await load(id)).status, "CANCELLED");
  assert.equal((await db.select().from(requestRefunds).where(eq(requestRefunds.requestId, id))).length, 3, "the refund ledger has each thing once");
});

test("if Stripe refuses a refund nothing changes, and repeating the call finishes it with the same keys", async () => {
  resetStripe();
  const { id, n, payoutId } = await disputedRental();
  failRefunds = true;
  try {
    const failed = await admin.resolve(id, { decision: "borrower" });
    assert.equal(failed.status, 502);
    assert.equal(((await failed.json()) as any).retryable, true);
  } finally {
    failRefunds = false;
  }
  const untouched = await load(id);
  assert.equal(untouched.status, "HANDOFF_DISPUTED");
  assert.equal(untouched.depositOperationToken, null, "the fence is released so the call can be repeated");
  assert.equal(await payoutStatus(payoutId), "frozen");
  assert.deepEqual(await wallet(), { balance: 0, pending: 9500 });
  assert.equal((await db.select().from(requestLifecycleEvents).where(eq(requestLifecycleEvents.idempotencyKey, `handoff-dispute-resolved-${id}`))).length, 0);

  assert.equal((await admin.resolve(id, { decision: "borrower" })).status, 200);
  assert.deepEqual(refundsNow().map(r => r.options?.idempotencyKey).sort(), [`handoff-dispute-refund-${id}-pi_fee_${n}`, `handoff-dispute-refund-${id}-pi_rental_${n}`].sort());
  assert.equal((await load(id)).status, "CANCELLED");
});

test("borrower wins on a dispute whose earnings were never frozen: they are taken back from the wallet", async () => {
  resetStripe();
  const { id, payoutId } = await disputedRental({ freeze: false });
  assert.deepEqual(await wallet(), { balance: 9500, pending: 0 });
  const response = await admin.resolve(id, { decision: "borrower" });
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as any).earningsRecovered, "recorded");
  assert.deepEqual(await wallet(), { balance: 0, pending: 0 });
  assert.equal(await payoutStatus(payoutId), "reversed");
  const [row] = await db.select().from(walletChargebacks).where(eq(walletChargebacks.disputeId, `handoff-dispute-${id}`));
  assert.equal(row.collectedCents, 9500);
});

test("owner wins: the rental continues, the earnings return to the wallet, Stripe is not touched, and a repeat is harmless", async () => {
  resetStripe();
  const { id, payoutId } = await disputedRental();
  assert.deepEqual(await wallet(), { balance: 0, pending: 9500 });
  const response = await admin.resolve(id, { decision: "owner" });
  assert.equal(response.status, 200);
  assert.equal((await load(id)).status, "IN_PROGRESS");
  assert.equal(await payoutStatus(payoutId), "released");
  assert.deepEqual(await wallet(), { balance: 9500, pending: 0 });
  assert.equal(refundsNow().length + cancelsNow().length, 0, "no money moves for the borrower");

  const again = await admin.resolve(id, { decision: "owner" });
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as any).alreadyResolved, true);
  assert.deepEqual(await wallet(), { balance: 9500, pending: 0 }, "not returned twice");
  assert.equal((await admin.resolve(id, { decision: "borrower" })).status, 409);
});
