import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test, type TestContext } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
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
import {
  confirmApprovedReturn,
  recoverPendingApprovedReturns,
  type ReturnRecoveryStripeClient,
} from "./return-recovery-service.js";

type DepositMode = "authorization" | "refundable_charge";

type FakeIntent = {
  id: string;
  status: string;
  amount: number;
  amount_received: number;
  capture_method?: "automatic" | "manual";
};

type FakeRefund = {
  id: string;
  payment_intent: string;
  amount: number;
  status: string;
  metadata: Record<string, string>;
};

type FakeStripeBehavior = {
  beforeProviderCall?: (method: string, id: string) => void | Promise<void>;
  cancelError?: (id: string) => Error | undefined;
  refundCreateStatuses?: string[];
};

function fakeStripe(
  initialIntents: FakeIntent[],
  behavior: FakeStripeBehavior = {},
) {
  const intents = new Map(initialIntents.map((intent) => [intent.id, intent]));
  const refundRows: FakeRefund[] = [];
  const refundsByIdempotencyKey = new Map<string, FakeRefund>();
  const refundCreateStatuses = [...(behavior.refundCreateStatuses || [])];
  const calls = {
    retrieve: [] as string[],
    cancel: [] as Array<{ id: string; params: any; options: any }>,
    refundList: [] as any[],
    refundCreate: [] as Array<{ params: any; options: any }>,
  };

  const stripe: ReturnRecoveryStripeClient & {
    calls: typeof calls;
    intents: Map<string, FakeIntent>;
    refundRows: FakeRefund[];
    addRefund: (refund: FakeRefund) => void;
  } = {
    calls,
    intents,
    refundRows,
    addRefund: (refund) => refundRows.push(refund),
    paymentIntents: {
      retrieve: async (id: string) => {
        calls.retrieve.push(id);
        await behavior.beforeProviderCall?.("paymentIntents.retrieve", id);
        const intent = intents.get(id);
        if (!intent) throw new Error(`Unknown fake PaymentIntent ${id}`);
        return intent;
      },
      cancel: async (id: string, params: any = {}, options: any = {}) => {
        calls.cancel.push({ id, params, options });
        await behavior.beforeProviderCall?.("paymentIntents.cancel", id);
        const cancelError = behavior.cancelError?.(id);
        if (cancelError) throw cancelError;
        const intent = intents.get(id);
        if (!intent) throw new Error(`Unknown fake PaymentIntent ${id}`);
        intent.status = "canceled";
        return intent;
      },
    },
    refunds: {
      list: async (params: any) => {
        calls.refundList.push(params);
        await behavior.beforeProviderCall?.("refunds.list", params.payment_intent);
        return {
          data: refundRows.filter((refund) => refund.payment_intent === params.payment_intent),
          has_more: false,
        };
      },
      create: async (params: any, options: any = {}) => {
        calls.refundCreate.push({ params, options });
        await behavior.beforeProviderCall?.("refunds.create", params.payment_intent);
        const idempotencyKey = options.idempotencyKey;
        const prior = idempotencyKey
          ? refundsByIdempotencyKey.get(idempotencyKey)
          : undefined;
        if (prior) return prior;
        const refund: FakeRefund = {
          id: `re_${randomUUID()}`,
          payment_intent: params.payment_intent,
          amount: params.amount,
          status: refundCreateStatuses.shift() || "succeeded",
          metadata: params.metadata || {},
        };
        refundRows.push(refund);
        if (idempotencyKey) refundsByIdempotencyKey.set(idempotencyKey, refund);
        return refund;
      },
    },
  };
  return stripe;
}

async function holdPoolConnectionsExceptOne() {
  const maxConnections = Number((pool as any).options?.max || 10);
  const clients: any[] = [];
  try {
    for (let index = 0; index < maxConnections; index += 1) {
      clients.push(await pool.connect());
    }
  } catch (error) {
    for (const client of clients) client.release();
    throw error;
  }
  clients.pop()!.release();
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      for (const client of clients) client.release();
    },
  };
}

async function fixture(
  t: TestContext,
  {
    mode = "authorization",
    previousPaymentIntentId = null,
    currentIntentStatus,
  }: {
    mode?: DepositMode;
    previousPaymentIntentId?: string | null;
    currentIntentStatus?: string;
  } = {},
) {
  const suffix = randomUUID();
  const [owner, borrower] = await db.insert(users).values([
    { username: `return-recovery-owner-${suffix}` },
    { username: `return-recovery-borrower-${suffix}` },
  ]).returning();
  let itemId: number | undefined;
  let requestId: number | undefined;
  t.after(async () => {
    if (requestId !== undefined) {
      await db.delete(notifications).where(eq(notifications.requestId, requestId));
      await db.delete(messages).where(eq(messages.requestId, requestId));
      await db.delete(requestLifecycleEvents).where(eq(requestLifecycleEvents.requestId, requestId));
      await db.delete(depositSettlementOperations)
        .where(eq(depositSettlementOperations.requestId, requestId));
      await db.delete(securityClaims).where(eq(securityClaims.requestId, requestId));
      await db.delete(itemRequests).where(eq(itemRequests.id, requestId));
    }
    if (itemId !== undefined) {
      await db.delete(items).where(eq(items.id, itemId));
    }
    await db.delete(users).where(inArray(users.id, [owner.id, borrower.id]));
  });
  const [item] = await db.insert(items).values({
    ownerId: owner.id,
    name: `return-recovery-item-${suffix.slice(0, 8)}`,
    description: "Return recovery integration test",
    conditionRating: 5,
    photos: [],
    shareCoinsReward: "0",
    isAvailable: false,
  }).returning();
  itemId = item.id;

  const currentPaymentIntentId = `pi_return_current_${suffix}`;
  const [request] = await db.insert(itemRequests).values({
    itemId: item.id,
    requesterId: borrower.id,
    requestType: "BORROW",
    status: "RETURN_REQUESTED",
    trustDepositAmount: "100.00",
    depositStatus: mode === "authorization" ? "authorized" : "SECURED_REFUNDABLE",
    depositMode: mode,
    depositMethod: "in_app",
    depositPaymentIntentId: currentPaymentIntentId,
    depositPreviousPaymentIntentId: previousPaymentIntentId,
    isEarlyReturn: false,
  }).returning();
  requestId = request.id;

  const paymentIntentIds = [
    ...(previousPaymentIntentId ? [previousPaymentIntentId] : []),
    currentPaymentIntentId,
  ];
  const defaultIntentStatus = currentIntentStatus ||
    (mode === "authorization" ? "requires_capture" : "succeeded");
  const stripe = fakeStripe(paymentIntentIds.map((id) => ({
    id,
    status: id === currentPaymentIntentId || !currentIntentStatus
      ? defaultIntentStatus
      : mode === "authorization" ? "requires_capture" : "succeeded",
    amount: 10_000,
    amount_received: 10_000,
    capture_method: mode === "authorization" ? "manual" : "automatic",
  })));
  return { owner, borrower, item, request, stripe };
}

async function state(requestId: number) {
  const [request] = await db.select().from(itemRequests)
    .where(eq(itemRequests.id, requestId));
  const operations = await db.select().from(depositSettlementOperations)
    .where(eq(depositSettlementOperations.requestId, requestId));
  const notices = await db.select().from(notifications)
    .where(and(
      eq(notifications.requestId, requestId),
      eq(notifications.type, "return_confirmed"),
    ));
  const requestMessages = await db.select().from(messages)
    .where(eq(messages.requestId, requestId));
  return { request, operations, notices, messages: requestMessages };
}

async function withFinalNotificationFailure<T>(
  requestId: number,
  work: () => Promise<T>,
): Promise<T> {
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `return_recovery_fail_${suffix}`;
  const triggerName = `return_recovery_fail_${suffix}`;
  await pool.query(`
    CREATE FUNCTION ${functionName}() RETURNS trigger
    LANGUAGE plpgsql
    AS $body$
    BEGIN
      IF NEW.request_id = ${requestId} AND NEW.title = 'Return Confirmed' THEN
        RAISE EXCEPTION 'injected return finalization notification failure';
      END IF;
      RETURN NEW;
    END;
    $body$;
  `);
  try {
    await pool.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);
    return await work();
  } finally {
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON notifications`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
  }
}

after(async () => {
  await pool.end();
});

test("persists the return release operation before Stripe and releases current and previous authorizations", async (t) => {
  const previousPaymentIntentId = `pi_return_previous_${randomUUID()}`;
  const { request, stripe } = await fixture(t, { previousPaymentIntentId });
  let observedPersistedOperation = false;
  stripe.paymentIntents.retrieve = async (id: string) => {
    stripe.calls.retrieve.push(id);
    if (!observedPersistedOperation) {
      const persisted = await state(request.id);
      assert.equal(persisted.operations.length, 1);
      assert.equal(persisted.operations[0].status, "PROCESSING");
      assert.equal(persisted.request.depositRenewalStatus, "terminal_action");
      assert.equal(persisted.request.depositOperationType, "return_release");
      assert.ok(persisted.request.depositOperationToken);
      observedPersistedOperation = true;
    }
    const intent = stripe.intents.get(id);
    assert.ok(intent);
    return intent;
  };

  const result = await confirmApprovedReturn({
    requestId: request.id,
    conditionRating: 4,
    conditionNotes: "Small scuff noted at return",
    sameCondition: false,
    stripeClient: stripe,
  });

  assert.equal(result.status, "completed");
  assert.equal(observedPersistedOperation, true);
  assert.deepEqual(
    stripe.calls.cancel.map((call) => call.id),
    [previousPaymentIntentId, request.depositPaymentIntentId],
  );
  const final = await state(request.id);
  assert.equal(final.operations.length, 1);
  assert.equal(final.operations[0].status, "SETTLED");
  assert.equal(final.request.status, "COMPLETED");
  assert.equal(final.request.depositStatus, "released");
  assert.equal(final.request.depositRenewalStatus, null);
  assert.equal(final.request.depositOperationToken, null);
  assert.equal(final.request.depositPreviousPaymentIntentId, null);
  assert.equal(final.request.returnConditionRating, 4);
  assert.equal(final.request.returnConditionNotes, "Small scuff noted at return");
  assert.equal(final.request.returnConditionOk, false);
  assert.equal(final.notices.length, 1);
  assert.equal(final.notices[0].title, "Return Confirmed");
  assert.equal(final.messages.filter((m) => m.messageType === "system").length, 1);
  assert.match(final.messages.find((m) => m.messageType === "system")!.content, /Temporary hold released\. You were not charged\./);
  // No claim was opened: a distinct "hold released" event + notification, never "refunded".
  const released = final.messages.find((m) => (m.metadata as any)?.eventType === "deposit_released")!;
  assert.match(released.content, /^Deposit hold released — \$[\d.]+ temporary hold released\. You were not charged\.$/);
  assert.equal((released.metadata as any).depositMode, "authorization");
  assert.ok((released.metadata as any).amount > 0);
  const releaseNotices = await db.select().from(notifications).where(and(eq(notifications.requestId, request.id), eq(notifications.type, "deposit_hold_released")));
  assert.equal(releaseNotices.length, 1);
  assert.equal(releaseNotices[0].title, "Deposit hold released");
  assert.match(releaseNotices[0].message, /temporary hold released\. You were not charged\.$/);
});

test("a captured refundable deposit is discovered and refunded, unlike an already-canceled authorization", async (t) => {
  const authorization = await fixture(t, { currentIntentStatus: "canceled" });
  const alreadyCanceled = await confirmApprovedReturn({
    requestId: authorization.request.id,
    stripeClient: authorization.stripe,
  });
  assert.equal(alreadyCanceled.status, "completed");
  assert.equal(authorization.stripe.calls.cancel.length, 0);
  assert.equal(authorization.stripe.calls.refundCreate.length, 0);

  const refundable = await fixture(t, { mode: "refundable_charge" });
  const refunded = await confirmApprovedReturn({
    requestId: refundable.request.id,
    stripeClient: refundable.stripe,
  });
  assert.equal(refunded.status, "completed");
  assert.equal(refundable.stripe.calls.cancel.length, 0);
  assert.equal(refundable.stripe.calls.refundCreate.length, 1);
  assert.equal(refundable.stripe.calls.refundCreate[0].params.payment_intent,
    refundable.request.depositPaymentIntentId);
  assert.equal(refundable.stripe.calls.refundCreate[0].params.amount, 10_000);
  assert.equal(refundable.stripe.calls.refundList.length >= 2, true);
});

test("a captured manual previous authorization is not refunded under the current refundable-charge mode", async (t) => {
  const previousPaymentIntentId = `pi_return_manual_previous_${randomUUID()}`;
  const { request, stripe } = await fixture(t, {
    mode: "refundable_charge",
    previousPaymentIntentId,
    currentIntentStatus: "succeeded",
  });
  const previousIntent = stripe.intents.get(previousPaymentIntentId)!;
  const currentIntent = stripe.intents.get(request.depositPaymentIntentId!)!;
  previousIntent.status = "succeeded";
  previousIntent.capture_method = "manual";
  currentIntent.status = "succeeded";
  currentIntent.capture_method = "automatic";

  const result = await confirmApprovedReturn({
    requestId: request.id,
    stripeClient: stripe,
  });

  assert.equal(result.status, "pending");
  if (result.status === "pending") assert.equal(result.depositReleased, false);
  assert.deepEqual(stripe.calls.retrieve, [previousPaymentIntentId]);
  assert.equal(stripe.calls.refundList.length, 0);
  assert.equal(stripe.calls.refundCreate.length, 0);
  assert.equal(stripe.calls.cancel.length, 0);
  const final = await state(request.id);
  assert.equal(final.request.status, "RETURN_REQUESTED");
  assert.equal(final.request.depositStatus, "SECURED_REFUNDABLE");
  assert.equal(final.operations.length, 1);
  assert.equal(final.operations[0].status, "INDETERMINATE");
  assert.equal(final.notices.length, 0);
});

test("a final transaction rollback leaves an indeterminate operation and retry updates the same pending alert", async (t) => {
  const { request, stripe } = await fixture(t);
  const futureDueDate = new Date(Date.now() + 7 * 24 * 60 * 60_000);
  await db.update(itemRequests).set({ endDate: futureDueDate })
    .where(eq(itemRequests.id, request.id));
  let frozenActualReturnAt: Date | null = null;
  const interrupted = await withFinalNotificationFailure(request.id, () =>
    confirmApprovedReturn({
      requestId: request.id,
      stripeClient: stripe,
      beforeFinalization: async () => {
        const [snapshot] = await db.select({
          actualReturnAt: itemRequests.actualReturnAt,
        }).from(itemRequests).where(eq(itemRequests.id, request.id));
        frozenActualReturnAt = snapshot.actualReturnAt;
      },
    }),
  );

  assert.equal(interrupted.status, "pending");
  if (interrupted.status !== "pending") return;
  assert.equal(interrupted.depositReleased, true);
  assert.ok(frozenActualReturnAt, "the physical return time is persisted before finalization");
  assert.ok(frozenActualReturnAt.getTime() < futureDueDate.getTime());
  let afterRollback = await state(request.id);
  assert.equal(afterRollback.request.status, "RETURN_REQUESTED");
  assert.equal(afterRollback.request.actualReturnAt?.getTime(), frozenActualReturnAt.getTime());
  assert.equal(afterRollback.request.depositStatus, "authorized");
  assert.equal(afterRollback.operations.length, 1);
  assert.equal(afterRollback.operations[0].status, "INDETERMINATE");
  assert.equal(afterRollback.notices.length, 1);
  assert.equal(afterRollback.notices[0].title, "Deposit hold released");
  assert.equal(afterRollback.messages.length, 0);
  const [itemAfterRollback] = await db.select().from(items)
    .where(eq(items.id, request.itemId!));
  assert.equal(itemAfterRollback.isAvailable, false);
  assert.equal(stripe.calls.cancel.length, 1);
  const pendingNoticeId = afterRollback.notices[0].id;

  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  let callbackActualReturnAt: Date | null = null;
  const retry = await confirmApprovedReturn({
    requestId: request.id,
    stripeClient: stripe,
    onCompleted: async ({ request: completedRequest }) => {
      callbackActualReturnAt = completedRequest.actualReturnAt;
      const [persisted] = await db.select({
        actualReturnAt: itemRequests.actualReturnAt,
        status: itemRequests.status,
      }).from(itemRequests).where(eq(itemRequests.id, request.id));
      assert.equal(persisted.status, "COMPLETED");
      assert.equal(persisted.actualReturnAt?.getTime(), frozenActualReturnAt!.getTime());
    },
  });
  assert.equal(retry.status, "completed");
  assert.equal(callbackActualReturnAt?.getTime(), frozenActualReturnAt.getTime());
  afterRollback = await state(request.id);
  assert.equal(afterRollback.request.status, "COMPLETED");
  assert.equal(afterRollback.operations.length, 1);
  assert.equal(afterRollback.operations[0].status, "SETTLED");
  assert.equal(afterRollback.notices.length, 1);
  assert.equal(afterRollback.notices[0].id, pendingNoticeId);
  assert.equal(afterRollback.notices[0].title, "Return Confirmed");
  assert.equal(stripe.calls.cancel.length, 1, "retry observes canceled Stripe state instead of canceling twice");
});

test("the sweeper recovers canceled and fully refunded provider actions without duplicate financial calls", async (t) => {
  for (const mode of ["authorization", "refundable_charge"] as const) {
    const { request, stripe } = await fixture(t, { mode });
    const firstPass = await confirmApprovedReturn({
      requestId: request.id,
      stripeClient: stripe,
      beforeFinalization: async () => {
        throw new Error("simulated worker interruption after Stripe release");
      },
    });
    assert.equal(firstPass.status, "pending");
    if (firstPass.status !== "pending") continue;
    assert.equal(firstPass.depositReleased, true);
    const firstCancelCount = stripe.calls.cancel.length;
    const firstRefundCreateCount = stripe.calls.refundCreate.length;
    assert.equal((await state(request.id)).operations[0].status, "INDETERMINATE");
    await db.update(itemRequests)
      .set({ depositRenewalAttemptedAt: new Date(Date.now() - 60_000) })
      .where(eq(itemRequests.id, request.id));

    const resumed = await recoverPendingApprovedReturns({
      stripeClient: stripe,
      requestIds: [request.id],
    });
    assert.equal(resumed.checked, 1);
    assert.equal(resumed.completed, 1);
    const final = await state(request.id);
    assert.equal(final.request.status, "COMPLETED");
    assert.equal(final.operations[0].status, "SETTLED");
    assert.equal(final.notices.length, 1);
    assert.equal(final.notices[0].title, "Return Confirmed");
    assert.equal(stripe.calls.cancel.length, firstCancelCount);
    assert.equal(stripe.calls.refundCreate.length, firstRefundCreateCount);
    if (mode === "refundable_charge") {
      assert.equal(stripe.calls.refundList.length > 0, true);
      assert.equal(stripe.calls.refundCreate.length, 1);
    }
  }
});

test("partial, pending, and failed refunds never mark the deposit released before the balance is settled", async (t) => {
  const pendingFixture = await fixture(t, { mode: "refundable_charge" });
  const pendingId = pendingFixture.request.depositPaymentIntentId!;
  pendingFixture.stripe.addRefund({
    id: `re_pending_${randomUUID()}`,
    payment_intent: pendingId,
    amount: 10_000,
    status: "pending",
    metadata: {},
  });
  const pendingResult = await confirmApprovedReturn({
    requestId: pendingFixture.request.id,
    stripeClient: pendingFixture.stripe,
  });
  assert.equal(pendingResult.status, "pending");
  if (pendingResult.status === "pending") assert.equal(pendingResult.depositReleased, false);
  const pendingState = await state(pendingFixture.request.id);
  assert.equal(pendingState.request.status, "RETURN_REQUESTED");
  assert.equal(pendingState.request.depositStatus, "SECURED_REFUNDABLE");
  assert.equal(pendingState.operations[0].status, "INDETERMINATE");

  const partialFixture = await fixture(t, { mode: "refundable_charge" });
  const partialId = partialFixture.request.depositPaymentIntentId!;
  partialFixture.stripe.addRefund({
    id: `re_partial_${randomUUID()}`,
    payment_intent: partialId,
    amount: 4_000,
    status: "succeeded",
    metadata: {},
  });
  partialFixture.stripe.refundRows.push({
    id: `re_pending_partial_${randomUUID()}`,
    payment_intent: partialId,
    amount: 6_000,
    status: "pending",
    metadata: {},
  });
  const partialResult = await confirmApprovedReturn({
    requestId: partialFixture.request.id,
    stripeClient: partialFixture.stripe,
  });
  assert.equal(partialResult.status, "pending");
  if (partialResult.status === "pending") assert.equal(partialResult.depositReleased, false);
  const partialState = await state(partialFixture.request.id);
  assert.equal(partialState.request.status, "RETURN_REQUESTED");
  assert.equal(partialState.request.depositStatus, "SECURED_REFUNDABLE");
  assert.equal(partialState.operations[0].status, "INDETERMINATE");
  assert.equal(partialState.notices.length, 1);
  assert.match(partialState.notices[0].message, /part of the temporary hold was released/);

  const failedFixture = await fixture(t, {
    mode: "refundable_charge",
  });
  const failingStripe = fakeStripe(
    [...failedFixture.stripe.intents.values()],
    { refundCreateStatuses: ["failed", "failed", "failed"] },
  );
  const failedResult = await confirmApprovedReturn({
    requestId: failedFixture.request.id,
    stripeClient: failingStripe,
  });
  assert.equal(failedResult.status, "pending");
  if (failedResult.status === "pending") assert.equal(failedResult.depositReleased, false);
  assert.equal(failingStripe.calls.refundCreate.length, 3);
  const failedState = await state(failedFixture.request.id);
  assert.equal(failedState.request.status, "RETURN_REQUESTED");
  assert.equal(failedState.request.depositStatus, "SECURED_REFUNDABLE");
  assert.equal(failedState.operations[0].status, "INDETERMINATE");
});

test("owner retry and background resume cannot issue parallel Stripe actions", async (t) => {
  const { request } = await fixture(t);
  let signalProviderEntered!: () => void;
  let releaseProvider!: () => void;
  const providerEntered = new Promise<void>((resolve) => {
    signalProviderEntered = resolve;
  });
  const providerMayContinue = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  const stripe = fakeStripe(
    [{
      id: request.depositPaymentIntentId!,
      status: "requires_capture",
      amount: 10_000,
      amount_received: 10_000,
    }],
    {
      beforeProviderCall: async (method) => {
        if (method !== "paymentIntents.cancel") return;
        signalProviderEntered();
        await providerMayContinue;
      },
    },
  );
  const firstPass = confirmApprovedReturn({
    requestId: request.id,
    stripeClient: stripe,
  });

  let contentionError: unknown;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      providerEntered,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Stripe cancellation did not start")), 5_000);
      }),
    ]);
    const ownerRetry = await confirmApprovedReturn({
      requestId: request.id,
      stripeClient: stripe,
    });
    assert.equal(ownerRetry.status, "pending");
    const backgroundResume = await recoverPendingApprovedReturns({
      stripeClient: stripe,
      requestIds: [request.id],
    });
    assert.equal(backgroundResume.checked, 1);
    assert.equal(backgroundResume.pending, 1);
  } catch (error) {
    contentionError = error;
  } finally {
    if (timeout) clearTimeout(timeout);
    releaseProvider();
  }

  const [firstOutcome] = await Promise.allSettled([firstPass]);
  if (contentionError) throw contentionError;
  if (firstOutcome.status === "rejected") throw firstOutcome.reason;
  const firstResult = firstOutcome.value;
  assert.equal(firstResult.status, "completed");
  assert.equal(stripe.calls.cancel.length, 1);
  const final = await state(request.id);
  assert.equal(final.operations.length, 1);
  assert.equal(final.operations[0].status, "SETTLED");
});

test("return recovery progresses under pool saturation and releases its advisory connection before post-effects", async (t) => {
  const { request, stripe } = await fixture(t);
  const maxConnections = Number((pool as any).options?.max || 10);
  assert.ok(maxConnections >= 2, "the targeted saturation test needs one lock slot and one shared DB slot");
  const heldConnections = await holdPoolConnectionsExceptOne();
  t.after(() => heldConnections.release());
  let providerEnteredWhileSaturated = false;
  let callbackObservedLockFree = false;
  let callbackDatabaseStatus: string | undefined;

  let signalProviderEntered!: () => void;
  const providerEntered = new Promise<void>((resolve) => {
    signalProviderEntered = resolve;
  });
  const stripeWithBarrier = fakeStripe(
    [...stripe.intents.values()],
    {
      beforeProviderCall: () => {
        providerEnteredWhileSaturated = true;
        signalProviderEntered();
      },
    },
  );

  const firstPass = confirmApprovedReturn({
    requestId: request.id,
    stripeClient: stripeWithBarrier,
    beforeFinalization: async () => {
      heldConnections.release();
    },
    onCompleted: async () => {
      const probe = await pool.connect();
      try {
        const lock = await probe.query(
          "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS locked",
          [1380012364, request.id],
        );
        callbackObservedLockFree = !!lock.rows[0]?.locked;
        if (callbackObservedLockFree) {
          await probe.query(
            "SELECT pg_advisory_unlock($1::integer, $2::integer)",
            [1380012364, request.id],
          );
        }
      } finally {
        probe.release();
      }
      const [completed] = await db.transaction(async (tx) =>
        tx.select({ status: itemRequests.status })
          .from(itemRequests)
          .where(eq(itemRequests.id, request.id))
          .limit(1),
      );
      callbackDatabaseStatus = completed?.status;
    },
  });

  let reachedStripeBeforePoolRelease = false;
  let saturationTimeout: ReturnType<typeof setTimeout> | undefined;
  let result: Awaited<ReturnType<typeof confirmApprovedReturn>>;
  try {
    reachedStripeBeforePoolRelease = await Promise.race([
      providerEntered.then(() => true),
      new Promise<boolean>((resolve) => {
        saturationTimeout = setTimeout(() => resolve(false), 5_000);
      }),
    ]);
  } finally {
    if (saturationTimeout) clearTimeout(saturationTimeout);
    if (!reachedStripeBeforePoolRelease) heldConnections.release();
  }
  try {
    result = await firstPass;
  } finally {
    heldConnections.release();
  }
  assert.equal(result.status, "completed");
  assert.equal(providerEnteredWhileSaturated, true);
  assert.equal(reachedStripeBeforePoolRelease, true);
  assert.equal(callbackObservedLockFree, true);
  assert.equal(callbackDatabaseStatus, "COMPLETED");
  assert.equal(stripeWithBarrier.calls.cancel.length, 1);
});

test("fair recovery passes eventually reach a newer cancellation behind three blocked releases", async (t) => {
  const blockedCapturedOne = await fixture(t, {
    currentIntentStatus: "succeeded",
  });
  const blockedCapturedTwo = await fixture(t, {
    currentIntentStatus: "succeeded",
  });
  const blockedRefund = await fixture(t, { mode: "refundable_charge" });
  const newerCancellation = await fixture(t);

  let failNewCancellationOnce = true;
  const stripe = fakeStripe(
    [
      ...blockedCapturedOne.stripe.intents.values(),
      ...blockedCapturedTwo.stripe.intents.values(),
      ...blockedRefund.stripe.intents.values(),
      ...newerCancellation.stripe.intents.values(),
    ],
    {
      cancelError: (id) => {
        if (id === newerCancellation.request.depositPaymentIntentId && failNewCancellationOnce) {
          failNewCancellationOnce = false;
          return new Error("temporary cancel transport failure");
        }
        return undefined;
      },
    },
  );
  stripe.addRefund({
    id: `re_persistently_pending_${randomUUID()}`,
    payment_intent: blockedRefund.request.depositPaymentIntentId!,
    amount: 10_000,
    status: "pending",
    metadata: {},
  });

  for (const blocked of [blockedCapturedOne, blockedCapturedTwo, blockedRefund]) {
    const result = await confirmApprovedReturn({
      requestId: blocked.request.id,
      stripeClient: stripe,
    });
    assert.equal(result.status, "pending");
  }
  const initiallyFailedCancellation = await confirmApprovedReturn({
    requestId: newerCancellation.request.id,
    stripeClient: stripe,
  });
  assert.equal(initiallyFailedCancellation.status, "pending");

  const oldestTime = Date.now() - 60_000;
  const orderedFixtures = [blockedCapturedOne, blockedCapturedTwo, blockedRefund, newerCancellation];
  for (const [index, target] of orderedFixtures.entries()) {
    await db.update(itemRequests)
      .set({ depositRenewalAttemptedAt: new Date(oldestTime + index * 1_000) })
      .where(eq(itemRequests.id, target.request.id));
  }

  let reachedNewerCancellation = false;
  for (let pass = 0; pass < 8; pass += 1) {
    const sweep = await recoverPendingApprovedReturns({
      stripeClient: stripe,
      limit: 3,
      requestIds: orderedFixtures.map(({ request: target }) => target.id),
    });
    assert.ok(sweep.checked <= 3);
    const newerState = await state(newerCancellation.request.id);
    if (newerState.request.status === "COMPLETED") {
      reachedNewerCancellation = true;
      assert.equal(newerState.operations[0].status, "SETTLED");
      break;
    }
    assert.equal(newerState.request.status, "RETURN_REQUESTED");
  }

  assert.equal(reachedNewerCancellation, true, "repeated fair passes must not starve newer recoverable work");
  assert.equal(stripe.calls.cancel.filter(
    (call) => call.id === newerCancellation.request.depositPaymentIntentId,
  ).length, 2, "the first failed attempt and one successful retry are sufficient");
  assert.equal(stripe.calls.refundCreate.length, 0);
  for (const blocked of [blockedCapturedOne, blockedCapturedTwo, blockedRefund]) {
    const blockedState = await state(blocked.request.id);
    assert.equal(blockedState.request.status, "RETURN_REQUESTED");
    assert.notEqual(blockedState.operations[0].status, "SETTLED");
  }
});

test("an active security claim blocks return release before any Stripe call", async (t) => {
  for (const status of ["OPEN", "UNDER_REVIEW"]) {
    const { request, owner, borrower, stripe } = await fixture(t);
    await db.insert(securityClaims).values({
      requestId: request.id,
      ownerId: owner.id,
      borrowerId: borrower.id,
      claimType: "damage",
      status,
      reason: "Pending review",
      requestedAmount: "25.00",
    });

    const result = await confirmApprovedReturn({
      requestId: request.id,
      stripeClient: stripe,
    });

    assert.equal(result.status, "conflict");
    assert.equal(stripe.calls.retrieve.length, 0);
    assert.equal(stripe.calls.cancel.length, 0);
    assert.equal(stripe.calls.refundList.length, 0);
    assert.equal(stripe.calls.refundCreate.length, 0);
    const final = await state(request.id);
    assert.equal(final.operations.length, 0);
    assert.equal(final.request.depositOperationToken, null);
  }
});