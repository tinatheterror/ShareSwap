import { randomUUID } from "node:crypto";
import {
  db,
  pool,
  itemRequests,
  items,
  notifications,
  messages,
  securityClaims,
  depositSettlementOperations,
} from "@workspace/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, asc, eq, inArray, isNull, like, lte, or, sql } from "drizzle-orm";

const RETURN_OPERATION_TYPE = "return_release";
const RETURN_OPERATION_PREFIX = "return-release-";
const RETURN_LOCK_NAMESPACE = 1380012364;
const ACTIVE_CLAIM_STATUSES = [
  "OPEN",
  "CUSTOMER_RESPONSE_PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "PROCESSING",
];
const MAX_REFUND_LIST_PAGES = 20;
const MAX_REFUND_ATTEMPTS_PER_RUN = 3;
const MAX_RECOVERY_BACKOFF_SECONDS = 30;
const MAX_RECOVERY_CANDIDATE_SCAN = 60;

const recoverySchema = {
  itemRequests,
  items,
  notifications,
  messages,
  securityClaims,
  depositSettlementOperations,
};

function createSessionDatabase(client: any) {
  return drizzle(client, { schema: recoverySchema });
}

type RecoveryDatabase = ReturnType<typeof createSessionDatabase>;
type RecoveryTransaction = Parameters<Parameters<RecoveryDatabase["transaction"]>[0]>[0];

export type ReturnRecoveryStripeClient = {
  paymentIntents: {
    retrieve: (...args: any[]) => Promise<any>;
    cancel: (...args: any[]) => Promise<any>;
  };
  refunds?: {
    create: (...args: any[]) => Promise<any>;
    list: (...args: any[]) => Promise<any>;
  };
};

export type ReturnRecoveryContext = {
  request: typeof itemRequests.$inferSelect;
  item: typeof items.$inferSelect;
};

export type ReturnRecoveryResult =
  | {
      status: "completed";
      request: typeof itemRequests.$inferSelect;
      context: ReturnRecoveryContext;
      recovered: boolean;
      alreadyCompleted: boolean;
      depositReleased: true;
    }
  | {
      status: "pending";
      depositReleased: boolean;
      returnRecoveryPending: true;
      error: string;
      busy?: true;
    }
  | { status: "conflict"; error: string }
  | { status: "not_found"; error: string };

type CompletionCallback = (context: ReturnRecoveryContext) => Promise<void>;

type OperationSnapshot = {
  paymentIntentIds: string[];
  currentPaymentIntentId: string | null;
  previousPaymentIntentId: string | null;
  depositMode: string | null;
  paymentIntentModes: Record<string, "authorization" | "refundable_charge" | null>;
  depositMethod: string | null;
  conditionRating: number;
  conditionNotes: string | null;
  sameCondition: boolean | null;
  isEarlyReturn: boolean;
  approvalTimestamp: string;
};

function operationKey(requestId: number): string {
  return `${RETURN_OPERATION_PREFIX}${requestId}`;
}

function parseOperationError(raw: string | null): {
  snapshot?: OperationSnapshot;
  lastError?: string | null;
} {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return { lastError: raw };
  }
}

function operationError(snapshot: OperationSnapshot, lastError: string | null): string {
  return JSON.stringify({ snapshot, lastError, releaseComplete: false });
}

function pendingOperationError(
  snapshot: OperationSnapshot,
  lastError: string,
  releaseComplete: boolean,
): string {
  return JSON.stringify({ snapshot, lastError, releaseComplete });
}

function snapshotMatchesRequest(
  snapshot: OperationSnapshot | undefined,
  request: typeof itemRequests.$inferSelect,
): boolean {
  return !!snapshot &&
    snapshot.currentPaymentIntentId === request.depositPaymentIntentId &&
    snapshot.previousPaymentIntentId === request.depositPreviousPaymentIntentId &&
    !!snapshot.paymentIntentModes &&
    (snapshot.currentPaymentIntentId === null ||
      snapshot.paymentIntentModes[snapshot.currentPaymentIntentId] === snapshot.depositMode) &&
    snapshot.paymentIntentIds.every((id) => {
      const mode = snapshot.paymentIntentModes[id];
      return mode === null || mode === "authorization" || mode === "refundable_charge";
    }) &&
    snapshot.depositMode === request.depositMode &&
    snapshot.depositMethod === request.depositMethod &&
    snapshot.conditionRating === request.returnConditionRating &&
    snapshot.conditionNotes === request.returnConditionNotes &&
    snapshot.sameCondition === request.returnConditionOk &&
    snapshot.isEarlyReturn === !!request.isEarlyReturn &&
    snapshot.approvalTimestamp === request.actualReturnAt?.toISOString() &&
    JSON.stringify(snapshot.paymentIntentIds) === JSON.stringify([...new Set(
      [request.depositPreviousPaymentIntentId, request.depositPaymentIntentId]
        .filter((id): id is string => !!id),
    )]);
}

function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "Unknown release error");
  return raw.slice(0, 1000);
}

async function getPendingRefunds(
  stripeClient: ReturnRecoveryStripeClient,
  paymentIntentId: string,
  beforeStripeCall: () => Promise<void>,
) {
  if (!stripeClient.refunds?.list) throw new Error("Stripe refund discovery is unavailable");
  const refunds: any[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_REFUND_LIST_PAGES; page += 1) {
    await beforeStripeCall();
    const result = await stripeClient.refunds.list({
      payment_intent: paymentIntentId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    refunds.push(...(result.data || []));
    if (!result.has_more) return refunds;
    const last = result.data?.[result.data.length - 1];
    if (!last?.id) throw new Error("Stripe refund listing returned an incomplete page");
    startingAfter = last.id;
  }
  throw new Error("Stripe refund listing exceeded its safe recovery limit");
}

type DepositMode = "authorization" | "refundable_charge";

function readProviderDepositMode(intent: any): DepositMode | null {
  const metadata = intent.metadata || {};
  const metadataValues = [metadata.depositMode, metadata.deposit_mode]
    .filter((value) => value !== undefined && value !== null && value !== "");
  const parsedMetadataModes = metadataValues.map((value) => {
    if (value !== "authorization" && value !== "refundable_charge") {
      throw new Error("PaymentIntent has an unknown deposit mode in provider metadata");
    }
    return value as DepositMode;
  });
  if (new Set(parsedMetadataModes).size > 1) {
    throw new Error("PaymentIntent deposit mode metadata is inconsistent");
  }

  let captureMethodMode: DepositMode | null = null;
  if (intent.capture_method !== undefined && intent.capture_method !== null) {
    if (intent.capture_method === "manual") captureMethodMode = "authorization";
    else if (intent.capture_method === "automatic" || intent.capture_method === "automatic_async") {
      captureMethodMode = "refundable_charge";
    } else {
      throw new Error("PaymentIntent has an unknown capture method");
    }
  }

  const metadataMode = parsedMetadataModes[0] || null;
  if (metadataMode && captureMethodMode && metadataMode !== captureMethodMode) {
    throw new Error("PaymentIntent provider metadata does not match its capture method");
  }
  return metadataMode || captureMethodMode;
}

async function persistResolvedPaymentIntentMode(
  database: RecoveryDatabase,
  requestId: number,
  key: string,
  token: string,
  paymentIntentId: string,
  resolvedMode: DepositMode,
  workingSnapshot: OperationSnapshot,
) {
  const existingMode = workingSnapshot.paymentIntentModes[paymentIntentId];
  if (existingMode && existingMode !== resolvedMode) {
    throw new Error("PaymentIntent mode differs from its persisted return snapshot");
  }
  if (existingMode === resolvedMode) return;

  const persisted = await database.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${requestId} FOR UPDATE`);
    const [request] = await tx.select().from(itemRequests)
      .where(eq(itemRequests.id, requestId))
      .limit(1);
    const [operation] = await tx.select().from(depositSettlementOperations)
      .where(eq(depositSettlementOperations.operationKey, key))
      .limit(1);
    if (
      !request ||
      !operation ||
      request.depositRenewalStatus !== "terminal_action" ||
      request.depositOperationType !== RETURN_OPERATION_TYPE ||
      request.depositOperationToken !== token
    ) throw new Error("Return recovery fence changed while persisting PaymentIntent mode");
    const snapshot = parseOperationError(operation.error).snapshot;
    if (!snapshot || !snapshotMatchesRequest(snapshot, request)) {
      throw new Error("Return deposit snapshot changed while persisting PaymentIntent mode");
    }
    const storedMode = snapshot.paymentIntentModes[paymentIntentId];
    if (storedMode && storedMode !== resolvedMode) {
      throw new Error("PaymentIntent mode differs from its persisted return snapshot");
    }
    const updatedSnapshot: OperationSnapshot = {
      ...snapshot,
      paymentIntentModes: { ...snapshot.paymentIntentModes, [paymentIntentId]: resolvedMode },
    };
    await tx.update(depositSettlementOperations).set({
      error: operationError(updatedSnapshot, parseOperationError(operation.error).lastError || null),
    }).where(eq(depositSettlementOperations.id, operation.id));
    return updatedSnapshot;
  });
  workingSnapshot.paymentIntentModes = persisted.paymentIntentModes;
}

async function retrievePaymentIntentWithMode(
  database: RecoveryDatabase,
  stripeClient: ReturnRecoveryStripeClient,
  requestId: number,
  key: string,
  token: string,
  paymentIntentId: string,
  snapshot: OperationSnapshot,
  beforeStripeCall: () => Promise<void>,
) {
  await beforeStripeCall();
  const intent = await stripeClient.paymentIntents.retrieve(paymentIntentId);
  const storedMode = snapshot.paymentIntentModes[paymentIntentId] || null;
  const providerMode = readProviderDepositMode(intent);
  const currentPaymentIntent = paymentIntentId === snapshot.currentPaymentIntentId;
  const requestMode = snapshot.depositMode === "authorization" || snapshot.depositMode === "refundable_charge"
    ? snapshot.depositMode
    : null;

  if (currentPaymentIntent && !requestMode) {
    throw new Error("Current PaymentIntent has no known deposit mode");
  }
  if (currentPaymentIntent && storedMode && storedMode !== requestMode) {
    throw new Error("Current PaymentIntent mode differs from the approved request snapshot");
  }
  if (currentPaymentIntent && providerMode && providerMode !== requestMode) {
    throw new Error("Current PaymentIntent mode differs from the approved request snapshot");
  }

  const resolvedMode = currentPaymentIntent
    ? requestMode
    : storedMode || providerMode;
  if (!resolvedMode) {
    throw new Error("Previous PaymentIntent deposit mode is unknown; refusing financial action");
  }
  if (providerMode && providerMode !== resolvedMode) {
    throw new Error("PaymentIntent mode differs from its persisted return snapshot");
  }
  if (storedMode && storedMode !== resolvedMode) {
    throw new Error("PaymentIntent mode differs from its persisted return snapshot");
  }
  if (!storedMode) {
    await persistResolvedPaymentIntentMode(
      database,
      requestId,
      key,
      token,
      paymentIntentId,
      resolvedMode,
      snapshot,
    );
  }
  return { intent, mode: resolvedMode };
}

async function releaseRefundableCharge(
  stripeClient: ReturnRecoveryStripeClient,
  intent: any,
  paymentIntentId: string,
  requestId: number,
  recoveryKey: string,
  beforeStripeCall: () => Promise<void>,
): Promise<{ complete: boolean; releasedSomething: boolean }> {
  if (!stripeClient.refunds?.create || !stripeClient.refunds.list) {
    throw new Error("Stripe refunds are unavailable");
  }

  if (intent.status === "canceled") return { complete: true, releasedSomething: true };
  if (intent.status !== "succeeded") {
    throw new Error(`Refundable deposit is not a captured charge (${intent.status})`);
  }
  if (intent.capture_method === "manual") {
    throw new Error("A captured manual authorization cannot be treated as a refundable charge");
  }

  let releasedBeforeError = false;
  try {
    for (let attemptInRun = 0; attemptInRun < MAX_REFUND_ATTEMPTS_PER_RUN; attemptInRun += 1) {
      const refunds = await getPendingRefunds(stripeClient, paymentIntentId, beforeStripeCall);
      const matching = refunds.filter(
        (refund) => refund.metadata?.returnRecoveryKey === recoveryKey,
      );
      const succeededAmount = refunds
        .filter((refund) => refund.status === "succeeded")
        .reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
      if (succeededAmount > 0) releasedBeforeError = true;
      const chargeAmount = Number(intent.amount_received || intent.amount || 0);
      const remaining = Math.max(0, chargeAmount - succeededAmount);
      if (remaining === 0) return { complete: true, releasedSomething: true };
      if (refunds.some((refund) => refund.status === "pending")) {
        return { complete: false, releasedSomething: succeededAmount > 0 };
      }

      // Failed refunds are terminal and moved no funds. Advancing the attempt
      // suffix is safe only after discovery confirms that outcome; otherwise the
      // same idempotency key is replayed on the next worker pass.
      const attempt = matching
        .filter((refund) => refund.status === "failed" || refund.status === "canceled")
        .reduce((maximum, refund) => {
          const recordedAttempt = Number(refund.metadata?.attempt);
          return Number.isInteger(recordedAttempt) && recordedAttempt >= 0
            ? Math.max(maximum, recordedAttempt + 1)
            : maximum + 1;
        }, 0);
      const idempotencyKey = `${recoveryKey}-${attempt}`;
      try {
        await beforeStripeCall();
        const refund = await stripeClient.refunds.create(
          {
            payment_intent: paymentIntentId,
            amount: remaining,
            metadata: {
              returnRecoveryKey: recoveryKey,
              requestId: String(requestId),
              attempt: String(attempt),
            },
          },
          { idempotencyKey },
        );
        if (refund.status === "pending") {
          return { complete: false, releasedSomething: succeededAmount > 0 };
        }
        if (refund.status === "succeeded") {
          releasedBeforeError = true;
          continue;
        }
        if (refund.status !== "failed" && refund.status !== "canceled") {
          return { complete: false, releasedSomething: succeededAmount > 0 };
        }
      } catch (createError) {
        // A timeout/5xx can arrive after Stripe created the refund. Inspect
        // discoverable metadata before deciding whether to leave it pending.
        const afterError = await getPendingRefunds(stripeClient, paymentIntentId, beforeStripeCall);
        const discovered = afterError.find(
          (refund) => refund.metadata?.returnRecoveryKey === recoveryKey &&
            Number(refund.metadata?.attempt) === attempt,
        );
        if (!discovered) throw createError;
        if (discovered.status === "pending") {
          return { complete: false, releasedSomething: succeededAmount > 0 };
        }
        if (discovered.status !== "succeeded" && discovered.status !== "failed" && discovered.status !== "canceled") {
          return { complete: false, releasedSomething: succeededAmount > 0 };
        }
        if (discovered.status === "succeeded") {
          releasedBeforeError = true;
          continue;
        }
      }
    }

    const finalRefunds = await getPendingRefunds(stripeClient, paymentIntentId, beforeStripeCall);
    const released = finalRefunds
      .filter((refund) => refund.status === "succeeded")
      .reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
    if (released > 0) releasedBeforeError = true;
    if (finalRefunds.some((refund) => refund.status === "pending")) {
      return { complete: false, releasedSomething: released > 0 };
    }
    await beforeStripeCall();
    const charge = await stripeClient.paymentIntents.retrieve(paymentIntentId);
    return {
      complete: released >= Number(charge.amount_received || charge.amount || 0),
      releasedSomething: released > 0,
    };
  } catch (error) {
    throw Object.assign(
      error instanceof Error ? error : new Error(String(error)),
      { releasedSomething: releasedBeforeError },
    );
  }
}

async function releaseAuthorization(
  stripeClient: ReturnRecoveryStripeClient,
  intent: any,
  paymentIntentId: string,
  requestId: number,
  beforeStripeCall: () => Promise<void>,
): Promise<{ complete: boolean; releasedSomething: boolean }> {
  if (intent.status === "canceled") return { complete: true, releasedSomething: true };
  if (intent.status === "succeeded") {
    throw new Error("Captured authorization cannot be treated as released");
  }

  try {
    await beforeStripeCall();
    await stripeClient.paymentIntents.cancel(paymentIntentId, {}, {
      idempotencyKey: `return-authorization-release-${requestId}-${paymentIntentId}`,
    });
  } catch (cancelError) {
    // A lost response is reconciled against Stripe's current state. A still
    // active authorization remains pending and is retried with the same key.
    await beforeStripeCall();
    intent = await stripeClient.paymentIntents.retrieve(paymentIntentId);
    if (intent.status === "canceled") return { complete: true, releasedSomething: true };
    throw cancelError;
  }
  await beforeStripeCall();
  intent = await stripeClient.paymentIntents.retrieve(paymentIntentId);
  if (intent.status === "canceled") return { complete: true, releasedSomething: true };
  if (intent.status === "succeeded") {
    throw new Error("Authorization was captured instead of released");
  }
  return { complete: false, releasedSomething: false };
}

async function releasePaymentIntents(
  database: RecoveryDatabase,
  stripeClient: ReturnRecoveryStripeClient,
  requestId: number,
  expectedToken: string,
  operation: typeof depositSettlementOperations.$inferSelect,
  snapshot: OperationSnapshot,
  beforeStripeCall: () => Promise<void>,
): Promise<{ allReleased: boolean; releasedCount: number }> {
  let releasedCount = 0;
  let allReleased = true;
  for (const paymentIntentId of snapshot.paymentIntentIds) {
    try {
      let result: { complete: boolean; releasedSomething: boolean };
      if (paymentIntentId.startsWith("simulated-")) {
        result = { complete: true, releasedSomething: true };
      } else {
        const { intent, mode } = await retrievePaymentIntentWithMode(
          database,
          stripeClient,
          requestId,
          operation.operationKey,
          expectedToken,
          paymentIntentId,
          snapshot,
          beforeStripeCall,
        );
        result = mode === "refundable_charge"
          ? await releaseRefundableCharge(
              stripeClient,
              intent,
              paymentIntentId,
              requestId,
              `${operation.operationKey}-${paymentIntentId}`,
              beforeStripeCall,
            )
          : await releaseAuthorization(
              stripeClient,
              intent,
              paymentIntentId,
              requestId,
              beforeStripeCall,
            );
      }
      if (result.releasedSomething) releasedCount += 1;
      if (!result.complete) allReleased = false;
    } catch (error) {
      if ((error as any)?.releasedSomething) releasedCount += 1;
      throw Object.assign(
        error instanceof Error ? error : new Error(String(error)),
        { releasedCount },
      );
    }
  }
  return { allReleased, releasedCount };
}

async function updatePendingNotice(
  tx: RecoveryTransaction,
  request: typeof itemRequests.$inferSelect,
  item: typeof items.$inferSelect,
  allReleased: boolean,
  releasedCount: number,
) {
  if (releasedCount === 0 && !allReleased) return;
  const itemName = item.name.length > 20 ? `${item.name.slice(0, 20)}…` : item.name;
  const hasPlatformDeposit = request.depositMethod !== "in_person" &&
    (!!request.depositPaymentIntentId || !!request.depositPreviousPaymentIntentId);
  const message = hasPlatformDeposit
    ? allReleased
      ? `"${itemName}" — deposit hold lifted; return confirmation is pending while we finish updating your request.`
      : `"${itemName}" — part of the deposit hold was released; return confirmation is pending while we reconcile the remaining hold.`
    : `"${itemName}" — return confirmation is pending while we finish updating your request.`;
  const title = hasPlatformDeposit ? "Deposit Released" : "Return Confirmation Pending";
  const [existing] = await tx.select({ id: notifications.id })
    .from(notifications)
    .where(and(
      eq(notifications.requestId, request.id),
      eq(notifications.userId, request.requesterId!),
      eq(notifications.type, "return_confirmed"),
    ))
    .limit(1);
  if (existing) {
    await tx.update(notifications).set({
      title,
      message,
      itemId: item.id,
      isRead: false,
    }).where(eq(notifications.id, existing.id));
    return;
  }
  await tx.insert(notifications).values({
    userId: request.requesterId!,
    type: "return_confirmed",
    title,
    message,
    itemId: item.id,
    requestId: request.id,
    isRead: false,
  });
}

async function persistPending(
  database: RecoveryDatabase,
  requestId: number,
  key: string,
  error: string,
  allReleased: boolean,
  releasedCount: number,
): Promise<boolean> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${requestId} FOR UPDATE`);
    const [row] = await tx.select({ request: itemRequests, item: items })
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(eq(itemRequests.id, requestId))
      .limit(1);
    if (!row) return false;
    const [operation] = await tx.select().from(depositSettlementOperations)
      .where(eq(depositSettlementOperations.operationKey, key))
      .limit(1);
    if (
      !operation ||
      row.request.depositRenewalStatus !== "terminal_action" ||
      row.request.depositOperationType !== RETURN_OPERATION_TYPE ||
      !row.request.depositOperationToken
    ) return false;
    const metadata = parseOperationError(operation.error);
    await tx.update(depositSettlementOperations).set({
      status: "INDETERMINATE",
      error: pendingOperationError(metadata.snapshot || {
        paymentIntentIds: [],
        currentPaymentIntentId: null,
        previousPaymentIntentId: null,
        depositMode: null,
        paymentIntentModes: {},
        depositMethod: null,
        conditionRating: 5,
        conditionNotes: null,
        sameCondition: null,
        isEarlyReturn: !!row.request.isEarlyReturn,
        approvalTimestamp: row.request.actualReturnAt?.toISOString() || new Date().toISOString(),
      }, error, allReleased),
    }).where(eq(depositSettlementOperations.id, operation.id));
    await updatePendingNotice(tx, row.request, row.item, allReleased, releasedCount);
    return true;
  });
}

async function acquireRequestLock(requestId: number) {
  const client = await pool.connect();
  let released = false;
  let clientReleased = false;
  const releaseClient = (error?: Error) => {
    if (clientReleased) return;
    clientReleased = true;
    client.release(error);
  };
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS locked",
      [RETURN_LOCK_NAMESPACE, requestId],
    );
    if (!result.rows[0]?.locked) {
      releaseClient();
      return null;
    }
    const database = createSessionDatabase(client);
    return {
      database,
      release: async () => {
        if (released) return;
        released = true;
        try {
          await client.query(
            "SELECT pg_advisory_unlock($1::integer, $2::integer)",
            [RETURN_LOCK_NAMESPACE, requestId],
          );
        } catch (error) {
          console.error(`[return-recovery] advisory lock release failed for request ${requestId}:`, error);
          releaseClient(error as Error);
        } finally {
          releaseClient();
        }
      },
    };
  } catch (error) {
    releaseClient(error as Error);
    throw error;
  }
}

async function prepareApprovedReturn(
  database: RecoveryDatabase,
  requestId: number,
  input: { conditionRating?: number; conditionNotes?: string | null; sameCondition?: boolean | null },
) {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${requestId} FOR UPDATE`);
    const [row] = await tx.select({ request: itemRequests, item: items })
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(eq(itemRequests.id, requestId))
      .limit(1);
    if (!row) return { kind: "not_found" as const };

    const key = operationKey(requestId);
    await tx.execute(sql`
      SELECT 1 FROM ${depositSettlementOperations}
      WHERE ${depositSettlementOperations.operationKey} = ${key}
      FOR UPDATE
    `);
    const [operation] = await tx.select().from(depositSettlementOperations)
      .where(eq(depositSettlementOperations.operationKey, key))
      .limit(1);
    if (
      operation?.status === "SETTLED" &&
      ["COMPLETED", "COMPLETED_EARLY"].includes(row.request.status)
    ) {
      return {
        kind: "completed" as const,
        request: row.request,
        item: row.item,
        operation,
        alreadyCompleted: true,
      };
    }

    if (
      operation &&
      row.request.depositRenewalStatus === "terminal_action" &&
      row.request.depositOperationType === RETURN_OPERATION_TYPE &&
      row.request.depositOperationToken
    ) {
      await tx.update(itemRequests).set({ depositRenewalAttemptedAt: new Date() })
        .where(and(
          eq(itemRequests.id, requestId),
          eq(itemRequests.depositOperationToken, row.request.depositOperationToken),
          eq(itemRequests.depositOperationType, RETURN_OPERATION_TYPE),
        ));
    }

    const [activeClaim] = await tx.select({ id: securityClaims.id }).from(securityClaims)
      .where(and(
        eq(securityClaims.requestId, requestId),
        inArray(securityClaims.status, ACTIVE_CLAIM_STATUSES),
      ))
      .limit(1);
    if (activeClaim) return { kind: "conflict" as const, error: "An active security claim is holding the deposit" };

    if (operation) {
      if (
        row.request.status !== "RETURN_REQUESTED" ||
        row.request.depositRenewalStatus !== "terminal_action" ||
        row.request.depositOperationType !== RETURN_OPERATION_TYPE ||
        !row.request.depositOperationToken
      ) {
        return { kind: "conflict" as const, error: "The persisted return recovery fence no longer matches this request" };
      }
      const metadata = parseOperationError(operation.error);
      const snapshot = metadata.snapshot;
      if (!snapshotMatchesRequest(snapshot, row.request)) {
        return { kind: "conflict" as const, error: "The persisted return deposit snapshot changed" };
      }
      return {
        kind: "ready" as const,
        request: row.request,
        item: row.item,
        operation,
        snapshot,
        recovered: true,
      };
    }

    if (row.request.status !== "RETURN_REQUESTED") {
      return { kind: "conflict" as const, error: "No return is pending for this request" };
    }
    // Never replace another terminal, renewal, or dispute fence, regardless of
    // how old it is. The existing owner must reconcile or explicitly resolve it.
    if (row.request.depositRenewalStatus === "terminal_action" || row.request.depositOperationToken) {
      return { kind: "conflict" as const, error: "Another deposit operation is already in progress" };
    }

    const now = new Date();
    const currentPaymentIntentId = row.request.depositPaymentIntentId;
    const previousPaymentIntentId = row.request.depositPreviousPaymentIntentId;
    const paymentIntentIds = [...new Set(
      [previousPaymentIntentId, currentPaymentIntentId].filter((id): id is string => !!id),
    )];
    const snapshot: OperationSnapshot = {
      paymentIntentIds,
      currentPaymentIntentId,
      previousPaymentIntentId,
      depositMode: row.request.depositMode,
      paymentIntentModes: Object.fromEntries(paymentIntentIds.map((id) => [
        id,
        id === currentPaymentIntentId &&
        (row.request.depositMode === "authorization" || row.request.depositMode === "refundable_charge")
          ? row.request.depositMode
          : null,
      ])),
      depositMethod: row.request.depositMethod,
      conditionRating: input.conditionRating || 5,
      conditionNotes: input.conditionNotes ?? null,
      sameCondition: input.sameCondition ?? null,
      isEarlyReturn: !!row.request.isEarlyReturn,
      approvalTimestamp: (row.request.actualReturnAt || now).toISOString(),
    };
    const token = randomUUID();
    const [fencedRequest] = await tx.update(itemRequests).set({
      depositRenewalStatus: "terminal_action",
      depositRenewalAttemptedAt: now,
      depositOperationToken: token,
      depositOperationType: RETURN_OPERATION_TYPE,
      actualReturnAt: row.request.actualReturnAt || now,
      returnConditionRating: snapshot.conditionRating,
      returnConditionNotes: snapshot.conditionNotes,
      returnConditionOk: snapshot.sameCondition,
    }).where(and(
      eq(itemRequests.id, requestId),
      eq(itemRequests.status, "RETURN_REQUESTED"),
    )).returning();
    if (!fencedRequest) return { kind: "conflict" as const, error: "Request changed before return recovery started" };

    const [createdOperation] = await tx.insert(depositSettlementOperations).values({
      requestId,
      operationKey: key,
      status: "PENDING",
      approvedAmount: "0",
      retainedAmount: "0",
      releasedAmount: row.request.trustDepositAmount || "0",
      stripePaymentIntentId: currentPaymentIntentId,
      error: operationError(snapshot, null),
    }).returning();
    return {
      kind: "ready" as const,
      request: fencedRequest,
      item: row.item,
      operation: createdOperation,
      snapshot,
      recovered: false,
    };
  });
}

async function finalizeReturn(
  database: RecoveryDatabase,
  requestId: number,
  key: string,
  expectedToken: string,
): Promise<
  | { status: "completed"; request: typeof itemRequests.$inferSelect; context: ReturnRecoveryContext }
  | { status: "blocked"; reason: string }
> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${requestId} FOR UPDATE`);
    await tx.execute(sql`
      SELECT 1 FROM ${depositSettlementOperations}
      WHERE ${depositSettlementOperations.operationKey} = ${key}
      FOR UPDATE
    `);
    const [row] = await tx.select({ request: itemRequests, item: items })
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(eq(itemRequests.id, requestId))
      .limit(1);
    if (!row) return { status: "blocked" as const, reason: "Request not found during finalization" };
    const [operation] = await tx.select().from(depositSettlementOperations)
      .where(eq(depositSettlementOperations.operationKey, key))
      .limit(1);
    if (
      !operation ||
      row.request.status !== "RETURN_REQUESTED" ||
      row.request.depositRenewalStatus !== "terminal_action" ||
      row.request.depositOperationType !== RETURN_OPERATION_TYPE ||
      row.request.depositOperationToken !== expectedToken
    ) {
      return { status: "blocked" as const, reason: "Return recovery fence changed before finalization" };
    }
    const operationSnapshot = parseOperationError(operation.error).snapshot;
    if (!operationSnapshot || !snapshotMatchesRequest(operationSnapshot, row.request)) {
      return { status: "blocked" as const, reason: "Return deposit snapshot changed before finalization" };
    }
    const [activeClaim] = await tx.select({ id: securityClaims.id }).from(securityClaims)
      .where(and(
        eq(securityClaims.requestId, requestId),
        inArray(securityClaims.status, ACTIVE_CLAIM_STATUSES),
      ))
      .limit(1);
    if (activeClaim) {
      return { status: "blocked" as const, reason: "An active security claim is holding the deposit" };
    }

    const now = new Date();
    const status = row.request.isEarlyReturn ? "COMPLETED_EARLY" : "COMPLETED";
    const approvedAt = new Date(operationSnapshot.approvalTimestamp);
    const [updated] = await tx.update(itemRequests).set({
      status,
      overdueStage: "RETURNED_PENDING_REVIEW",
      overdueStageChangedAt: now,
      returnConfirmedAt: approvedAt,
      actualReturnAt: approvedAt,
      depositStatus: "released",
      depositReleasedAt: now,
      depositPreviousPaymentIntentId: null,
      depositRenewalStatus: null,
      depositOperationToken: null,
      depositOperationType: null,
    }).where(and(
      eq(itemRequests.id, requestId),
      eq(itemRequests.depositRenewalStatus, "terminal_action"),
      eq(itemRequests.depositOperationToken, expectedToken),
      eq(itemRequests.depositOperationType, RETURN_OPERATION_TYPE),
    )).returning();
    if (!updated) throw new Error("Request changed before the return could complete");

    await tx.update(items)
      .set({ isAvailable: true, updatedAt: now })
      .where(eq(items.id, row.item.id));

    const itemName = row.item.name.length > 20 ? `${row.item.name.slice(0, 20)}…` : row.item.name;
    const isInPerson = row.request.depositMethod === "in_person";
    const finalNoticeMessage = isInPerson
      ? `"${itemName}" returned to owner.`
      : `"${itemName}" returned to owner. Deposit hold lifted.`;
    const [existingNotice] = await tx.select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.requestId, requestId),
        eq(notifications.userId, row.request.requesterId!),
        eq(notifications.type, "return_confirmed"),
      ))
      .limit(1);
    if (existingNotice) {
      await tx.update(notifications).set({
        title: "Return Confirmed",
        message: finalNoticeMessage,
        itemId: row.item.id,
        isRead: false,
      }).where(eq(notifications.id, existingNotice.id));
    } else {
      await tx.insert(notifications).values({
        userId: row.request.requesterId!,
        type: "return_confirmed",
        title: "Return Confirmed",
        message: finalNoticeMessage,
        itemId: row.item.id,
        requestId,
        isRead: false,
      });
    }

    await tx.insert(messages).values({
      content: isInPerson
        ? "✅ Return confirmed — item received in good condition."
        : "✅ Return confirmed — item received in good condition. Deposit hold is lifted.",
      senderId: row.item.ownerId!,
      receiverId: row.request.requesterId!,
      messageType: "system",
      requestId,
    });

    await tx.update(depositSettlementOperations).set({
      status: "SETTLED",
      error: null,
      completedAt: now,
    }).where(eq(depositSettlementOperations.id, operation.id));

    return {
      status: "completed" as const,
      request: updated,
      context: { request: row.request, item: row.item },
    };
  });
}

async function markReturnOperationProcessing(
  database: RecoveryDatabase,
  requestId: number,
  operationId: number,
  expectedToken: string,
  snapshot: OperationSnapshot,
): Promise<boolean> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${requestId} FOR UPDATE`);
    const [operation] = await tx.select().from(depositSettlementOperations)
      .where(eq(depositSettlementOperations.id, operationId))
      .limit(1);
    const [request] = await tx.select().from(itemRequests)
      .where(eq(itemRequests.id, requestId))
      .limit(1);
    if (
      !operation ||
      !request ||
      request.status !== "RETURN_REQUESTED" ||
      request.depositRenewalStatus !== "terminal_action" ||
      request.depositOperationType !== RETURN_OPERATION_TYPE ||
      request.depositOperationToken !== expectedToken
    ) return false;
    await tx.update(depositSettlementOperations).set({
      status: "PROCESSING",
      error: operationError(snapshot, null),
    }).where(eq(depositSettlementOperations.id, operationId));
    await tx.update(itemRequests).set({ depositRenewalAttemptedAt: new Date() })
      .where(and(
        eq(itemRequests.id, requestId),
        eq(itemRequests.depositOperationToken, expectedToken),
        eq(itemRequests.depositOperationType, RETURN_OPERATION_TYPE),
      ));
    return true;
  });
}

export async function confirmApprovedReturn({
  requestId,
  conditionRating,
  conditionNotes,
  sameCondition,
  stripeClient,
  onCompleted,
  beforeFinalization,
}: {
  requestId: number;
  conditionRating?: number;
  conditionNotes?: string | null;
  sameCondition?: boolean | null;
  stripeClient: ReturnRecoveryStripeClient;
  onCompleted?: CompletionCallback;
  beforeFinalization?: () => void | Promise<void>;
}): Promise<ReturnRecoveryResult> {
  const lock = await acquireRequestLock(requestId);
  if (!lock) {
    return {
      status: "pending",
      depositReleased: false,
      returnRecoveryPending: true,
      busy: true,
      error: "Return recovery is already running; safely retry shortly.",
    };
  }

  try {
    const database = lock.database;
    const prepared = await prepareApprovedReturn(database, requestId, {
      conditionRating,
      conditionNotes,
      sameCondition,
    });
    if (prepared.kind === "not_found") return { status: "not_found", error: "Request not found" };
    if (prepared.kind === "conflict") return { status: "conflict", error: prepared.error };
    if (prepared.kind === "completed") {
      return {
        status: "completed",
        request: prepared.request,
        context: { request: prepared.request, item: prepared.item },
        recovered: false,
        alreadyCompleted: true,
        depositReleased: true,
      };
    }
    if (!prepared.snapshot) {
      return { status: "conflict", error: "Persisted return recovery snapshot is missing" };
    }
    const snapshot = prepared.snapshot;

    const expectedToken = prepared.request.depositOperationToken;
    if (!expectedToken) {
      return { status: "conflict", error: "Return recovery fence is missing" };
    }
    const hasPlatformDeposit = snapshot.depositMethod !== "in_person" &&
      snapshot.paymentIntentIds.length > 0;

    const isProcessing = await markReturnOperationProcessing(
      database,
      requestId,
      prepared.operation.id,
      expectedToken,
      snapshot,
    );
    if (!isProcessing) {
      return { status: "conflict", error: "Return recovery fence changed before deposit release" };
    }

    let releaseOutcome: { allReleased: boolean; releasedCount: number };
    try {
      await assertOwnedReturnFence(database, requestId, operationKey(requestId), expectedToken);
      releaseOutcome = await releasePaymentIntents(
        database,
        stripeClient,
        requestId,
        expectedToken,
        prepared.operation,
        snapshot,
        () => assertOwnedReturnFence(database, requestId, operationKey(requestId), expectedToken),
      );
    } catch (error) {
      const pendingError = safeError(error);
      const releasedCount = Number((error as any)?.releasedCount || 0);
      console.error(`[return-recovery] deposit release remains pending for request ${requestId}:`, pendingError);
      const persisted = await persistPending(
        database,
        requestId,
        operationKey(requestId),
        pendingError,
        false,
        releasedCount,
      );
      if (!persisted) return { status: "conflict", error: "Return recovery fence changed during deposit release" };
      return {
        status: "pending",
        depositReleased: false,
        returnRecoveryPending: true,
        error: "The deposit release is still being reconciled. You can safely retry.",
      };
    }

    if (!releaseOutcome.allReleased) {
      const persisted = await persistPending(
        database,
        requestId,
        operationKey(requestId),
        "One or more deposit PaymentIntents are still pending release",
        false,
        releaseOutcome.releasedCount,
      );
      if (!persisted) return { status: "conflict", error: "Return recovery fence changed during deposit release" };
      return {
        status: "pending",
        depositReleased: false,
        returnRecoveryPending: true,
        error: "The deposit release is still being reconciled. You can safely retry.",
      };
    }

    try {
      await beforeFinalization?.();
      const finalized = await finalizeReturn(
        database,
        requestId,
        operationKey(requestId),
        expectedToken,
      );
      if (finalized.status !== "completed") {
        const persisted = await persistPending(
          database,
          requestId,
          operationKey(requestId),
          finalized.reason,
          true,
          releaseOutcome.releasedCount,
        );
        if (!persisted) return { status: "conflict", error: finalized.reason };
        const errorMessage = hasPlatformDeposit
          ? "The deposit was released, but return confirmation is still pending. You can safely retry."
          : "Return confirmation is still pending while we finish updating your request. You can safely retry.";
        return {
          status: "pending",
          depositReleased: hasPlatformDeposit,
          returnRecoveryPending: true,
          error: errorMessage,
        };
      }
      // The shared winner-only callback performs unrelated DB work through the
      // application pool; never invoke it while this client holds the advisory
      // lock or a reserved connection.
      await lock.release();
      if (onCompleted) {
        try {
          await onCompleted(finalized.context);
        } catch (error) {
          console.error("[return-recovery] post-return effects failed after committed completion:", error);
        }
      }
      return {
        status: "completed",
        request: finalized.request,
        context: finalized.context,
        recovered: prepared.recovered,
        alreadyCompleted: false,
        depositReleased: true,
      };
    } catch (error) {
      console.error(`[return-recovery] finalization remains pending for request ${requestId}:`, safeError(error));
      const persisted = await persistPending(
        database,
        requestId,
        operationKey(requestId),
        safeError(error),
        true,
        releaseOutcome.releasedCount,
      );
      if (!persisted) {
        console.error("[return-recovery] could not persist pending notice after release:", error);
      }
      const errorMessage = hasPlatformDeposit
        ? "The deposit was released, but return confirmation is still pending. You can safely retry."
        : "Return confirmation is still pending while we finish updating your request. You can safely retry.";
      return {
        status: "pending",
        depositReleased: hasPlatformDeposit,
        returnRecoveryPending: true,
        error: errorMessage,
      };
    }
  } finally {
    await lock.release();
  }
}

async function assertOwnedReturnFence(
  database: RecoveryDatabase,
  requestId: number,
  key: string,
  token: string,
) {
  const [row] = await database.select({ request: itemRequests, operation: depositSettlementOperations })
    .from(itemRequests)
    .innerJoin(depositSettlementOperations, eq(depositSettlementOperations.requestId, itemRequests.id))
    .where(and(
      eq(itemRequests.id, requestId),
      eq(depositSettlementOperations.operationKey, key),
      eq(itemRequests.depositRenewalStatus, "terminal_action"),
      eq(itemRequests.depositOperationType, RETURN_OPERATION_TYPE),
      eq(itemRequests.depositOperationToken, token),
    ))
    .limit(1);
  if (!row) throw new Error("Persisted return recovery fence was superseded");
  const snapshot = parseOperationError(row.operation.error).snapshot;
      if (!snapshot || !snapshotMatchesRequest(snapshot, row.request)) {
    throw new Error("Persisted return deposit snapshot was superseded");
  }
  const [activeClaim] = await database.select({ id: securityClaims.id }).from(securityClaims)
    .where(and(
      eq(securityClaims.requestId, requestId),
      inArray(securityClaims.status, ACTIVE_CLAIM_STATUSES),
    ))
    .limit(1);
  if (activeClaim) throw new Error("An active security claim is holding the deposit");
}

export async function recoverPendingApprovedReturns({
  stripeClient,
  onCompleted,
  limit = 3,
  requestIds,
}: {
  stripeClient: ReturnRecoveryStripeClient;
  onCompleted?: CompletionCallback;
  limit?: number;
  /** Internal execution scope, used to keep fake-provider tests isolated. */
  requestIds?: number[];
}): Promise<{ checked: number; completed: number; pending: number; results: ReturnRecoveryResult[] }> {
  const jobLimit = Math.min(Math.max(limit, 0), 3);
  if (jobLimit === 0) return { checked: 0, completed: 0, pending: 0, results: [] };
  const releaseComplete = sql<boolean>`
    CASE
      WHEN ${depositSettlementOperations.error} LIKE '{"snapshot":%'
      THEN COALESCE((${depositSettlementOperations.error}::jsonb ->> 'releaseComplete') = 'true', false)
      ELSE false
    END
  `;
  const retryBackoffElapsed = or(
    isNull(itemRequests.depositRenewalAttemptedAt),
    lte(itemRequests.depositRenewalAttemptedAt, sql`NOW() - INTERVAL '${sql.raw(String(MAX_RECOVERY_BACKOFF_SECONDS))} seconds'`),
  );
  const candidates = await db.select({
    requestId: depositSettlementOperations.requestId,
    status: depositSettlementOperations.status,
    lastAttemptAt: itemRequests.depositRenewalAttemptedAt,
    releaseComplete,
  })
    .from(depositSettlementOperations)
    .innerJoin(itemRequests, eq(itemRequests.id, depositSettlementOperations.requestId))
    .where(and(
      like(depositSettlementOperations.operationKey, `${RETURN_OPERATION_PREFIX}%`),
      inArray(depositSettlementOperations.status, ["PENDING", "PROCESSING", "INDETERMINATE"]),
      eq(itemRequests.status, "RETURN_REQUESTED"),
      eq(itemRequests.depositRenewalStatus, "terminal_action"),
      eq(itemRequests.depositOperationType, RETURN_OPERATION_TYPE),
      requestIds ? inArray(depositSettlementOperations.requestId, requestIds) : undefined,
      or(retryBackoffElapsed, releaseComplete, eq(depositSettlementOperations.status, "PROCESSING")),
    ))
    .orderBy(
      asc(itemRequests.depositRenewalAttemptedAt),
      asc(depositSettlementOperations.createdAt),
      asc(depositSettlementOperations.requestId),
    )
    .limit(Math.min(jobLimit * 20, MAX_RECOVERY_CANDIDATE_SCAN));

  const results: ReturnRecoveryResult[] = [];
  let attemptedJobs = 0;
  for (const candidate of candidates) {
    if (attemptedJobs >= jobLimit) break;
    const attemptedAtMs = candidate.lastAttemptAt?.getTime() ?? 0;
    const backoffElapsed = attemptedAtMs === 0 ||
      Date.now() - attemptedAtMs >= MAX_RECOVERY_BACKOFF_SECONDS * 1000;
    if (candidate.status === "PROCESSING" && !backoffElapsed && !candidate.releaseComplete) {
      results.push({
        status: "pending",
        depositReleased: false,
        returnRecoveryPending: true,
        busy: true,
        error: "Return recovery is already running; safely retry shortly.",
      });
      continue;
    }
    try {
      const result = await confirmApprovedReturn({
        requestId: candidate.requestId,
        stripeClient,
        onCompleted,
      });
      if (result.status === "pending") {
        console.error(`[return-recovery] request ${candidate.requestId} remains pending:`, result.error);
      }
      results.push(result);
      if (!(result.status === "pending" && result.busy)) attemptedJobs += 1;
    } catch (error) {
      console.error(`[return-recovery] recovery failed for request ${candidate.requestId}:`, error);
      results.push({
        status: "pending",
        depositReleased: false,
        returnRecoveryPending: true,
        error: "The deposit release is still being reconciled. You can safely retry.",
      });
      attemptedJobs += 1;
    }
  }
  return {
    checked: results.length,
    completed: results.filter((result) => result.status === "completed" && !result.alreadyCompleted).length,
    pending: results.filter((result) => result.status === "pending").length,
    results,
  };
}