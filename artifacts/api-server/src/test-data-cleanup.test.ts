import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, notifications, pool, rentalPayouts, requestLifecycleEvents, users, walletTransactions } from "@workspace/db";
import { planTestDataCleanup, runTestDataCleanup } from "./test-data-cleanup.js";
import { fakeStripe } from "./test-fixtures/fake-stripe.js";
import { recordWalletEntry } from "./wallet-ledger.js";

const unique = `usd-cleanup-${Date.now()}`;
let failCancel = false;
const stripe = fakeStripe({ failCancel: () => failCancel });
let ownerId: number;
let otherOwnerId: number;
let borrowerId: number;
const itemIds: number[] = [];
const requestIds: number[] = [];

const ids = {} as Record<"hold" | "pending" | "inPerson" | "done" | "cad", number>;
const itemOf = {} as Record<string, number>;
let holdPayoutId: number;

async function request(name: keyof typeof ids, values: Record<string, unknown>, itemOwnerId: number = ownerId) {
  const [item] = await db.insert(items).values({ ownerId: itemOwnerId, name: `${unique}-${name}`, description: "usd cleanup test", conditionRating: 4, photos: [], isAvailable: false, shareCoinsReward: "0" }).returning({ id: items.id });
  itemIds.push(item.id);
  itemOf[name] = item.id;
  const [row] = await db.insert(itemRequests).values({ itemId: item.id, requesterId: borrowerId, requestType: "RENT", ...values } as any).returning({ id: itemRequests.id });
  requestIds.push(row.id);
  ids[name] = row.id;
}
const scope = () => ({ onlyRequestIds: Object.values(ids), onlyUserIds: [ownerId, otherOwnerId] });
const status = async (id: number) => (await db.select({ s: itemRequests.status }).from(itemRequests).where(eq(itemRequests.id, id)))[0].s;
const wallet = async (id: number) => {
  const [row] = await db.select({ b: users.rentalBalance, p: users.pendingRentalBalance }).from(users).where(eq(users.id, id));
  return { balance: Math.round(Number(row.b) * 100), pending: Math.round(Number(row.p) * 100) };
};
const ledgerSum = async (id: number) => (await db.select().from(walletTransactions).where(eq(walletTransactions.userId, id))).reduce((t, r) => t + r.amountCents, 0);

async function seed() {
  await db.delete(walletTransactions).where(inArray(walletTransactions.userId, [ownerId, otherOwnerId]));
  await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, requestIds.length ? requestIds : [0]));
  if (requestIds.length) {
    await db.delete(rentalPayouts).where(inArray(rentalPayouts.requestId, requestIds));
    await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    requestIds.length = 0;
  }
  if (itemIds.length) {
    await db.delete(items).where(inArray(items.id, itemIds));
    itemIds.length = 0;
  }
  await request("hold", { status: "IN_PROGRESS", paymentCurrency: "usd", depositMethod: "in_app", depositMode: "authorization", depositStatus: "held", depositPaymentIntentId: `pi_${unique}_hold`, trustDepositAmount: "10.00" });
  await request("pending", { status: "PENDING", paymentCurrency: "usd" });
  await request("inPerson", { status: "IN_PROGRESS", paymentCurrency: "usd", depositMethod: "in_person" });
  await request("done", { status: "COMPLETED", paymentCurrency: "usd" });
  await request("cad", { status: "IN_PROGRESS", paymentCurrency: "cad", depositMethod: "in_app", depositMode: "authorization", depositStatus: "held", depositPaymentIntentId: `pi_${unique}_cad` }, otherOwnerId);
  const [payout] = await db.insert(rentalPayouts).values({ userId: ownerId, requestId: ids.hold, amount: "20", rentalAmount: "20", netAmount: "20.00", status: "held" }).returning();
  holdPayoutId = payout.id;
  await db.update(users).set({ rentalBalance: "50.00", pendingRentalBalance: "20.00" }).where(eq(users.id, ownerId));
  await db.update(users).set({ rentalBalance: "10.00", pendingRentalBalance: "0.00" }).where(eq(users.id, otherOwnerId));
  await recordWalletEntry(db, { userId: ownerId, kind: "rental_payout", amountCents: 5000, currency: "usd", idempotencyKey: `${unique}-ledger-${Date.now()}` });
  await recordWalletEntry(db, { userId: otherOwnerId, kind: "rental_payout", amountCents: 1000, currency: "cad", idempotencyKey: `${unique}-ledger-cad-${Date.now()}` });
  failCancel = false;
  stripe.intentStatus.clear();
}

before(async () => {
  const inserted = await db.insert(users).values([{ username: `${unique}-owner` }, { username: `${unique}-other` }, { username: `${unique}-borrower` }]).returning();
  [ownerId, otherOwnerId, borrowerId] = inserted.map(u => u.id);
});

after(async () => {
  await db.delete(walletTransactions).where(inArray(walletTransactions.userId, [ownerId, otherOwnerId]));
  if (requestIds.length) {
    await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, requestIds));
    await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
    await db.delete(rentalPayouts).where(inArray(rentalPayouts.requestId, requestIds));
    await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
  }
  if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
  await db.delete(users).where(inArray(users.id, [ownerId, otherOwnerId, borrowerId]));
  await pool.end();
});

test("the dry run lists what would change, reads Stripe without changing anything, and touches nothing", async () => {
  await seed();
  const out = await runTestDataCleanup(stripe.client as any, { live: false, scope: scope() });
  assert.equal(out.mode, "dry-run");
  assert.deepEqual(out.plan.requests.map(r => [r.id, r.action]), [[ids.hold, "release_hold"], [ids.pending, "close_only"], [ids.inPerson, "close_only"]]);
  assert.equal(out.plan.requests[0].stripeIntentStatus, "requires_capture", "the hold's status is read from Stripe");
  assert.deepEqual(out.plan.users.map(u => [u.userId, u.balanceCents, u.pendingCents, u.skipped !== null]), [[ownerId, 5000, 2000, false], [otherOwnerId, 1000, 0, true]]);
  assert.match(out.plan.users[1].skipped!, /another currency/);
  assert.equal(out.plan.users[0].ledgerCents, 5000);
  assert.equal(stripe.calls.cancel.length, 0);
  assert.equal(stripe.calls.refunds.length, 0);
  assert.equal(await status(ids.hold), "IN_PROGRESS");
  assert.deepEqual(await wallet(ownerId), { balance: 5000, pending: 2000 });
});

test("live needs the hash of a plan that was shown, and refuses when anything changed since", async () => {
  await seed();
  const dry = await runTestDataCleanup(stripe.client as any, { live: false, scope: scope() });
  assert.match((await runTestDataCleanup(stripe.client as any, { live: true, scope: scope() })).refused!, /needs --confirm/);
  assert.match((await runTestDataCleanup(stripe.client as any, { live: true, confirm: "not-the-hash", scope: scope() })).refused!, /plan changed/);
  await db.update(users).set({ rentalBalance: "55.00" }).where(eq(users.id, ownerId));
  const stale = await runTestDataCleanup(stripe.client as any, { live: true, confirm: dry.plan.hash, scope: scope() });
  assert.match(stale.refused!, /plan changed/);
  assert.equal(await status(ids.hold), "IN_PROGRESS");
  assert.equal(stripe.calls.cancel.length, 0);
});

test("live closes the open USD requests, releases the hold with a stable key, zeroes the wallet with an adjustment row, and leaves CAD, finished and skipped data alone", async () => {
  await seed();
  const cancelsBefore = stripe.calls.cancel.length;
  const dry = await runTestDataCleanup(stripe.client as any, { live: false, scope: scope() });
  const live = await runTestDataCleanup(stripe.client as any, { live: true, confirm: dry.plan.hash, scope: scope() });
  assert.equal(live.refused, undefined);
  assert.deepEqual(live.result!.requests.map(r => [r.id, r.outcome]), [[ids.hold, "closed"], [ids.pending, "closed"], [ids.inPerson, "closed"]]);

  const cancels = stripe.calls.cancel.slice(cancelsBefore);
  assert.deepEqual(cancels.map(c => [c.id, c.options?.idempotencyKey]), [[`pi_${unique}_hold`, `test-cleanup-${ids.hold}-pi_${unique}_hold`]]);
  for (const name of ["hold", "pending", "inPerson"] as const) assert.equal(await status(ids[name]), "CANCELLED");
  const [closed] = await db.select().from(itemRequests).where(eq(itemRequests.id, ids.hold));
  assert.equal(closed.cancelReason, "test_data_cleanup");
  assert.equal(closed.depositStatus, "released");
  assert.equal(closed.depositOperationToken, null);
  assert.equal((await db.select({ s: rentalPayouts.status }).from(rentalPayouts).where(eq(rentalPayouts.id, holdPayoutId)))[0].s, "cancelled");
  assert.equal((await db.select({ a: items.isAvailable }).from(items).where(eq(items.id, itemOf.hold)))[0].a, true);

  assert.equal(await status(ids.done), "COMPLETED", "a finished request is left alone");
  assert.equal(await status(ids.cad), "IN_PROGRESS", "a CAD request is left alone");
  assert.equal((await db.select({ a: items.isAvailable }).from(items).where(eq(items.id, itemOf.cad)))[0].a, false);

  assert.deepEqual(await wallet(ownerId), { balance: 0, pending: 0 });
  const adjustment = (await db.select().from(walletTransactions).where(eq(walletTransactions.userId, ownerId))).find(r => r.kind === "adjustment")!;
  assert.deepEqual([adjustment.amountCents, adjustment.currency, adjustment.idempotencyKey], [-5000, "usd", `test-data-adjustment-${ownerId}`]);
  assert.equal(await ledgerSum(ownerId), 0, "the ledger still explains the (zero) balance");
  assert.deepEqual(live.result!.users.map(u => [u.userId, u.outcome]), [[ownerId, "zeroed"], [otherOwnerId, "skipped"]]);
  assert.deepEqual(await wallet(otherOwnerId), { balance: 1000, pending: 0 }, "the user with CAD activity is never zeroed");

  const again = await planTestDataCleanup(stripe.client as any, scope());
  assert.deepEqual(again.requests.map(r => r.id), [], "nothing is left to close");
  assert.deepEqual(again.users.map(u => u.userId), [otherOwnerId], "only the skipped user still has a balance");
});

test("if Stripe will not release a hold, that request stays open and the rest still close; running again finishes it", async () => {
  await seed();
  const dry = await runTestDataCleanup(stripe.client as any, { live: false, scope: scope() });
  failCancel = true;
  const first = await runTestDataCleanup(stripe.client as any, { live: true, confirm: dry.plan.hash, scope: scope() });
  failCancel = false;
  assert.deepEqual(first.result!.requests.map(r => [r.id, r.outcome]), [[ids.hold, "failed"], [ids.pending, "closed"], [ids.inPerson, "closed"]]);
  assert.match(first.result!.requests[0].detail, /left open/);
  assert.equal(await status(ids.hold), "IN_PROGRESS");
  assert.equal((await db.select({ t: itemRequests.depositOperationToken }).from(itemRequests).where(eq(itemRequests.id, ids.hold)))[0].t, null, "the fence is released for the retry");

  const retryDry = await runTestDataCleanup(stripe.client as any, { live: false, scope: scope() });
  const second = await runTestDataCleanup(stripe.client as any, { live: true, confirm: retryDry.plan.hash, scope: scope() });
  assert.deepEqual(second.result!.requests.map(r => [r.id, r.outcome]), [[ids.hold, "closed"]]);
  assert.equal(await status(ids.hold), "CANCELLED");
});
