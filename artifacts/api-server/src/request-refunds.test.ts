import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  itemRequests,
  items,
  messages,
  notifications,
  pool,
  rentalPayouts,
  users,
} from "@workspace/db";
import { expireRequestIfDue, type RequestExpiryDeps } from "./request-expiry-service.js";
import {
  refundUpfrontCharges,
  stripeRefundTarget,
  upfrontRefundTargets,
} from "./request-refunds.js";
import { ensureCancellationRecord } from "./startup-migrations.js";

// Oct 2–5 → cutoff Oct 4 23:59:59 Vancouver = 2026-10-05T06:59:59Z.
const ONE_SECOND_AFTER = new Date("2026-10-05T07:00:00.000Z");

const UNIQUE = `request-refunds-${Date.now()}`;
const requestIds: number[] = [];
const itemIds: number[] = [];
const userIds: number[] = [];
let ownerId: number;
let borrowerId: number;

type RefundCall = { params: Record<string, unknown>; options?: { idempotencyKey?: string } };

function fakeStripe(
  options: {
    failCancel?: () => boolean;
    refundBehaviour?: (call: RefundCall, nth: number) => void;
  } = {},
) {
  const calls = {
    cancel: [] as { id: string; options?: { idempotencyKey?: string } }[],
    refunds: [] as RefundCall[],
    capture: [] as string[],
  };
  const intentStatus = new Map<string, string>();
  const stripe = {
    paymentIntents: {
      retrieve: async (id: string) => ({ id, status: intentStatus.get(id) ?? "requires_capture" }),
      create: async () => {
        throw new Error("refunds must never create a payment");
      },
      cancel: async (id: string, _params?: unknown, opts?: { idempotencyKey?: string }) => {
        if (options.failCancel?.()) throw new Error("stripe unavailable");
        calls.cancel.push({ id, options: opts });
        intentStatus.set(id, "canceled");
        return { id, status: "canceled" };
      },
      capture: async (id: string) => {
        calls.capture.push(id);
        throw new Error("refunds must never capture");
      },
    },
    refunds: {
      create: async (params: Record<string, unknown>, opts?: { idempotencyKey?: string }) => {
        const call = { params, options: opts };
        calls.refunds.push(call);
        options.refundBehaviour?.(call, calls.refunds.length);
        return { id: `re_${calls.refunds.length}` };
      },
    },
  };
  const deps: RequestExpiryDeps = {
    readPolicy: async () => ({ mode: "live", maxCutoffAgeMs: null }),
    stripe: stripe as any,
  };
  return { calls, deps, stripe: stripe as any };
}

async function newRequest(overrides: Partial<typeof itemRequests.$inferInsert> = {}) {
  const [item] = await db
    .insert(items)
    .values({
      ownerId,
      name: `${UNIQUE}-item-${itemIds.length}`,
      description: "Refund test item",
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
      status: "DEPOSIT_CONFIRMED",
      startDate: new Date("2026-10-02T00:00:00.000Z"),
      endDate: new Date("2026-10-05T00:00:00.000Z"),
      shareCoinAmount: "3.00",
      handoffPin: "4321",
      depositMethod: "in_app",
      depositPaymentIntentId: "pi_deposit_hold",
      depositStatus: "authorized",
      depositMode: "authorization",
      trustDepositAmount: "30.00",
      ...overrides,
    })
    .returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return request.id;
}

async function load(requestId: number) {
  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
  return request;
}

before(async () => {
  await ensureCancellationRecord();
  const [owner, borrower] = await db
    .insert(users)
    .values([
      { username: `${UNIQUE}-owner`, password: "x", emailVerified: true, pendingRentalBalance: "0.00" },
      { username: `${UNIQUE}-borrower`, password: "x", emailVerified: true },
    ])
    .returning({ id: users.id });
  ownerId = owner.id;
  borrowerId = borrower.id;
  userIds.push(owner.id, borrower.id);
});

after(async () => {
  if (requestIds.length) {
    await db.delete(rentalPayouts).where(inArray(rentalPayouts.requestId, requestIds));
    await db.delete(messages).where(inArray(messages.requestId, requestIds));
    await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
    await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
  }
  if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

// ── Which Stripe parameter a stored id needs ──────────────────────────────────

test("stripeRefundTarget: a pi_ id is refunded by payment_intent, a ch_ or py_ id by charge", () => {
  assert.deepEqual(stripeRefundTarget("pi_3Abc"), { payment_intent: "pi_3Abc" });
  assert.deepEqual(stripeRefundTarget("ch_3Abc"), { charge: "ch_3Abc" });
  assert.deepEqual(stripeRefundTarget("py_3Abc"), { charge: "py_3Abc" });
});

test("a platform fee stored as a pi_ id (what charge-platform-fee returns) is refunded as a payment_intent", async () => {
  const id = await newRequest({ platformFeeChargeId: "pi_platform_fee" });
  const stripe = fakeStripe();

  const refunds = await refundUpfrontCharges(await load(id), stripe.stripe, { keyPrefix: "cancel" });

  assert.deepEqual(stripe.calls.refunds, [
    { params: { payment_intent: "pi_platform_fee" }, options: { idempotencyKey: `cancel-refund-${id}-pi_platform_fee` } },
  ]);
  assert.deepEqual(refunds.map((r) => [r.kind, r.stripeId, r.refundId]), [["platform_fee_refund", "pi_platform_fee", "re_1"]]);
});

test("a platform fee stored as a ch_ id is refunded as a charge", async () => {
  const id = await newRequest({ platformFeeChargeId: "ch_platform_fee" });
  const stripe = fakeStripe();

  await refundUpfrontCharges(await load(id), stripe.stripe, { keyPrefix: "expire" });

  assert.deepEqual(stripe.calls.refunds, [
    { params: { charge: "ch_platform_fee" }, options: { idempotencyKey: `expire-refund-${id}-ch_platform_fee` } },
  ]);
});

// ── What exists is what is refunded ───────────────────────────────────────────

test("a waived platform fee (no id) makes no refund attempt, and neither does a request with no fees at all", async () => {
  const waived = await newRequest({ platformFeeChargeId: null });
  const stripe = fakeStripe();
  assert.deepEqual(await refundUpfrontCharges(await load(waived), stripe.stripe, { keyPrefix: "cancel" }), []);
  assert.deepEqual(stripe.calls, { cancel: [], refunds: [], capture: [] });
});

test("simulated ids, the deposit's own intent and duplicates are never refunded", async () => {
  const id = await newRequest({ platformFeeChargeId: "pi_deposit_hold" }); // points at the deposit
  await db.insert(rentalPayouts).values([
    { userId: ownerId, requestId: id, amount: "10.00", rentalAmount: "10.00", netAmount: "9.50", status: "held", stripePaymentIntentId: "simulated-rental" },
    { userId: ownerId, requestId: id, amount: "10.00", rentalAmount: "10.00", netAmount: "9.50", status: "held", stripePaymentIntentId: "pi_deposit_hold" },
  ]);
  assert.deepEqual(await upfrontRefundTargets(await load(id)), []);
});

test("RENT: the held rental payment and the platform fee are both refunded, each once, deposit left to its own release", async () => {
  const id = await newRequest({ requestType: "RENT", platformFeeChargeId: "pi_platform_fee" });
  await db.insert(rentalPayouts).values([
    { userId: ownerId, requestId: id, amount: "10.00", rentalAmount: "10.00", netAmount: "9.50", status: "held", stripePaymentIntentId: "pi_rent_fee" },
    // A payout that was already voided is not refunded again.
    { userId: ownerId, requestId: id, amount: "5.00", rentalAmount: "5.00", netAmount: "4.75", status: "cancelled", stripePaymentIntentId: "pi_old_rent_fee" },
  ]);
  const stripe = fakeStripe();

  const refunds = await refundUpfrontCharges(await load(id), stripe.stripe, { keyPrefix: "cancel" });

  assert.deepEqual(stripe.calls.refunds.map((c) => c.params), [{ payment_intent: "pi_rent_fee" }, { payment_intent: "pi_platform_fee" }]);
  assert.deepEqual(refunds.map((r) => r.kind), ["rental_refund", "platform_fee_refund"]);
  assert.deepEqual(stripe.calls.capture, []);
  assert.deepEqual(stripe.calls.cancel, []);
});

test("an already-refunded charge counts as done and the rest still go through", async () => {
  const id = await newRequest({ platformFeeChargeId: "pi_platform_fee" });
  await db.insert(rentalPayouts).values({
    userId: ownerId, requestId: id, amount: "10.00", rentalAmount: "10.00", netAmount: "9.50", status: "held", stripePaymentIntentId: "pi_rent_fee",
  });
  const stripe = fakeStripe({
    refundBehaviour: (call) => {
      if (call.params.payment_intent === "pi_rent_fee") {
        throw Object.assign(new Error("already refunded"), { code: "charge_already_refunded" });
      }
    },
  });

  const refunds = await refundUpfrontCharges(await load(id), stripe.stripe, { keyPrefix: "cancel" });

  assert.deepEqual(refunds.map((r) => [r.stripeId, r.refundId]), [["pi_rent_fee", null], ["pi_platform_fee", "re_2"]]);
});

test("charges that exist but a client without refunds support is a failure, not a silent skip", async () => {
  const id = await newRequest({ platformFeeChargeId: "pi_platform_fee" });
  const stripe = fakeStripe();
  delete stripe.stripe.refunds;
  await assert.rejects(refundUpfrontCharges(await load(id), stripe.stripe, { keyPrefix: "cancel" }), /refunds are unavailable/);
});

// ── Expiry uses the shared function (the pi_ platform-fee bug) ────────────────

test("expiry refunds a platform fee stored as a pi_ id as a payment_intent (it used to be sent as a charge)", async () => {
  const id = await newRequest({ platformFeeChargeId: "pi_platform_fee" });
  const stripe = fakeStripe();

  const outcome = await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER);

  assert.equal(outcome.status, "expired");
  assert.deepEqual(stripe.calls.refunds, [
    { params: { payment_intent: "pi_platform_fee" }, options: { idempotencyKey: `expire-refund-${id}-pi_platform_fee` } },
  ]);
  assert.deepEqual(stripe.calls.cancel.map((c) => c.id), ["pi_deposit_hold"]);
  assert.deepEqual(stripe.calls.capture, []);
});

test("expiry of a waived-fee BORROW releases only the deposit", async () => {
  const id = await newRequest({ platformFeeChargeId: null });
  const stripe = fakeStripe();
  assert.equal((await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER)).status, "expired");
  assert.deepEqual(stripe.calls.refunds, []);
  assert.deepEqual(stripe.calls.cancel.map((c) => c.id), ["pi_deposit_hold"]);
});

// ── Partial failure: fee refunded, deposit release fails, retry completes ─────

test("the fee refund succeeds and the deposit release fails: nothing changes in our records, and the retry completes", async () => {
  const id = await newRequest({ platformFeeChargeId: "pi_platform_fee" });
  let depositDown = true;
  const stripe = fakeStripe({ failCancel: () => depositDown });

  const first = await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER);
  assert.equal(first.status, "failed");

  // The fee refund went out before the failing release...
  assert.equal(stripe.calls.refunds.length, 1);
  // ...but our side is untouched: still open, claim dropped, nobody told, chat quiet.
  const after1 = await load(id);
  assert.equal(after1.status, "DEPOSIT_CONFIRMED");
  assert.equal(after1.depositStatus, "authorized");
  assert.equal(after1.depositOperationToken, null);
  assert.equal(after1.expiredAt, null);
  assert.deepEqual(await db.select().from(notifications).where(eq(notifications.requestId, id)), []);
  assert.deepEqual(await db.select().from(messages).where(eq(messages.requestId, id)), []);

  // Retry once Stripe is back. The fee refund repeats with the same key; Stripe answers "already
  // refunded" for it, which counts as done.
  depositDown = false;
  (stripe.stripe.refunds as any).create = async (params: Record<string, unknown>, opts?: { idempotencyKey?: string }) => {
    stripe.calls.refunds.push({ params, options: opts });
    throw Object.assign(new Error("already refunded"), { code: "charge_already_refunded" });
  };
  const second = await expireRequestIfDue(id, stripe.deps, ONE_SECOND_AFTER);

  assert.equal(second.status, "expired");
  assert.equal(stripe.calls.refunds.length, 2);
  assert.equal(stripe.calls.refunds[0].options?.idempotencyKey, stripe.calls.refunds[1].options?.idempotencyKey);
  assert.deepEqual(stripe.calls.cancel.map((c) => c.id), ["pi_deposit_hold"]);
  assert.equal((await load(id)).status, "EXPIRED");
  assert.equal((await db.select().from(notifications).where(eq(notifications.requestId, id))).length, 2);
});
