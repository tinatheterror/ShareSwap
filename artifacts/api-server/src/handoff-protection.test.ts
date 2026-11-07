import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, notifications, pool, rentalPayouts, requestLifecycleEvents, users, walletTransactions } from "@workspace/db";
import { sendBorrowerHandoffReminders } from "./handoff-reminders.js";
import { freezeRentalEarnings, resolveFrozenRentalEarnings } from "./rental-earnings-freeze.js";
import { recordWalletEntry, rentalEarningKey } from "./wallet-ledger.js";

const unique = `handoff-protection-${Date.now()}`;
const HOUR = 3_600_000;
const NOW = new Date("2026-11-10T12:00:00.000Z");
let ownerId: number;
let borrowerId: number;
let itemId: number;
const requestIds: number[] = [];

before(async () => {
  const inserted = await db.insert(users).values([{ username: `${unique}-owner` }, { username: `${unique}-borrower` }]).returning();
  ownerId = inserted[0].id;
  borrowerId = inserted[1].id;
  const [item] = await db.insert(items).values({ ownerId, name: `${unique}-item`, description: "handoff protection test", conditionRating: 5, photos: [], shareCoinsReward: "0" }).returning();
  itemId = item.id;
});

after(async () => {
  await db.delete(notifications).where(inArray(notifications.userId, [ownerId, borrowerId]));
  await db.delete(walletTransactions).where(eq(walletTransactions.userId, ownerId));
  await db.delete(rentalPayouts).where(eq(rentalPayouts.userId, ownerId));
  if (requestIds.length) {
    await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, requestIds));
    await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
  }
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(inArray(users.id, [ownerId, borrowerId]));
  await pool.end();
});

async function awaitingRequest(deadlineInHours: number, over: Record<string, unknown> = {}) {
  const [request] = await db.insert(itemRequests).values({
    itemId, requesterId: borrowerId, requestType: "RENT", status: "AWAITING_HANDOFF_CONFIRM", paymentCurrency: "cad",
    ownerConfirmedHandoff: true, borrowerConfirmedHandoff: false, handoffConfirmDeadline: new Date(NOW.getTime() + deadlineInHours * HOUR), ...over,
  } as any).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return request.id;
}
const reminders = (requestId: number) => db.select().from(notifications).where(and(eq(notifications.requestId, requestId), eq(notifications.type, "handoff_reminder")));
const at = (hoursBeforeDeadline: number, deadlineInHours: number) => new Date(NOW.getTime() + (deadlineInHours - hoursBeforeDeadline) * HOUR);

test("the borrower is reminded once at 12 hours and once at 2 hours before the auto-confirm, never earlier", async () => {
  const id = await awaitingRequest(24);
  const only = { onlyRequestIds: [id] };
  assert.equal(await sendBorrowerHandoffReminders(NOW, only), 0, "24 hours left: too early");
  assert.equal(await sendBorrowerHandoffReminders(at(12, 24), only), 1);
  assert.equal(await sendBorrowerHandoffReminders(at(11, 24), only), 0, "the 12 hour reminder is not repeated");
  assert.equal(await sendBorrowerHandoffReminders(at(2, 24), only), 1);
  assert.equal(await sendBorrowerHandoffReminders(at(1, 24), only), 0);
  const sent = await reminders(id);
  assert.equal(sent.length, 2);
  assert.ok(sent.every(n => n.userId === borrowerId));
  assert.match(sent.map(n => n.message).join("|"), /within 12 hours.*\|.*within 2 hours/);
});

test("a request first seen with under 2 hours left gets only the 2 hour reminder, and the 12 hour one never follows", async () => {
  const id = await awaitingRequest(1);
  assert.equal(await sendBorrowerHandoffReminders(NOW, { onlyRequestIds: [id] }), 1);
  assert.equal(await sendBorrowerHandoffReminders(new Date(NOW.getTime() + 1000), { onlyRequestIds: [id] }), 0);
  assert.equal((await reminders(id)).length, 1);
  assert.match((await reminders(id))[0].message, /within 2 hours/);
});

test("no reminder when the borrower already confirmed or denied, when the owner has not confirmed, or after the deadline", async () => {
  const confirmed = await awaitingRequest(10, { borrowerConfirmedHandoff: true });
  const denied = await awaitingRequest(10, { borrowerDeniedHandoff: true });
  const ownerSilent = await awaitingRequest(10, { ownerConfirmedHandoff: false });
  const past = await awaitingRequest(-1);
  assert.equal(await sendBorrowerHandoffReminders(NOW, { onlyRequestIds: [confirmed, denied, ownerSilent, past] }), 0);
});

async function releasedRental(net: string, balance: string, currency = "cad") {
  const requestId = await awaitingRequest(0, { status: "IN_PROGRESS", paymentCurrency: currency, handoffAutoAdvanced: true });
  const [payout] = await db.insert(rentalPayouts).values({ userId: ownerId, requestId, amount: net, rentalAmount: net, netAmount: net, status: "released" }).returning();
  await recordWalletEntry(db, {
    userId: ownerId, kind: "rental_payout", amountCents: Math.round(Number(net) * 100), currency, requestId, rentalPayoutId: payout.id, idempotencyKey: rentalEarningKey(payout.id),
  });
  await db.update(users).set({ rentalBalance: balance, pendingRentalBalance: "0.00" }).where(eq(users.id, ownerId));
  return { requestId, payoutId: payout.id };
}
const wallet = async () => {
  const [row] = await db.select({ b: users.rentalBalance, p: users.pendingRentalBalance }).from(users).where(eq(users.id, ownerId));
  return { balance: Math.round(Number(row.b) * 100), pending: Math.round(Number(row.p) * 100) };
};
const ledgerSum = async () => (await db.select().from(walletTransactions).where(eq(walletTransactions.userId, ownerId))).reduce((t, r) => t + r.amountCents, 0);
const payoutStatus = async (id: number) => (await db.select({ s: rentalPayouts.status }).from(rentalPayouts).where(eq(rentalPayouts.id, id)))[0].s;

test("freezing holds only that rental's earnings: the rest of the wallet stays available, and the ledger keeps matching", async () => {
  await db.delete(walletTransactions).where(eq(walletTransactions.userId, ownerId));
  const { requestId, payoutId } = await releasedRental("95.00", "150.00");
  const result = await freezeRentalEarnings(requestId);
  assert.deepEqual([result?.frozenCents, result?.shortfallCents], [9500, 0]);
  assert.deepEqual(await wallet(), { balance: 5500, pending: 9500 });
  assert.equal(await payoutStatus(payoutId), "frozen");
  assert.equal(await freezeRentalEarnings(requestId), null, "freezing twice does nothing");
  assert.deepEqual(await wallet(), { balance: 5500, pending: 9500 });
});

test("if part of the earnings was already withdrawn, only what is left is frozen and the shortfall is recorded", async () => {
  await db.delete(walletTransactions).where(eq(walletTransactions.userId, ownerId));
  const { requestId } = await releasedRental("95.00", "40.00");
  const result = await freezeRentalEarnings(requestId);
  assert.deepEqual([result?.frozenCents, result?.shortfallCents], [4000, 5500]);
  assert.deepEqual(await wallet(), { balance: 0, pending: 4000 });
  const [event] = await db.select().from(requestLifecycleEvents).where(and(eq(requestLifecycleEvents.requestId, requestId), eq(requestLifecycleEvents.eventType, "RENTAL_EARNINGS_FROZEN")));
  assert.deepEqual((event.details as any).shortfallCents, 5500);
});

test("the owner winning returns the frozen earnings; the borrower winning reverses them; neither can be done twice", async () => {
  await db.delete(walletTransactions).where(eq(walletTransactions.userId, ownerId));
  const won = await releasedRental("50.00", "50.00");
  await freezeRentalEarnings(won.requestId);
  assert.equal(await ledgerSum(), 5000 - 5000, "earning minus freeze");
  assert.deepEqual(await resolveFrozenRentalEarnings(won.requestId, "owner"), { payoutId: won.payoutId, frozenCents: 5000, shortfallCents: 0 });
  assert.deepEqual(await wallet(), { balance: 5000, pending: 0 });
  assert.equal(await ledgerSum(), 5000);
  assert.equal(await payoutStatus(won.payoutId), "released");
  assert.equal(await resolveFrozenRentalEarnings(won.requestId, "owner"), null);

  const lost = await releasedRental("30.00", "30.00");
  await freezeRentalEarnings(lost.requestId);
  await resolveFrozenRentalEarnings(lost.requestId, "borrower");
  assert.deepEqual(await wallet(), { balance: 0, pending: 0 });
  assert.equal(await payoutStatus(lost.payoutId), "reversed");
  assert.equal(await resolveFrozenRentalEarnings(lost.requestId, "borrower"), null);
  assert.equal(await resolveFrozenRentalEarnings(lost.requestId, "owner"), null);
});
