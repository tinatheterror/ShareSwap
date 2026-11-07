import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, depositSettlementOperations, itemRequests, items, notifications, pool, rentalPayouts, securityClaims, users, walletTransactions } from "@workspace/db";
import { releaseHeldRentalPayout, reservePayout, sendPayout } from "./rental-payout-service.js";
import { applyWalletBackfill, planWalletBackfill } from "./wallet-ledger-backfill.js";

const unique = `wallet-ledger-${Date.now()}`;
let ownerId: number;
let borrowerId: number;
let itemId: number;
const requestIds: number[] = [];

const ledger = (userId = ownerId) => db.select().from(walletTransactions).where(eq(walletTransactions.userId, userId)).orderBy(walletTransactions.id);
async function balanceCents() {
  const [row] = await db.select({ b: users.rentalBalance }).from(users).where(eq(users.id, ownerId));
  return Math.round(Number(row.b ?? 0) * 100);
}
const sumCents = async () => (await ledger()).reduce((total, row) => total + row.amountCents, 0);

async function heldRental(net: string, currency: string) {
  const [request] = await db.insert(itemRequests).values({
    itemId, requesterId: borrowerId, requestType: "RENT", status: "IN_PROGRESS", paymentCurrency: currency, rentalAmount: net,
  } as any).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  const [payout] = await db.insert(rentalPayouts).values({
    userId: ownerId, requestId: request.id, amount: net, rentalAmount: net, platformFee: "0", processingFee: "0", netAmount: net, status: "held",
  }).returning();
  await db.update(users).set({ pendingRentalBalance: net }).where(eq(users.id, ownerId));
  return { requestId: request.id, payout };
}

before(async () => {
  const inserted = await db.insert(users).values([{ username: `${unique}-owner` }, { username: `${unique}-borrower` }]).returning();
  ownerId = inserted[0].id;
  borrowerId = inserted[1].id;
  const [item] = await db.insert(items).values({
    ownerId, name: `${unique}-item`, description: "wallet ledger test", conditionRating: 5, photos: [], shareCoinsReward: "0",
  }).returning();
  itemId = item.id;
});

after(async () => {
  await db.delete(walletTransactions).where(eq(walletTransactions.userId, ownerId));
  await db.delete(rentalPayouts).where(eq(rentalPayouts.userId, ownerId));
  if (requestIds.length) await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
  if (requestIds.length) await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(inArray(users.id, [ownerId, borrowerId]));
  await pool.end();
});

test("releasing rental earnings writes one rental_payout row in the request's currency, and releasing again writes no more", async () => {
  await db.update(users).set({ rentalBalance: "0.00" }).where(eq(users.id, ownerId));
  const { requestId, payout } = await heldRental("95.00", "usd");
  assert.equal(await releaseHeldRentalPayout({ requestId, ownerId, itemId, itemName: "Drill", logTag: "test" }), true);
  assert.equal(await releaseHeldRentalPayout({ requestId, ownerId, itemId, itemName: "Drill", logTag: "test" }), false);
  const rows = await ledger();
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { kind: rows[0].kind, cents: rows[0].amountCents, currency: rows[0].currency, request: rows[0].requestId, payout: rows[0].rentalPayoutId, key: rows[0].idempotencyKey },
    { kind: "rental_payout", cents: 9500, currency: "usd", request: requestId, payout: payout.id, key: `rental-earning-${payout.id}` },
  );
  assert.equal(await balanceCents(), 9500);
  assert.equal(await sumCents(), await balanceCents(), "the ledger explains the balance");
});

test("a withdrawal is a negative row, a refused transfer adds the reversal, and the ledger keeps matching the balance", async () => {
  const reserved = await reservePayout(ownerId, 4000);
  assert.ok(reserved);
  assert.equal(await balanceCents(), 5500);
  let rows = await ledger();
  assert.equal(rows.at(-1)!.kind, "withdrawal");
  assert.equal(rows.at(-1)!.amountCents, -4000);
  assert.equal(await sumCents(), await balanceCents());

  const refused = Object.assign(new Error("no funds"), { type: "StripeInvalidRequestError", statusCode: 400 });
  const outcome = await sendPayout(reserved, "acct_test", { transfers: { create: async () => { throw refused; } } });
  assert.equal(outcome.ok, false);
  rows = await ledger();
  assert.deepEqual(rows.slice(-2).map(r => [r.kind, r.amountCents]), [["withdrawal", -4000], ["withdrawal_reversal", 4000]]);
  assert.equal(await balanceCents(), 9500);
  assert.equal(await sumCents(), await balanceCents());

  const again = await reservePayout(ownerId, 1000);
  assert.ok(again);
  const sent = await sendPayout(again, "acct_test", { transfers: { create: async () => ({ id: `tr_${unique}` }) } });
  assert.equal(sent.ok, true);
  assert.equal(await balanceCents(), 8500);
  assert.equal(await sumCents(), await balanceCents(), "a paid withdrawal stays a debit");
});

test("the backfill derives rows for pre-ledger earnings, withdrawals and awards, is a dry run until applied, and a second apply writes nothing", async () => {
  const other = (await db.insert(users).values({ username: `${unique}-legacy` }).returning())[0];
  try {
    const [request] = await db.insert(itemRequests).values({
      itemId, requesterId: borrowerId, requestType: "RENT", status: "COMPLETED", paymentCurrency: "usd", rentalAmount: "50.00",
    } as any).returning({ id: itemRequests.id });
    requestIds.push(request.id);
    const [earned] = await db.insert(rentalPayouts).values({
      userId: other.id, requestId: request.id, amount: "50", rentalAmount: "50", netAmount: "47.50", status: "released", releasedAt: new Date("2026-08-01T00:00:00Z"),
    }).returning();
    const [paid] = await db.insert(rentalPayouts).values({ userId: other.id, amount: "20", rentalAmount: "20", netAmount: "20.00", status: "paid_out" }).returning();
    const [failed] = await db.insert(rentalPayouts).values({ userId: other.id, amount: "5", rentalAmount: "5", netAmount: "5.00", status: "failed" }).returning();
    await db.insert(rentalPayouts).values({ userId: other.id, requestId: request.id, amount: "9", rentalAmount: "9", netAmount: "9.00", status: "held" });
    await db.update(users).set({ rentalBalance: "27.50" }).where(eq(users.id, other.id));

    const plan = await planWalletBackfill();
    const mine = plan.entries.filter(e => e.userId === other.id);
    assert.deepEqual(
      mine.map(e => [e.kind, e.amountCents, e.currency, e.idempotencyKey]),
      [
        ["rental_payout", 4750, "usd", `rental-earning-${earned.id}`],
        ["withdrawal", -2000, "cad", `withdrawal-${paid.id}`],
        ["withdrawal", -500, "cad", `withdrawal-${failed.id}`],
        ["withdrawal_reversal", 500, "cad", `withdrawal-reversal-${failed.id}`],
      ],
      "held earnings are not in the wallet yet, so they get no row",
    );
    assert.equal((await ledger(other.id)).length, 0, "planning writes nothing");
    assert.equal(plan.drift.find(d => d.userId === other.id), undefined, "47.50 - 20 - 5 + 5 = 27.50 explains the balance");

    assert.equal(await applyWalletBackfill(plan), plan.entries.length);
    assert.equal((await ledger(other.id)).length, 4);
    const second = await planWalletBackfill();
    assert.equal(second.entries.filter(e => e.userId === other.id).length, 0);
    assert.equal(await applyWalletBackfill(second), 0);

    await db.update(users).set({ rentalBalance: "30.00" }).where(eq(users.id, other.id));
    const drift = (await planWalletBackfill()).drift.find(d => d.userId === other.id);
    assert.deepEqual(drift && [drift.balanceCents, drift.ledgerCents, drift.differenceCents], [3000, 2750, 250], "a balance the ledger cannot explain is reported, not papered over");
  } finally {
    await db.delete(walletTransactions).where(eq(walletTransactions.userId, other.id));
    await db.delete(rentalPayouts).where(eq(rentalPayouts.userId, other.id));
    await db.delete(users).where(eq(users.id, other.id));
  }
});

test("the claim-award tests' counterpart: a settled operation that was credited is backfilled under the live key", async () => {
  const [request] = await db.insert(itemRequests).values({ itemId, requesterId: borrowerId, requestType: "BORROW", status: "COMPLETED", paymentCurrency: "cad" } as any).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  const [claim] = await db.insert(securityClaims).values({
    requestId: request.id, ownerId, borrowerId, claimType: "damage", status: "SETTLED", reason: "x", evidence: ["e"], requestedAmount: "30.00", approvedAmount: "30.00",
  }).returning();
  await db.insert(depositSettlementOperations).values({
    claimId: claim.id, requestId: request.id, operationKey: `${unique}-op`, status: "SETTLED", approvedAmount: "30.00", retainedAmount: "30.00",
    walletCreditedAmount: "30.00", walletCreditedAt: new Date("2026-11-05T00:00:00Z"),
  });
  try {
    const plan = await planWalletBackfill();
    const entry = plan.entries.find(e => e.claimId === claim.id)!;
    assert.deepEqual([entry.kind, entry.amountCents, entry.currency, entry.idempotencyKey], ["claim_award", 3000, "cad", `claim-award-${claim.id}`]);
  } finally {
    await db.delete(depositSettlementOperations).where(eq(depositSettlementOperations.requestId, request.id));
    await db.delete(securityClaims).where(eq(securityClaims.id, claim.id));
  }
});
