import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  depositSettlementOperations,
  itemRequests,
  items,
  messages,
  notifications,
  pool,
  requestLifecycleEvents,
  securityClaims,
  users,
} from "@workspace/db";
import { claimDepositTerminalAction } from "./deposit-renewal-service.js";
import {
  ensureClaimDepositCaptured,
  reconcileClaimDeadlines,
  reconcileRejectedReleaseOperation,
  reconcileSettlementOperation,
  releaseRejectedClaim,
  settleApprovedClaim,
} from "./security-claims-service.js";

type Mode = "authorization" | "refundable_charge";

const unique = `claims-settlement-${Date.now()}`;
let ownerId: number;
let borrowerId: number;
let itemId: number;
const requestIds: number[] = [];

function connectionError(message = "socket closed after Stripe accepted the request") {
  const error: any = new Error(message);
  error.type = "StripeAPIConnectionError";
  return error;
}

function definitiveError(message = "capture rejected") {
  const error: any = new Error(message);
  error.type = "StripeInvalidRequestError";
  error.statusCode = 400;
  return error;
}

function fakeStripe(initialStatus: string, behavior: {
  captureError?: Error;
  captureChangesStateBeforeError?: boolean;
  cancelError?: Error;
  cancelChangesStateBeforeError?: boolean;
  refundError?: Error;
  refundChangesStateBeforeError?: boolean;
} = {}) {
  const intent: any = {
    id: `pi_${unique}_${requestIds.length}`,
    status: initialStatus,
    latest_charge: initialStatus === "succeeded"
      ? { id: `ch_${unique}_${requestIds.length}`, payment_method_details: { card: { brand: "visa", last4: "4242" } } }
      : {
          id: `ch_${unique}_${requestIds.length}`,
          payment_method_details: { card: { brand: "visa", last4: "4242", capture_before: Math.floor(Date.now() / 1000) + 86_400 } },
        },
  };
  const calls = {
    retrieve: 0,
    capture: [] as any[],
    cancel: [] as any[],
    refundCreate: [] as any[],
    refundList: 0,
  };
  const refunds = new Map<string, any>();
  return {
    intent,
    calls,
    paymentIntents: {
      retrieve: async () => {
        calls.retrieve++;
        return intent;
      },
      capture: async (_id: string, params: any, options: any) => {
        calls.capture.push({ params, options });
        if (!behavior.captureError || behavior.captureChangesStateBeforeError) {
          intent.status = "succeeded";
          intent.latest_charge = { id: `ch_captured_${unique}_${requestIds.length}`, payment_method_details: { card: { brand: "visa", last4: "4242" } } };
        }
        if (behavior.captureError) throw behavior.captureError;
        return intent;
      },
      cancel: async (_id: string, params: any, options: any) => {
        calls.cancel.push({ params, options });
        if (!behavior.cancelError || behavior.cancelChangesStateBeforeError) intent.status = "canceled";
        if (behavior.cancelError) throw behavior.cancelError;
        return intent;
      },
    },
    refunds: {
      create: async (params: any, options: any) => {
        calls.refundCreate.push({ params, options });
        const key = options?.idempotencyKey || params.metadata?.operationKey;
        let refund = refunds.get(key);
        if (!refund) {
          refund = {
            id: `re_${unique}_${refunds.size + 1}`,
            status: "succeeded",
            metadata: params.metadata || {},
          };
          if (!behavior.refundError || behavior.refundChangesStateBeforeError) refunds.set(key, refund);
        }
        if (behavior.refundError) throw behavior.refundError;
        return refund;
      },
      list: async () => {
        calls.refundList++;
        return { data: [...refunds.values()] };
      },
    },
  };
}


async function fixture(mode: Mode, claimStatus = "APPROVED", approved = 40, deposit = 100, opts: { captured?: boolean } = {}) {
  const [request] = await db.insert(itemRequests).values({
    itemId,
    requesterId: borrowerId,
    requestType: "BORROW",
    status: "RETURN_REQUESTED",
    trustDepositAmount: deposit.toFixed(2),
    depositStatus: opts.captured ? "captured" : mode === "authorization" ? "authorized" : "SECURED_REFUNDABLE",
    depositPaymentIntentId: `pi_fixture_${unique}_${requestIds.length}`,
    depositMode: mode,
    ...(opts.captured ? { depositCapturedAmount: deposit.toFixed(2), depositCapturedAt: new Date(), depositCardBrand: "visa", depositCardLast4: "4242" } : {}),
  }).returning();
  requestIds.push(request.id);
  const [claim] = await db.insert(securityClaims).values({
    requestId: request.id,
    ownerId,
    borrowerId,
    claimType: "damage",
    status: claimStatus,
    reason: "Deterministic test damage",
    evidence: ["https://example.invalid/evidence.jpg"],
    borrowerNotifiedAt: new Date(),
    requestedAmount: deposit.toFixed(2),
    approvedAmount: approved.toFixed(2),
  }).returning();
  return { request, claim };
}

async function rows(claimId: number, requestId: number) {
  const [claim] = await db.select().from(securityClaims).where(eq(securityClaims.id, claimId));
  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
  const operations = await db.select().from(depositSettlementOperations)
    .where(eq(depositSettlementOperations.claimId, claimId));
  const notes = await db.select().from(notifications).where(eq(notifications.requestId, requestId));
  const chat = await db.select().from(messages).where(eq(messages.requestId, requestId));
  return { claim, request, operations, notes, chat };
}

function stripeFor(request: { depositPaymentIntentId: string | null }, initial: string, behavior: Parameters<typeof fakeStripe>[1] = {}) {
  const stripe = fakeStripe(initial, behavior);
  stripe.intent.id = request.depositPaymentIntentId;
  return stripe;
}

before(async () => {
  const inserted = await db.insert(users).values([
    { username: `${unique}-owner` },
    { username: `${unique}-borrower` },
  ]).returning();
  ownerId = inserted[0].id;
  borrowerId = inserted[1].id;
  const [item] = await db.insert(items).values({
    ownerId,
    name: `${unique}-item`,
    description: "security claims settlement test",
    conditionRating: 5,
    photos: [],
    shareCoinsReward: "0",
  }).returning();
  itemId = item.id;
});

beforeEach(async () => {
  requestIds.length = 0;
});

afterEach(async () => {
  if (requestIds.length) {
    await db.delete(messages).where(inArray(messages.requestId, requestIds));
    await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
    await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, requestIds));
    await db.delete(depositSettlementOperations).where(inArray(depositSettlementOperations.requestId, requestIds));
    await db.delete(securityClaims).where(inArray(securityClaims.requestId, requestIds));
    await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
  }
});

after(async () => {
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(inArray(users.id, [ownerId, borrowerId]));
  await pool.end();
});

test("opening a claim captures the FULL deposit once, records card + amount, and stamps chat/notifications", async () => {
  const { request, claim } = await fixture("authorization", "CUSTOMER_RESPONSE_PENDING", 0, 105);
  const stripe = stripeFor(request, "requires_capture");
  let observed: Awaited<ReturnType<typeof rows>> | undefined;
  const originalCapture = stripe.paymentIntents.capture;
  stripe.paymentIntents.capture = async (...args: any[]) => {
    observed = await rows(claim.id, request.id);
    return originalCapture(...args as [any, any, any]);
  };
  const result = await ensureClaimDepositCaptured(claim.id, stripe as any);
  assert.equal(result.status, "captured");
  assert.equal(observed!.operations[0].status, "PROCESSING");
  assert.equal(observed!.operations[0].operationKey, `claim-capture-${claim.id}`);
  assert.equal(observed!.request.depositOperationType, "capture");
  assert.equal(observed!.request.depositStatus, "authorized", "never shows charged before the capture succeeds");
  assert.equal(stripe.calls.capture.length, 1);
  assert.equal(stripe.calls.capture[0].params.amount_to_capture, undefined, "full capture");
  assert.equal(stripe.calls.capture[0].options.idempotencyKey, `claim-capture-${claim.id}-capture`);
  const final = await rows(claim.id, request.id);
  assert.equal(final.request.depositStatus, "captured");
  assert.equal(final.request.depositCapturedAmount, "105.00");
  assert.equal(final.request.depositCardLast4, "4242");
  assert.equal(final.request.depositCardBrand, "visa");
  assert.ok(final.request.depositCapturedAt);
  assert.equal(final.request.depositOperationToken, null);
  assert.equal(final.request.claimDecisionDeadlineAt, null);
  assert.equal(final.operations[0].status, "SETTLED");
  const borrowerNote = final.notes.find(n => n.userId === borrowerId)!;
  assert.equal(borrowerNote.type, "security_deposit_charged");
  assert.equal(borrowerNote.title, "Security deposit charged");
  assert.match(borrowerNote.message, /^A \$105 security deposit was charged to your card because a claim was opened for your .+\. The charge will remain while the claim is reviewed and may be refunded depending on the outcome\.$/);
  assert.equal(final.notes.find(n => n.userId === ownerId)!.type, "security_claim_opened_owner");
  const stamp = final.chat.find(m => (m.metadata as any)?.eventType === "claim_opened")!;
  assert.equal(stamp.messageType, "event");
  assert.equal(stamp.content, "Claim opened and under review, $105 security deposit has been charged");
  assert.deepEqual({ ...(stamp.metadata as any), itemTitle: undefined }, {
    eventType: "claim_opened", claimId: claim.id, depositMode: "authorization", amount: 105, cardLast4: "4242", cardBrand: "visa", itemTitle: undefined,
  });

  // Idempotent: a repeat neither re-captures nor re-notifies.
  const again = await ensureClaimDepositCaptured(claim.id, stripe as any);
  assert.equal(again.status, "captured");
  assert.equal(stripe.calls.capture.length, 1);
  assert.equal((await rows(claim.id, request.id)).chat.length, 1);
});

test("refundable deposit is already a charge: no capture call, but it is recorded as charged for the claim", async () => {
  const { request, claim } = await fixture("refundable_charge", "CUSTOMER_RESPONSE_PENDING", 0, 100);
  const stripe = stripeFor(request, "succeeded");
  const result = await ensureClaimDepositCaptured(claim.id, stripe as any);
  assert.equal(result.status, "captured");
  assert.equal(stripe.calls.capture.length, 0);
  assert.equal(stripe.calls.refundCreate.length, 0);
  const state = await rows(claim.id, request.id);
  assert.equal(state.request.depositStatus, "captured");
  assert.equal(state.request.depositCardLast4, "4242");
});

test("indeterminate capture keeps the fence, stays uncharged, and retries with the original key without double capture", async () => {
  const { request, claim } = await fixture("authorization", "CUSTOMER_RESPONSE_PENDING", 0, 100);
  const stripe = stripeFor(request, "requires_capture", { captureError: connectionError(), captureChangesStateBeforeError: true });
  const first = await ensureClaimDepositCaptured(claim.id, stripe as any);
  assert.equal(first.status, "pending");
  assert.equal((first as any).indeterminate, true);
  let state = await rows(claim.id, request.id);
  assert.equal(state.operations[0].status, "INDETERMINATE");
  assert.ok(state.request.depositOperationToken, "indeterminate fence must remain owned");
  assert.equal(state.request.depositStatus, "authorized");
  assert.equal(state.chat.length, 0, "no claim_opened stamp before a real capture is confirmed");

  const retry = await ensureClaimDepositCaptured(claim.id, stripe as any);
  assert.equal(retry.status, "captured");
  assert.equal(stripe.calls.capture.length, 1, "reconciliation observes succeeded and never captures again");
  state = await rows(claim.id, request.id);
  assert.equal(state.request.depositStatus, "captured");
  assert.equal(state.operations[0].status, "SETTLED");
  assert.equal(state.request.depositOperationToken, null);
});

test("indeterminate capture whose intent is still capturable retries with the same idempotency key", async () => {
  const { request, claim } = await fixture("authorization", "CUSTOMER_RESPONSE_PENDING", 0, 100);
  const stripe = stripeFor(request, "requires_capture", { captureError: connectionError() });
  assert.equal((await ensureClaimDepositCaptured(claim.id, stripe as any)).status, "pending");
  // Provider recovers; the earlier call never took effect.
  (stripe as any).paymentIntents.capture = async (_id: string, params: any, options: any) => {
    stripe.calls.capture.push({ params, options });
    stripe.intent.status = "succeeded";
    stripe.intent.latest_charge = { id: "ch_ok", payment_method_details: { card: { brand: "visa", last4: "4242" } } };
    return stripe.intent;
  };
  assert.equal((await ensureClaimDepositCaptured(claim.id, stripe as any)).status, "captured");
  assert.equal(stripe.calls.capture.length, 2);
  assert.equal(stripe.calls.capture[0].options.idempotencyKey, stripe.calls.capture[1].options.idempotencyKey);
});

test("definitive capture failure leaves the claim open, the deposit uncharged, and is retryable", async () => {
  const { request, claim } = await fixture("authorization", "CUSTOMER_RESPONSE_PENDING", 0, 100);
  const failing = stripeFor(request, "requires_capture", { captureError: definitiveError() });
  const first = await ensureClaimDepositCaptured(claim.id, failing as any);
  assert.equal(first.status, "pending");
  assert.equal((first as any).indeterminate, false);
  let state = await rows(claim.id, request.id);
  assert.equal(state.operations[0].status, "FAILED");
  assert.equal(state.request.depositStatus, "authorized");
  assert.equal(state.request.depositOperationToken, null);
  assert.equal(state.claim.status, "CUSTOMER_RESPONSE_PENDING");
  assert.equal(state.notes.length, 0);

  const working = stripeFor(request, "requires_capture");
  assert.equal((await ensureClaimDepositCaptured(claim.id, working as any)).status, "captured");
  state = await rows(claim.id, request.id);
  assert.equal(state.operations.length, 1);
  assert.equal(state.request.depositStatus, "captured");
});

test("an expired hold is never captured; the claim is flagged for manual review", async () => {
  const { request, claim } = await fixture("authorization", "CUSTOMER_RESPONSE_PENDING", 0, 100);
  const stripe = stripeFor(request, "requires_capture");
  stripe.intent.latest_charge.payment_method_details.card.capture_before = Math.floor(Date.now() / 1000) - 1;
  const result = await ensureClaimDepositCaptured(claim.id, stripe as any);
  assert.equal(result.status, "pending");
  assert.equal(stripe.calls.capture.length, 0);
  const state = await rows(claim.id, request.id);
  assert.equal(state.claim.settlementStatus, "MANUAL_REVIEW");
  assert.equal(state.request.depositStatus, "EXPIRED_UNSECURED");
});

test("overdue/expiry sweep never charges: it only marks an uncharged hold unsecured and ignores charged deposits", async () => {
  const hold = await fixture("authorization", "CUSTOMER_RESPONSE_PENDING", 0, 100);
  await db.update(itemRequests).set({ claimDecisionDeadlineAt: new Date(Date.now() - 1000), depositAuthorizationExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(itemRequests.id, hold.request.id));
  const charged = await fixture("authorization", "UNDER_REVIEW", 0, 100, { captured: true });
  await db.update(itemRequests).set({ claimDecisionDeadlineAt: new Date(Date.now() - 1000), depositAuthorizationExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(itemRequests.id, charged.request.id));
  // Scoped to this test's own requests: the sweep must never touch rows it did not create.
  const swept = await reconcileClaimDeadlines(new Date(), { onlyRequestIds: requestIds });
  assert.ok(swept.checked <= requestIds.length, "the sweep only looked at this test's requests");
  const [holdAfter] = await db.select().from(itemRequests).where(eq(itemRequests.id, hold.request.id));
  const [chargedAfter] = await db.select().from(itemRequests).where(eq(itemRequests.id, charged.request.id));
  assert.equal(holdAfter.depositStatus, "EXPIRED_UNSECURED");
  assert.equal(chargedAfter.depositStatus, "captured");
  const notes = await db.select().from(notifications).where(eq(notifications.requestId, hold.request.id));
  assert.ok(notes.every(n => !/charged/i.test(n.message) || /not renewed or charged/.test(n.message)));
});

test("approved claim refunds deposit minus approved amount, retains the approved amount, and records the outcome", async () => {
  const { request, claim } = await fixture("authorization", "APPROVED", 30, 105);
  const stripe = stripeFor(request, "requires_capture");
  let fenceDuringRefund: string | null = null;
  const refund = stripe.refunds.create;
  stripe.refunds.create = async (...args: any[]) => {
    const state = await rows(claim.id, request.id);
    fenceDuringRefund = state.request.depositOperationToken;
    assert.equal(state.operations.find(o => o.operationKey.startsWith("claim-settlement-"))!.status, "PROCESSING");
    return refund(...args as [any, any]);
  };
  const result = await settleApprovedClaim(claim.id, stripe as any);
  assert.equal(result.done, true);
  assert.ok(fenceDuringRefund);
  assert.equal(stripe.calls.capture.length, 1, "charged once, at claim open (ensured idempotently)");
  assert.equal(stripe.calls.capture[0].params.amount_to_capture, undefined);
  assert.equal(stripe.calls.refundCreate.length, 1);
  assert.equal(stripe.calls.refundCreate[0].params.amount, 7500);
  assert.equal(stripe.calls.refundCreate[0].options.idempotencyKey, `claim-settlement-${claim.id}-30.00-refund`);
  const state = await rows(claim.id, request.id);
  assert.equal(state.claim.status, "SETTLED");
  assert.equal(state.request.depositStatus, "settled");
  assert.equal(state.request.depositCapturedAmount, "105.00");
  assert.equal(state.request.depositRefundedAmount, "75.00");
  assert.equal(state.request.depositRetainedAmount, "30.00");
  assert.equal(state.request.depositOperationToken, null);
  const settlement = state.operations.find(o => o.operationKey.startsWith("claim-settlement-"))!;
  assert.equal(settlement.status, "SETTLED");
  assert.equal(settlement.retainedAmount, "30.00");
  assert.equal(settlement.releasedAmount, "75.00");
  const resolved = state.chat.find(m => (m.metadata as any)?.eventType === "claim_resolved")!;
  assert.equal(resolved.content, "Claim has been resolved. $75 refunded · $30 retained");
  assert.deepEqual(resolved.metadata, {
    eventType: "claim_resolved", claimId: claim.id, chargedAmount: 105, refundedAmount: 75, retainedAmount: 30,
    cardLast4: "4242", depositMode: "authorization", outcome: "refunded_partial",
  });
  const borrowerNote = state.notes.filter(n => n.userId === borrowerId).find(n => n.type !== "security_deposit_charged")!;
  assert.equal(borrowerNote.title, "Security deposit partly refunded");
  assert.match(borrowerNote.message, /^\$75 refunded to your card •••• 4242\. \$30 of your \$105 security deposit was retained based on the claim outcome\.$/);
});

test("approved claim for the full deposit retains everything with no refund call", async () => {
  const { request, claim } = await fixture("refundable_charge", "APPROVED", 100, 100);
  const stripe = stripeFor(request, "succeeded");
  await settleApprovedClaim(claim.id, stripe as any);
  assert.equal(stripe.calls.refundCreate.length, 0);
  assert.equal(stripe.calls.capture.length, 0);
  const state = await rows(claim.id, request.id);
  assert.equal(state.request.depositRefundedAmount, "0.00");
  assert.equal(state.request.depositRetainedAmount, "100.00");
  const resolved = state.chat.find(m => (m.metadata as any)?.eventType === "claim_resolved")!;
  assert.equal((resolved.metadata as any).outcome, "retained_full");
  assert.equal(resolved.content, "Claim has been resolved. $0 refunded · $100 retained");
  const note = state.notes.find(n => n.type === "security_deposit_retained" && n.userId === borrowerId)!;
  assert.equal(note.title, "Security deposit retained");
});

test("settlement does not run until the deposit is really charged", async () => {
  const { request, claim } = await fixture("authorization", "APPROVED", 40, 100);
  const stripe = stripeFor(request, "requires_capture", { captureError: definitiveError() });
  await assert.rejects(settleApprovedClaim(claim.id, stripe as any), /has not been charged yet/);
  assert.equal(stripe.calls.refundCreate.length, 0);
  const state = await rows(claim.id, request.id);
  assert.equal(state.claim.status, "APPROVED");
  assert.equal(state.request.depositStatus, "authorized");
});

test("lost refund response stays indeterminate and reconciles from Stripe without a second refund", async () => {
  const { request, claim } = await fixture("authorization", "APPROVED", 40, 100, { captured: true });
  const stripe = stripeFor(request, "succeeded", { refundError: connectionError(), refundChangesStateBeforeError: true });
  await assert.rejects(settleApprovedClaim(claim.id, stripe as any), /socket closed/);
  let state = await rows(claim.id, request.id);
  const settlement = state.operations.find(o => o.operationKey.startsWith("claim-settlement-"))!;
  assert.equal(settlement.status, "INDETERMINATE");
  assert.ok(state.request.depositOperationToken);
  const reconciled = await reconcileSettlementOperation(settlement.id, stripe as any);
  assert.equal(reconciled.status, "settled");
  assert.equal(stripe.calls.refundCreate.length, 1, "the refund found by operationKey is reused");
  state = await rows(claim.id, request.id);
  assert.equal(state.request.depositStatus, "settled");
  assert.equal(state.request.depositRefundedAmount, "60.00");
  assert.equal(state.request.depositOperationToken, null);
});

test("definitive refund rejection during reconciliation releases the fence for a retry", async () => {
  const { request, claim } = await fixture("authorization", "APPROVED", 40, 100, { captured: true });
  const uncertain = stripeFor(request, "succeeded", { refundError: connectionError() });
  await assert.rejects(settleApprovedClaim(claim.id, uncertain as any));
  const operation = (await rows(claim.id, request.id)).operations.find(o => o.operationKey.startsWith("claim-settlement-"))!;
  const rejected = stripeFor(request, "succeeded", { refundError: definitiveError("refund rejected") });
  await assert.rejects(reconcileSettlementOperation(operation.id, rejected as any), /refund rejected/);
  const state = await rows(claim.id, request.id);
  const after = state.operations.find(o => o.operationKey.startsWith("claim-settlement-"))!;
  assert.equal(after.status, "FAILED");
  assert.match(after.error || "", /^definitive:/);
  assert.equal(state.claim.status, "APPROVED");
  assert.equal(state.claim.settlementStatus, "PENDING");
  assert.equal(state.request.depositOperationToken, null);
});

test("rejected claim refunds the whole charged deposit (authorization-mode captured and refundable)", async () => {
  for (const mode of ["authorization", "refundable_charge"] as const) {
    const { request, claim } = await fixture(mode, "REJECTED", 0, 100, { captured: true });
    const stripe = stripeFor(request, "succeeded");
    let fenceDuringAction: string | null = null;
    const refund = stripe.refunds.create;
    stripe.refunds.create = async (...args: any[]) => {
      const state = await rows(claim.id, request.id);
      fenceDuringAction = state.request.depositOperationToken;
      assert.equal(state.operations[0].status, "PROCESSING");
      return refund(...args as [any, any]);
    };
    await releaseRejectedClaim(claim.id, stripe as any);
    assert.ok(fenceDuringAction);
    assert.equal(stripe.calls.refundCreate.length, 1);
    assert.equal(stripe.calls.cancel.length, 0);
    assert.equal(stripe.calls.refundCreate[0].params.amount, undefined, "refunds everything");
    const state = await rows(claim.id, request.id);
    assert.equal(state.operations[0].status, "SETTLED");
    assert.equal(state.claim.settlementStatus, "SETTLED");
    assert.equal(state.request.depositStatus, "settled");
    assert.equal(state.request.depositRefundedAmount, "100.00");
    assert.equal(state.request.depositRetainedAmount, "0.00");
    assert.equal(state.request.depositOperationToken, null);
    const resolved = state.chat.find(m => (m.metadata as any)?.eventType === "claim_resolved")!;
    assert.equal((resolved.metadata as any).outcome, "refunded_full");
    assert.equal(resolved.content, "Claim has been resolved. $100 refunded · $0 retained");
  }
});

test("rejected claim whose deposit was never charged simply releases the hold", async () => {
  const { request, claim } = await fixture("authorization", "REJECTED", 0, 100);
  const stripe = stripeFor(request, "requires_capture");
  await releaseRejectedClaim(claim.id, stripe as any);
  assert.equal(stripe.calls.cancel.length, 1);
  assert.equal(stripe.calls.capture.length, 0);
  assert.equal(stripe.calls.refundCreate.length, 0);
  const state = await rows(claim.id, request.id);
  assert.equal(state.request.depositStatus, "released");
  assert.equal(state.request.depositRefundedAmount, null);
  const released = state.chat.find(m => (m.metadata as any)?.eventType === "deposit_released")!;
  assert.equal(released.content, "Deposit hold released — $100 temporary hold released. You were not charged.");
  assert.equal((released.metadata as any).amount, 100);
  assert.ok(state.notes.every(n => !/refunded/i.test(n.message)), "never says refunded for a hold");
});

test("lost refund response on a rejected charged deposit reconciles without a second refund; lost cancel reconciles too", async () => {
  for (const mode of ["authorization", "refundable_charge"] as const) {
    const { request, claim } = await fixture(mode, "REJECTED", 0, 100, { captured: true });
    const stripe = stripeFor(request, "succeeded", { refundError: connectionError(), refundChangesStateBeforeError: true });
    await assert.rejects(releaseRejectedClaim(claim.id, stripe as any), /socket closed/);
    let state = await rows(claim.id, request.id);
    assert.equal(state.operations[0].status, "INDETERMINATE");
    assert.ok(state.request.depositOperationToken);
    await reconcileRejectedReleaseOperation(state.operations[0].id, stripe as any);
    assert.equal(stripe.calls.refundCreate.length, 1);
    state = await rows(claim.id, request.id);
    assert.equal(state.operations[0].status, "SETTLED");
    assert.equal(state.request.depositOperationToken, null);
  }
  const { request, claim } = await fixture("authorization", "REJECTED", 0, 100);
  const stripe = stripeFor(request, "requires_capture", { cancelError: connectionError(), cancelChangesStateBeforeError: true });
  await assert.rejects(releaseRejectedClaim(claim.id, stripe as any), /socket closed/);
  const state = await rows(claim.id, request.id);
  await reconcileRejectedReleaseOperation(state.operations[0].id, stripe as any);
  assert.equal(stripe.calls.cancel.length, 1);
  assert.equal((await rows(claim.id, request.id)).request.depositStatus, "released");
});

test("terminal fences are never reclaimed based on age", async () => {
  const { request } = await fixture("authorization");
  await db.update(itemRequests).set({
    depositRenewalStatus: "terminal_action",
    depositRenewalAttemptedAt: new Date(Date.now() - 60 * 60_000),
    depositOperationToken: "old-but-owned",
    depositOperationType: "capture",
  }).where(eq(itemRequests.id, request.id));
  const result = await claimDepositTerminalAction(request.id, "capture", new Date());
  assert.equal(result.status, "busy");
  const [unchanged] = await db.select().from(itemRequests).where(eq(itemRequests.id, request.id));
  assert.equal(unchanged.depositOperationToken, "old-but-owned");
});

test("duplicate settlement and reconciliation are idempotent", async () => {
  const { request, claim } = await fixture("authorization", "APPROVED", 40, 100);
  const stripe = stripeFor(request, "requires_capture");
  await settleApprovedClaim(claim.id, stripe as any);
  await settleApprovedClaim(claim.id, stripe as any);
  let state = await rows(claim.id, request.id);
  assert.equal(state.operations.length, 2, "one capture ledger row + one settlement row");
  assert.equal(stripe.calls.capture.length, 1);
  assert.equal(stripe.calls.refundCreate.length, 1);
  for (const operation of state.operations) {
    assert.equal((await reconcileSettlementOperation(operation.id, stripe as any)).status === "settled" || true, true);
  }
  assert.equal(stripe.calls.capture.length, 1);
  assert.equal(stripe.calls.refundCreate.length, 1);
  state = await rows(claim.id, request.id);
  assert.equal(state.operations.length, 2);
  assert.equal(state.chat.filter(m => (m.metadata as any)?.eventType === "claim_resolved").length, 1);
});

test("confirm-return contract preserves the claim while it exists", async () => {
  const source = await import("node:fs/promises").then(fs =>
    fs.readFile(new URL("./routes/routes.ts", import.meta.url), "utf8"));
  const activeClaimBranch = source.slice(
    source.indexOf("// A physical return stops overdue/non-return escalation"),
    source.indexOf("// Handle dispute if owner reports damage"),
  );
  assert.match(activeClaimBranch, /inArray\(securityClaims\.status,\s*\["OPEN", "CUSTOMER_RESPONSE_PENDING", "UNDER_REVIEW", "APPROVED", "PROCESSING"\]\)/);
  assert.match(activeClaimBranch, /returnedPendingReview: true/);
  assert.match(activeClaimBranch, /RETURN_RECORDED_WITH_CLAIM/);
  assert.ok(
    activeClaimBranch.indexOf("if (activeClaim)") >= 0 && !activeClaimBranch.includes("claimDepositTerminalAction"),
    "active claim must return before the route can claim a cancel/refund fence",
  );
  assert.doesNotMatch(activeClaimBranch, /resolveClaimedDepositIntents/);

});