import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { db, itemRequests, items, notifications } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { sendPushToUser } from "./push-notifications";

const RENEWAL_WINDOW_MS = 36 * 60 * 60 * 1000;
const ACTIVE_DEPOSIT_STATUSES = ["authorized", "held", "disputed"];
const ACTIVE_REQUEST_STATUSES = [
  "DEPOSIT_CONFIRMED",
  "AWAITING_HANDOFF_CONFIRM",
  "HANDOFF_CONFIRMED",
  "HANDOFF_DISPUTED",
  "IN_PROGRESS",
  "RETURN_REQUESTED",
  "DISPUTED",
];

export const DEPOSIT_RENEWAL_FAILED_NOTIFICATION_TYPE = "deposit_renewal_failed";

export type DepositRenewalStripeClient = {
  paymentIntents: {
    retrieve: Stripe["paymentIntents"]["retrieve"];
    create: Stripe["paymentIntents"]["create"];
    cancel: Stripe["paymentIntents"]["cancel"];
    capture?: Stripe["paymentIntents"]["capture"];
  };
  refunds?: { create: Stripe["refunds"]["create"] };
};

export type DepositTerminalClaim =
  | {
      status: "claimed";
      request: typeof itemRequests.$inferSelect;
      operationToken: string;
      operationType: "cancel" | "capture" | "dispute";
    }
  | { status: "busy" | "not_found"; reason: string };

export async function claimDepositTerminalAction(
  requestId: number,
  operationType: "cancel" | "capture" | "dispute",
  now = new Date(),
): Promise<DepositTerminalClaim> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 1 FROM ${itemRequests}
      WHERE ${itemRequests.id} = ${requestId}
      FOR UPDATE
    `);
    const [request] = await tx
      .select()
      .from(itemRequests)
      .where(eq(itemRequests.id, requestId))
      .limit(1);
    if (!request) return { status: "not_found", reason: "Request not found" };

    const claimIsFresh =
      request.depositRenewalStatus === "renewing" &&
      request.depositRenewalAttemptedAt &&
      request.depositRenewalAttemptedAt.getTime() > now.getTime() - 15 * 60 * 1000;
    if (claimIsFresh) {
      return { status: "busy", reason: "A deposit update is already in progress" };
    }
    if (request.depositRenewalStatus === "terminal_action" || request.depositOperationToken) {
      return {
        status: "busy",
        reason: request.depositOperationType === operationType
          ? "This deposit resolution is already in progress; reconcile its persisted operation"
          : "A different deposit resolution is already in progress",
      };
    }

    const operationToken = randomUUID();
    await tx.update(itemRequests).set({
      depositRenewalStatus: "terminal_action",
      depositRenewalAttemptedAt: now,
      depositOperationToken: operationToken,
      depositOperationType: operationType,
    }).where(eq(itemRequests.id, requestId));
    return { status: "claimed", request, operationToken, operationType };
  });
}

export async function resolveClaimedDepositIntents(
  claim: Extract<DepositTerminalClaim, { status: "claimed" }>,
  stripeClient: DepositRenewalStripeClient,
  action: "cancel" | "capture",
) {
  const { request } = claim;
  const assertClaimOwnership = async () => {
    const [owned] = await db.select({ id: itemRequests.id }).from(itemRequests).where(and(
      eq(itemRequests.id, request.id),
      eq(itemRequests.depositRenewalStatus, "terminal_action"),
      eq(itemRequests.depositOperationToken, claim.operationToken),
      eq(itemRequests.depositOperationType, claim.operationType),
    )).limit(1);
    if (!owned) throw new Error("Deposit operation claim was superseded");
  };
  const cancelIfActive = async (paymentIntentId: string) => {
    await assertClaimOwnership();
    // Seeded/demo requests use a non-Stripe identifier. There is no external
    // authorization to cancel, but the normal settlement workflow must still
    // be allowed to complete and record the release.
    if (paymentIntentId.startsWith("simulated-")) return;
    const intent = await stripeClient.paymentIntents.retrieve(paymentIntentId);
    if (intent.status === "succeeded") {
      // A refundable deposit is intentionally an already-captured charge. Its
      // release is a Stripe refund, never a second implicit money movement.
      if (request.depositMode === "refundable_charge") {
        if (!stripeClient.refunds) throw new Error("Stripe refunds are unavailable");
        await stripeClient.refunds.create({ payment_intent: paymentIntentId }, {
          idempotencyKey: `refundable-deposit-release-${request.id}-${paymentIntentId}`,
        });
        return;
      }
      throw new Error("Deposit authorization was already captured and cannot be released");
    }
    if (intent.status === "canceled") return;
    await assertClaimOwnership();
    await stripeClient.paymentIntents.cancel(paymentIntentId);
  };

  if (request.depositPreviousPaymentIntentId) {
    await cancelIfActive(request.depositPreviousPaymentIntentId);
  }
  if (!request.depositPaymentIntentId) return;
  if (action === "capture") {
    // The refundable charge was collected only after explicit consent. A
    // terminal claim approval retains it; there is no PI capture to perform.
    if (request.depositMode === "refundable_charge") return;
    if (!stripeClient.paymentIntents.capture) {
      throw new Error("Stripe capture is unavailable");
    }
    await assertClaimOwnership();
    const current = await stripeClient.paymentIntents.retrieve(request.depositPaymentIntentId);
    if (current.status === "succeeded") return;
    if (current.status === "canceled") {
      throw new Error("Deposit authorization was already released and cannot be captured");
    }
    await assertClaimOwnership();
    await stripeClient.paymentIntents.capture(request.depositPaymentIntentId);
  } else {
    await cancelIfActive(request.depositPaymentIntentId);
  }
}

export async function releaseDepositTerminalClaim(
  claim: Extract<DepositTerminalClaim, { status: "claimed" }>,
) {
  const { request } = claim;
  await db.update(itemRequests).set({
    depositRenewalStatus: request.depositRenewalStatus,
    depositRenewalAttemptedAt: request.depositRenewalAttemptedAt,
    depositOperationToken: request.depositOperationToken,
    depositOperationType: request.depositOperationType,
  }).where(and(
    eq(itemRequests.id, request.id),
    eq(itemRequests.depositRenewalStatus, "terminal_action"),
    eq(itemRequests.depositOperationToken, claim.operationToken),
    request.depositPaymentIntentId
      ? eq(itemRequests.depositPaymentIntentId, request.depositPaymentIntentId)
      : sql`${itemRequests.depositPaymentIntentId} IS NULL`,
  ));
}

export type DepositRenewalResult =
  | { status: "renewed"; requestId: number; oldPaymentIntentId: string; newPaymentIntentId: string; expiresAt: Date | null }
  | { status: "not_due"; requestId: number; expiresAt: Date }
  | { status: "skipped"; requestId: number; reason: string }
  | { status: "failed"; requestId: number; error: string };

function stripeId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Stripe places capture_before on the latest Charge's card details. The value
 * is a Unix timestamp in seconds and varies by card network and transaction
 * type, so callers must not substitute a fixed seven-day estimate.
 */
export function getPaymentIntentCaptureBefore(paymentIntent: any): Date | null {
  const latestCharge =
    paymentIntent?.latest_charge && typeof paymentIntent.latest_charge !== "string"
      ? paymentIntent.latest_charge
      : null;
  const captureBefore = latestCharge?.payment_method_details?.card?.capture_before;
  return typeof captureBefore === "number" && Number.isFinite(captureBefore)
    ? new Date(captureBefore * 1000)
    : null;
}

function safeRenewalError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "Unknown payment error");
  if (/authentication|declin|insufficient|expired|payment method|card/i.test(raw)) {
    return "Your saved card could not renew the security deposit authorization.";
  }
  return "The security deposit authorization could not be renewed automatically.";
}

async function markRenewalFailure(
  request: {
    id: number;
    requesterId: number | null;
    depositPaymentIntentId: string | null;
  },
  item: { id: number; name: string; ownerId: number | null },
  error: unknown,
  now: Date,
  renewalToken: string,
): Promise<DepositRenewalResult> {
  const message = safeRenewalError(error);
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 1 FROM ${itemRequests}
      WHERE ${itemRequests.id} = ${request.id}
      FOR UPDATE
    `);
    const [current] = await tx
      .select({
        paymentIntentId: itemRequests.depositPaymentIntentId,
        renewalStatus: itemRequests.depositRenewalStatus,
        operationToken: itemRequests.depositOperationToken,
      })
      .from(itemRequests)
      .where(eq(itemRequests.id, request.id))
      .limit(1);
    if (
      !request.depositPaymentIntentId ||
      current?.paymentIntentId !== request.depositPaymentIntentId ||
      current.renewalStatus !== "renewing" ||
      current.operationToken !== renewalToken
    ) {
      return { claimed: false, pushes: [] };
    }

    await tx
      .update(itemRequests)
      .set({
        depositRenewalStatus: "failed",
        depositRenewalAttemptedAt: now,
        depositRenewalError: message,
        depositOperationToken: null,
        depositOperationType: null,
      })
      .where(and(
        eq(itemRequests.id, request.id),
        eq(itemRequests.depositPaymentIntentId, request.depositPaymentIntentId),
        eq(itemRequests.depositRenewalStatus, "renewing"),
        eq(itemRequests.depositOperationToken, renewalToken),
      ));

    if (!request.requesterId) return { claimed: true, pushes: [] };
    const recipients = [
      {
        userId: request.requesterId,
        title: "Deposit authorization needs attention",
        body: `We couldn't renew the security deposit hold for "${item.name}". Retry now or update your saved payment method.`,
      },
      ...(item.ownerId && item.ownerId !== request.requesterId
        ? [{
            userId: item.ownerId,
            title: "Deposit authorization needs attention",
            body: `The security deposit hold for "${item.name}" could not be renewed. The renter has been asked to update their payment method.`,
          }]
        : []),
    ];
    const newPushes: typeof recipients = [];
    for (const recipient of recipients) {
      const [existing] = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(
          eq(notifications.userId, recipient.userId),
          eq(notifications.requestId, request.id),
          eq(notifications.type, DEPOSIT_RENEWAL_FAILED_NOTIFICATION_TYPE),
          eq(notifications.isRead, false),
        ))
        .limit(1);
      if (existing) continue;
      await tx.insert(notifications).values({
        userId: recipient.userId,
        type: DEPOSIT_RENEWAL_FAILED_NOTIFICATION_TYPE,
        title: recipient.title,
        message: recipient.body,
        itemId: item.id,
        requestId: request.id,
        isRead: false,
      });
      newPushes.push(recipient);
    }
    return { claimed: true, pushes: newPushes };
  });

  if (!outcome.claimed) {
    return { status: "skipped", requestId: request.id, reason: "Renewal claim was superseded" };
  }
  for (const push of outcome.pushes) {
    sendPushToUser(push.userId, {
      title: push.title,
      body: push.body,
      data: { screen: "chat", requestId: request.id, itemId: item.id },
    }, "payments").catch((pushError) =>
      console.error("[deposit-renewal] push failed:", pushError),
    );
  }
  return { status: "failed", requestId: request.id, error: message };
}

async function clearPreviousHold(
  requestId: number,
  previousPaymentIntentId: string,
  stripeClient: DepositRenewalStripeClient,
): Promise<boolean> {
  try {
    const previous = await stripeClient.paymentIntents.retrieve(previousPaymentIntentId);
    if (previous.status !== "canceled" && previous.status !== "succeeded") {
      await stripeClient.paymentIntents.cancel(previousPaymentIntentId);
    }
    await db
      .update(itemRequests)
      .set({ depositPreviousPaymentIntentId: null })
      .where(and(
        eq(itemRequests.id, requestId),
        eq(itemRequests.depositPreviousPaymentIntentId, previousPaymentIntentId),
      ));
    return true;
  } catch (error) {
    console.error(`[deposit-renewal] could not clean up prior hold ${previousPaymentIntentId}:`, error);
    return false;
  }
}

export async function renewDepositHold({
  requestId,
  stripeClient,
  force = false,
  now = new Date(),
  renewalWindowMs = RENEWAL_WINDOW_MS,
}: {
  requestId: number;
  stripeClient: DepositRenewalStripeClient;
  force?: boolean;
  now?: Date;
  renewalWindowMs?: number;
}): Promise<DepositRenewalResult> {
  // Authorization renewal is permanently disabled. Keeping this exported
  // no-op briefly avoids breaking older workers during a rolling deploy; it
  // must never contact Stripe or create a replacement authorization.
  return { status: "skipped", requestId, reason: "Authorization renewal is disabled; obtain refundable-deposit consent instead" };
  /*
  const joined: any = await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 1 FROM ${itemRequests}
      WHERE ${itemRequests.id} = ${requestId}
      FOR UPDATE
    `);
    const [row] = await tx
      .select({ request: itemRequests, item: items })
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(eq(itemRequests.id, requestId))
      .limit(1);
    if (!row) return { skipReason: "Request not found" };
    const { request } = row;
    if (
      !request.depositPaymentIntentId ||
      !request.requesterId ||
      !ACTIVE_DEPOSIT_STATUSES.includes(request.depositStatus || "") ||
      !ACTIVE_REQUEST_STATUSES.includes(request.status) ||
      !["BORROW", "RENT"].includes(request.requestType) ||
      request.depositMethod === "in_person"
    ) {
      return { skipReason: "No active card deposit authorization" };
    }
    if (force && request.depositRenewalStatus !== "failed") {
      return { skipReason: "Only a failed renewal can be retried manually" };
    }
    const claimIsFresh =
      request.depositRenewalStatus === "terminal_action" ||
      (request.depositRenewalStatus === "renewing" &&
      request.depositRenewalAttemptedAt &&
      request.depositRenewalAttemptedAt.getTime() > now.getTime() - 15 * 60 * 1000);
    if (claimIsFresh) return { skipReason: "A renewal is already in progress" };

    const renewalToken = randomUUID();
    await tx.update(itemRequests).set({
      depositRenewalStatus: "renewing",
      depositRenewalAttemptedAt: now,
      depositOperationToken: renewalToken,
      depositOperationType: "renewal",
    }).where(eq(itemRequests.id, requestId));
    return { ...row, renewalToken };
  });

  if (joined.skipReason) return { status: "skipped", requestId, reason: joined.skipReason };
  const { request, item, renewalToken } = joined;

  if (request.depositPreviousPaymentIntentId) {
    const cleanupSucceeded = await clearPreviousHold(
      requestId,
      request.depositPreviousPaymentIntentId,
      stripeClient,
    );
    if (!cleanupSucceeded) {
      await db.update(itemRequests).set({
        depositRenewalStatus: request.depositRenewalStatus,
        depositOperationToken: request.depositOperationToken,
        depositOperationType: request.depositOperationType,
      }).where(and(
        eq(itemRequests.id, requestId),
        eq(itemRequests.depositPaymentIntentId, request.depositPaymentIntentId),
        eq(itemRequests.depositRenewalStatus, "renewing"),
        eq(itemRequests.depositOperationToken, renewalToken),
      ));
      return {
        status: "skipped",
        requestId,
        reason: "A previous deposit hold is still awaiting cancellation",
      };
    }
  }

  const oldPaymentIntentId = request.depositPaymentIntentId;
  let oldPaymentIntent: any;
  try {
    oldPaymentIntent = await stripeClient.paymentIntents.retrieve(oldPaymentIntentId, {
      expand: ["latest_charge"],
    });
  } catch (error) {
    return markRenewalFailure(request, item, error, now, renewalToken);
  }

  const currentExpiresAt = getPaymentIntentCaptureBefore(oldPaymentIntent);
  if (!currentExpiresAt) {
    return markRenewalFailure(
      request,
      item,
      new Error("Stripe did not report an exact capture_before deadline"),
      now,
      renewalToken,
    );
  }
  if (!request.depositAuthorizationExpiresAt || request.depositAuthorizationExpiresAt.getTime() !== currentExpiresAt.getTime()) {
    await db
      .update(itemRequests)
      .set({ depositAuthorizationExpiresAt: currentExpiresAt })
      .where(and(
        eq(itemRequests.id, requestId),
        eq(itemRequests.depositPaymentIntentId, oldPaymentIntentId),
        eq(itemRequests.depositRenewalStatus, "renewing"),
        eq(itemRequests.depositOperationToken, renewalToken),
      ));
  }

  if (!force && currentExpiresAt.getTime() > now.getTime() + renewalWindowMs) {
    await db.update(itemRequests).set({
      depositRenewalStatus: "healthy",
      depositRenewalError: null,
      depositOperationToken: null,
      depositOperationType: null,
    }).where(and(
      eq(itemRequests.id, requestId),
      eq(itemRequests.depositPaymentIntentId, oldPaymentIntentId),
      eq(itemRequests.depositRenewalStatus, "renewing"),
      eq(itemRequests.depositOperationToken, renewalToken),
    ));
    return { status: "not_due", requestId, expiresAt: currentExpiresAt };
  }

  const customerId = stripeId(oldPaymentIntent.customer);
  const paymentMethodId = stripeId(oldPaymentIntent.payment_method);
  if (!customerId || !paymentMethodId || !oldPaymentIntent.amount || !oldPaymentIntent.currency) {
    return markRenewalFailure(
      request,
      item,
      new Error("PaymentIntent is missing its customer, payment method, amount, or currency"),
      now,
      renewalToken,
    );
  }

  let replacement: any;
  try {
    replacement = await stripeClient.paymentIntents.create({
      amount: oldPaymentIntent.amount,
      currency: oldPaymentIntent.currency,
      capture_method: "manual",
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,
      metadata: {
        ...oldPaymentIntent.metadata,
        type: "deposit_hold_renewal",
        requestId: requestId.toString(),
        userId: request.requesterId.toString(),
        renewalOf: oldPaymentIntentId,
      },
      description: `Renewed ShareSwap security deposit for request #${requestId}`,
      expand: ["latest_charge"],
    } as any, {
      idempotencyKey: `deposit-renewal-${requestId}-${oldPaymentIntentId}`,
    });

    if (replacement.status !== "requires_capture") {
      try { await stripeClient.paymentIntents.cancel(replacement.id); } catch (_) {}
      throw new Error(`Replacement authorization ended in ${replacement.status}`);
    }
  } catch (error) {
    return markRenewalFailure(request, item, error, now, renewalToken);
  }

  const replacementExpiresAt = getPaymentIntentCaptureBefore(replacement);
  if (!replacementExpiresAt) {
    try { await stripeClient.paymentIntents.cancel(replacement.id); } catch (_) {}
    return markRenewalFailure(
      request,
      item,
      new Error("Stripe did not report an exact capture_before deadline for the replacement"),
      now,
      renewalToken,
    );
  }
  const updateResult = await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 1 FROM ${itemRequests}
      WHERE ${itemRequests.id} = ${requestId}
      FOR UPDATE
    `);
    const [current] = await tx
      .select({
        paymentIntentId: itemRequests.depositPaymentIntentId,
        renewalStatus: itemRequests.depositRenewalStatus,
        operationToken: itemRequests.depositOperationToken,
        depositStatus: itemRequests.depositStatus,
        status: itemRequests.status,
        requestType: itemRequests.requestType,
        depositMethod: itemRequests.depositMethod,
      })
      .from(itemRequests)
      .where(eq(itemRequests.id, requestId))
      .limit(1);

    if (current?.paymentIntentId === replacement.id) return "already_replaced" as const;
    if (current?.paymentIntentId !== oldPaymentIntentId) return "superseded" as const;
    if (
      current.renewalStatus !== "renewing" ||
      current.operationToken !== renewalToken ||
      !ACTIVE_DEPOSIT_STATUSES.includes(current.depositStatus || "") ||
      !ACTIVE_REQUEST_STATUSES.includes(current.status) ||
      !["BORROW", "RENT"].includes(current.requestType) ||
      current.depositMethod === "in_person"
    ) {
      return "superseded" as const;
    }

    await tx
      .update(itemRequests)
      .set({
        depositPaymentIntentId: replacement.id,
        depositHoldAttemptId: replacement.id,
        depositAuthorizedAt: now,
        depositAuthorizationExpiresAt: replacementExpiresAt,
        depositRenewalStatus: "healthy",
        depositRenewalAttemptedAt: now,
        depositRenewalError: null,
        depositRenewalCount: (request.depositRenewalCount || 0) + 1,
        depositPreviousPaymentIntentId: oldPaymentIntentId,
        depositOperationToken: null,
        depositOperationType: null,
      })
      .where(and(
        eq(itemRequests.id, requestId),
        eq(itemRequests.depositRenewalStatus, "renewing"),
        eq(itemRequests.depositOperationToken, renewalToken),
      ));
    return "updated" as const;
  });

  if (updateResult === "superseded") {
    try { await stripeClient.paymentIntents.cancel(replacement.id); } catch (_) {}
    return { status: "skipped", requestId, reason: "A newer authorization already replaced this hold" };
  }

  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(
      eq(notifications.requestId, requestId),
      eq(notifications.type, DEPOSIT_RENEWAL_FAILED_NOTIFICATION_TYPE),
    ));

  await clearPreviousHold(requestId, oldPaymentIntentId, stripeClient);

  return {
    status: "renewed",
    requestId,
    oldPaymentIntentId,
    newPaymentIntentId: replacement.id,
    expiresAt: replacementExpiresAt,
  };
  */
}

export async function processExpiringDepositHolds({
  stripeClient,
  now = new Date(),
}: {
  stripeClient: DepositRenewalStripeClient;
  now?: Date;
}) {
  // Intentionally no sweep: expiration is not a settlement event and can
  // never create a new authorization or capture/retain a deposit.
  return { checked: 0, renewed: 0, failed: 0, results: [] as DepositRenewalResult[] };
  /*
  const candidates = await db
    .select({ id: itemRequests.id })
    .from(itemRequests)
    .where(and(
      inArray(itemRequests.requestType, ["BORROW", "RENT"]),
      inArray(itemRequests.status, ACTIVE_REQUEST_STATUSES),
      inArray(itemRequests.depositStatus, ACTIVE_DEPOSIT_STATUSES),
    ));

  const results: DepositRenewalResult[] = [];
  for (const candidate of candidates) {
    results.push(await renewDepositHold({
      requestId: candidate.id,
      stripeClient,
      now,
    }));
  }
  return {
    checked: candidates.length,
    renewed: results.filter((result) => result.status === "renewed").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
  */
}