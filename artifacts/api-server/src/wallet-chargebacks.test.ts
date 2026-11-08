import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { accountReviewFlags, db, itemRequests, items, notifications, platformDisputes, pool, rentalPayouts, users, walletChargebacks, walletTransactions } from "@workspace/db";
import { disputeFeeCents, disputeReturnedCents, disputeWebhookHandler, findDisputeLiability, handleDisputeEvent } from "./dispute-webhook.js";
import { releaseHeldRentalPayout, reservePayout } from "./rental-payout-service.js";
import { closeChargeback, openDebtCents, recordChargeback, recordChargebackFee } from "./wallet-chargebacks.js";

// These tests cover the OLD behaviour (charging owners), which is now behind a switch that is off by default.
process.env.CHARGEBACK_RECOVERY_FROM_OWNERS = "true";

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
  // Every dispute is also recorded on the platform side, with a flag, and notices to any admin: they point at these requests.
  if (requestIds.length) await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
  await db.delete(accountReviewFlags).where(inArray(accountReviewFlags.userId, [ownerId, borrowerId]));
  await db.delete(platformDisputes).where(inArray(platformDisputes.ownerId, [ownerId]));
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

test("winning returns only what Stripe actually returned: the payment yes, the fee only if Stripe gave it back", async () => {
  // Stripe reinstated the disputed 40.00 but did not return its 15.00 fee: the member gets 25.00 back and pays the fee.
  await setWallet("40.00");
  const feeKept = dispute();
  await recordChargeback(input(feeKept, 4000));
  await recordChargebackFee(feeKept, 1500);
  assert.equal(await balanceCents(), 0);
  assert.equal(await openDebtCents(ownerId), 1500);
  assert.equal(await closeChargeback(feeKept, "won", { returnedCents: 4000, disputeAmountCents: 4000 }), "won");
  assert.equal(await closeChargeback(feeKept, "won", { returnedCents: 4000, disputeAmountCents: 4000 }), "duplicate");
  assert.equal(await balanceCents(), 2500, "40.00 collected, 15.00 of it covers the fee Stripe kept");
  assert.equal(await openDebtCents(ownerId), 0);
  assert.equal(await ledgerSum(), await balanceCents());

  // Stripe returned the fee as well: everything collected goes back.
  await setWallet("40.00");
  const feeBack = dispute();
  await recordChargeback(input(feeBack, 4000));
  await recordChargebackFee(feeBack, 1500);
  await closeChargeback(feeBack, "won", { returnedCents: 5500, disputeAmountCents: 4000 });
  assert.equal(await balanceCents(), 4000);
  assert.equal(await openDebtCents(ownerId), 0);

  // "Won" but Stripe's figures are missing or zero: nothing is returned, and what was taken stays owed.
  await setWallet("40.00");
  const noFigures = dispute();
  await recordChargeback(input(noFigures, 4000));
  assert.equal(await closeChargeback(noFigures, "won"), "won");
  assert.equal(await balanceCents(), 0, "Stripe's figures are missing, so nothing is given back");
  assert.equal(await openDebtCents(ownerId), 0, "the 40.00 is already collected; nothing more is owed");

  // Stripe returned less than the member's share: the shortfall stays an obligation.
  await setWallet("40.00");
  const partial = dispute();
  await recordChargeback(input(partial, 4000));
  await closeChargeback(partial, "won", { returnedCents: 1000, disputeAmountCents: 4000 });
  assert.equal(await balanceCents(), 1000, "only the 10.00 Stripe returned");
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
  // Stripe reinstated the disputed 120.00 on a balance transaction and kept its 15.00 fee: the earnings come back, the fee does not.
  const closedWon = {
    id, status: "won", amount: 12_000,
    balance_transactions: [{ net: -12_000, fee: 0 }, { net: -1500, fee: 1500 }, { net: 12_000, fee: 0 }],
  };
  assert.equal(disputeReturnedCents(closedWon), 12_000);
  assert.equal(await handleDisputeEvent({ type: "charge.dispute.closed", data: { object: closedWon } } as any), "won");
  assert.equal(await balanceCents(), 50_000 - 1500, "won: the 95.00 is back, the 15.00 fee stays with the member");
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

test("Stripe's real test-mode dispute payloads: the disputed amount comes back on a win and the fee does not, even when the balance transactions arrive as ids", async () => {
  // Captured from a CAD test-mode dispute (payment of 20.00, card pm_card_createDispute) that was then won.
  const withdrawal = { type: "adjustment", reporting_category: "dispute", amount: -2000, fee: 1500, net: -3500, currency: "cad" };
  const reinstated = { type: "adjustment", reporting_category: "dispute_reversal", amount: 2000, fee: 0, net: 2000, currency: "cad" };
  const created = { status: "needs_response", amount: 2000, currency: "cad", balance_transactions: [withdrawal] };
  const won = { status: "won", amount: 2000, currency: "cad", balance_transactions: [withdrawal, reinstated] };
  assert.equal(disputeFeeCents(created), 1500);
  assert.equal(disputeReturnedCents(created), 0);
  assert.equal(disputeReturnedCents(won), 2000, "only the reinstated amount; the withdrawal and its fee are negative");

  await setWallet("100.00");
  const id = dispute();
  await recordChargeback(input(id, 2000));
  await handleDisputeEvent({ type: "charge.dispute.funds_withdrawn", data: { object: { id, ...created } } } as any);
  assert.equal(await balanceCents(), 10_000 - 2000 - 1500);
  const byId: Record<string, unknown> = { txn_withdrawal: withdrawal, txn_reinstated: reinstated };
  const lookedUp: string[] = [];
  const outcome = await handleDisputeEvent(
    { type: "charge.dispute.closed", data: { object: { id, ...won, balance_transactions: ["txn_withdrawal", "txn_reinstated"] } } } as any,
    async (txn) => { lookedUp.push(txn); return byId[txn]; },
  );
  assert.equal(outcome, "won");
  assert.deepEqual(lookedUp, ["txn_withdrawal", "txn_reinstated"]);
  assert.equal(await balanceCents(), 10_000 - 1500, "the 20.00 is back; the 15.00 fee Stripe kept stays with the member");
  assert.equal(await ledgerSum(), await balanceCents());
});
