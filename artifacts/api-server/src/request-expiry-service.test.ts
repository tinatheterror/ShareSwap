import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  itemRequests,
  items,
  messages,
  notifications,
  pool,
  rentalPayouts,
  shareCoinsTransactions,
  users,
} from "@workspace/db";
import {
  expireDueRequestsForUser,
  expireRequestIfDue,
  guardHandoffWindow,
  runRequestExpirySweep,
  type RequestExpiryDeps,
} from "./request-expiry-service.js";

// Oct 2–5 (the agreed dates) → cutoff Oct 4 23:59:59 in Vancouver (PDT, UTC-7)
// = 2026-10-05T06:59:59Z. Request dates never move; only the cutoff matters here.
const CUTOFF = new Date("2026-10-05T06:59:59.000Z");
const AT_CUTOFF = CUTOFF;
const ONE_SECOND_AFTER = new Date(CUTOFF.getTime() + 1_000);
const ONE_SECOND_BEFORE = new Date(CUTOFF.getTime() - 1_000);
const FIVE_HOURS_BEFORE = new Date(CUTOFF.getTime() - 5 * 3_600_000);
const THREE_HOURS_BEFORE = new Date(CUTOFF.getTime() - 3 * 3_600_000);

const UNIQUE = `request-expiry-${Date.now()}`;
const requestIds: number[] = [];
const itemIds: number[] = [];
const userIds: number[] = [];
let ownerId: number;
let borrowerId: number;
let strangerId: number;

// ── Fake Stripe: records every call; capture is a hard failure ────────────────

function fakeStripe(options: { failCancel?: () => boolean } = {}) {
  const calls = {
    cancel: [] as { id: string; options?: { idempotencyKey?: string } }[],
    refunds: [] as { params: Record<string, unknown>; options?: { idempotencyKey?: string } }[],
    capture: [] as string[],
  };
  const intentStatus = new Map<string, string>();
  const deps: RequestExpiryDeps = {
    stripe: {
      paymentIntents: {
        retrieve: async (id: string) => ({ id, status: intentStatus.get(id) ?? "requires_capture" }),
        create: async () => {
          throw new Error("expiry must never create a payment");
        },
        cancel: async (id: string, _params?: unknown, opts?: { idempotencyKey?: string }) => {
          if (options.failCancel?.()) throw new Error("stripe unavailable");
          calls.cancel.push({ id, options: opts });
          intentStatus.set(id, "canceled");
          return { id, status: "canceled" };
        },
        capture: async (id: string) => {
          calls.capture.push(id);
          throw new Error("expiry must never capture");
        },
      },
      refunds: {
        create: async (params: Record<string, unknown>, opts?: { idempotencyKey?: string }) => {
          calls.refunds.push({ params, options: opts });
          return { id: `re_${calls.refunds.length}` };
        },
      },
    } as any,
  };
  return { calls, intentStatus, deps };
}

const noStripe = () => fakeStripe();

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function newItem(overrides: Partial<typeof items.$inferInsert> = {}) {
  const [item] = await db
    .insert(items)
    .values({
      ownerId,
      name: `${UNIQUE}-item-${itemIds.length}`,
      description: "Request expiry test item",
      conditionRating: 4,
      photos: [],
      isLendable: true,
      isRentable: true,
      isSwappable: true,
      isGift: true,
      isAvailable: false, // an accepted request holds the item
      replacementValue: 100,
      securityDeposit: "10.00",
      lendingDuration: 7,
      shareCoinsReward: "0",
      shareCoinPrice: "7.00",
      ...overrides,
    })
    .returning({ id: items.id });
  itemIds.push(item.id);
  return item.id;
}

async function newRequest(overrides: Partial<typeof itemRequests.$inferInsert> = {}) {
  const itemId = overrides.itemId ?? (await newItem());
  const [request] = await db
    .insert(itemRequests)
    .values({
      itemId,
      requesterId: borrowerId,
      requestType: "BORROW",
      status: "ACCEPTED",
      startDate: new Date("2026-10-02T00:00:00.000Z"),
      endDate: new Date("2026-10-05T00:00:00.000Z"),
      shareCoinAmount: "3.00",
      handoffPin: "4321",
      pinExpiresAt: CUTOFF,
      depositMethod: "in_app",
      ...overrides,
    })
    .returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return { id: request.id, itemId };
}

async function load(requestId: number) {
  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
  return request;
}

async function itemAvailable(itemId: number) {
  const [item] = await db.select({ isAvailable: items.isAvailable }).from(items).where(eq(items.id, itemId));
  return item.isAvailable;
}

async function chat(requestId: number) {
  return db.select().from(messages).where(eq(messages.requestId, requestId));
}

async function notes(requestId: number, type?: string) {
  const rows = await db.select().from(notifications).where(eq(notifications.requestId, requestId));
  return type ? rows.filter((n) => n.type === type) : rows;
}

async function coins(userId: number) {
  const [row] = await db.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, userId));
  return Number(row.shareCoins);
}

before(async () => {
  const [owner, borrower, stranger] = await db
    .insert(users)
    .values([
      { username: `${UNIQUE}-owner`, password: "x", emailVerified: true, shareCoins: "5.00", pendingRentalBalance: "0.00" },
      { username: `${UNIQUE}-borrower`, password: "x", emailVerified: true, shareCoins: "50.00" },
      { username: `${UNIQUE}-stranger`, password: "x", emailVerified: true },
    ])
    .returning({ id: users.id });
  ownerId = owner.id;
  borrowerId = borrower.id;
  strangerId = stranger.id;
  userIds.push(owner.id, borrower.id, stranger.id);
});

after(async () => {
  if (requestIds.length) {
    await db.delete(rentalPayouts).where(inArray(rentalPayouts.requestId, requestIds));
    await db.delete(messages).where(inArray(messages.requestId, requestIds));
    await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
    await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
  }
  if (userIds.length) await db.delete(shareCoinsTransactions).where(inArray(shareCoinsTransactions.userId, userIds));
  if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

// ── Transition: ACCEPTED → EXPIRED ────────────────────────────────────────────

test("ACCEPTED expires one second after the cutoff, not at it", async () => {
  const { id, itemId } = await newRequest();
  const stripe = noStripe();

  assert.equal((await expireRequestIfDue(id, stripe.deps, ONE_SECOND_BEFORE)).status, "not_due");
  assert.equal((await expireRequestIfDue(id, stripe.deps, AT_CUTOFF)).status, "not_due");
  assert.equal((await load(id)).status, "ACCEPTED");
  assert.equal(await itemAvailable(itemId), false);

  const outcome = await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER);
  assert.equal(outcome.status, "expired");

  const request = await load(id);
  assert.equal(request.status, "EXPIRED");
  assert.equal(request.expiredAt?.getTime(), ONE_SECOND_AFTER.getTime());
  assert.equal(request.handoffPin, null, "the handoff code dies with the request");
});

test("expiry never moves the agreed dates or touches ShareCoins", async () => {
  const { id } = await newRequest();
  const before = await load(id);
  const borrowerBefore = await coins(borrowerId);
  const ownerBefore = await coins(ownerId);

  await expireRequestIfDue(id, noStripe().deps, ONE_SECOND_AFTER);

  const after = await load(id);
  assert.equal(after.startDate?.toISOString(), before.startDate?.toISOString());
  assert.equal(after.endDate?.toISOString(), before.endDate?.toISOString());
  assert.equal(after.shareCoinAmount, before.shareCoinAmount);
  assert.equal(after.shareCoinsCharged, before.shareCoinsCharged);
  assert.equal(await coins(borrowerId), borrowerBefore);
  assert.equal(await coins(ownerId), ownerBefore);
});

test("the item frees up so other neighbours can request it", async () => {
  const { id, itemId } = await newRequest();
  const freed: number[] = [];
  const stripe = fakeStripe();
  await expireRequestIfDue(id, { ...stripe.deps, onItemFreed: (itemIdFreed) => void freed.push(itemIdFreed) }, ONE_SECOND_AFTER);
  assert.equal(await itemAvailable(itemId), true);
  assert.deepEqual(freed, [itemId]);
});

test("both people are told, with the cutoff and the money outcome", async () => {
  const { id } = await newRequest({
    status: "DEPOSIT_CONFIRMED",
    depositPaymentIntentId: "pi_notify",
    depositStatus: "authorized",
    depositMode: "authorization",
    trustDepositAmount: "25.00",
  });
  const pushes: number[] = [];
  const stripe = fakeStripe();
  await expireRequestIfDue(id, { ...stripe.deps, push: (userId) => void pushes.push(userId) }, ONE_SECOND_AFTER);

  const expired = await notes(id, "request_expired");
  assert.deepEqual(expired.map((n) => n.userId).sort(), [ownerId, borrowerId].sort());
  const borrowerNote = expired.find((n) => n.userId === borrowerId)!;
  assert.match(borrowerNote.message, /expired — no handoff happened by Oct 4, 11:59 PM/);
  assert.match(borrowerNote.message, /deposit hold has been released/);
  const ownerNote = expired.find((n) => n.userId === ownerId)!;
  assert.match(ownerNote.message, /available again/);
  assert.deepEqual(pushes.sort(), [ownerId, borrowerId].sort());

  const texts = (await chat(id)).map((m) => m.content);
  assert.ok(texts.some((t) => /Request expired — no handoff happened by Oct 4, 11:59 PM/.test(t)));
  assert.ok(texts.some((t) => /Deposit hold released/.test(t)));
});

// ── Transition: DEPOSIT_CONFIRMED → EXPIRED (money released, never captured) ───

test("DEPOSIT_CONFIRMED cancels the hold with a deterministic key and never captures", async () => {
  const { id } = await newRequest({
    status: "DEPOSIT_CONFIRMED",
    depositPaymentIntentId: "pi_hold_1",
    depositStatus: "authorized",
    depositMode: "authorization",
    trustDepositAmount: "25.00",
  });
  const stripe = fakeStripe();

  const outcome = await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER);
  assert.equal(outcome.status, "expired");
  assert.deepEqual(stripe.calls.cancel, [
    { id: "pi_hold_1", options: { idempotencyKey: `expire-${id}-pi_hold_1` } },
  ]);
  assert.deepEqual(stripe.calls.capture, []);
  assert.deepEqual(stripe.calls.refunds, []);

  const request = await load(id);
  assert.equal(request.status, "EXPIRED");
  assert.equal(request.depositStatus, "released");
  assert.ok(request.depositReleasedAt);
  assert.equal(request.depositOperationToken, null, "the fence is cleared");
  assert.equal(request.depositRenewalStatus, null);
});

test("a previous hold awaiting cancellation is released too, each with its own key", async () => {
  const { id } = await newRequest({
    status: "DEPOSIT_CONFIRMED",
    depositPaymentIntentId: "pi_new",
    depositPreviousPaymentIntentId: "pi_old",
    depositStatus: "authorized",
    depositMode: "authorization",
  });
  const stripe = fakeStripe();
  await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER);
  assert.deepEqual(
    stripe.calls.cancel.map((c) => [c.id, c.options?.idempotencyKey]),
    [
      ["pi_old", `expire-${id}-pi_old`],
      ["pi_new", `expire-${id}-pi_new`],
    ],
  );
  assert.equal((await load(id)).depositPreviousPaymentIntentId, null);
});

test("a refundable-charge deposit is refunded, never captured or cancelled", async () => {
  const { id } = await newRequest({
    status: "DEPOSIT_CONFIRMED",
    depositPaymentIntentId: "pi_refundable",
    depositStatus: "authorized",
    depositMode: "refundable_charge",
    trustDepositAmount: "40.00",
  });
  const stripe = fakeStripe();
  stripe.intentStatus.set("pi_refundable", "succeeded");

  const outcome = await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER);
  assert.equal(outcome.status, "expired");
  assert.deepEqual(stripe.calls.capture, []);
  assert.deepEqual(stripe.calls.cancel, []);
  assert.deepEqual(stripe.calls.refunds.map((r) => r.params), [{ payment_intent: "pi_refundable" }]);
  assert.match((await chat(id)).map((m) => m.content).join("\n"), /Refundable deposit refunded/);
});

test("an in-person deposit has nothing to release and makes no Stripe call", async () => {
  const { id } = await newRequest({ status: "DEPOSIT_CONFIRMED", depositMethod: "in_person" });
  const stripe = fakeStripe();
  await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER);
  assert.equal((await load(id)).status, "EXPIRED");
  assert.deepEqual(stripe.calls, { cancel: [], refunds: [], capture: [] });
  assert.equal((await load(id)).depositStatus, null);
});

test("a rental fee charged up front is refunded in full and the held payout is voided", async () => {
  await db.update(users).set({ pendingRentalBalance: "9.50" }).where(eq(users.id, ownerId));
  const { id } = await newRequest({
    requestType: "RENT",
    status: "DEPOSIT_CONFIRMED",
    depositPaymentIntentId: "pi_rent_hold",
    depositStatus: "authorized",
    depositMode: "authorization",
    trustDepositAmount: "30.00",
    rentalAmount: "10.00",
  });
  await db.insert(rentalPayouts).values({
    userId: ownerId,
    requestId: id,
    amount: "10.00",
    rentalAmount: "10.00",
    netAmount: "9.50",
    status: "held",
    stripePaymentIntentId: "pi_rent_fee",
  });
  const stripe = fakeStripe();

  const outcome = await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER);
  assert.equal(outcome.status, "expired");

  // The fee is its own PaymentIntent: refunded whole (no amount = full), keyed per request + intent.
  assert.deepEqual(stripe.calls.refunds, [
    { params: { payment_intent: "pi_rent_fee" }, options: { idempotencyKey: `expire-refund-${id}-pi_rent_fee` } },
  ]);
  assert.deepEqual(stripe.calls.cancel.map((c) => c.id), ["pi_rent_hold"]);
  assert.deepEqual(stripe.calls.capture, []);

  const [payout] = await db.select().from(rentalPayouts).where(eq(rentalPayouts.requestId, id));
  assert.equal(payout.status, "cancelled");
  const [owner] = await db.select({ pending: users.pendingRentalBalance }).from(users).where(eq(users.id, ownerId));
  assert.equal(Number(owner.pending), 0);

  const borrowerNote = (await notes(id, "request_expired")).find((n) => n.userId === borrowerId)!;
  assert.match(borrowerNote.message, /rental fee has been refunded in full/);
});

test("a rental fee that is already refunded counts as done", async () => {
  const { id } = await newRequest({ requestType: "RENT", status: "DEPOSIT_CONFIRMED", depositMethod: "in_person" });
  await db.insert(rentalPayouts).values({
    userId: ownerId, requestId: id, amount: "10.00", rentalAmount: "10.00", netAmount: "9.50",
    status: "held", stripePaymentIntentId: "pi_already_refunded",
  });
  const stripe = fakeStripe();
  (stripe.deps.stripe as any).refunds.create = async () => {
    throw Object.assign(new Error("already refunded"), { code: "charge_already_refunded" });
  };
  assert.equal((await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER)).status, "expired");
});

// ── What must NOT expire ──────────────────────────────────────────────────────

test("AWAITING_HANDOFF_CONFIRM is never expired: someone already confirmed", async () => {
  const { id, itemId } = await newRequest({
    status: "AWAITING_HANDOFF_CONFIRM",
    ownerConfirmedHandoff: true,
    handoffConfirmDeadline: new Date(CUTOFF.getTime() + 86_400_000),
  });
  const stripe = fakeStripe();
  const outcome = await expireRequestIfDue(id, stripe.deps, new Date(CUTOFF.getTime() + 3_600_000));
  assert.equal(outcome.status, "not_applicable");
  assert.equal((await load(id)).status, "AWAITING_HANDOFF_CONFIRM");
  assert.equal(await itemAvailable(itemId), false);
  assert.deepEqual(stripe.calls, { cancel: [], refunds: [], capture: [] });
});

test("other statuses and request types are left alone", async () => {
  const stripe = fakeStripe();
  for (const overrides of [
    { status: "PENDING" },
    { status: "IN_PROGRESS" },
    { status: "COMPLETED" },
    { status: "CANCELLED" },
    { status: "HANDOFF_DISPUTED" },
    { status: "ACCEPTED", requestType: "GIFT" },
    { status: "ACCEPTED", requestType: "SWAP" },
  ]) {
    const { id } = await newRequest(overrides);
    const outcome = await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER);
    assert.equal(outcome.status, "not_applicable", JSON.stringify(overrides));
    assert.equal((await load(id)).status, overrides.status);
  }
  assert.deepEqual(stripe.calls, { cancel: [], refunds: [], capture: [] });
});

test("a request without usable dates never expires on a schedule", async () => {
  const { id } = await newRequest({ startDate: null, endDate: null });
  assert.equal((await expireRequestIfDue(id, noStripe().deps, ONE_SECOND_AFTER)).status, "not_applicable");
  assert.equal((await load(id)).status, "ACCEPTED");
});

test("agreed counter-dates decide the cutoff, not the original dates", async () => {
  const { id } = await newRequest({
    counterStartDate: new Date("2026-10-02T00:00:00.000Z"),
    counterEndDate: new Date("2026-10-09T00:00:00.000Z"),
  });
  assert.equal((await expireRequestIfDue(id, noStripe().deps, ONE_SECOND_AFTER)).status, "not_due");
  assert.equal((await load(id)).status, "ACCEPTED");
});

test("a one-day request's cutoff is the end of its start day, never before it starts", async () => {
  // Oct 2 → Oct 3: end − 24h lands inside the start day, so the cutoff is Oct 2 23:59:59 PDT.
  const { id } = await newRequest({
    startDate: new Date("2026-10-02T00:00:00.000Z"),
    endDate: new Date("2026-10-03T00:00:00.000Z"),
  });
  const stripe = noStripe();
  const lastSecondOfStartDay = new Date("2026-10-03T06:59:59.000Z");
  assert.equal((await expireRequestIfDue(id, stripe.deps, lastSecondOfStartDay)).status, "not_due");
  assert.equal((await expireRequestIfDue(id, stripe.deps, new Date("2026-10-03T07:00:00.000Z"))).status, "expired");
});

// ── Idempotence, failure, retry ───────────────────────────────────────────────

test("expiring twice is harmless: one set of messages, notifications and Stripe calls", async () => {
  const { id } = await newRequest({
    status: "DEPOSIT_CONFIRMED", depositPaymentIntentId: "pi_twice", depositStatus: "authorized", depositMode: "authorization",
  });
  const stripe = fakeStripe();
  const first = await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER);
  const second = await expireRequestIfDue(id, stripe.deps, new Date(ONE_SECOND_AFTER.getTime() + 60_000));
  assert.equal(first.status, "expired");
  assert.equal(second.status, "not_applicable");
  assert.equal(stripe.calls.cancel.length, 1);
  assert.equal((await notes(id, "request_expired")).length, 2);
  assert.equal((await chat(id)).filter((m) => /Request expired/.test(m.content)).length, 1);
  assert.equal((await load(id)).expiredAt?.getTime(), ONE_SECOND_AFTER.getTime());
});

test("a Stripe failure leaves the request open and retryable, and the retry reuses the same key", async () => {
  const { id, itemId } = await newRequest({
    status: "DEPOSIT_CONFIRMED", depositPaymentIntentId: "pi_flaky", depositStatus: "authorized", depositMode: "authorization",
  });
  let failing = true;
  const stripe = fakeStripe({ failCancel: () => failing });

  const failed = await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER);
  assert.equal(failed.status, "failed");
  let request = await load(id);
  assert.equal(request.status, "DEPOSIT_CONFIRMED", "not expired while the hold is still on the card");
  assert.equal(request.depositOperationToken, null, "the fence is released so a retry can claim it");
  assert.equal(request.depositRenewalStatus, null, "the operation marker is restored, not left as terminal_action");
  assert.equal(await itemAvailable(itemId), false);
  assert.equal((await notes(id, "request_expired")).length, 0);

  failing = false;
  const retried = await expireRequestIfDue(id, stripe.deps, new Date(ONE_SECOND_AFTER.getTime() + 60_000));
  assert.equal(retried.status, "expired");
  assert.deepEqual(stripe.calls.cancel, [{ id: "pi_flaky", options: { idempotencyKey: `expire-${id}-pi_flaky` } }]);
  assert.equal((await load(id)).status, "EXPIRED");
});

test("a rental refund failure also leaves the request open and retryable", async () => {
  const { id } = await newRequest({ requestType: "RENT", status: "DEPOSIT_CONFIRMED", depositMethod: "in_person" });
  await db.insert(rentalPayouts).values({
    userId: ownerId, requestId: id, amount: "10.00", rentalAmount: "10.00", netAmount: "9.50",
    status: "held", stripePaymentIntentId: "pi_fee_flaky",
  });
  const stripe = fakeStripe();
  const realRefund = (stripe.deps.stripe as any).refunds.create;
  (stripe.deps.stripe as any).refunds.create = async () => { throw new Error("stripe unavailable"); };
  assert.equal((await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER)).status, "failed");
  assert.equal((await load(id)).status, "DEPOSIT_CONFIRMED");
  const [payout] = await db.select().from(rentalPayouts).where(eq(rentalPayouts.requestId, id));
  assert.equal(payout.status, "held", "the payout is only voided once the refund went through");

  (stripe.deps.stripe as any).refunds.create = realRefund;
  assert.equal((await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER)).status, "expired");
});

test("a deposit operation already in flight makes expiry back off", async () => {
  const { id } = await newRequest({
    status: "DEPOSIT_CONFIRMED", depositPaymentIntentId: "pi_busy", depositStatus: "authorized",
    depositRenewalStatus: "terminal_action", depositOperationToken: "someone-else", depositOperationType: "capture",
    depositRenewalAttemptedAt: new Date(),
  });
  const stripe = fakeStripe();
  const outcome = await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER);
  assert.equal(outcome.status, "busy");
  assert.equal((await load(id)).status, "DEPOSIT_CONFIRMED");
  assert.deepEqual(stripe.calls, { cancel: [], refunds: [], capture: [] });
});

// ── The deadline race ─────────────────────────────────────────────────────────

/** The conditional update every handoff route now uses to move a request on. */
async function handoffUpdate(requestId: number, fromStatus: string) {
  return db
    .update(itemRequests)
    .set({ status: "AWAITING_HANDOFF_CONFIRM", ownerConfirmedHandoff: true })
    .where(and(eq(itemRequests.id, requestId), eq(itemRequests.status, fromStatus), isNull(itemRequests.depositOperationToken)))
    .returning({ id: itemRequests.id });
}

test("race: a handoff that commits just before the claim wins, and nothing is released", async () => {
  // The 11:59:58 handoff has taken the row lock; the expiry (already past the cutoff
  // by its own clock) queues behind it and must re-check under the lock.
  const { id, itemId } = await newRequest({
    status: "DEPOSIT_CONFIRMED", depositPaymentIntentId: "pi_race_a", depositStatus: "authorized", depositMode: "authorization",
  });
  const stripe = fakeStripe();
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT 1 FROM item_requests WHERE id = $1 FOR UPDATE", [id]);
    const expiry = expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER);
    await new Promise((resolve) => setTimeout(resolve, 400)); // expiry is now blocked on the lock
    await holder.query("UPDATE item_requests SET status = 'AWAITING_HANDOFF_CONFIRM', owner_confirmed_handoff = true WHERE id = $1", [id]);
    await holder.query("COMMIT");

    const outcome = await expiry;
    assert.equal(outcome.status, "not_applicable");
  } finally {
    holder.release();
  }
  const request = await load(id);
  assert.equal(request.status, "AWAITING_HANDOFF_CONFIRM");
  assert.equal(request.depositOperationToken, null, "the claim was handed back");
  assert.equal(request.depositRenewalStatus, null);
  assert.equal(await itemAvailable(itemId), false);
  assert.deepEqual(stripe.calls, { cancel: [], refunds: [], capture: [] }, "no hold released for a handed-off item");
  assert.equal((await notes(id, "request_expired")).length, 0);
});

test("race: once the expiry holds the claim, a handoff update matches no row", async () => {
  const { id } = await newRequest({
    status: "DEPOSIT_CONFIRMED", depositPaymentIntentId: "pi_race_b", depositStatus: "authorized", depositMode: "authorization",
  });
  // Expiry mid-flight: Stripe is slow, so the claim is held while a handoff arrives.
  let releaseStripe!: () => void;
  const stripeGate = new Promise<void>((resolve) => { releaseStripe = resolve; });
  const stripe = fakeStripe();
  const realCancel = (stripe.deps.stripe as any).paymentIntents.cancel;
  (stripe.deps.stripe as any).paymentIntents.cancel = async (...args: unknown[]) => {
    await stripeGate;
    return realCancel(...args);
  };

  const expiry = expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const lateHandoff = await handoffUpdate(id, "DEPOSIT_CONFIRMED");
  assert.equal(lateHandoff.length, 0, "the handoff is refused while the expiry owns the request");
  releaseStripe();

  assert.equal((await expiry).status, "expired");
  assert.equal((await load(id)).status, "EXPIRED");
});

test("race: after the expiry commits, a handoff update matches no row", async () => {
  const { id } = await newRequest();
  await expireRequestIfDue(id, noStripe().deps, ONE_SECOND_AFTER);
  assert.equal((await handoffUpdate(id, "ACCEPTED")).length, 0);
  assert.equal((await load(id)).status, "EXPIRED");
});

test("race: expiry and handoff fired together produce exactly one winner and a consistent request", async () => {
  const outcomes = { expired: 0, handedOff: 0 };
  for (let round = 0; round < 15; round++) {
    const { id, itemId } = await newRequest({
      status: "DEPOSIT_CONFIRMED", depositPaymentIntentId: `pi_race_c_${round}`, depositStatus: "authorized", depositMode: "authorization",
    });
    const stripe = fakeStripe();
    const [expiry, handoff] = await Promise.all([
      expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER),
      handoffUpdate(id, "DEPOSIT_CONFIRMED"),
    ]);

    const request = await load(id);
    const handedOff = handoff.length === 1;
    if (handedOff) {
      outcomes.handedOff++;
      assert.notEqual(expiry.status, "expired", `round ${round}: both won`);
      assert.equal(request.status, "AWAITING_HANDOFF_CONFIRM");
      assert.deepEqual(stripe.calls.cancel, [], `round ${round}: hold released for a handed-off item`);
      assert.equal(await itemAvailable(itemId), false);
    } else {
      outcomes.expired++;
      assert.equal(expiry.status, "expired", `round ${round}: neither won`);
      assert.equal(request.status, "EXPIRED");
      assert.equal(stripe.calls.cancel.length, 1);
      assert.equal(await itemAvailable(itemId), true);
    }
    assert.deepEqual(stripe.calls.capture, []);
    assert.equal(request.depositOperationToken, null);
  }
  assert.equal(outcomes.expired + outcomes.handedOff, 15);
});

test("race: two expiries at once act once", async () => {
  const { id } = await newRequest({
    status: "DEPOSIT_CONFIRMED", depositPaymentIntentId: "pi_double", depositStatus: "authorized", depositMode: "authorization",
  });
  const stripe = fakeStripe();
  const results = await Promise.all([
    expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER),
    expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER),
    expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER),
  ]);
  assert.equal(results.filter((r) => r.status === "expired").length, 1);
  assert.equal(stripe.calls.cancel.length, 1);
  assert.equal((await notes(id, "request_expired")).length, 2);
  assert.equal((await load(id)).status, "EXPIRED");
});

// ── Guard used by the handoff, code-redemption and payment routes ─────────────

test("guard: a dead code gets the clear expiry message, not a generic one", async () => {
  const { id } = await newRequest();
  await expireRequestIfDue(id, noStripe().deps, ONE_SECOND_AFTER);
  const guard = await guardHandoffWindow(id, noStripe().deps, new Date(CUTOFF.getTime() + 86_400_000));
  assert.equal(guard.blocked, true);
  if (guard.blocked) {
    assert.equal(guard.code, "REQUEST_EXPIRED");
    assert.equal(guard.error, "This request expired Oct 4 at 11:59 PM.");
    assert.equal(guard.expired, true);
    assert.equal(guard.cutoff?.toISOString(), CUTOFF.toISOString());
  }
});

test("guard: lets a handoff through right up to the cutoff", async () => {
  const { id } = await newRequest();
  assert.deepEqual(await guardHandoffWindow(id, noStripe().deps, ONE_SECOND_BEFORE), { blocked: false });
  assert.deepEqual(await guardHandoffWindow(id, noStripe().deps, AT_CUTOFF), { blocked: false });
  assert.equal((await load(id)).status, "ACCEPTED");
});

test("guard: expires a due request on the spot, so a stale status is never acted on", async () => {
  const { id } = await newRequest();
  const guard = await guardHandoffWindow(id, noStripe().deps, ONE_SECOND_AFTER);
  assert.equal(guard.blocked, true);
  assert.equal((await load(id)).status, "EXPIRED");
});

test("guard: still blocks past the cutoff when the expiry itself fails (Stripe down)", async () => {
  const { id } = await newRequest({
    status: "DEPOSIT_CONFIRMED", depositPaymentIntentId: "pi_guard", depositStatus: "authorized", depositMode: "authorization",
  });
  const stripe = fakeStripe({ failCancel: () => true });
  const guard = await guardHandoffWindow(id, stripe.deps, ONE_SECOND_AFTER);
  assert.equal(guard.blocked, true);
  if (guard.blocked) assert.equal(guard.expired, false);
  assert.equal((await load(id)).status, "DEPOSIT_CONFIRMED");
});

test("guard: an already-confirmed handoff may still finish after the cutoff", async () => {
  const { id } = await newRequest({ status: "AWAITING_HANDOFF_CONFIRM", ownerConfirmedHandoff: true });
  assert.deepEqual(await guardHandoffWindow(id, noStripe().deps, new Date(CUTOFF.getTime() + 3_600_000)), { blocked: false });
});

// ── Read-time check ───────────────────────────────────────────────────────────

test("reading a user's requests expires only the due ones that involve them", async () => {
  const mine = await newRequest();
  const notDue = await newRequest({ endDate: new Date("2026-10-20T00:00:00.000Z") });
  const strangers = await newRequest({ requesterId: strangerId });
  const stripe = noStripe();

  const count = await expireDueRequestsForUser(borrowerId, stripe.deps, ONE_SECOND_AFTER);
  assert.ok(count >= 1);
  assert.equal((await load(mine.id)).status, "EXPIRED");
  assert.equal((await load(notDue.id)).status, "ACCEPTED");
  assert.equal((await load(strangers.id)).status, "ACCEPTED", "another borrower's request is not touched by this read");
});

// ── Sweep: expiry, reminder, dry run (nothing here schedules itself) ──────────

test("sweep: reminds both people once, a few hours before the cutoff", async () => {
  const { id } = await newRequest({ status: "DEPOSIT_CONFIRMED", depositMethod: "in_person" });
  const pushes: number[] = [];
  const deps = { ...noStripe().deps, push: (userId: number) => void pushes.push(userId) };

  const tooEarly = await runRequestExpirySweep(deps, { now: FIVE_HOURS_BEFORE, onlyRequestIds: [id] });
  assert.equal(tooEarly.remindedCount, 0);
  assert.equal((await notes(id, "handoff_deadline_reminder")).length, 0);

  const first = await runRequestExpirySweep(deps, { now: THREE_HOURS_BEFORE, onlyRequestIds: [id] });
  assert.equal(first.remindedCount, 1);
  const reminders = await notes(id, "handoff_deadline_reminder");
  assert.deepEqual(reminders.map((n) => n.userId).sort(), [ownerId, borrowerId].sort());
  assert.match(reminders[0].message, /Confirm it in the app by Oct 4, 11:59 PM or the request expires/);
  assert.deepEqual(pushes.sort(), [ownerId, borrowerId].sort());
  assert.equal((await load(id)).status, "DEPOSIT_CONFIRMED", "a reminder changes nothing else");

  const second = await runRequestExpirySweep(deps, { now: new Date(THREE_HOURS_BEFORE.getTime() + 3_600_000), onlyRequestIds: [id] });
  assert.equal(second.remindedCount, 0);
  assert.equal((await notes(id, "handoff_deadline_reminder")).length, 2, "at most once");
});

test("sweep: concurrent reminder runs send one reminder", async () => {
  const { id } = await newRequest({ depositMethod: "in_person" });
  const deps = noStripe().deps;
  const results = await Promise.all([
    runRequestExpirySweep(deps, { now: THREE_HOURS_BEFORE, onlyRequestIds: [id] }),
    runRequestExpirySweep(deps, { now: THREE_HOURS_BEFORE, onlyRequestIds: [id] }),
  ]);
  assert.equal(results.reduce((sum, r) => sum + r.remindedCount, 0), 1);
  assert.equal((await notes(id, "handoff_deadline_reminder")).length, 2);
});

test("sweep: nobody is reminded once a handoff was confirmed, or after the request expired", async () => {
  const awaiting = await newRequest({ status: "AWAITING_HANDOFF_CONFIRM", ownerConfirmedHandoff: true });
  const sweep = await runRequestExpirySweep(noStripe().deps, { now: THREE_HOURS_BEFORE, onlyRequestIds: [awaiting.id] });
  assert.equal(sweep.remindedCount, 0);
  assert.equal((await notes(awaiting.id)).length, 0);

  const due = await newRequest({ depositMethod: "in_person" });
  const expired = await runRequestExpirySweep(noStripe().deps, { now: ONE_SECOND_AFTER, onlyRequestIds: [due.id] });
  assert.equal(expired.expiredCount, 1);
  assert.equal((await notes(due.id, "handoff_deadline_reminder")).length, 0, "no reminder for a request that just expired");
});

test("sweep: expires what is due and leaves the rest", async () => {
  const dueRequest = await newRequest({ depositMethod: "in_person" });
  const later = await newRequest({ endDate: new Date("2026-10-20T00:00:00.000Z"), depositMethod: "in_person" });
  const result = await runRequestExpirySweep(noStripe().deps, { now: ONE_SECOND_AFTER, onlyRequestIds: [dueRequest.id, later.id] });
  assert.equal(result.expiredCount, 1);
  assert.equal((await load(dueRequest.id)).status, "EXPIRED");
  assert.equal((await load(later.id)).status, "ACCEPTED");
});

test("sweep: a dry run reports what it would do and changes nothing", async () => {
  const dueRequest = await newRequest({ status: "DEPOSIT_CONFIRMED", depositPaymentIntentId: "pi_dry", depositStatus: "authorized", depositMode: "authorization" });
  const soon = await newRequest({ depositMethod: "in_person" });
  const stripe = fakeStripe();

  const dryDue = await runRequestExpirySweep(stripe.deps, { now: ONE_SECOND_AFTER, dryRun: true, onlyRequestIds: [dueRequest.id] });
  assert.deepEqual(dryDue.candidates.map((c) => [c.requestId, c.action]), [[dueRequest.id, "expire"]]);
  assert.equal(dryDue.expiredCount, 0);
  assert.equal((await load(dueRequest.id)).status, "DEPOSIT_CONFIRMED");

  const drySoon = await runRequestExpirySweep(stripe.deps, { now: THREE_HOURS_BEFORE, dryRun: true, onlyRequestIds: [soon.id] });
  assert.deepEqual(drySoon.candidates.map((c) => [c.requestId, c.action]), [[soon.id, "remind"]]);
  assert.equal((await notes(soon.id)).length, 0);
  assert.equal((await load(soon.id)).expiryReminderSentAt, null);
  assert.deepEqual(stripe.calls, { cancel: [], refunds: [], capture: [] });
});
