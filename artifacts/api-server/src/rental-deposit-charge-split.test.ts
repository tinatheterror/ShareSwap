/**
 * Regression tests: rental deposit hold vs. rental+fee charge split.
 *
 * Covers the fix where the combined rental-payment flow was accidentally charging
 * the deposit immediately (`capture_method: "automatic"`) instead of holding it,
 * inconsistent with the rest of the deposit lifecycle (create/capture/release-deposit
 * endpoints, which all use a manual-capture hold). Exercises the two route handlers'
 * extracted core logic (createRentalPaymentHold / confirmRentalDeposit) directly,
 * with a fake Stripe client standing in for the network, so the assertions cover the
 * exact PaymentIntent shape created rather than just "a request succeeded":
 *
 *   1. POST /api/rentals/create-payment-hold creates a manual-capture PaymentIntent
 *      for the deposit amount ONLY.
 *   2. POST /api/requests/:requestId/confirm-rental-deposit creates a SEPARATE
 *      automatic-capture PaymentIntent for rentalAmount + processingFee, and stores
 *      that second PI's id (not the deposit's) on the rentalPayouts row.
 *   3. If the second (rental+fee) charge fails, the deposit hold is released
 *      (cancelled) and the request is never marked DEPOSIT_CONFIRMED.
 *   4. After confirm-rental-deposit succeeds, the deposit hold is still an
 *      uncaptured, cancelable manual hold (the existing release/dispute flow must
 *      keep working against it).
 *
 * Uses the real Postgres database (same approach as the other *.test.ts files in
 * this package) with a fake in-memory Stripe client injected via the stripeClient
 * parameter, so no real network calls are made and exact request/response shapes
 * can be asserted precisely.
 */

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pool, db } from "@workspace/db";
import { users, items, itemRequests, rentalPayouts, messages } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createRentalPaymentHold, confirmRentalDeposit } from "./routes/routes.js";

// ── Fake Stripe client ──────────────────────────────────────────────────────────
//
// Mimics just enough of the real Stripe Node SDK surface (customers.create,
// paymentIntents.create/retrieve/cancel) to exercise the route logic without a
// network call, while still enforcing the same basic invariants a real PI would:
// cancel() only succeeds on an uncaptured/unsucceeded PaymentIntent, and the
// PI's own `status` reflects whether it was created with capture_method "manual"
// vs "automatic" and whether it was confirmed.

interface FakePaymentIntent {
  id: string;
  object: "payment_intent";
  client_secret: string;
  status: string;
  amount: number;
  currency: string;
  customer: string | null;
  payment_method: string | null;
  metadata: Record<string, string>;
  capture_method: string;
  latest_charge: {
    id: string;
    payment_method_details: { card: { capture_before?: number } };
  } | string | null;
}

function createFakeStripe(options?: {
  onCreatePaymentIntent?: (params: any) => { throwError?: Error; status?: string } | void;
  captureBefore?: number | null;
}) {
  const store = new Map<string, FakePaymentIntent>();
  let seq = 0;
  const calls = {
    customersCreate: [] as any[],
    paymentIntentsCreate: [] as any[],
    paymentIntentsRetrieve: [] as string[],
    paymentIntentsRetrieveParameters: [] as { expand?: string[] }[],
    paymentIntentsCancel: [] as string[],
  };

  // Stripe returns a Charge ID unless latest_charge is explicitly expanded.
  // Keep the stored details separate so retrieval can request expansion later.
  function response(pi: FakePaymentIntent, params?: { expand?: string[] }) {
    return {
      ...pi,
      latest_charge:
        pi.latest_charge && typeof pi.latest_charge !== "string" &&
        !params?.expand?.includes("latest_charge")
          ? pi.latest_charge.id
          : pi.latest_charge,
    };
  }

  return {
    calls,
    store,
    customers: {
      create: async (params: any) => {
        calls.customersCreate.push(params);
        return { id: `cus_test_${++seq}` };
      },
    },
    paymentIntents: {
      create: async (params: any, opts?: any) => {
        calls.paymentIntentsCreate.push({ params, opts });

        const behavior = options?.onCreatePaymentIntent?.(params);
        if (behavior?.throwError) {
          throw behavior.throwError;
        }

        const id = `pi_test_${++seq}`;
        let status = behavior?.status;
        if (!status) {
          if (params.capture_method === "manual") {
            status = params.confirm ? "requires_capture" : "requires_payment_method";
          } else {
            status = params.confirm ? "succeeded" : "requires_payment_method";
          }
        }

        const pi: FakePaymentIntent = {
          id,
          object: "payment_intent",
          client_secret: `${id}_secret`,
          status,
          amount: params.amount,
          currency: params.currency,
          customer: params.customer ?? null,
          payment_method: params.payment_method ?? null,
          metadata: params.metadata || {},
          capture_method: params.capture_method || "automatic",
          latest_charge: {
            id: `ch_test_${seq}`,
            payment_method_details: {
              card: options?.captureBefore === null ? {} : {
                capture_before: options?.captureBefore ??
                  Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
              },
            },
          },
        };
        store.set(id, pi);
        return response(pi, params) as any;
      },
      retrieve: async (id: string, params?: { expand?: string[] }) => {
        calls.paymentIntentsRetrieve.push(id);
        calls.paymentIntentsRetrieveParameters.push(params ?? {});
        const pi = store.get(id);
        if (!pi) throw new Error(`No such payment_intent: '${id}'`);
        return response(pi, params) as any;
      },
      cancel: async (id: string) => {
        calls.paymentIntentsCancel.push(id);
        const pi = store.get(id);
        if (!pi) throw new Error(`No such payment_intent: '${id}'`);
        // Real Stripe refuses to cancel a PI that has already been captured/succeeded.
        const cancelableStatuses = [
          "requires_payment_method",
          "requires_capture",
          "requires_confirmation",
          "requires_action",
        ];
        if (!cancelableStatuses.includes(pi.status)) {
          throw new Error(
            `This PaymentIntent could not be canceled because it has a status of ${pi.status}.`,
          );
        }
        pi.status = "canceled";
        return pi as any;
      },
    },
  };
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const UNIQUE = `test-rental-deposit-split-${Date.now()}`;

let ownerId: number;
let renterId: number;
let itemId: number;

/**
 * Inserts a fresh ACCEPTED request + renter (with a saved card, so
 * createRentalPaymentHold({ confirmIfSaved: true }) confirms the hold PI
 * off-session immediately, the same path a native-app client with a saved
 * card takes) and returns its id. Every test gets its own request/renter pair
 * so tests don't interfere via depositHoldAttemptId state.
 */
async function makeAcceptedRequest() {
  const [renter] = await db
    .insert(users)
    .values({
      username: `${UNIQUE}-renter-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      reputationScore: 100,
      stripeCustomerId: "cus_test_existing",
      stripePaymentMethodId: "pm_test_saved_card",
    })
    .returning({ id: users.id });

  const [request] = await db
    .insert(itemRequests)
    .values({
      itemId,
      requesterId: renter.id,
      requestType: "RENT",
      status: "ACCEPTED",
      startDate: new Date(Date.now() + 60 * 60 * 1000),
      endDate: new Date(Date.now() + 25 * 60 * 60 * 1000), // two inclusive days
    })
    .returning({ id: itemRequests.id });

  return { requestId: request.id, renterId: renter.id };
}

async function cleanupRequest(requestId: number, renterId: number) {
  await db.delete(messages).where(eq(messages.requestId, requestId));
  await db.delete(rentalPayouts).where(eq(rentalPayouts.requestId, requestId));
  await db.delete(itemRequests).where(eq(itemRequests.id, requestId));
  await db.delete(users).where(eq(users.id, renterId));
}

before(async () => {
  const [owner] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-owner`, reputationScore: 100 })
    .returning({ id: users.id });
  ownerId = owner.id;

  // Fixed pricing so every test can assert on exact dollar amounts:
  //   deposit = securityDeposit override = $50
  //   weekly rate override = $70 -> two days -> rentalAmount = $20
  //   processingFee = round((20 + 50) * 0.03, 2) = $2.10
  const [item] = await db
    .insert(items)
    .values({
      ownerId,
      name: `${UNIQUE}-item`,
      description: "test item for deposit/charge split",
      category: "Home & Kitchen",
      tier: 2,
      conditionRating: 4,
      photos: [],
      securityDeposit: "50",
      dollarsPrice: "70",
      lendingDuration: 7,
      shareCoinsReward: "0",
      replacementValue: 200,
    })
    .returning({ id: items.id });
  itemId = item.id;
});

after(async () => {
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(eq(users.id, ownerId));
  await pool.end();
});

// ── 1. create-payment-hold: deposit-only manual-capture hold ────────────────────

test("createRentalPaymentHold creates a manual-capture PaymentIntent for the deposit amount only", async () => {
  const { requestId, renterId } = await makeAcceptedRequest();
  try {
    const fakeStripe = createFakeStripe();

    const result = await createRentalPaymentHold({
      requestId,
      userId: renterId,
      confirmIfSaved: true,
      stripeClient: fakeStripe as any,
    });

    assert.equal(result.status, 200, `expected 200, got ${result.status}: ${JSON.stringify(result.body)}`);
    assert.equal(fakeStripe.calls.paymentIntentsCreate.length, 1, "exactly one PaymentIntent should be created for the hold");

    const { params } = fakeStripe.calls.paymentIntentsCreate[0];
    assert.equal(params.capture_method, "manual", "deposit hold must use manual capture, not an immediate charge");
    assert.equal(params.expand, undefined, "keep creation parameters compatible with earlier idempotent attempts");
    assert.deepEqual(fakeStripe.calls.paymentIntentsRetrieveParameters[0].expand, ["latest_charge"], "read the exact deadline separately");
    assert.equal(params.amount, 5000, "hold amount must equal the deposit only (in cents): $50.00");
    assert.equal(params.metadata.type, "rental_payment_deposit");
    assert.equal(params.metadata.depositAmount, "50");

    // The response must surface the deposit/rental amounts separately — never a single
    // combined "amount charged" figure that could be mistaken for an immediate charge.
    assert.equal(result.body.depositAmount, 50);
    assert.equal(result.body.rentalAmount, 20);
    assert.equal(result.body.totalHoldAmount, 72.1);

    // The PI Stripe actually created must itself be an uncaptured hold, not a charge.
    const createdPI = fakeStripe.store.get(result.body.paymentIntentId)!;
    assert.equal(createdPI.status, "requires_capture", "hold PI must be authorized, not captured");
    assert.deepEqual(fakeStripe.calls.paymentIntentsCancel, [], "a sufficient authorization must not be canceled");
    const [requestAfter] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
    assert.equal(requestAfter.depositMode, "authorization");
    assert.equal(requestAfter.depositSelectionState, "hold_attempted");
  } finally {
    await cleanupRequest(requestId, renterId);
  }
});

test("a verified hold deadline shorter than the protection period still requires refundable-payment consent", async () => {
  const { requestId, renterId } = await makeAcceptedRequest();
  try {
    const fakeStripe = createFakeStripe({
      // The hold only needs to cover return date + 1 day (no claim-review buffer),
      // so use a deadline that is clearly shorter than that.
      captureBefore: Math.floor(Date.now() / 1000) + 60 * 60,
    });
    const result = await createRentalPaymentHold({
      requestId, userId: renterId, confirmIfSaved: true, stripeClient: fakeStripe as any,
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.consentRequired, true);
    assert.equal(result.body.selectionReason, "authorization_window_insufficient");
    assert.equal(fakeStripe.calls.paymentIntentsCreate.length, 1, "no refundable charge without consent");
    const holdId = [...fakeStripe.store.keys()][0];
    assert.deepEqual(fakeStripe.calls.paymentIntentsCancel, [holdId]);
    assert.equal(fakeStripe.store.get(holdId)!.status, "canceled");
    const [requestAfter] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
    assert.equal(requestAfter.depositSelectionState, "consent_required");
    assert.equal(requestAfter.status, "ACCEPTED");
    assert.equal(requestAfter.depositPaymentIntentId, null);
  } finally {
    await cleanupRequest(requestId, renterId);
  }
});

test("retrying a valid rental authorization reuses the same hold", async () => {
  const { requestId, renterId } = await makeAcceptedRequest();
  try {
    const fakeStripe = createFakeStripe();
    const args = { requestId, userId: renterId, confirmIfSaved: true, stripeClient: fakeStripe as any };
    const first = await createRentalPaymentHold(args);
    const retry = await createRentalPaymentHold(args);
    assert.equal(first.status, 200);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.paymentIntentId, first.body.paymentIntentId);
    assert.equal(fakeStripe.calls.paymentIntentsCreate.length, 1);
    assert.deepEqual(fakeStripe.calls.paymentIntentsCancel, []);
  } finally {
    await cleanupRequest(requestId, renterId);
  }
});

test("an indeterminate rental hold lookup never advances the attempt or authorizes a second hold", async () => {
  const { requestId, renterId } = await makeAcceptedRequest();
  try {
    const fakeStripe = createFakeStripe();
    const args = { requestId, userId: renterId, confirmIfSaved: true, stripeClient: fakeStripe as any };
    const first = await createRentalPaymentHold(args);
    assert.equal(first.status, 200);
    fakeStripe.paymentIntents.retrieve = async () => { throw new Error("Stripe read timed out"); };
    await assert.rejects(createRentalPaymentHold(args), /read timed out/);
    assert.equal(fakeStripe.calls.paymentIntentsCreate.length, 1);
    assert.deepEqual(fakeStripe.calls.paymentIntentsCancel, []);
    const [requestAfter] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
    assert.equal(requestAfter.depositHoldAttemptNum, 0);
    assert.equal(requestAfter.depositHoldAttemptId, first.body.paymentIntentId);
  } finally {
    await cleanupRequest(requestId, renterId);
  }
});

test("an expanded Charge with no verifiable deadline still fails safely without charging a refundable deposit", async () => {
  const { requestId, renterId } = await makeAcceptedRequest();
  try {
    const fakeStripe = createFakeStripe({ captureBefore: null });
    const result = await createRentalPaymentHold({
      requestId, userId: renterId, confirmIfSaved: true, stripeClient: fakeStripe as any,
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.consentRequired, true);
    assert.equal(result.body.selectionReason, "authorization_window_insufficient");
    assert.equal(fakeStripe.calls.paymentIntentsCreate[0].params.expand, undefined);
    assert.deepEqual(fakeStripe.calls.paymentIntentsRetrieveParameters[0].expand, ["latest_charge"]);
    assert.equal(fakeStripe.calls.paymentIntentsCreate.length, 1, "no automatic refundable charge");
    assert.equal(fakeStripe.calls.paymentIntentsCancel.length, 1);
  } finally {
    await cleanupRequest(requestId, renterId);
  }
});

test("long rentals still require consent before creating any Stripe authorization or charge", async () => {
  const { requestId, renterId } = await makeAcceptedRequest();
  try {
    await db.update(itemRequests).set({
      endDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
    }).where(eq(itemRequests.id, requestId));
    const fakeStripe = createFakeStripe();
    const result = await createRentalPaymentHold({
      requestId, userId: renterId, confirmIfSaved: true, stripeClient: fakeStripe as any,
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.consentRequired, true);
    assert.equal(result.body.selectionReason, "request_exceeds_authorization_window");
    assert.deepEqual(fakeStripe.calls.paymentIntentsCreate, []);
    assert.deepEqual(fakeStripe.calls.paymentIntentsCancel, []);
  } finally {
    await cleanupRequest(requestId, renterId);
  }
});

// ── 2. confirm-rental-deposit: separate automatic-capture rental+fee PI ────────

test("confirmRentalDeposit charges rentalAmount + processingFee as a SEPARATE automatic-capture PaymentIntent, and stores its id on the payout (not the deposit's)", async () => {
  const { requestId, renterId } = await makeAcceptedRequest();
  try {
    const fakeStripe = createFakeStripe();

    const holdResult = await createRentalPaymentHold({
      requestId,
      userId: renterId,
      confirmIfSaved: true,
      stripeClient: fakeStripe as any,
    });
    assert.equal(holdResult.status, 200);
    const depositPaymentIntentId = holdResult.body.paymentIntentId;

    const confirmResult = await confirmRentalDeposit({
      requestId,
      userId: renterId,
      paymentIntentId: depositPaymentIntentId,
      stripeClient: fakeStripe as any,
    });

    assert.equal(confirmResult.status, 200, `expected 200, got ${confirmResult.status}: ${JSON.stringify(confirmResult.body)}`);

    // Exactly two PaymentIntents should exist by now: the deposit hold, and the
    // separate rental+fee charge created during confirmation.
    assert.equal(fakeStripe.calls.paymentIntentsCreate.length, 2, "expected exactly 2 PaymentIntents: deposit hold + rental charge");
    const rentalChargeCall = fakeStripe.calls.paymentIntentsCreate[1].params;

    assert.notEqual(rentalChargeCall.capture_method, "manual", "rental+fee charge must NOT be a manual hold");
    assert.equal(rentalChargeCall.confirm, true, "rental+fee charge must be confirmed immediately (charged, not held)");
    assert.equal(rentalChargeCall.amount, 2210, "rental+fee charge amount must equal rentalAmount ($20) + processingFee ($2.10) = $22.10, in cents");
    assert.equal(rentalChargeCall.metadata.type, "rental_payment");
    assert.equal(rentalChargeCall.metadata.depositPaymentIntentId, depositPaymentIntentId);

    // Find the actual second PaymentIntent's id (distinct from the deposit's).
    const rentalPaymentIntentId = [...fakeStripe.store.keys()].find((id) => id !== depositPaymentIntentId)!;
    assert.ok(rentalPaymentIntentId, "a second PaymentIntent must have been created");
    assert.notEqual(rentalPaymentIntentId, depositPaymentIntentId);

    const [payout] = await db.select().from(rentalPayouts).where(eq(rentalPayouts.requestId, requestId));
    assert.ok(payout, "confirming the deposit must create a held rentalPayouts row");
    assert.equal(
      payout.stripePaymentIntentId,
      rentalPaymentIntentId,
      "rentalPayouts.stripePaymentIntentId must store the RENTAL charge's PI id, not the deposit hold's",
    );
    assert.notEqual(payout.stripePaymentIntentId, depositPaymentIntentId);

    const [updatedRequest] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
    assert.equal(updatedRequest.status, "DEPOSIT_CONFIRMED");
    assert.equal(updatedRequest.depositPaymentIntentId, depositPaymentIntentId);
  } finally {
    await cleanupRequest(requestId, renterId);
  }
});

// ── 3. Second-charge failure: deposit released, never DEPOSIT_CONFIRMED ────────

test("if the rental+fee charge fails, the deposit hold is released and the request is NOT marked DEPOSIT_CONFIRMED", async () => {
  const { requestId, renterId } = await makeAcceptedRequest();
  try {
    const fakeStripe = createFakeStripe({
      onCreatePaymentIntent: (params) => {
        // Fail only the second (rental+fee) charge — a simulated card decline —
        // while letting the first (deposit hold) creation succeed normally.
        if (params.metadata?.type === "rental_payment") {
          const declineError: any = new Error("Your card was declined.");
          declineError.type = "StripeCardError";
          declineError.code = "card_declined";
          return { throwError: declineError };
        }
      },
    });

    const holdResult = await createRentalPaymentHold({
      requestId,
      userId: renterId,
      confirmIfSaved: true,
      stripeClient: fakeStripe as any,
    });
    assert.equal(holdResult.status, 200);
    const depositPaymentIntentId = holdResult.body.paymentIntentId;
    assert.equal(fakeStripe.store.get(depositPaymentIntentId)!.status, "requires_capture");

    const confirmResult = await confirmRentalDeposit({
      requestId,
      userId: renterId,
      paymentIntentId: depositPaymentIntentId,
      stripeClient: fakeStripe as any,
    });

    assert.equal(confirmResult.status, 402, `expected a payment-failure status, got ${confirmResult.status}: ${JSON.stringify(confirmResult.body)}`);
    assert.equal(confirmResult.body.depositReleased, true, "response must indicate the deposit hold was released");

    // The deposit hold must actually have been cancelled with Stripe...
    assert.ok(
      fakeStripe.calls.paymentIntentsCancel.includes(depositPaymentIntentId),
      "paymentIntents.cancel must have been called for the deposit hold after the rental charge failed",
    );
    assert.equal(fakeStripe.store.get(depositPaymentIntentId)!.status, "canceled");

    // ...and the request must NOT have been advanced to DEPOSIT_CONFIRMED, nor left with
    // a payout row for a rental that was never actually paid for.
    const [requestAfter] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
    assert.equal(requestAfter.status, "ACCEPTED", "request must remain ACCEPTED, not DEPOSIT_CONFIRMED, when the rental charge fails");
    assert.equal(requestAfter.depositPaymentIntentId, null);

    const payouts = await db.select().from(rentalPayouts).where(eq(rentalPayouts.requestId, requestId));
    assert.equal(payouts.length, 0, "no escrow payout should be created when the rental charge failed");
  } finally {
    await cleanupRequest(requestId, renterId);
  }
});

// ── 4. Deposit hold remains cancelable after a successful confirmation ─────────

test("after confirmRentalDeposit succeeds, the deposit hold is still an uncaptured, cancelable manual hold", async () => {
  const { requestId, renterId } = await makeAcceptedRequest();
  try {
    const fakeStripe = createFakeStripe();

    const holdResult = await createRentalPaymentHold({
      requestId,
      userId: renterId,
      confirmIfSaved: true,
      stripeClient: fakeStripe as any,
    });
    const depositPaymentIntentId = holdResult.body.paymentIntentId;

    const confirmResult = await confirmRentalDeposit({
      requestId,
      userId: renterId,
      paymentIntentId: depositPaymentIntentId,
      stripeClient: fakeStripe as any,
    });
    assert.equal(confirmResult.status, 200, `expected 200, got ${confirmResult.status}: ${JSON.stringify(confirmResult.body)}`);

    // confirmRentalDeposit must NOT have captured or otherwise consumed the deposit
    // hold — it must remain exactly as authorized, so the existing release/dispute
    // flow (used e.g. on a clean return, or an owner-claimed damage dispute) still
    // works against it.
    const depositPI = fakeStripe.store.get(depositPaymentIntentId)!;
    assert.equal(depositPI.status, "requires_capture", "deposit hold must remain an uncaptured authorization after confirmation");

    // The pre-existing release path calls paymentIntents.cancel(depositPaymentIntentId)
    // directly (see e.g. the return/cancellation handlers in routes.ts) — it must still
    // succeed against this same hold.
    const canceled = await fakeStripe.paymentIntents.cancel(depositPaymentIntentId);
    assert.equal(canceled.status, "canceled");
  } finally {
    await cleanupRequest(requestId, renterId);
  }
});
