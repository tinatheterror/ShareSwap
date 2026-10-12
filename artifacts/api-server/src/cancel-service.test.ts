import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  itemRequests,
  items,
  messages,
  notifications,
  pool,
  rentalPayouts,
  reputationActivities,
  users,
} from "@workspace/db";
import {
  cancelBorrowRentRequest,
  cancelPenaltyApplies,
  classifyDepositState,
  type CancelDeps,
} from "./cancel-service.js";
import { ensureCancellationRecord } from "./startup-migrations.js";
import { fakeStripe, noStripeCalls } from "./test-fixtures/fake-stripe.js";

const NOW = new Date("2026-10-03T19:00:00.000Z");
const UNIQUE = `cancel-service-${Date.now()}`;
const requestIds: number[] = [];
const itemIds: number[] = [];
const userIds: number[] = [];

async function newUser(label: string, reputationScore = 80) {
  const [user] = await db
    .insert(users)
    .values({
      username: `${UNIQUE}-${label}-${userIds.length}`,
      password: "x",
      emailVerified: true,
      reputationScore,
      reputationLevel: "Neighbour",
      pendingRentalBalance: "0.00",
    })
    .returning({ id: users.id });
  userIds.push(user.id);
  return user.id;
}

async function newRequest(
  ownerId: number,
  borrowerId: number,
  overrides: Partial<typeof itemRequests.$inferInsert> = {},
) {
  const [item] = await db
    .insert(items)
    .values({
      ownerId,
      name: `${UNIQUE}-item-${itemIds.length}`,
      description: "Cancel test item",
      conditionRating: 4,
      photos: [],
      isLendable: true,
      isRentable: true,
      isAvailable: false,
      replacementValue: 100,
      securityDeposit: "10.00",
      lendingDuration: 7,
      shareCoinsReward: "0",
      shareCoinPrice: "7.00",
    })
    .returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db
    .insert(itemRequests)
    .values({
      itemId: item.id,
      requesterId: borrowerId,
      requestType: "BORROW",
      status: "PENDING",
      startDate: new Date("2026-10-05T00:00:00.000Z"),
      endDate: new Date("2026-10-08T00:00:00.000Z"),
      depositMethod: "in_app",
      ...overrides,
    })
    .returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return { id: request.id, itemId: item.id };
}

/** A BORROW whose in-app hold is placed. */
const withHold = (overrides: Partial<typeof itemRequests.$inferInsert> = {}): Partial<typeof itemRequests.$inferInsert> => ({
  status: "DEPOSIT_CONFIRMED",
  depositPaymentIntentId: "pi_deposit_hold",
  depositStatus: "authorized",
  depositMode: "authorization",
  trustDepositAmount: "42.00",
  ...overrides,
});

const deps = (stripe: ReturnType<typeof fakeStripe>, extra: Partial<CancelDeps> = {}): CancelDeps => ({
  stripe: stripe.client as any,
  ...extra,
});

async function load(id: number) {
  const [row] = await db.select().from(itemRequests).where(eq(itemRequests.id, id));
  return row;
}
const score = async (userId: number) => {
  const [row] = await db.select({ s: users.reputationScore, l: users.reputationLevel }).from(users).where(eq(users.id, userId));
  return row;
};
const activities = (userId: number, requestId: number) =>
  db.select().from(reputationActivities).where(and(eq(reputationActivities.userId, userId), eq(reputationActivities.requestId, requestId)));
const notes = (requestId: number) => db.select().from(notifications).where(eq(notifications.requestId, requestId));
const chat = (requestId: number) => db.select().from(messages).where(eq(messages.requestId, requestId));
const itemFree = async (itemId: number) => (await db.select({ a: items.isAvailable }).from(items).where(eq(items.id, itemId)))[0].a;

before(async () => {
  // users are created per test so scores never leak between them
  await ensureCancellationRecord();
});

after(async () => {
  if (requestIds.length) {
    await db.delete(rentalPayouts).where(inArray(rentalPayouts.requestId, requestIds));
    await db.delete(reputationActivities).where(inArray(reputationActivities.requestId, requestIds));
    await db.delete(messages).where(inArray(messages.requestId, requestIds));
    await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
    await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
  }
  if (userIds.length) {
    await db.delete(reputationActivities).where(inArray(reputationActivities.userId, userIds));
    await db.delete(notifications).where(inArray(notifications.userId, userIds));
  }
  if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

// ── The rule, as a pure function of deposit state ─────────────────────────────

test("the deposit state comes from the deposit fields, not the request status", () => {
  const base = { status: "ACCEPTED", depositMethod: "in_app", depositPaymentIntentId: null, depositStatus: null, depositMode: null } as const;
  assert.equal(classifyDepositState({ ...base, status: "PENDING" }), "none");
  assert.equal(classifyDepositState(base), "unpaid");
  assert.equal(classifyDepositState({ ...base, depositMethod: "in_person" }), "in_person");
  assert.equal(classifyDepositState({ ...base, depositPaymentIntentId: "pi_x", depositStatus: "authorized" }), "authorized");
  // Same status, different deposit: a status alone never decides.
  assert.equal(classifyDepositState({ ...base, status: "DEPOSIT_CONFIRMED", depositMethod: "in_person" }), "in_person");
  assert.equal(classifyDepositState({ ...base, depositPaymentIntentId: "pi_x", depositStatus: "held", depositMode: "refundable_charge" }), "charged");
  // A hold that was already released, or failed, is not a deposit.
  assert.equal(classifyDepositState({ ...base, depositPaymentIntentId: "pi_x", depositStatus: "released" }), "unpaid");
  for (const state of ["none", "in_person", "unpaid"] as const) assert.equal(cancelPenaltyApplies(state), false);
  for (const state of ["authorized", "charged"] as const) assert.equal(cancelPenaltyApplies(state), true);
});

// ── Free cancels ──────────────────────────────────────────────────────────────

test("PENDING: cancels free, with no Stripe call, no penalty and the other person told", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const { id, itemId } = await newRequest(owner, borrower);
  const stripe = fakeStripe();

  const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower }, deps(stripe), NOW);

  assert.equal(result.status, 200);
  assert.equal(result.body.message, "Request cancelled.");
  assert.deepEqual((result.body.outcome as any), {
    deposit: "none", depositAmount: null, platformFeeRefunded: null, rentalRefunded: null,
    penaltyApplied: false, penaltyPoints: 0, newScore: null,
  });
  assert.deepEqual(stripe.calls, noStripeCalls);
  assert.equal((await load(id)).status, "CANCELLED");
  assert.equal(await itemFree(itemId), true);
  assert.deepEqual(await activities(borrower, id), []);
  assert.equal((await score(borrower)).s, 80);
  const toOwner = (await notes(id)).filter((n) => n.userId === owner);
  assert.deepEqual(toOwner.map((n) => n.type), ["request_cancelled"]);
  assert.match(toOwner[0].message, /the borrower cancelled the request/);
  const events = (await chat(id)).filter((m) => (m.metadata as any)?.eventType === "request_cancelled");
  assert.equal(events.length, 1);
  assert.equal((events[0].metadata as any).cancelledByRole, "requester");
});

test("ACCEPTED with no deposit paid is free: nothing was charged", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const { id } = await newRequest(owner, borrower, { status: "ACCEPTED" });
  const stripe = fakeStripe();

  const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower }, deps(stripe), NOW);

  assert.equal(result.status, 200);
  assert.equal(result.body.message, "Request cancelled. Nothing was charged.");
  assert.deepEqual(stripe.calls, noStripeCalls);
  assert.deepEqual(await activities(borrower, id), []);
});

test("an in-person BORROW cancels with no Stripe call and no penalty, even from DEPOSIT_CONFIRMED", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const { id } = await newRequest(owner, borrower, { status: "DEPOSIT_CONFIRMED", depositMethod: "in_person" });
  const stripe = fakeStripe();

  const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower }, deps(stripe), NOW);

  assert.equal(result.status, 200);
  assert.equal(result.body.message, "Request cancelled. No payment was involved.");
  assert.equal((result.body.outcome as any).deposit, "in_person");
  assert.deepEqual(stripe.calls, noStripeCalls);
  assert.deepEqual(await activities(borrower, id), []);
  assert.equal((await score(borrower)).s, 80);
  assert.equal((await load(id)).depositStatus, null);
});

// ── The penalty and its acknowledgment ────────────────────────────────────────

test("a placed hold needs the penalty acknowledged: the first call is a 409 that changes nothing", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const { id } = await newRequest(owner, borrower, withHold());
  const stripe = fakeStripe();

  const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower }, deps(stripe), NOW);

  assert.equal(result.status, 409);
  assert.deepEqual(result.body, {
    code: "PENALTY_ACK_REQUIRED",
    error: "A trust score penalty of -5 will be applied for this cancellation",
    penalty: { points: 5, type: "cancel_after_deposit" },
    depositState: "authorized",
    requestStatus: "DEPOSIT_CONFIRMED",
  });
  assert.deepEqual(stripe.calls, noStripeCalls);
  const row = await load(id);
  assert.equal(row.status, "DEPOSIT_CONFIRMED");
  assert.equal(row.depositOperationToken, null, "the lock is released so the next attempt can go through");
  assert.equal(row.depositRenewalStatus, null);
  assert.deepEqual(await activities(borrower, id), []);
  assert.deepEqual(await notes(id), []);
});

test("acknowledged: the hold is released (never captured), -5 is recorded with its history row and a score notification", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower", 80);
  const { id } = await newRequest(owner, borrower, withHold());
  const stripe = fakeStripe();

  const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(stripe), NOW);

  assert.equal(result.status, 200);
  assert.equal(result.body.alreadyCancelled, false);
  assert.deepEqual((result.body.outcome as any), {
    deposit: "hold_released", depositAmount: 42, platformFeeRefunded: null, rentalRefunded: null,
    penaltyApplied: true, penaltyPoints: 5, newScore: 75,
  });
  assert.equal(result.body.message, "Request cancelled. Your $42 temporary hold was released. You were not charged. A trust score penalty of -5 was applied.");
  assert.deepEqual((result.body.request as any).cancelledFromStatus, "DEPOSIT_CONFIRMED");

  assert.deepEqual(stripe.calls.cancel, [{ id: "pi_deposit_hold", options: { idempotencyKey: `cancel-${id}-pi_deposit_hold` } }]);
  assert.deepEqual(stripe.calls.capture, []);
  assert.deepEqual(stripe.calls.create, []);

  const row = await load(id);
  assert.equal(row.status, "CANCELLED");
  assert.equal(row.depositStatus, "released");
  assert.equal(row.depositOperationToken, null);
  assert.equal((await score(borrower)).s, 75);

  const [activity] = await activities(borrower, id);
  assert.equal(activity.activityType, "cancel_after_deposit");
  assert.equal(activity.points, -5);
  assert.match(activity.description ?? "", /Cancelled after a deposit was placed/);

  const trust = (await notes(id)).filter((n) => n.userId === borrower && n.type === "trust_score_changed");
  assert.equal(trust.length, 1);
  assert.equal(trust[0].title, "Trust Score -5");
  assert.equal(trust[0].message, "Cancelled after a deposit -5");
  assert.ok(trust[0].message.length <= 54);

  const released = (await chat(id)).filter((m) => (m.metadata as any)?.eventType === "deposit_released");
  assert.equal(released.length, 1);
  assert.match(released[0].content ?? "", /Deposit hold released/);
});

test("there is no grace pass: the very first cancel after a deposit still costs 5, and old -20 rows are left alone", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower", 80);
  const older = await newRequest(owner, borrower, { status: "CANCELLED" });
  await db.insert(reputationActivities).values({
    userId: borrower, activityType: "cancel_after_acceptance", points: -20, description: "old", requestId: older.id,
  });
  const { id } = await newRequest(owner, borrower, withHold());
  const stripe = fakeStripe();

  await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(stripe), NOW);

  assert.equal((await activities(borrower, id))[0].points, -5);
  assert.equal((await activities(borrower, id)).filter((a) => a.activityType === "grace_pass_warning").length, 0);
  const [old] = await activities(borrower, older.id);
  assert.equal(old.points, -20);
  assert.equal(old.activityType, "cancel_after_acceptance");
});

test("a deposit authorized between the tap and the request still triggers the 409", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const { id } = await newRequest(owner, borrower, { status: "ACCEPTED" });
  const stripe = fakeStripe();

  // The app showed a free cancel (ACCEPTED, nothing paid)... and the hold lands before the request does.
  await db.update(itemRequests).set(withHold()).where(eq(itemRequests.id, id));
  const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower }, deps(stripe), NOW);

  assert.equal(result.status, 409);
  assert.equal(result.body.code, "PENALTY_ACK_REQUIRED");
  assert.equal((await load(id)).status, "DEPOSIT_CONFIRMED");
  assert.deepEqual(stripe.calls, noStripeCalls);
});

test("a wrong acknowledgment (a different amount) is challenged again", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const { id } = await newRequest(owner, borrower, withHold());
  const stripe = fakeStripe();
  for (const bad of [0, 20, "yes", true, null]) {
    const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: bad }, deps(stripe), NOW);
    assert.equal(result.status, 409, `acknowledgePenalty=${String(bad)}`);
  }
  assert.equal((await load(id)).status, "DEPOSIT_CONFIRMED");
});

test("an acknowledgment is harmless when no penalty applies: a free cancel stays free", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const { id } = await newRequest(owner, borrower, { status: "ACCEPTED" });
  const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(fakeStripe()), NOW);
  assert.equal(result.status, 200);
  assert.equal((result.body.outcome as any).penaltyApplied, false);
  assert.deepEqual(await activities(borrower, id), []);
});

// ── Double cancel ─────────────────────────────────────────────────────────────

test("a second cancel does nothing: no second penalty, refund, notification or message", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower", 80);
  const { id } = await newRequest(owner, borrower, withHold({ platformFeeChargeId: "pi_platform_fee" }));
  const stripe = fakeStripe({ refundAmounts: { pi_platform_fee: 350 } });

  const first = await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(stripe), NOW);
  assert.equal(first.status, 200);
  const before = { notes: (await notes(id)).length, chat: (await chat(id)).length, refunds: stripe.calls.refunds.length, cancels: stripe.calls.cancel.length };

  for (const actor of [borrower, owner]) {
    const again = await cancelBorrowRentRequest({ requestId: id, actorId: actor, acknowledgePenalty: 5 }, deps(stripe), NOW);
    assert.equal(again.status, 200);
    assert.equal(again.body.alreadyCancelled, true);
    assert.equal(again.body.outcome, null);
    assert.equal(again.body.message, "This request was already cancelled.");
  }

  assert.deepEqual(
    { notes: (await notes(id)).length, chat: (await chat(id)).length, refunds: stripe.calls.refunds.length, cancels: stripe.calls.cancel.length },
    before,
  );
  assert.equal((await activities(borrower, id)).length, 1);
  assert.equal((await score(borrower)).s, 75);
});

test("two cancels at once act once", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower", 80);
  const { id } = await newRequest(owner, borrower, withHold());
  const stripe = fakeStripe();

  const results = await Promise.all([
    cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(stripe), NOW),
    cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(stripe), NOW),
  ]);

  // One does the cancel; the other either sees it already cancelled (200) or backs off while it runs (409).
  for (const r of results) assert.ok(r.status === 200 || r.status === 409, `unexpected ${r.status}`);
  assert.equal(results.filter((r) => r.status === 200 && r.body.alreadyCancelled === false).length, 1);
  assert.equal(stripe.calls.cancel.length, 1);
  assert.equal((await activities(borrower, id)).length, 1);
  assert.equal((await score(borrower)).s, 75);
});

// ── Refunds: what exists is what is refunded ──────────────────────────────────

test("a waived-fee BORROW refunds only the deposit", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const { id } = await newRequest(owner, borrower, withHold({ platformFeeChargeId: null }));
  const stripe = fakeStripe();

  const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(stripe), NOW);

  assert.equal(result.status, 200);
  assert.deepEqual(stripe.calls.refunds, []);
  assert.deepEqual(stripe.calls.cancel.map((c) => c.id), ["pi_deposit_hold"]);
});

test("a BORROW with a platform fee refunds the fee as a payment_intent and releases the hold", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const { id } = await newRequest(owner, borrower, withHold({ platformFeeChargeId: "pi_platform_fee" }));
  const stripe = fakeStripe({ refundAmounts: { pi_platform_fee: 350 } });

  const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(stripe), NOW);

  assert.deepEqual(stripe.calls.refunds, [
    { params: { payment_intent: "pi_platform_fee" }, options: { idempotencyKey: `cancel-refund-${id}-pi_platform_fee` } },
  ]);
  assert.deepEqual(stripe.calls.cancel.map((c) => c.id), ["pi_deposit_hold"]);
  assert.equal((result.body.outcome as any).platformFeeRefunded, 3.5);
  assert.match(String(result.body.message), /Your \$3\.50 platform fee was refunded\. Refunds can take 5–10 days/);
});

test("RENT: the deposit hold, the platform fee and the rental payment are all given back, and the payout is voided", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  await db.update(users).set({ pendingRentalBalance: "9.50" }).where(eq(users.id, owner));
  const { id } = await newRequest(owner, borrower, withHold({ requestType: "RENT", platformFeeChargeId: "pi_platform_fee", trustDepositAmount: "30.00" }));
  await db.insert(rentalPayouts).values({
    userId: owner, requestId: id, amount: "10.00", rentalAmount: "10.00", netAmount: "9.50", status: "held", stripePaymentIntentId: "pi_rent_fee",
  });
  const stripe = fakeStripe({ refundAmounts: { pi_rent_fee: 1030, pi_platform_fee: 50 } });

  const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(stripe), NOW);

  assert.equal(result.status, 200);
  assert.deepEqual(stripe.calls.refunds.map((c) => c.params), [{ payment_intent: "pi_rent_fee" }, { payment_intent: "pi_platform_fee" }]);
  assert.deepEqual(stripe.calls.cancel.map((c) => c.id), ["pi_deposit_hold"]);
  assert.deepEqual(stripe.calls.capture, []);
  assert.deepEqual(
    [(result.body.outcome as any).rentalRefunded, (result.body.outcome as any).platformFeeRefunded, (result.body.outcome as any).depositAmount],
    [10.3, 0.5, 30],
  );
  const [payout] = await db.select().from(rentalPayouts).where(eq(rentalPayouts.requestId, id));
  assert.equal(payout.status, "cancelled");
  const [ownerRow] = await db.select({ p: users.pendingRentalBalance }).from(users).where(eq(users.id, owner));
  assert.equal(Number(ownerRow.p), 0);
});

test("a refundable-charge deposit is refunded in full, never cancelled or captured", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const { id } = await newRequest(owner, borrower, withHold({ depositMode: "refundable_charge", depositStatus: "held", depositPaymentIntentId: "pi_refundable" }));
  const stripe = fakeStripe();
  stripe.intentStatus.set("pi_refundable", "succeeded");

  const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(stripe), NOW);

  assert.equal(result.status, 200);
  assert.deepEqual(stripe.calls.refunds.map((c) => c.params), [{ payment_intent: "pi_refundable" }]);
  assert.deepEqual(stripe.calls.cancel, []);
  assert.deepEqual(stripe.calls.capture, []);
  assert.equal((result.body.outcome as any).deposit, "charge_refunded");
  assert.match(String(result.body.message), /Your \$42 refundable deposit was refunded to your card\./);
  assert.match((await chat(id)).find((m) => (m.metadata as any)?.eventType === "deposit_released")!.content ?? "", /Refundable deposit refunded/);
});

// ── A failed Stripe call changes nothing; the retry completes ─────────────────

test("the fee refund succeeds and the deposit release fails: nothing changes, then a retry completes", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower", 80);
  const { id } = await newRequest(owner, borrower, withHold({ platformFeeChargeId: "pi_platform_fee" }));
  let depositDown = true;
  const stripe = fakeStripe({ failCancel: () => depositDown });

  const failed = await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(stripe), NOW);

  assert.equal(failed.status, 502);
  assert.equal(failed.body.code, "REFUND_FAILED");
  assert.equal(failed.body.retryable, true);
  assert.equal(stripe.calls.refunds.length, 1, "the fee refund went out before the deposit release failed");
  const row = await load(id);
  assert.equal(row.status, "DEPOSIT_CONFIRMED");
  assert.equal(row.depositStatus, "authorized");
  assert.equal(row.depositOperationToken, null);
  assert.equal(row.depositRenewalStatus, null);
  assert.deepEqual(await activities(borrower, id), []);
  assert.equal((await score(borrower)).s, 80);
  assert.deepEqual(await notes(id), []);
  assert.deepEqual(await chat(id), []);

  depositDown = false;
  const retry = await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(stripe), NOW);

  assert.equal(retry.status, 200);
  assert.equal(stripe.calls.refunds.length, 2);
  assert.equal(stripe.calls.refunds[0].options?.idempotencyKey, stripe.calls.refunds[1].options?.idempotencyKey, "same key: Stripe replays instead of refunding twice");
  assert.deepEqual(stripe.calls.cancel.map((c) => c.id), ["pi_deposit_hold"]);
  assert.equal((await load(id)).status, "CANCELLED");
  assert.equal((await activities(borrower, id)).length, 1);
  assert.equal((await score(borrower)).s, 75);
});

test("a refund failure leaves everything unchanged too, and the retry goes through", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower", 80);
  const { id } = await newRequest(owner, borrower, withHold({ platformFeeChargeId: "pi_platform_fee" }));
  let down = true;
  const stripe = fakeStripe({ failRefund: () => down });

  const failed = await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(stripe), NOW);
  assert.equal(failed.status, 502);
  assert.equal(stripe.calls.cancel.length, 0, "the hold is untouched when the fee refund fails");
  assert.equal((await load(id)).status, "DEPOSIT_CONFIRMED");
  assert.deepEqual(await activities(borrower, id), []);

  down = false;
  assert.equal((await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(stripe), NOW)).status, 200);
});

// ── Owner cancel (option a) ───────────────────────────────────────────────────

test("an owner who cancels after the borrower's hold is penalised and the borrower is made whole", async () => {
  const owner = await newUser("owner", 120);
  const borrower = await newUser("borrower", 80);
  const { id } = await newRequest(owner, borrower, withHold({ platformFeeChargeId: "pi_platform_fee" }));
  const stripe = fakeStripe({ refundAmounts: { pi_platform_fee: 350 } });

  const challenged = await cancelBorrowRentRequest({ requestId: id, actorId: owner }, deps(stripe), NOW);
  assert.equal(challenged.status, 409);
  assert.equal(challenged.body.code, "PENALTY_ACK_REQUIRED");

  const result = await cancelBorrowRentRequest({ requestId: id, actorId: owner, acknowledgePenalty: 5 }, deps(stripe), NOW);

  assert.equal(result.status, 200);
  assert.equal((await score(owner)).s, 115);
  assert.equal((await score(borrower)).s, 80, "the borrower loses nothing");
  assert.deepEqual(stripe.calls.cancel.map((c) => c.id), ["pi_deposit_hold"]);
  assert.equal(stripe.calls.refunds.length, 1);
  assert.match(String(result.body.message), /^Request cancelled\. The borrower's \$42 temporary hold was released\. The borrower's \$3\.50 platform fee was refunded\. A trust score penalty of -5 was applied\.$/);
  const toBorrower = (await notes(id)).filter((n) => n.userId === borrower);
  assert.match(toBorrower[0].message, /the owner cancelled the request/);
  assert.equal((await chat(id)).find((m) => (m.metadata as any)?.eventType === "request_cancelled")!.senderId, owner);
  assert.equal((await activities(owner, id))[0].activityType, "cancel_after_deposit");
  assert.deepEqual(await activities(borrower, id), []);
});

test("an owner can cancel an accepted request before any deposit, free", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const { id } = await newRequest(owner, borrower, { status: "ACCEPTED" });
  const result = await cancelBorrowRentRequest({ requestId: id, actorId: owner }, deps(fakeStripe()), NOW);
  assert.equal(result.status, 200);
  assert.equal((result.body.outcome as any).penaltyApplied, false);
});

// ── Score floor and thresholds ────────────────────────────────────────────────

test("a -5 across a level threshold changes the level and says so in the notification", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower", 52);
  const { id } = await newRequest(owner, borrower, withHold());

  await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(fakeStripe()), NOW);

  const row = await score(borrower);
  assert.equal(row.s, 47);
  assert.equal(row.l, "Newcomer");
  const trust = (await notes(id)).find((n) => n.userId === borrower && n.type === "trust_score_changed")!;
  assert.equal(trust.message, "Cancelled after a deposit -5. Now Newcomer.");
  assert.ok(trust.message.length <= 54);
});

test("a -5 that does not cross a threshold leaves the level alone (and 98 -> 93 only affects future deposits)", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower", 98);
  const { id } = await newRequest(owner, borrower, withHold({ trustDiscountPercentage: 40 }));
  await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(fakeStripe()), NOW);
  assert.equal((await score(borrower)).s, 93);
  assert.equal((await load(id)).trustDiscountPercentage, 40, "the cancelled request keeps the discount it was priced with");
});

test("the floor: a -5 at score 3 records -3, and at score 0 writes no row and no notification but still cancels", async () => {
  const owner = await newUser("owner");
  const nearZero = await newUser("borrower", 3);
  const atZero = await newUser("borrower", 0);
  const a = await newRequest(owner, nearZero, withHold());
  const b = await newRequest(owner, atZero, withHold());

  const resultA = await cancelBorrowRentRequest({ requestId: a.id, actorId: nearZero, acknowledgePenalty: 5 }, deps(fakeStripe()), NOW);
  const resultB = await cancelBorrowRentRequest({ requestId: b.id, actorId: atZero, acknowledgePenalty: 5 }, deps(fakeStripe()), NOW);

  assert.equal((await activities(nearZero, a.id))[0].points, -3);
  assert.equal((await score(nearZero)).s, 0);
  assert.equal((resultA.body.outcome as any).penaltyPoints, 3);

  assert.equal(resultB.status, 200);
  assert.deepEqual(await activities(atZero, b.id), []);
  assert.deepEqual((await notes(b.id)).filter((n) => n.type === "trust_score_changed"), []);
  assert.equal((await load(b.id)).status, "CANCELLED");
  assert.equal((resultB.body.outcome as any).penaltyApplied, false);
  assert.doesNotMatch(String(resultB.body.message), /penalty/);
});

// ── Guards ────────────────────────────────────────────────────────────────────

test("HANDOFF_CONFIRMED, in-progress, expired and strangers are all refused without touching anything", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const stranger = await newUser("stranger");
  const stripe = fakeStripe();

  const handoff = await newRequest(owner, borrower, withHold({ status: "HANDOFF_CONFIRMED" }));
  const r1 = await cancelBorrowRentRequest({ requestId: handoff.id, actorId: borrower, acknowledgePenalty: 5 }, deps(stripe), NOW);
  assert.equal(r1.status, 409);
  assert.equal(r1.body.code, "HANDOFF_ALREADY_CONFIRMED");

  for (const status of ["IN_PROGRESS", "EXPIRED", "COMPLETED", "DECLINED"]) {
    const r = await newRequest(owner, borrower, { status });
    const res = await cancelBorrowRentRequest({ requestId: r.id, actorId: borrower }, deps(stripe), NOW);
    assert.equal(res.status, 400, status);
    assert.equal(res.body.code, "INVALID_STATUS");
    assert.equal(res.body.currentStatus, status);
  }

  const open = await newRequest(owner, borrower, withHold());
  assert.equal((await cancelBorrowRentRequest({ requestId: open.id, actorId: stranger, acknowledgePenalty: 5 }, deps(stripe), NOW)).status, 403);
  assert.equal((await cancelBorrowRentRequest({ requestId: 2_147_000_000, actorId: borrower }, deps(stripe), NOW)).status, 404);
  assert.equal((await load(open.id)).status, "DEPOSIT_CONFIRMED");
  assert.deepEqual(stripe.calls, noStripeCalls);
});

test("an unknown reason is rejected; a known one is accepted", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const { id } = await newRequest(owner, borrower);
  const bad = await cancelBorrowRentRequest({ requestId: id, actorId: borrower, reason: "because" }, deps(fakeStripe()), NOW);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "INVALID_REASON");
  assert.equal((await load(id)).status, "PENDING");
  assert.equal((await cancelBorrowRentRequest({ requestId: id, actorId: borrower, reason: "changed_plans" }, deps(fakeStripe()), NOW)).status, 200);
});

test("a deposit operation already in flight makes the cancel back off with BUSY", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const { id } = await newRequest(owner, borrower, withHold({ depositRenewalStatus: "terminal_action", depositOperationToken: "someone-else", depositOperationType: "capture" }));
  const stripe = fakeStripe();
  const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, deps(stripe), NOW);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "BUSY");
  assert.deepEqual(stripe.calls, noStripeCalls);
  assert.equal((await load(id)).status, "DEPOSIT_CONFIRMED");
});

test("the item is freed and availability subscribers and the other person are told after the commit", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const { id, itemId } = await newRequest(owner, borrower, { status: "ACCEPTED" });
  const freed: number[] = [];
  const pushed: number[] = [];
  const result = await cancelBorrowRentRequest(
    { requestId: id, actorId: borrower },
    deps(fakeStripe(), { onItemFreed: (i) => void freed.push(i), push: (u) => void pushed.push(u) }),
    NOW,
  );
  assert.equal(result.status, 200);
  assert.deepEqual(freed, [itemId]);
  assert.deepEqual(pushed, [owner]);
});
