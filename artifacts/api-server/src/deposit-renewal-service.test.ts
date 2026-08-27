import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { db, items, itemRequests, notifications, pool, users } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  claimDepositTerminalAction,
  DEPOSIT_RENEWAL_FAILED_NOTIFICATION_TYPE,
  getPaymentIntentCaptureBefore,
  releaseDepositTerminalClaim,
  resolveClaimedDepositIntents,
  renewDepositHold,
} from "./deposit-renewal-service";

type FakeIntent = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  customer: string;
  payment_method: string;
  metadata: Record<string, string>;
  latest_charge: {
    payment_method_details: { card: { capture_before: number } };
  };
};

function fakeIntent(id: string, captureBefore: number): FakeIntent {
  return {
    id,
    status: "requires_capture",
    amount: 5000,
    currency: "usd",
    customer: "cus_renewal_test",
    payment_method: "pm_renewal_test",
    metadata: { requestId: "0", userId: "0", depositAmount: "50" },
    latest_charge: {
      payment_method_details: { card: { capture_before: captureBefore } },
    },
  };
}

function createFakeStripe(options: {
  oldIntent: FakeIntent;
  failCreate?: boolean;
  failOldCancel?: boolean;
  failRetrieve?: boolean;
  beforeRetrieve?: (id: string) => Promise<void>;
  beforeCreateReturn?: (created: FakeIntent) => Promise<void>;
}) {
  const store = new Map<string, FakeIntent>([[options.oldIntent.id, options.oldIntent]]);
  const idempotent = new Map<string, FakeIntent>();
  const calls = {
    create: [] as Array<{ params: any; options: any }>,
    cancel: [] as string[],
    capture: [] as string[],
  };

  return {
    store,
    calls,
    paymentIntents: {
      retrieve: async (id: string) => {
        await options.beforeRetrieve?.(id);
        if (options.failRetrieve) throw new Error("Temporary Stripe retrieval error");
        const intent = store.get(id);
        if (!intent) throw new Error(`No such payment_intent: ${id}`);
        return intent as any;
      },
      create: async (params: any, requestOptions: any) => {
        calls.create.push({ params, options: requestOptions });
        if (options.failCreate) throw new Error("Your card was declined.");

        const prior = idempotent.get(requestOptions.idempotencyKey);
        if (prior) return prior as any;

        const created = fakeIntent(`pi_replacement_${idempotent.size + 1}`, 2_000_000_000);
        created.amount = params.amount;
        created.currency = params.currency;
        created.customer = params.customer;
        created.payment_method = params.payment_method;
        created.metadata = params.metadata;
        store.set(created.id, created);
        idempotent.set(requestOptions.idempotencyKey, created);
        await options.beforeCreateReturn?.(created);
        return created as any;
      },
      cancel: async (id: string) => {
        calls.cancel.push(id);
        if (options.failOldCancel && id === options.oldIntent.id) {
          throw new Error("Temporary Stripe cancellation error");
        }
        const intent = store.get(id);
        if (!intent) throw new Error(`No such payment_intent: ${id}`);
        intent.status = "canceled";
        return intent as any;
      },
      capture: async (id: string) => {
        calls.capture.push(id);
        const intent = store.get(id);
        if (!intent) throw new Error(`No such payment_intent: ${id}`);
        intent.status = "succeeded";
        return intent as any;
      },
    },
  };
}

const UNIQUE = `deposit-renewal-${Date.now()}`;
let ownerId: number;
let renterId: number;
let itemId: number;
let requestId: number;
let oldIntent: FakeIntent;

before(async () => {
  const [owner] = await db.insert(users).values({
    username: `${UNIQUE}-owner`,
  }).returning({ id: users.id });
  ownerId = owner.id;

  const [renter] = await db.insert(users).values({
    username: `${UNIQUE}-renter`,
    stripeCustomerId: "cus_renewal_test",
    stripePaymentMethodId: "pm_renewal_test",
  }).returning({ id: users.id });
  renterId = renter.id;

  const [item] = await db.insert(items).values({
    ownerId,
    name: `${UNIQUE}-item`,
    description: "Deposit renewal regression test",
    category: "Home & Kitchen",
    tier: 2,
    conditionRating: 4,
    photos: [],
    shareCoinsReward: "0",
    replacementValue: 100,
    lendingDuration: 7,
  }).returning({ id: items.id });
  itemId = item.id;

  const [request] = await db.insert(itemRequests).values({
    itemId,
    requesterId: renterId,
    requestType: "RENT",
    status: "IN_PROGRESS",
    depositMethod: "in_app",
    depositStatus: "authorized",
    depositPaymentIntentId: "pi_old",
    depositAuthorizedAt: new Date("2026-08-20T00:00:00Z"),
  }).returning({ id: itemRequests.id });
  requestId = request.id;
});

beforeEach(async () => {
  oldIntent = fakeIntent("pi_old", Math.floor(new Date("2026-08-28T00:00:00Z").getTime() / 1000));
  oldIntent.metadata.requestId = requestId.toString();
  oldIntent.metadata.userId = renterId.toString();
  await db.update(itemRequests).set({
    status: "IN_PROGRESS",
    depositStatus: "authorized",
    depositPaymentIntentId: oldIntent.id,
    depositAuthorizationExpiresAt: null,
    depositRenewalStatus: null,
    depositRenewalAttemptedAt: null,
    depositRenewalError: null,
    depositRenewalCount: 0,
    depositPreviousPaymentIntentId: null,
  }).where(eq(itemRequests.id, requestId));
  await db.delete(notifications).where(eq(notifications.requestId, requestId));
});

after(async () => {
  await db.delete(notifications).where(eq(notifications.requestId, requestId));
  await db.delete(itemRequests).where(eq(itemRequests.id, requestId));
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(inArray(users.id, [ownerId, renterId]));
  await pool.end();
});

test("extracts Stripe's exact capture_before timestamp", () => {
  assert.equal(
    getPaymentIntentCaptureBefore(oldIntent)?.toISOString(),
    "2026-08-28T00:00:00.000Z",
  );
});

test("authorizes a replacement before swapping the stored reference and then cancels the old hold", async () => {
  const fakeStripe = createFakeStripe({ oldIntent });
  const result = await renewDepositHold({
    requestId,
    stripeClient: fakeStripe as any,
    now: new Date("2026-08-27T00:00:00Z"),
  });

  assert.equal(result.status, "renewed");
  assert.equal(fakeStripe.calls.create.length, 1);
  assert.equal(fakeStripe.calls.create[0].params.capture_method, "manual");
  assert.equal(fakeStripe.calls.create[0].params.amount, oldIntent.amount);
  assert.equal(fakeStripe.calls.create[0].params.confirm, true);
  assert.equal(fakeStripe.calls.create[0].params.off_session, true);
  assert.equal(
    fakeStripe.calls.create[0].options.idempotencyKey,
    `deposit-renewal-${requestId}-pi_old`,
  );
  assert.deepEqual(fakeStripe.calls.cancel, ["pi_old"]);

  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
  assert.equal(request.depositPaymentIntentId, "pi_replacement_1");
  assert.equal(request.depositPreviousPaymentIntentId, null);
  assert.equal(request.depositRenewalStatus, "healthy");
  assert.equal(request.depositRenewalCount, 1);
  assert.equal(request.depositAuthorizationExpiresAt?.toISOString(), "2033-05-18T03:33:20.000Z");
});

test("does not renew before Stripe's exact capture deadline enters the renewal window", async () => {
  oldIntent.latest_charge.payment_method_details.card.capture_before =
    Math.floor(new Date("2026-09-01T00:00:00Z").getTime() / 1000);
  const fakeStripe = createFakeStripe({ oldIntent });
  const result = await renewDepositHold({
    requestId,
    stripeClient: fakeStripe as any,
    now: new Date("2026-08-27T00:00:00Z"),
  });

  assert.equal(result.status, "not_due");
  assert.equal(fakeStripe.calls.create.length, 0);
  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
  assert.equal(request.depositPaymentIntentId, "pi_old");
  assert.equal(request.depositAuthorizationExpiresAt?.toISOString(), "2026-09-01T00:00:00.000Z");
});

test("failed renewal keeps the old reference and creates one deduplicated payment alert per party", async () => {
  const fakeStripe = createFakeStripe({ oldIntent, failCreate: true });
  await renewDepositHold({
    requestId,
    stripeClient: fakeStripe as any,
    now: new Date("2026-08-27T00:00:00Z"),
  });
  await renewDepositHold({
    requestId,
    stripeClient: fakeStripe as any,
    now: new Date("2026-08-27T01:00:00Z"),
  });

  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
  assert.equal(request.depositPaymentIntentId, "pi_old");
  assert.equal(request.depositRenewalStatus, "failed");
  assert.match(request.depositRenewalError || "", /saved card/i);

  const alerts = await db.select().from(notifications).where(and(
    eq(notifications.requestId, requestId),
    eq(notifications.type, DEPOSIT_RENEWAL_FAILED_NOTIFICATION_TYPE),
  ));
  assert.equal(alerts.length, 2);
  assert.deepEqual(new Set(alerts.map((alert) => alert.userId)), new Set([ownerId, renterId]));
});

test("concurrent retries reuse one idempotent replacement without cancelling the live new hold", async () => {
  const fakeStripe = createFakeStripe({ oldIntent });
  const [first, second] = await Promise.all([
    renewDepositHold({
      requestId,
      stripeClient: fakeStripe as any,
      now: new Date("2026-08-27T00:00:00Z"),
    }),
    renewDepositHold({
      requestId,
      stripeClient: fakeStripe as any,
      now: new Date("2026-08-27T00:00:00Z"),
    }),
  ]);

  assert.deepEqual(
    [first.status, second.status].sort(),
    ["renewed", "skipped"],
  );
  assert.equal(fakeStripe.store.get("pi_replacement_1")?.status, "requires_capture");
  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
  assert.equal(request.depositPaymentIntentId, "pi_replacement_1");
  assert.equal(request.depositRenewalCount, 1);
});

test("a newer stored hold wins and the orphan replacement is cancelled", async () => {
  const fakeStripe = createFakeStripe({
    oldIntent,
    beforeCreateReturn: async () => {
      await db.update(itemRequests).set({
        depositPaymentIntentId: "pi_newer_from_other_worker",
      }).where(eq(itemRequests.id, requestId));
    },
  });
  const result = await renewDepositHold({
    requestId,
    stripeClient: fakeStripe as any,
    now: new Date("2026-08-27T00:00:00Z"),
  });

  assert.equal(result.status, "skipped");
  assert.deepEqual(fakeStripe.calls.cancel, ["pi_replacement_1"]);
  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
  assert.equal(request.depositPaymentIntentId, "pi_newer_from_other_worker");
});

test("manual retry cannot churn a healthy authorization that is not in a failed state", async () => {
  await db.update(itemRequests).set({
    depositRenewalStatus: "healthy",
  }).where(eq(itemRequests.id, requestId));
  const fakeStripe = createFakeStripe({ oldIntent });
  const result = await renewDepositHold({
    requestId,
    stripeClient: fakeStripe as any,
    force: true,
    now: new Date("2026-08-27T00:00:00Z"),
  });

  assert.equal(result.status, "skipped");
  assert.equal(fakeStripe.calls.create.length, 0);
});

test("missing Stripe capture_before fails safely without creating a guessed replacement", async () => {
  (oldIntent as any).latest_charge = null;
  const fakeStripe = createFakeStripe({ oldIntent });
  const result = await renewDepositHold({
    requestId,
    stripeClient: fakeStripe as any,
    now: new Date("2026-08-27T00:00:00Z"),
  });

  assert.equal(result.status, "failed");
  assert.equal(fakeStripe.calls.create.length, 0);
  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
  assert.equal(request.depositPaymentIntentId, "pi_old");
  assert.equal(request.depositRenewalStatus, "failed");
});

test("a lifecycle completion during Stripe authorization prevents the reference swap and cancels the orphan", async () => {
  const fakeStripe = createFakeStripe({
    oldIntent,
    beforeCreateReturn: async () => {
      await db.update(itemRequests).set({
        status: "COMPLETED",
        depositStatus: "released",
      }).where(eq(itemRequests.id, requestId));
    },
  });
  const result = await renewDepositHold({
    requestId,
    stripeClient: fakeStripe as any,
    now: new Date("2026-08-27T00:00:00Z"),
  });

  assert.equal(result.status, "skipped");
  assert.deepEqual(fakeStripe.calls.cancel, ["pi_replacement_1"]);
  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
  assert.equal(request.depositPaymentIntentId, "pi_old");
  assert.equal(request.status, "COMPLETED");
});

test("old-hold cancellation failure never rolls back the authorized replacement", async () => {
  const fakeStripe = createFakeStripe({ oldIntent, failOldCancel: true });
  const result = await renewDepositHold({
    requestId,
    stripeClient: fakeStripe as any,
    now: new Date("2026-08-27T00:00:00Z"),
  });

  assert.equal(result.status, "renewed");
  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
  assert.equal(request.depositPaymentIntentId, "pi_replacement_1");
  assert.equal(request.depositPreviousPaymentIntentId, "pi_old");
  assert.equal(request.depositRenewalStatus, "healthy");
});

test("pending old-hold cleanup blocks another renewal so no earlier authorization reference is orphaned", async () => {
  const firstStripe = createFakeStripe({ oldIntent, failOldCancel: true });
  const first = await renewDepositHold({
    requestId,
    stripeClient: firstStripe as any,
    now: new Date("2026-08-27T00:00:00Z"),
  });
  assert.equal(first.status, "renewed");

  const replacement = firstStripe.store.get("pi_replacement_1")!;
  replacement.latest_charge.payment_method_details.card.capture_before =
    Math.floor(new Date("2026-08-28T00:00:00Z").getTime() / 1000);
  const secondStripe = createFakeStripe({
    oldIntent: replacement,
  });
  secondStripe.store.set("pi_old", oldIntent);
  const secondCancel = secondStripe.paymentIntents.cancel;
  secondStripe.paymentIntents.cancel = async (id: string) => {
    if (id === "pi_old") {
      secondStripe.calls.cancel.push(id);
      throw new Error("Temporary Stripe cancellation error");
    }
    return secondCancel(id);
  };

  const second = await renewDepositHold({
    requestId,
    stripeClient: secondStripe as any,
    now: new Date("2026-08-27T00:00:00Z"),
  });
  assert.equal(second.status, "skipped");
  assert.equal(secondStripe.calls.create.length, 0);

  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
  assert.equal(request.depositPaymentIntentId, "pi_replacement_1");
  assert.equal(request.depositPreviousPaymentIntentId, "pi_old");
});

test("a terminal deposit claim prevents renewal from creating a replacement", async () => {
  const claim = await claimDepositTerminalAction(
    requestId,
    "cancel",
    new Date("2026-08-27T00:00:00Z"),
  );
  assert.equal(claim.status, "claimed");
  if (claim.status !== "claimed") return;

  const fakeStripe = createFakeStripe({ oldIntent });
  const renewal = await renewDepositHold({
    requestId,
    stripeClient: fakeStripe as any,
    now: new Date("2026-08-27T00:01:00Z"),
  });
  assert.equal(renewal.status, "skipped");
  assert.equal(fakeStripe.calls.create.length, 0);
  await releaseDepositTerminalClaim(claim);
});

test("an active renewal claim prevents a stale terminal action from reading a hold", async () => {
  const now = new Date("2026-08-27T00:00:00Z");
  await db.update(itemRequests).set({
    depositRenewalStatus: "renewing",
    depositRenewalAttemptedAt: now,
  }).where(eq(itemRequests.id, requestId));

  const claim = await claimDepositTerminalAction(requestId, "capture", now);
  assert.equal(claim.status, "busy");
});

test("terminal resolution handles both the current hold and pending prior cleanup", async () => {
  const previousIntent = fakeIntent("pi_previous", 1_900_000_000);
  await db.update(itemRequests).set({
    depositPreviousPaymentIntentId: previousIntent.id,
  }).where(eq(itemRequests.id, requestId));
  const claim = await claimDepositTerminalAction(requestId, "cancel");
  assert.equal(claim.status, "claimed");
  if (claim.status !== "claimed") return;

  const fakeStripe = createFakeStripe({ oldIntent });
  fakeStripe.store.set(previousIntent.id, previousIntent);
  await resolveClaimedDepositIntents(claim, fakeStripe as any, "cancel");
  assert.deepEqual(
    fakeStripe.calls.cancel.sort(),
    ["pi_old", "pi_previous"],
  );
});

test("stale terminal recovery rejects the opposite money action and fences the old worker", async () => {
  const first = await claimDepositTerminalAction(
    requestId,
    "cancel",
    new Date("2026-08-27T00:00:00Z"),
  );
  assert.equal(first.status, "claimed");
  if (first.status !== "claimed") return;

  const opposite = await claimDepositTerminalAction(
    requestId,
    "capture",
    new Date("2026-08-27T00:16:00Z"),
  );
  assert.equal(opposite.status, "busy");

  const recovery = await claimDepositTerminalAction(
    requestId,
    "cancel",
    new Date("2026-08-27T00:16:00Z"),
  );
  assert.equal(recovery.status, "claimed");
  if (recovery.status !== "claimed") return;
  assert.notEqual(recovery.operationToken, first.operationToken);

  const fakeStripe = createFakeStripe({ oldIntent });
  await assert.rejects(
    resolveClaimedDepositIntents(first, fakeStripe as any, "cancel"),
    /claim was superseded/,
  );
  assert.equal(fakeStripe.calls.cancel.length, 0);

  await resolveClaimedDepositIntents(recovery, fakeStripe as any, "cancel");
  assert.deepEqual(fakeStripe.calls.cancel, ["pi_old"]);
});

test("terminal recovery reconciles Stripe status before recording release or capture", async () => {
  oldIntent.status = "succeeded";
  const cancelClaim = await claimDepositTerminalAction(requestId, "cancel");
  assert.equal(cancelClaim.status, "claimed");
  if (cancelClaim.status !== "claimed") return;
  const fakeStripe = createFakeStripe({ oldIntent });
  await assert.rejects(
    resolveClaimedDepositIntents(cancelClaim, fakeStripe as any, "cancel"),
    /already captured/,
  );
  assert.equal(fakeStripe.calls.cancel.length, 0);
  await releaseDepositTerminalClaim(cancelClaim);

  const captureClaim = await claimDepositTerminalAction(requestId, "capture");
  assert.equal(captureClaim.status, "claimed");
  if (captureClaim.status !== "claimed") return;
  await resolveClaimedDepositIntents(captureClaim, fakeStripe as any, "capture");
  assert.equal(fakeStripe.calls.capture.length, 0);
});

test("an expired renewal worker cannot overwrite a newer terminal claim after Stripe failure", async () => {
  let terminalClaim: Awaited<ReturnType<typeof claimDepositTerminalAction>> | undefined;
  const fakeStripe = createFakeStripe({
    oldIntent,
    failRetrieve: true,
    beforeRetrieve: async () => {
      terminalClaim = await claimDepositTerminalAction(
        requestId,
        "capture",
        new Date("2026-08-27T00:16:00Z"),
      );
    },
  });

  const result = await renewDepositHold({
    requestId,
    stripeClient: fakeStripe as any,
    now: new Date("2026-08-27T00:00:00Z"),
  });
  assert.equal(result.status, "skipped");
  assert.equal(terminalClaim?.status, "claimed");
  if (!terminalClaim || terminalClaim.status !== "claimed") return;

  const [persisted] = await db.select({
    status: itemRequests.depositRenewalStatus,
    token: itemRequests.depositOperationToken,
  }).from(itemRequests).where(eq(itemRequests.id, requestId));
  assert.equal(persisted.status, "terminal_action");
  assert.equal(persisted.token, terminalClaim.operationToken);

  fakeStripe.paymentIntents.retrieve = async (id: string) => fakeStripe.store.get(id) as any;
  await resolveClaimedDepositIntents(terminalClaim, fakeStripe as any, "capture");
  assert.deepEqual(fakeStripe.calls.capture, ["pi_old"]);
});