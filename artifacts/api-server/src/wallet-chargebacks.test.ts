import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, notifications, pool, rentalPayouts, users, walletChargebacks, walletTransactions } from "@workspace/db";
import { disputeFeeCents, disputeWebhookHandler, findDisputeLiability, handleDisputeEvent } from "./dispute-webhook.js";
import { releaseHeldRentalPayout, reservePayout } from "./rental-payout-service.js";
import { closeChargeback, openDebtCents, recordChargeback, recordChargebackFee } from "./wallet-chargebacks.js";

const unique = `wallet-chargebacks-${Date.now()}`;
let ownerId: number;
let borrowerId: number;
let itemId: number;
const requestIds: number[] = [];
let counter = 0;

const dispute = () => `du_${unique}_${++counter}`;
async function setWallet(balance: string) {
  await db.delete(walletChargebacks).where(eq(walletChargebacks.userId, ownerId));
  await db.delete(walletTransactions).where(eq(walletTransactions.userId, ownerId));
  await db.update(users).set({ rentalBalance: balance, pendingRentalBalance: "0.00" }).where(eq(users.id, ownerId));
  if (Number(balance) > 0) {
    await db.insert(walletTransactions).values({ userId: ownerId, kind: "rental_payout", amountCents: Math.round(Number(balance) * 100), currency: "cad", idempotencyKey: `${unique}-opening-${++counter}` });
  }
}
const balanceCents = async () => Math.round(Number((await db.select({ b: users.rentalBalance }).from(users).where(eq(users.id, ownerId)))[0].b) * 100);
const ledgerSum = async () => (await db.select().from(walletTransactions).where(eq(walletTransactions.userId, ownerId))).reduce((t, r) => t + r.amountCents, 0);
const input = (disputeId: string, principalCents: number) => ({ userId: ownerId, disputeId, paymentIntentId: `pi_${disputeId}`, requestId: null, currency: "cad", principalCents });

async function heldRental(net: string, paymentIntentId: string | null = null) {
  const [request] = await db.insert(itemRequests).values({ itemId, requesterId: borrowerId, requestType: "RENT", status: "IN_PROGRESS", paymentCurrency: "cad" } as any).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  await db.insert(rentalPayouts).values({ userId: ownerId, requestId: request.id, amount: net, rentalAmount: net, netAmount: net, status: "held", stripePaymentIntentId: paymentIntentId });
  await db.update(users).set({ pendingRentalBalance: net }).where(eq(users.id, ownerId));
  return request.id;
}
const release = (requestId: number) => releaseHeldRentalPayout({ requestId, ownerId, itemId, itemName: "Drill", logTag: "test" });

before(async () => {
  const inserted = await db.insert(users).values([{ username: `${unique}-owner` }, { username: `${unique}-borrower` }]).returning();
  ownerId = inserted[0].id;
  borrowerId = inserted[1].id;
  const [item] = await db.insert(items).values({ ownerId, name: `${unique}-item`, description: "chargeback test", conditionRating: 5, photos: [], shareCoinsReward: "0" }).returning();
  itemId = item.id;
});

after(async () => {
  await db.delete(notifications).where(inArray(notifications.userId, [ownerId, borrowerId]));
  await db.delete(walletChargebacks).where(eq(walletChargebacks.userId, ownerId));
  await db.delete(walletTransactions).where(eq(walletTransactions.userId, ownerId));
  await db.delete(rentalPayouts).where(eq(rentalPayouts.userId, ownerId));
  if (requestIds.length) await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(inArray(users.id, [ownerId, borrowerId]));
  await pool.end();
});

test("a chargeback the balance covers is taken from the wallet once, however often Stripe repeats the event", async () => {
  await setWallet("100.00");
  const id = dispute();
  assert.equal(await recordChargeback(input(id, 6000)), "recorded");
  assert.equal(await recordChargeback(input(id, 6000)), "duplicate");
  assert.equal(await balanceCents(), 4000);
  assert.equal(await ledgerSum(), 4000, "the ledger still explains the balance");
  assert.equal(await openDebtCents(ownerId), 0);
  const [row] = await db.select().from(walletChargebacks).where(eq(walletChargebacks.disputeId, id));
  assert.deepEqual([row.principalCents, row.collectedCents, row.status], [6000, 6000, "open"]);
});

test("a shortfall becomes a debt, and new earnings pay it off first so only the surplus reaches the wallet", async () => {
  await setWallet("30.00");
  await recordChargeback(input(dispute(), 9500));
  assert.equal(await balanceCents(), 0, "the balance is never taken below zero");
  assert.equal(await openDebtCents(ownerId), 6500);

  assert.ok(await release(await heldRental("50.00")));
  assert.equal(await balanceCents(), 0, "all 50.00 went to the debt");
  assert.equal(await openDebtCents(ownerId), 1500);
  assert.equal(await reservePayout(ownerId, 1000), null, "nothing is withdrawable while the earnings only paid the debt");

  assert.ok(await release(await heldRental("40.00")));
  assert.equal(await openDebtCents(ownerId), 0);
  assert.equal(await balanceCents(), 2500, "the 25.00 left after the last 15.00 of debt");
  assert.equal(await ledgerSum(), 2500, "earnings +90, debt payments -65, the chargeback -30, opening +30");
  const withdrawal = await reservePayout(ownerId, 2500);
  assert.ok(withdrawal, "the surplus can be withdrawn");
});

test("the dispute fee is charged once, from the balance first, and what the balance cannot cover is owed", async () => {
  await setWallet("20.00");
  const id = dispute();
  await recordChargeback(input(id, 1000));
  assert.equal(await recordChargebackFee(id, 1500), "recorded");
  assert.equal(await recordChargebackFee(id, 1500), "duplicate");
  assert.equal(await balanceCents(), 0);
  assert.equal(await openDebtCents(ownerId), 500, "1000 + 1500 owed, 2000 collected");
  assert.equal(await recordChargebackFee("du_unknown", 1500), "unknown");
});

test("winning returns everything collected and clears the debt; losing leaves it taken and owed; closing twice changes nothing", async () => {
  await setWallet("40.00");
  const won = dispute();
  await recordChargeback(input(won, 4000));
  await recordChargebackFee(won, 1500);
  assert.equal(await balanceCents(), 0);
  assert.equal(await openDebtCents(ownerId), 1500);
  assert.equal(await closeChargeback(won, "won"), "won");
  assert.equal(await closeChargeback(won, "won"), "duplicate");
  assert.equal(await balanceCents(), 4000, "the 40.00 collected is back");
  assert.equal(await openDebtCents(ownerId), 0);
  assert.equal(await ledgerSum(), await balanceCents());

  await setWallet("10.00");
  const lost = dispute();
  await recordChargeback(input(lost, 4000));
  assert.equal(await closeChargeback(lost, "lost"), "lost");
  assert.equal(await balanceCents(), 0);
  assert.equal(await openDebtCents(ownerId), 3000, "a lost dispute keeps its debt");
  assert.equal(await closeChargeback("du_never_seen", "won"), "unknown");
});

test("the webhook maps a disputed rental payment to the owner's net earnings, never more than was disputed", async () => {
  await setWallet("500.00");
  const pi = `pi_${unique}_rental`;
  const requestId = await heldRental("95.00", pi);
  await db.update(rentalPayouts).set({ status: "released" }).where(eq(rentalPayouts.requestId, requestId));
  const liability = await findDisputeLiability(pi, 12_000);
  assert.deepEqual([liability?.userId, liability?.requestId, liability?.principalCents], [ownerId, requestId, 9500]);
  assert.equal((await findDisputeLiability(pi, 5000))?.principalCents, 5000, "capped at the disputed amount");
  assert.equal(await findDisputeLiability("pi_unrelated", 5000), null);

  const id = dispute();
  const created = { type: "charge.dispute.created", data: { object: { id, amount: 12_000, payment_intent: pi } } } as any;
  assert.equal(await handleDisputeEvent(created), "recorded");
  assert.equal(await handleDisputeEvent(created), "duplicate");
  assert.equal(await balanceCents(), 50_000 - 9500);
  const withdrawn = { type: "charge.dispute.funds_withdrawn", data: { object: { id, balance_transactions: [{ fee: 1500 }, { fee: 0 }] } } } as any;
  assert.equal(disputeFeeCents(withdrawn.data.object), 1500);
  assert.equal(await handleDisputeEvent(withdrawn), "recorded");
  assert.equal(await balanceCents(), 50_000 - 9500 - 1500);
  assert.equal(await handleDisputeEvent({ type: "charge.dispute.closed", data: { object: { id, status: "won" } } } as any), "won");
  assert.equal(await balanceCents(), 50_000, "won: the earnings and the fee are back");
  assert.match(await handleDisputeEvent({ type: "charge.dispute.created", data: { object: { id: dispute(), amount: 100, payment_intent: "pi_unrelated" } } } as any), /ignored/);
});

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined as unknown };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  return res;
}

test("the dispute webhook fails closed: no secret, no signature, no raw body or a bad signature changes nothing", async () => {
  const handled: unknown[] = [];
  const stripe = (valid: boolean) => async () => ({ webhooks: { constructEvent: () => { if (!valid) throw new Error("bad signature"); return { type: "charge.dispute.closed", data: { object: { id: "du_x" } } }; } } }) as any;
  const make = (over: Record<string, unknown>) => disputeWebhookHandler({ getSecret: () => "whsec_test", getStripe: stripe(true), handle: async (event: unknown) => { handled.push(event); return "ok"; }, ...over } as any);
  const raw = Buffer.from("{}");

  let res = fakeRes();
  await make({ getSecret: () => undefined })({ headers: { "stripe-signature": "t=1" }, body: raw } as any, res);
  assert.equal(res.statusCode, 400);
  res = fakeRes();
  await make({})({ headers: {}, body: raw } as any, res);
  assert.equal(res.statusCode, 400);
  res = fakeRes();
  await make({})({ headers: { "stripe-signature": "t=1" }, body: { parsed: true } } as any, res);
  assert.equal(res.statusCode, 400);
  res = fakeRes();
  await make({ getStripe: stripe(false) })({ headers: { "stripe-signature": "t=1" }, body: raw } as any, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(handled, []);

  res = fakeRes();
  await make({})({ headers: { "stripe-signature": "t=1" }, body: raw } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(handled.length, 1);
  res = fakeRes();
  await make({ handle: async () => { throw new Error("boom"); } })({ headers: { "stripe-signature": "t=1" }, body: raw } as any, res);
  assert.equal(res.statusCode, 500, "a processing failure is a 500 so Stripe retries");
});
