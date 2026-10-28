import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, rentalPayouts, shareCoinsTransactions, users } from "@workspace/db";
import { processHandoffDeadlines, type HandoffDeadlineDeps } from "./handoff-deadline-service.js";
import { findStrandedHeldPayouts, releaseHeldRentalPayout, releaseStrandedRentalPayouts } from "./rental-payout-service.js";

// Rental earnings are released at handoff. Every way a rental can reach IN_PROGRESS must do that:
// the manual and PIN confirmations (rental-handoff-release.test.ts) and the auto-confirm sweep (here),
// and a payout any of them missed is released by the recovery pass.

const UNIQUE = `rental-auto-release-${Date.now()}`;
const HOUR = 3_600_000;
const requestIds: number[] = [];
const itemIds: number[] = [];
const userIds: number[] = [];
let ownerId: number;
let borrowerId: number;

const deps: HandoffDeadlineDeps = { onSwapAutoConfirmed: async () => {} };
const sweep = (ids: number[]) => processHandoffDeadlines(deps, { onlyRequestIds: ids });

async function rental(opts: { type?: string; status?: string; held?: boolean; handedOff?: boolean; rentalAmount?: string | null } = {}) {
  const [item] = await db.insert(items).values({
    ownerId, name: `${UNIQUE}-item-${itemIds.length}`, description: "x", conditionRating: 4, photos: [], isRentable: true, isAvailable: true,
    replacementValue: 100, securityDeposit: "10.00", lendingDuration: 7, shareCoinsReward: "0", shareCoinPrice: "7.00",
  }).returning({ id: items.id });
  itemIds.push(item.id);
  const handedOff = opts.handedOff ?? false;
  const [request] = await db.insert(itemRequests).values({
    itemId: item.id, requesterId: borrowerId, requestType: opts.type ?? "RENT", status: opts.status ?? "AWAITING_HANDOFF_CONFIRM",
    startDate: new Date("2026-10-01T00:00:00.000Z"), endDate: new Date("2026-10-08T00:00:00.000Z"),
    ownerConfirmedHandoff: true, borrowerConfirmedHandoff: handedOff,
    handoffConfirmDeadline: new Date(Date.now() - HOUR),
    handoffConfirmedAt: handedOff ? new Date() : null,
    rentalAmount: opts.rentalAmount === undefined ? "100.00" : opts.rentalAmount,
  } as any).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  if (opts.held !== false) {
    await db.insert(rentalPayouts).values({
      userId: ownerId, requestId: request.id, amount: "100.00", rentalAmount: "100.00", platformFee: "5.00", processingFee: "0.00",
      netAmount: "95.00", status: "held",
    });
  }
  return { requestId: request.id, itemId: item.id };
}

const wallet = async () => (await db.select({ available: users.rentalBalance, pending: users.pendingRentalBalance }).from(users).where(eq(users.id, ownerId)))[0];
const resetWallet = (pending: string) => db.update(users).set({ rentalBalance: "0.00", pendingRentalBalance: pending }).where(eq(users.id, ownerId));
const payout = async (requestId: number) => (await db.select().from(rentalPayouts).where(eq(rentalPayouts.requestId, requestId)))[0];
const status = async (requestId: number) => (await db.select({ s: itemRequests.status }).from(itemRequests).where(eq(itemRequests.id, requestId)))[0].s;

before(async () => {
  const [owner, borrower] = await db.insert(users).values([
    { username: `${UNIQUE}-owner`, password: "x", emailVerified: true },
    { username: `${UNIQUE}-borrower`, password: "x", emailVerified: true, shareCoins: "50.00" },
  ]).returning({ id: users.id });
  ownerId = owner.id;
  borrowerId = borrower.id;
  userIds.push(owner.id, borrower.id);
});

after(async () => {
  try {
    if (requestIds.length) {
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
      await db.delete(rentalPayouts).where(inArray(rentalPayouts.requestId, requestIds));
      await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    }
    if (userIds.length) await db.delete(notifications).where(inArray(notifications.userId, userIds));
    if (userIds.length) await db.delete(shareCoinsTransactions).where(inArray(shareCoinsTransactions.userId, userIds));
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    await pool.end();
  }
});

test("auto-confirming a rental releases the owner's held earnings, once", async () => {
  await resetWallet("95.00");
  const { requestId } = await rental();
  const result = await sweep([requestId]);
  assert.equal(result.autoAdvancedCount, 1);
  assert.equal(await status(requestId), "IN_PROGRESS");
  assert.deepEqual(await wallet(), { available: "95.00", pending: "0.00" });
  const row = await payout(requestId);
  assert.equal(row.status, "released");
  assert.ok(row.releasedAt);
  const notes = await db.select().from(notifications).where(eq(notifications.requestId, requestId));
  assert.ok(notes.some((n) => n.userId === ownerId && n.type === "payment_received"), "the owner is told the money is ready");

  // Sweeping again finds nothing to advance and credits nothing more.
  assert.equal((await sweep([requestId])).autoAdvancedCount, 0);
  assert.deepEqual(await wallet(), { available: "95.00", pending: "0.00" });
});

test("two sweeps racing over the same rental credit it once", async () => {
  await resetWallet("95.00");
  const { requestId } = await rental();
  const results = await Promise.all([sweep([requestId]), sweep([requestId]), sweep([requestId])]);
  assert.equal(results.reduce((n, r) => n + r.autoAdvancedCount, 0), 1);
  assert.deepEqual(await wallet(), { available: "95.00", pending: "0.00" });
  assert.equal((await payout(requestId)).status, "released");
});

test("a rental with no held payout still auto-confirms and credits nothing; a borrow is untouched", async () => {
  await resetWallet("0.00");
  const noPayout = await rental({ held: false });
  const borrow = await rental({ type: "BORROW", held: false, rentalAmount: null });
  const result = await sweep([noPayout.requestId, borrow.requestId]);
  assert.equal(result.autoAdvancedCount, 2);
  assert.equal(await status(noPayout.requestId), "IN_PROGRESS");
  assert.equal(await status(borrow.requestId), "IN_PROGRESS");
  assert.deepEqual(await wallet(), { available: "0.00", pending: "0.00" });
});

test("a dry run advances nothing and releases nothing", async () => {
  await resetWallet("95.00");
  const { requestId } = await rental();
  const result = await processHandoffDeadlines(deps, { onlyRequestIds: [requestId], dryRun: true });
  assert.equal(result.candidates.length, 1);
  assert.equal(await status(requestId), "AWAITING_HANDOFF_CONFIRM");
  assert.equal((await payout(requestId)).status, "held");
  assert.deepEqual(await wallet(), { available: "0.00", pending: "95.00" });
});

test("recovery releases a payout left held after the handoff, once, and a dry run only reports it", async () => {
  await resetWallet("95.00");
  const { requestId } = await rental({ status: "IN_PROGRESS", handedOff: true });
  assert.deepEqual((await findStrandedHeldPayouts({ onlyRequestIds: [requestId] })).map((r) => r.requestId), [requestId]);

  assert.deepEqual(await releaseStrandedRentalPayouts({ dryRun: true, onlyRequestIds: [requestId] }), { found: 1, released: 0 });
  assert.deepEqual(await wallet(), { available: "0.00", pending: "95.00" });

  assert.deepEqual(await releaseStrandedRentalPayouts({ onlyRequestIds: [requestId] }), { found: 1, released: 1 });
  assert.deepEqual(await wallet(), { available: "95.00", pending: "0.00" });
  assert.deepEqual(await releaseStrandedRentalPayouts({ onlyRequestIds: [requestId] }), { found: 0, released: 0 });
  assert.deepEqual(await wallet(), { available: "95.00", pending: "0.00" });
});

test("recovery leaves alone a rental still awaiting handoff, and one that was cancelled", async () => {
  await resetWallet("190.00");
  const waiting = await rental();
  const cancelled = await rental({ status: "CANCELLED", handedOff: true });
  const ids = [waiting.requestId, cancelled.requestId];
  assert.deepEqual(await findStrandedHeldPayouts({ onlyRequestIds: ids }), []);
  assert.deepEqual(await releaseStrandedRentalPayouts({ onlyRequestIds: ids }), { found: 0, released: 0 });
  assert.equal((await payout(waiting.requestId)).status, "held");
  assert.equal((await payout(cancelled.requestId)).status, "held");
  assert.deepEqual(await wallet(), { available: "0.00", pending: "190.00" });
});

test("recovery leaves alone a disputed or flagged rental, whose payout an admin decides", async () => {
  await resetWallet("285.00");
  const ids: number[] = [];
  for (const s of ["DISPUTED", "HANDOFF_DISPUTED", "HANDOFF_FLAGGED"]) ids.push((await rental({ status: s, handedOff: true })).requestId);
  assert.deepEqual(await findStrandedHeldPayouts({ onlyRequestIds: ids }), []);
  assert.deepEqual(await releaseStrandedRentalPayouts({ onlyRequestIds: ids }), { found: 0, released: 0 });
  for (const id of ids) assert.equal((await payout(id)).status, "held");
  assert.deepEqual(await wallet(), { available: "0.00", pending: "285.00" });
});

test("recovery racing the auto-confirm sweep still credits once", async () => {
  await resetWallet("95.00");
  const { requestId } = await rental();
  await Promise.all([sweep([requestId]), releaseStrandedRentalPayouts({ onlyRequestIds: [requestId] }), releaseStrandedRentalPayouts({ onlyRequestIds: [requestId] })]);
  await releaseStrandedRentalPayouts({ onlyRequestIds: [requestId] });
  assert.deepEqual(await wallet(), { available: "95.00", pending: "0.00" });
  assert.equal((await payout(requestId)).status, "released");
});

test("releasing a payout that is already released is quiet: no error is logged, nothing is credited", async () => {
  await resetWallet("95.00");
  const { requestId, itemId } = await rental({ status: "IN_PROGRESS", handedOff: true });
  const args = { requestId, ownerId, itemId, itemName: "Test", logTag: "Test" };
  assert.equal(await releaseHeldRentalPayout(args), true);

  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  try {
    assert.equal(await releaseHeldRentalPayout(args), false);
  } finally {
    console.error = original;
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(await wallet(), { available: "95.00", pending: "0.00" });
});

test("a request that never had a held payout is still logged as an error", async () => {
  const { requestId, itemId } = await rental({ held: false });
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  try {
    assert.equal(await releaseHeldRentalPayout({ requestId, ownerId, itemId, itemName: "Test", logTag: "Test" }), false);
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
});
