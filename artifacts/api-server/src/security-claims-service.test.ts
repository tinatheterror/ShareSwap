import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  depositSettlementOperations,
  itemRequests,
  items,
  notifications,
  pool,
  requestLifecycleEvents,
  securityClaims,
  users,
} from "@workspace/db";
import { claimDepositTerminalAction } from "./deposit-renewal-service.js";
import {
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
      ? { id: `ch_${unique}_${requestIds.length}` }
      : {
          id: `ch_${unique}_${requestIds.length}`,
          payment_method_details: { card: { capture_before: Math.floor(Date.now() / 1000) + 86_400 } },
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
          intent.latest_charge = { id: `ch_captured_${unique}_${requestIds.length}` };
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

async function fixture(mode: Mode, claimStatus = "APPROVED", approved = 40, deposit = 100) {
  const [request] = await db.insert(itemRequests).values({
    itemId,
    requesterId: borrowerId,
    requestType: "BORROW",
    status: "RETURN_REQUESTED",
    trustDepositAmount: deposit.toFixed(2),
    depositStatus: mode === "authorization" ? "authorized" : "SECURED_REFUNDABLE",
    depositPaymentIntentId: `pi_fixture_${unique}_${requestIds.length}`,
    depositMode: mode,
    settlementStartDeadlineAt: new Date(Date.now() + 60_000),
    claimDecisionDeadlineAt: new Date(Date.now() + 120_000),
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
  return { claim, request, operations };
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

test("partial authorization capture settles exactly one ledger row before clearing its fence", async () => {
  const { request, claim } = await fixture("authorization");
  const stripe = fakeStripe("requires_capture");
  stripe.intent.id = request.depositPaymentIntentId;
  let observed: Awaited<ReturnType<typeof rows>> | undefined;
  const originalCapture = stripe.paymentIntents.capture;
  stripe.paymentIntents.capture = async (...args: any[]) => {
    observed = await rows(claim.id, request.id);
    return originalCapture(...args as [any, any, any]);
  };

  const result = await settleApprovedClaim(claim.id, stripe as any);
  assert.equal(result.done, true);
  assert.equal(observed!.operations.length, 1);
  assert.equal(observed!.operations[0].status, "PROCESSING");
  assert.equal(observed!.request.depositOperationType, "capture");
  assert.ok(observed!.request.depositOperationToken);
  assert.equal(stripe.calls.capture.length, 1);
  assert.equal(stripe.calls.capture[0].params.amount_to_capture, 4000);
  const final = await rows(claim.id, request.id);
  assert.equal(final.operations.length, 1);
  assert.equal(final.operations[0].status, "SETTLED");
  assert.equal(final.operations[0].retainedAmount, "40.00");
  assert.equal(final.operations[0].releasedAmount, "60.00");
  assert.equal(final.claim.status, "SETTLED");
  assert.equal(final.request.depositOperationToken, null);
});

test("capture accepted with lost response remains indeterminate, then reconciles without recapture", async () => {
  const { request, claim } = await fixture("authorization");
  const stripe = fakeStripe("requires_capture", {
    captureError: connectionError(),
    captureChangesStateBeforeError: true,
  });
  stripe.intent.id = request.depositPaymentIntentId;
  await assert.rejects(settleApprovedClaim(claim.id, stripe as any), /socket closed/);
  let state = await rows(claim.id, request.id);
  assert.equal(state.operations[0].status, "INDETERMINATE");
  assert.ok(state.request.depositOperationToken, "indeterminate fence must remain owned");

  const reconciled = await reconcileSettlementOperation(state.operations[0].id, stripe as any);
  assert.equal(reconciled.status, "settled");
  assert.equal(stripe.calls.capture.length, 1, "reconciliation must observe succeeded, not capture again");
  state = await rows(claim.id, request.id);
  assert.equal(state.operations[0].status, "SETTLED");
  assert.equal(state.request.depositOperationToken, null);
});

test("refundable settlement refunds the exact remainder and skips a zero refund", async () => {
  for (const approved of [40, 100]) {
    const { request, claim } = await fixture("refundable_charge", "APPROVED", approved, 100);
    const stripe = fakeStripe("succeeded");
    stripe.intent.id = request.depositPaymentIntentId;
    await settleApprovedClaim(claim.id, stripe as any);
    assert.equal(stripe.calls.refundCreate.length, approved === 40 ? 1 : 0);
    if (approved === 40) assert.equal(stripe.calls.refundCreate[0].params.amount, 6000);
    const state = await rows(claim.id, request.id);
    assert.equal(state.operations[0].status, "SETTLED");
    assert.equal(state.operations[0].releasedAmount, approved === 40 ? "60.00" : "0.00");
  }
});

test("rejected authorization cancel and refundable full refund settle before clearing fence", async () => {
  for (const mode of ["authorization", "refundable_charge"] as const) {
    const { request, claim } = await fixture(mode, "REJECTED", 0, 100);
    const stripe = fakeStripe(mode === "authorization" ? "requires_capture" : "succeeded");
    stripe.intent.id = request.depositPaymentIntentId;
    let fenceDuringAction: string | null = null;
    if (mode === "authorization") {
      const cancel = stripe.paymentIntents.cancel;
      stripe.paymentIntents.cancel = async (...args: any[]) => {
        const state = await rows(claim.id, request.id);
        fenceDuringAction = state.request.depositOperationToken;
        assert.equal(state.operations[0].status, "PROCESSING");
        return cancel(...args as [any, any, any]);
      };
    } else {
      const refund = stripe.refunds.create;
      stripe.refunds.create = async (...args: any[]) => {
        const state = await rows(claim.id, request.id);
        fenceDuringAction = state.request.depositOperationToken;
        assert.equal(state.operations[0].status, "PROCESSING");
        return refund(...args as [any, any]);
      };
    }
    await releaseRejectedClaim(claim.id, stripe as any);
    assert.ok(fenceDuringAction);
    const state = await rows(claim.id, request.id);
    assert.equal(state.operations[0].status, "SETTLED");
    assert.equal(state.claim.settlementStatus, "SETTLED");
    assert.equal(state.request.depositOperationToken, null);
  }
});

test("lost cancel/refund responses reconcile from Stripe state without a second financial action", async () => {
  for (const mode of ["authorization", "refundable_charge"] as const) {
    const { request, claim } = await fixture(mode, "REJECTED", 0, 100);
    const stripe = fakeStripe(mode === "authorization" ? "requires_capture" : "succeeded", mode === "authorization"
      ? { cancelError: connectionError(), cancelChangesStateBeforeError: true }
      : { refundError: connectionError(), refundChangesStateBeforeError: true });
    stripe.intent.id = request.depositPaymentIntentId;
    await assert.rejects(releaseRejectedClaim(claim.id, stripe as any), /socket closed/);
    let state = await rows(claim.id, request.id);
    assert.equal(state.operations[0].status, "INDETERMINATE");
    assert.ok(state.request.depositOperationToken);
    await reconcileRejectedReleaseOperation(state.operations[0].id, stripe as any);
    assert.equal(stripe.calls.cancel.length, mode === "authorization" ? 1 : 0);
    assert.equal(stripe.calls.refundCreate.length, mode === "refundable_charge" ? 1 : 0);
    state = await rows(claim.id, request.id);
    assert.equal(state.operations[0].status, "SETTLED");
    assert.equal(state.request.depositOperationToken, null);
  }
});

test("definitive Stripe rejection releases the owned fence and resets claim for retry", async () => {
  const { request, claim } = await fixture("authorization");
  const uncertain = fakeStripe("requires_capture", { captureError: connectionError() });
  uncertain.intent.id = request.depositPaymentIntentId;
  await assert.rejects(settleApprovedClaim(claim.id, uncertain as any));
  const operation = (await rows(claim.id, request.id)).operations[0];

  const rejected = fakeStripe("requires_capture", { captureError: definitiveError() });
  rejected.intent.id = request.depositPaymentIntentId;
  await assert.rejects(reconcileSettlementOperation(operation.id, rejected as any), /capture rejected/);
  const state = await rows(claim.id, request.id);
  assert.equal(state.operations[0].status, "FAILED");
  assert.match(state.operations[0].error || "", /^definitive:/);
  assert.equal(state.claim.status, "APPROVED");
  assert.equal(state.claim.settlementStatus, "PENDING");
  assert.equal(state.request.depositOperationToken, null);
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

test("database start cutoff and live capture_before cutoff both prevent capture", async () => {
  const first = await fixture("authorization");
  await db.update(itemRequests).set({ settlementStartDeadlineAt: new Date(Date.now() - 1) })
    .where(eq(itemRequests.id, first.request.id));
  const expiredStart = fakeStripe("requires_capture");
  await assert.rejects(settleApprovedClaim(first.claim.id, expiredStart as any), /zero capture attempted/);
  assert.equal(expiredStart.calls.retrieve, 0);
  assert.equal(expiredStart.calls.capture.length, 0);

  const second = await fixture("authorization");
  const expiredLive = fakeStripe("requires_capture");
  expiredLive.intent.id = second.request.depositPaymentIntentId;
  expiredLive.intent.latest_charge.payment_method_details.card.capture_before =
    Math.floor(Date.now() / 1000) - 1;
  await assert.rejects(settleApprovedClaim(second.claim.id, expiredLive as any), /authorization is expired/);
  assert.equal(expiredLive.calls.capture.length, 0);
});

test("last database cutoff after live retrieval prevents capture and makes no renewal call", async () => {
  const { request, claim } = await fixture("authorization");
  const stripe = fakeStripe("requires_capture");
  stripe.intent.id = request.depositPaymentIntentId;
  await assert.rejects(settleApprovedClaim(claim.id, stripe as any, new Date(), {
    beforeCaptureCheck: async () => {
      await db.update(itemRequests).set({ settlementStartDeadlineAt: new Date(Date.now() - 1) })
        .where(eq(itemRequests.id, request.id));
    },
  }), /zero capture attempted/);
  assert.equal(stripe.calls.retrieve, 1);
  assert.equal(stripe.calls.capture.length, 0);
  assert.equal((stripe.paymentIntents as any).create, undefined, "settlement Stripe surface has no renewal call");
});

test("duplicate settlement and reconciliation are idempotent", async () => {
  const { request, claim } = await fixture("authorization");
  const stripe = fakeStripe("requires_capture");
  stripe.intent.id = request.depositPaymentIntentId;
  await settleApprovedClaim(claim.id, stripe as any);
  await settleApprovedClaim(claim.id, stripe as any);
  let state = await rows(claim.id, request.id);
  assert.equal(state.operations.length, 1);
  assert.equal(stripe.calls.capture.length, 1);

  // A retry can arrive after the successful transaction has already cleared
  // the fence. SETTLED must therefore short-circuit before requiring a fence.
  assert.equal((await reconcileSettlementOperation(state.operations[0].id, stripe as any)).status, "settled");
  assert.equal((await reconcileSettlementOperation(state.operations[0].id, stripe as any)).status, "settled");
  assert.equal(stripe.calls.capture.length, 1);
  state = await rows(claim.id, request.id);
  assert.equal(state.operations.length, 1);
});

test("confirm-return contract preserves deposit protection while an active claim exists", async () => {
  const source = await import("node:fs/promises").then(fs =>
    fs.readFile(new URL("./routes/routes.ts", import.meta.url), "utf8"));
  const activeClaimBranch = source.slice(
    source.indexOf("// A physical return stops overdue/non-return escalation"),
    source.indexOf("// Handle dispute if owner reports damage"),
  );
  assert.match(activeClaimBranch, /inArray\(securityClaims\.status,\s*\["OPEN", "CUSTOMER_RESPONSE_PENDING", "UNDER_REVIEW", "APPROVED", "PROCESSING"\]\)/);
  assert.match(activeClaimBranch, /returnedPendingReview: true/);
  assert.match(activeClaimBranch, /deposit protection was not released/);
  assert.ok(
    activeClaimBranch.indexOf("if (activeClaim)") < activeClaimBranch.indexOf("claimDepositTerminalAction"),
    "active claim must return before the route can claim a cancel/refund fence",
  );
  assert.doesNotMatch(activeClaimBranch.slice(0, activeClaimBranch.indexOf("claimDepositTerminalAction")), /resolveClaimedDepositIntents/);
});