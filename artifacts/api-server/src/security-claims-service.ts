import Stripe from "stripe";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, depositSettlementOperations, itemRequests, items, messages, notifications, requestLifecycleEvents, securityClaims } from "@workspace/db";
import { OVERDUE_POLICY } from "./overdue-policy";
import { claimDepositTerminalAction, getPaymentIntentCaptureBefore, releaseDepositTerminalClaim } from "./deposit-renewal-service";
import {
  HOLD_EXPIRED_BODY,
  HOLD_EXPIRED_TITLE,
  claimOpenedChat,
  claimOpenedOwner,
  claimResolvedChat,
  depositChargedBorrower,
  holdReleasedChat,
  outcomeFor,
  rejectedHoldReleasedBorrower,
  rejectedHoldReleasedOwner,
  resolutionBorrower,
  resolutionOwner,
} from "./deposit-copy";

export type ClaimStripeClient = Pick<Stripe, "paymentIntents" | "refunds">;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ACTIVE_CLAIM_STATUSES = ["OPEN", "CUSTOMER_RESPONSE_PENDING", "UNDER_REVIEW", "APPROVED", "PROCESSING"];
/** Deposit states from which a claim may charge (or record the charge of) the deposit. */
const SECURED_DEPOSIT_STATUSES = ["authorized", "held", "disputed", "SECURED_REFUNDABLE", "secured_refundable"];

const isSimulatedIntent = (id?: string | null) => !!id && id.startsWith("simulated-");
const cents = (amount: number) => Math.round(amount * 100);
const dollars = (value: number) => Math.round(value * 100) / 100;

async function event(requestId: number, eventType: string, key: string, details: Record<string, unknown> = {}, actorId?: number) {
  await db.insert(requestLifecycleEvents).values({ requestId, eventType, idempotencyKey: key, details, actorId: actorId ?? null }).onConflictDoNothing();
}

function stripeOutcomeIsIndeterminate(error: unknown): boolean {
  const value = error as any;
  const status = Number(value?.statusCode || value?.status || 0);
  const type = String(value?.type || value?.code || "");
  return !status || status === 429 || status >= 500 ||
    /connection|timeout|network|api_connection|rate_limit/i.test(type) ||
    /connection|timeout|socket|network|temporar/i.test(String(value?.message || ""));
}

function safeOperationError(error: unknown) {
  const message = error instanceof Error ? error.message : "Stripe operation failed";
  return message.replace(/(?:card|payment)[ _-]?(?:number|method)\\s*[:=]\\s*\\S+/gi, "[redacted]").slice(0, 500);
}

function chargeIdOf(intent: any): string | null {
  const charge = intent?.latest_charge;
  return typeof charge === "string" ? charge : charge?.id || null;
}

function cardOf(intent: any): { brand: string | null; last4: string | null } {
  const charge = intent?.latest_charge && typeof intent.latest_charge !== "string" ? intent.latest_charge : null;
  const card = charge?.payment_method_details?.card;
  return { brand: card?.brand ?? null, last4: card?.last4 ?? null };
}

/** Separate read (never an expansion on the capture call) so card details cannot fail a capture. */
async function readCardDetails(stripe: ClaimStripeClient, paymentIntentId: string, fallback: any) {
  const known = cardOf(fallback);
  if (known.last4) return known;
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] } as any);
    return cardOf(intent);
  } catch {
    return known;
  }
}

async function itemNameFor(tx: Tx, itemId: number | null): Promise<string> {
  if (!itemId) return "your item";
  const [row] = await tx.select({ name: items.name }).from(items).where(eq(items.id, itemId)).limit(1);
  return row?.name || "your item";
}

async function insertClaimChatEvent(
  tx: Tx,
  claim: { ownerId: number; borrowerId: number },
  requestId: number,
  content: string,
  metadata: Record<string, unknown>,
) {
  await tx.insert(messages).values({
    senderId: claim.ownerId, receiverId: claim.borrowerId, requestId,
    content, messageType: "event", metadata,
  });
}

export type EnsureCaptureResult =
  | { status: "captured"; alreadyCaptured: boolean; chargedAmount: number | null; cardLast4: string | null; cardBrand: string | null }
  | { status: "pending"; reason: string; indeterminate: boolean };

function capturedResult(request: { depositCapturedAmount: string | null; depositCardLast4: string | null; depositCardBrand: string | null }, alreadyCaptured: boolean): EnsureCaptureResult {
  return {
    status: "captured", alreadyCaptured,
    chargedAmount: request.depositCapturedAmount === null ? null : Number(request.depositCapturedAmount),
    cardLast4: request.depositCardLast4, cardBrand: request.depositCardBrand,
  };
}

/**
 * Records a completed capture exactly once: ledger -> SETTLED, request ->
 * 'captured', fence cleared, borrower/owner notifications and the chat stamp.
 * Callers must own the request's "capture" fence token.
 */
async function finalizeClaimCapture(args: {
  requestId: number; claimId: number; fenceToken: string; operationId: number; operationKey: string;
  deposit: number; captureId: string | null; card: { brand: string | null; last4: string | null };
}) {
  const { requestId, claimId, fenceToken, operationId, operationKey, deposit, captureId, card } = args;
  const finalized = await db.transaction(async tx => {
    const completedAt = new Date();
    await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${requestId} FOR UPDATE`);
    await tx.execute(sql`SELECT 1 FROM ${securityClaims} WHERE ${securityClaims.id} = ${claimId} FOR UPDATE`);
    const [owned] = await tx.select().from(itemRequests).where(and(
      eq(itemRequests.id, requestId), eq(itemRequests.depositOperationToken, fenceToken), eq(itemRequests.depositOperationType, "capture"),
    )).limit(1);
    if (!owned) throw new Error("Deposit operation fence was superseded");
    const [claim] = await tx.select().from(securityClaims).where(eq(securityClaims.id, claimId)).limit(1);
    if (!claim) throw new Error("Claim not found");
    const [settledOperation] = await tx.update(depositSettlementOperations).set({
      status: "SETTLED", stripeCaptureId: captureId, completedAt, error: null,
    }).where(and(
      eq(depositSettlementOperations.id, operationId),
      eq(depositSettlementOperations.operationKey, operationKey),
      inArray(depositSettlementOperations.status, ["PROCESSING", "INDETERMINATE"]),
    )).returning({ id: depositSettlementOperations.id });
    if (!settledOperation) throw new Error("Capture ledger finalization was superseded");
    await tx.update(itemRequests).set({
      depositStatus: "captured", depositCapturedAmount: deposit.toFixed(2), depositCapturedAt: completedAt,
      depositCardBrand: card.brand, depositCardLast4: card.last4,
      // A captured deposit is no longer constrained by the authorization window.
      claimDecisionDeadlineAt: null, settlementStartDeadlineAt: null,
      depositRenewalStatus: null, depositOperationToken: null, depositOperationType: null,
    }).where(and(eq(itemRequests.id, requestId), eq(itemRequests.depositOperationToken, fenceToken)));
    const itemName = await itemNameFor(tx, owned.itemId);
    const borrowerCopy = depositChargedBorrower(deposit, itemName);
    const ownerCopy = claimOpenedOwner(deposit, itemName);
    await tx.insert(notifications).values([
      { userId: claim.borrowerId, requestId, itemId: owned.itemId, ...borrowerCopy },
      { userId: claim.ownerId, requestId, itemId: owned.itemId, ...ownerCopy },
    ]);
    await insertClaimChatEvent(tx, claim, requestId, claimOpenedChat(deposit), {
      eventType: "claim_opened", claimId, depositMode: owned.depositMode, amount: deposit, cardLast4: card.last4, cardBrand: card.brand, itemTitle: itemName,
    });
    return true;
  });
  if (finalized) await event(requestId, "DEPOSIT_CAPTURED_FOR_CLAIM", operationKey, { claimId, amount: deposit });
  return finalized;
}

/**
 * Opening a claim is the ONLY thing that turns a temporary hold into a charge.
 * Captures the FULL deposit (authorization mode) under the request terminal
 * fence and the settlement ledger (`claim-capture-{claimId}`). Idempotent;
 * an indeterminate Stripe outcome keeps the fence and is retried through
 * reconcileClaimCaptureOperation with the original idempotency key. Never
 * holds a DB transaction open across a Stripe call.
 *
 * It never throws for payment problems: the claim stays open and the result is
 * `pending` so the caller (and later the admin settle/decision path) can retry.
 */
export async function ensureClaimDepositCaptured(
  claimId: number,
  stripe: ClaimStripeClient,
  hooks: { beforeCapture?: () => Promise<void> } = {},
): Promise<EnsureCaptureResult> {
  const [identity] = await db.select({ requestId: securityClaims.requestId, status: securityClaims.status })
    .from(securityClaims).where(eq(securityClaims.id, claimId)).limit(1);
  if (!identity) throw new Error("Claim not found");
  const key = `claim-capture-${claimId}`;
  const [current] = await db.select().from(itemRequests).where(eq(itemRequests.id, identity.requestId)).limit(1);
  if (!current) throw new Error("Request not found");
  if (current.depositStatus === "captured" && current.depositCapturedAt) return capturedResult(current, true);
  if (["released", "settled"].includes(current.depositStatus || "")) {
    return { status: "pending", reason: "The deposit is no longer available to charge", indeterminate: false };
  }
  const [priorOperation] = await db.select().from(depositSettlementOperations).where(eq(depositSettlementOperations.operationKey, key)).limit(1);
  if (priorOperation && ["INDETERMINATE", "PROCESSING"].includes(priorOperation.status) && current.depositOperationType === "capture" && current.depositOperationToken) {
    return reconcileClaimCaptureOperation(priorOperation.id, stripe);
  }
  const terminal = await claimDepositTerminalAction(identity.requestId, "capture", new Date());
  if (terminal.status !== "claimed") return { status: "pending", reason: terminal.reason, indeterminate: false };
  let operation: typeof depositSettlementOperations.$inferSelect | undefined;
  let financialCallInvoked = false;
  let result: EnsureCaptureResult = { status: "pending", reason: "Deposit charge did not complete", indeterminate: false };
  try {
    const preflight = await db.transaction(async tx => {
      await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${identity.requestId} FOR UPDATE`);
      await tx.execute(sql`SELECT 1 FROM ${securityClaims} WHERE ${securityClaims.id} = ${claimId} FOR UPDATE`);
      const [request] = await tx.select().from(itemRequests).where(eq(itemRequests.id, identity.requestId)).limit(1);
      const [claim] = await tx.select().from(securityClaims).where(eq(securityClaims.id, claimId)).limit(1);
      if (!request || request.depositOperationToken !== terminal.operationToken || request.depositOperationType !== "capture") throw new Error("Deposit operation fence was superseded");
      if (!claim || !ACTIVE_CLAIM_STATUSES.includes(claim.status)) throw new Error("Claim is no longer open");
      if (!SECURED_DEPOSIT_STATUSES.includes(request.depositStatus || "") || !request.depositPaymentIntentId) throw new Error("Deposit is no longer available to charge");
      const deposit = Number(request.trustDepositAmount || 0);
      if (!(deposit > 0)) throw new Error("Deposit amount is not available");
      const [existing] = await tx.select().from(depositSettlementOperations).where(eq(depositSettlementOperations.operationKey, key)).limit(1);
      const [op] = existing ? [existing] : await tx.insert(depositSettlementOperations).values({
        claimId, requestId: request.id, operationKey: key, approvedAmount: deposit.toFixed(2),
        stripePaymentIntentId: request.depositPaymentIntentId,
      }).returning();
      if (existing && !["INDETERMINATE", "PROCESSING"].includes(existing.status)) {
        await tx.update(depositSettlementOperations).set({ status: "PENDING", error: null }).where(eq(depositSettlementOperations.id, existing.id));
      }
      return { request, deposit, operation: op };
    });
    operation = preflight.operation;
    const { request, deposit } = preflight;
    const [started] = await db.update(depositSettlementOperations).set({ status: "PROCESSING", error: null }).where(and(
      eq(depositSettlementOperations.id, operation.id),
      eq(depositSettlementOperations.operationKey, key),
      inArray(depositSettlementOperations.status, ["PENDING", "FAILED", "INDETERMINATE", "PROCESSING"]),
    )).returning({ id: depositSettlementOperations.id });
    if (!started) throw new Error("Capture ledger operation could not enter processing");

    let captureId: string | null = null;
    let card = { brand: null as string | null, last4: null as string | null };
    if (!isSimulatedIntent(request.depositPaymentIntentId)) {
      const intent = await stripe.paymentIntents.retrieve(request.depositPaymentIntentId!, { expand: ["latest_charge"] } as any);
      if (request.depositMode === "authorization") {
        if (intent.status === "succeeded") {
          // A previous response may have been lost after Stripe captured: record, never recapture.
          captureId = chargeIdOf(intent);
        } else if (intent.status === "requires_capture") {
          const captureBefore = getPaymentIntentCaptureBefore(intent);
          if (captureBefore && captureBefore <= new Date()) {
            await db.transaction(async tx => {
              await tx.update(itemRequests).set({ depositStatus: "EXPIRED_UNSECURED" })
                .where(and(eq(itemRequests.id, request.id), eq(itemRequests.depositOperationToken, terminal.operationToken)));
              await tx.update(securityClaims).set({ settlementStatus: "MANUAL_REVIEW", updatedAt: new Date() })
                .where(and(eq(securityClaims.id, claimId), inArray(securityClaims.status, ACTIVE_CLAIM_STATUSES)));
            });
            throw new Error("The temporary hold expired before it could be charged; manual payment review required");
          }
          if (hooks.beforeCapture) await hooks.beforeCapture();
          financialCallInvoked = true;
          // Full capture. The key is deterministic so a retry can never charge twice.
          const captured = await stripe.paymentIntents.capture(intent.id, {}, { idempotencyKey: `${key}-capture`, maxNetworkRetries: 0 });
          captureId = chargeIdOf(captured) || chargeIdOf(intent);
        } else throw new Error(`Deposit hold is not capturable (${intent.status})`);
      } else if (request.depositMode === "refundable_charge") {
        // Already a real charge after explicit consent: nothing to capture.
        if (intent.status !== "succeeded") throw new Error(`Refundable deposit is not charged (${intent.status})`);
        captureId = chargeIdOf(intent);
      } else throw new Error("Unsupported deposit mechanism; manual review required");
      card = await readCardDetails(stripe, intent.id, intent);
    }
    await finalizeClaimCapture({
      requestId: request.id, claimId, fenceToken: terminal.operationToken, operationId: operation.id,
      operationKey: key, deposit, captureId, card,
    });
    const [done] = await db.select().from(itemRequests).where(eq(itemRequests.id, request.id)).limit(1);
    result = capturedResult(done!, false);
    return result;
  } catch (error) {
    const uncertain = financialCallInvoked && stripeOutcomeIsIndeterminate(error);
    if (operation) {
      await db.update(depositSettlementOperations).set({
        status: uncertain ? "INDETERMINATE" : "FAILED",
        error: `${uncertain ? "indeterminate" : "definitive"}: ${safeOperationError(error)}`,
      }).where(and(eq(depositSettlementOperations.id, operation.id), ne(depositSettlementOperations.status, "SETTLED")));
    }
    result = { status: "pending", reason: safeOperationError(error), indeterminate: uncertain };
    return result;
  } finally {
    const [current] = operation ? await db.select({ status: depositSettlementOperations.status }).from(depositSettlementOperations).where(eq(depositSettlementOperations.id, operation.id)).limit(1) : [];
    // A definitively failed (or never-started) attempt releases the fence so a
    // deterministic retry is possible. Indeterminate/in-flight keeps it.
    if (!current || !["SETTLED", "INDETERMINATE", "PROCESSING"].includes(current.status)) {
      await releaseDepositTerminalClaim(terminal);
    }
  }
}

/** Resolves an INDETERMINATE/PROCESSING capture using the ledger's original idempotency key. */
export async function reconcileClaimCaptureOperation(operationId: number, stripe: ClaimStripeClient): Promise<EnsureCaptureResult> {
  const snapshot = await db.transaction(async tx => {
    await tx.execute(sql`SELECT 1 FROM ${depositSettlementOperations} WHERE ${depositSettlementOperations.id} = ${operationId} FOR UPDATE`);
    const [operation] = await tx.select().from(depositSettlementOperations).where(eq(depositSettlementOperations.id, operationId)).limit(1);
    if (!operation?.claimId) throw new Error("Capture operation not found");
    await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${operation.requestId} FOR UPDATE`);
    const [request] = await tx.select().from(itemRequests).where(eq(itemRequests.id, operation.requestId)).limit(1);
    if (!request) throw new Error("Request not found");
    if (operation.status === "SETTLED") return { settled: true as const, request };
    if (request.depositOperationType !== "capture" || !request.depositOperationToken) throw new Error("Capture fence is not active");
    return { settled: false as const, operation, request, fenceToken: request.depositOperationToken };
  });
  if (snapshot.settled) return capturedResult(snapshot.request, true);
  const { operation, request, fenceToken } = snapshot;
  const fail = async (error: unknown): Promise<EnsureCaptureResult> => {
    await db.update(depositSettlementOperations).set({ status: "FAILED", error: `definitive: ${safeOperationError(error)}` })
      .where(and(eq(depositSettlementOperations.id, operationId), ne(depositSettlementOperations.status, "SETTLED")));
    await releaseDepositFenceIfOwned(request.id, fenceToken);
    return { status: "pending", reason: safeOperationError(error), indeterminate: false };
  };
  let captureId: string | null = null;
  let card = { brand: null as string | null, last4: null as string | null };
  if (!isSimulatedIntent(request.depositPaymentIntentId)) {
    const intent = await stripe.paymentIntents.retrieve(request.depositPaymentIntentId!, { expand: ["latest_charge"] } as any);
    if (request.depositMode === "refundable_charge") {
      if (intent.status !== "succeeded") return { status: "pending", reason: `Refundable deposit is not charged (${intent.status})`, indeterminate: true };
      captureId = chargeIdOf(intent);
    } else if (intent.status === "succeeded") {
      captureId = chargeIdOf(intent);
    } else if (intent.status === "requires_capture") {
      if (operation.status !== "INDETERMINATE") return { status: "pending", reason: "Capture is still processing", indeterminate: true };
      try {
        const captured = await stripe.paymentIntents.capture(intent.id, {}, { idempotencyKey: `${operation.operationKey}-capture`, maxNetworkRetries: 0 });
        captureId = chargeIdOf(captured) || chargeIdOf(intent);
      } catch (error) {
        if (stripeOutcomeIsIndeterminate(error)) return { status: "pending", reason: safeOperationError(error), indeterminate: true };
        return fail(error);
      }
    } else {
      return fail(new Error(`Deposit hold is not capturable (${intent.status})`));
    }
    card = await readCardDetails(stripe, intent.id, intent);
  }
  await finalizeClaimCapture({
    requestId: request.id, claimId: operation.claimId!, fenceToken, operationId, operationKey: operation.operationKey,
    deposit: Number(request.trustDepositAmount || 0), captureId, card,
  });
  const [done] = await db.select().from(itemRequests).where(eq(itemRequests.id, request.id)).limit(1);
  return capturedResult(done!, false);
}

/**
 * Resolves an approved claim. The deposit was already charged when the claim
 * was opened (ensured idempotently first), so settlement REFUNDS
 * (deposit - approvedAmount) and retains approvedAmount. Locks the claim and
 * request before any Stripe side effect.
 */
export async function settleApprovedClaim(
  claimId: number,
  stripe: ClaimStripeClient,
  _startedAt = new Date(),
  hooks: { beforeRefund?: () => Promise<void> } = {},
) {
  const [identity] = await db.select({ requestId: securityClaims.requestId, status: securityClaims.status, settlementStatus: securityClaims.settlementStatus })
    .from(securityClaims).where(eq(securityClaims.id, claimId)).limit(1);
  if (!identity) throw new Error("Claim not found");
  if (identity.settlementStatus === "SETTLED") return { done: true as const };
  // The charge must exist before anything is refunded or retained.
  const ensured = await ensureClaimDepositCaptured(claimId, stripe);
  if (ensured.status !== "captured") throw new Error(`The security deposit has not been charged yet: ${ensured.reason}`);
  // Fence first. Reconciliation and return release inspect this same durable
  // request-level ownership token.
  const terminal = await claimDepositTerminalAction(identity.requestId, "capture", new Date());
  if (terminal.status !== "claimed") throw new Error(terminal.reason);
  let operation: typeof depositSettlementOperations.$inferSelect | undefined;
  let financialCallInvoked = false;
  try {
    const preflight = await db.transaction(async tx => {
      await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${identity.requestId} FOR UPDATE`);
      await tx.execute(sql`SELECT 1 FROM ${securityClaims} WHERE ${securityClaims.id} = ${claimId} FOR UPDATE`);
      const [request] = await tx.select().from(itemRequests).where(eq(itemRequests.id, identity.requestId)).limit(1);
      const [claim] = await tx.select().from(securityClaims).where(eq(securityClaims.id, claimId)).limit(1);
      const checkedAt = new Date();
      if (!request || request.depositOperationToken !== terminal.operationToken || request.depositOperationType !== "capture") throw new Error("Deposit operation fence was superseded");
      if (!claim || !["APPROVED", "PROCESSING"].includes(claim.status) || claim.settlementStatus === "MANUAL_REVIEW") throw new Error("Claim is no longer settlement-eligible");
      if (request.depositStatus !== "captured" || !request.depositPaymentIntentId) throw new Error("Deposit has not been charged");
      const amount = Number(claim.approvedAmount || 0), deposit = Number(request.depositCapturedAmount ?? request.trustDepositAmount ?? 0);
      if (amount <= 0 || amount > deposit || !claim.reason || !Array.isArray(claim.evidence) || !claim.evidence.length || !claim.borrowerNotifiedAt) throw new Error("Approved claim does not meet settlement requirements");
      const key = `claim-settlement-${claim.id}-${amount.toFixed(2)}`;
      const [existing] = await tx.select().from(depositSettlementOperations).where(eq(depositSettlementOperations.operationKey, key)).limit(1);
      if (existing?.status === "SETTLED") return { done: true as const, claim, request, amount, deposit, key, operation: existing };
      const [op] = existing ? [existing] : await tx.insert(depositSettlementOperations).values({ claimId, requestId: request.id, operationKey: key, approvedAmount: amount.toFixed(2), stripePaymentIntentId: request.depositPaymentIntentId }).returning();
      if (existing && !["INDETERMINATE", "PROCESSING"].includes(existing.status)) await tx.update(depositSettlementOperations).set({ status: "PENDING", error: null }).where(eq(depositSettlementOperations.id, existing.id));
      await tx.update(securityClaims).set({ status: "PROCESSING", settlementStatus: "PROCESSING", updatedAt: checkedAt }).where(and(eq(securityClaims.id, claim.id), inArray(securityClaims.status, ["APPROVED", "PROCESSING"])));
      return { done: false as const, claim, request, amount, deposit, key, operation: op };
    });
    operation = preflight.operation;
    if (preflight.done) return preflight;
    const { claim, request, amount, deposit, key } = preflight;
    const [startedOperation] = await db.update(depositSettlementOperations).set({ status: "PROCESSING", error: null }).where(and(
      eq(depositSettlementOperations.id, operation.id),
      eq(depositSettlementOperations.operationKey, key),
      inArray(depositSettlementOperations.status, ["PENDING", "INDETERMINATE", "PROCESSING"]),
    )).returning({ id: depositSettlementOperations.id });
    if (!startedOperation) throw new Error("Settlement ledger operation could not enter processing");
    const refundAmount = dollars(deposit - amount);
    let refundId: string | null = null;
    if (!isSimulatedIntent(request.depositPaymentIntentId)) {
      const intent = await stripe.paymentIntents.retrieve(request.depositPaymentIntentId!);
      if (intent.status !== "succeeded") throw new Error(`Security deposit is not charged (${intent.status})`);
      if (refundAmount > 0) {
        if (hooks.beforeRefund) await hooks.beforeRefund();
        financialCallInvoked = true;
        const refund = await stripe.refunds.create(
          { payment_intent: intent.id, amount: cents(refundAmount), metadata: { operationKey: key } },
          { idempotencyKey: `${key}-refund`, maxNetworkRetries: 0 },
        );
        refundId = refund.id;
      }
    }
    await finalizeApprovedSettlement({ claim, request, operationId: operation.id, key, fenceToken: terminal.operationToken, amount, deposit, refundAmount, refundId, reconciled: false });
    await event(request.id, "DEPOSIT_SETTLED", key, { claimId, retainedAmount: amount, refundedAmount: refundAmount });
    return { done: true, retainedAmount: amount, releasedAmount: refundAmount, refundedAmount: refundAmount };
  } catch (error) {
    if (operation) {
      const uncertain = financialCallInvoked && stripeOutcomeIsIndeterminate(error);
      await db.update(depositSettlementOperations).set({
        status: uncertain ? "INDETERMINATE" : "FAILED",
        error: `${uncertain ? "indeterminate" : "definitive"}: ${safeOperationError(error)}`,
      }).where(eq(depositSettlementOperations.id, operation.id));
    }
    throw error;
  } finally {
    // Do not restore a successfully finalized fence; only a failed operation is
    // released for a deterministic retry.
    const [current] = operation ? await db.select({ status: depositSettlementOperations.status }).from(depositSettlementOperations).where(eq(depositSettlementOperations.id, operation.id)).limit(1) : [];
    if (current && !["SETTLED", "INDETERMINATE", "PROCESSING"].includes(current.status)) {
      await releaseDepositTerminalClaim(terminal);
    }
  }
}

/** Final ledger/claim/request transition + borrower/owner notices for an approved settlement. */
async function finalizeApprovedSettlement(args: {
  claim: typeof securityClaims.$inferSelect; request: typeof itemRequests.$inferSelect; operationId: number; key: string;
  fenceToken: string; amount: number; deposit: number; refundAmount: number; refundId: string | null; reconciled: boolean;
}): Promise<boolean> {
  const { claim, request, operationId, key, fenceToken, amount, deposit, refundAmount, refundId, reconciled } = args;
  return db.transaction(async tx => {
    const completedAt = new Date();
    await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${request.id} FOR UPDATE`);
    await tx.execute(sql`SELECT 1 FROM ${securityClaims} WHERE ${securityClaims.id} = ${claim.id} FOR UPDATE`);
    const [owned] = await tx.select({ id: itemRequests.id }).from(itemRequests).where(and(eq(itemRequests.id, request.id), eq(itemRequests.depositOperationToken, fenceToken), eq(itemRequests.depositOperationType, "capture"))).limit(1);
    if (!owned) {
      if (reconciled) return false;
      throw new Error("Deposit operation fence was superseded");
    }
    const [eligible] = await tx.select({ id: securityClaims.id }).from(securityClaims).where(and(eq(securityClaims.id, claim.id), eq(securityClaims.status, "PROCESSING"), ne(securityClaims.settlementStatus, "MANUAL_REVIEW"))).limit(1);
    if (!eligible) {
      if (reconciled) return false;
      throw new Error("Claim became ineligible during settlement");
    }
    const [settledOperation] = await tx.update(depositSettlementOperations).set({
      status: "SETTLED", retainedAmount: amount.toFixed(2), releasedAmount: refundAmount.toFixed(2), stripeRefundId: refundId, completedAt, error: null,
    }).where(and(
      eq(depositSettlementOperations.id, operationId),
      eq(depositSettlementOperations.operationKey, key),
      inArray(depositSettlementOperations.status, ["PROCESSING", "INDETERMINATE"]),
    )).returning({ id: depositSettlementOperations.id });
    if (!settledOperation) throw new Error("Settlement ledger finalization was superseded");
    await tx.update(securityClaims).set({ status: "SETTLED", settlementStatus: "SETTLED", updatedAt: completedAt }).where(and(eq(securityClaims.id, claim.id), eq(securityClaims.status, "PROCESSING")));
    await tx.update(itemRequests).set({
      depositStatus: "settled", depositReleasedAt: completedAt, depositRefundedAmount: refundAmount.toFixed(2), depositRetainedAmount: amount.toFixed(2),
      depositRenewalStatus: null, depositOperationToken: null, depositOperationType: null,
    }).where(and(eq(itemRequests.id, request.id), eq(itemRequests.depositOperationToken, fenceToken)));
    const amounts = { charged: deposit, refunded: refundAmount, retained: amount };
    const borrowerCopy = resolutionBorrower(amounts, request.depositCardLast4);
    const ownerCopy = resolutionOwner(amounts);
    await tx.insert(notifications).values([
      { userId: claim.borrowerId, requestId: request.id, itemId: request.itemId, ...borrowerCopy },
      { userId: claim.ownerId, requestId: request.id, itemId: request.itemId, ...ownerCopy },
    ]);
    await insertClaimChatEvent(tx, claim, request.id, claimResolvedChat(refundAmount, amount), {
      eventType: "claim_resolved", claimId: claim.id, chargedAmount: deposit, refundedAmount: refundAmount, retainedAmount: amount,
      cardLast4: request.depositCardLast4, depositMode: request.depositMode, outcome: outcomeFor(deposit, refundAmount, amount),
    });
    return true;
  });
}

export async function markClaimDecisionDeadline(requestId: number, captureBefore: Date | null) {
  if (!captureBefore) return null;
  const deadline = new Date(captureBefore.getTime() - OVERDUE_POLICY.claimDecisionBufferHours * 3_600_000);
  const settlementStartDeadline = new Date(deadline.getTime() - OVERDUE_POLICY.CAPTURE_OPERATION_SAFETY_BUFFER_MINUTES * 60_000);
  await db.update(itemRequests).set({ claimDecisionDeadlineAt: deadline, settlementStartDeadlineAt: settlementStartDeadline }).where(eq(itemRequests.id, requestId));
  await event(requestId, "CLAIM_DEADLINES_SET", `claim-deadlines-${requestId}-${deadline.toISOString()}`, {
    claimDecisionDeadlineAt: deadline.toISOString(),
    settlementStartDeadlineAt: settlementStartDeadline.toISOString(),
  });
  return deadline;
}

/**
 * Called by the durable reminder sweep. It never calls Stripe or renews/captures:
 * an elapsed or expired temporary hold only marks the hold unsecured. Deposits
 * that a claim already charged are not constrained by the authorization window.
 */
export async function reconcileClaimDeadlines(
  now = new Date(),
  /** Restrict the pass to these requests (tests, so they never touch unrelated rows). */
  options: { onlyRequestIds?: number[] } = {},
) {
  if (options.onlyRequestIds && options.onlyRequestIds.length === 0) return { checked: 0, expired: 0 };
  const rows = await db.select({ id: itemRequests.id, expires: itemRequests.depositAuthorizationExpiresAt, depositStatus: itemRequests.depositStatus, requesterId: itemRequests.requesterId })
    .from(itemRequests).where(and(
      eq(itemRequests.depositMode, "authorization"),
      ...(options.onlyRequestIds ? [inArray(itemRequests.id, options.onlyRequestIds)] : []),
    ));
  let expired = 0;
  for (const row of rows) {
    if (["captured", "settled", "released"].includes(row.depositStatus || "")) continue;
    if (row.expires) await markClaimDecisionDeadline(row.id, row.expires);
    const changed = await db.transaction(async tx => {
      await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${row.id} FOR UPDATE`);
      const [current] = await tx.select().from(itemRequests).where(eq(itemRequests.id, row.id)).limit(1);
      if (!current?.claimDecisionDeadlineAt || current.claimDecisionDeadlineAt > now || ["EXPIRED_UNSECURED", "captured", "settled", "released"].includes(current.depositStatus || "")) return false;
      const captureFence = current.depositRenewalStatus === "terminal_action" &&
        current.depositOperationType === "capture" && !!current.depositOperationToken;
      // Fence age alone says nothing about an in-flight network outcome. Leave
      // it intact for reconcileSettlementOperation.
      if (captureFence) {
        const [existingAttention] = await tx.select({ id: notifications.id }).from(notifications).where(and(
          eq(notifications.requestId, row.id), eq(notifications.type, "settlement_reconciliation_required"),
        )).limit(1);
        if (!existingAttention) await tx.insert(notifications).values({
          userId: row.requesterId, requestId: row.id, type: "settlement_reconciliation_required",
          title: "Payment reconciliation in progress", message: "A deposit payment action needs reconciliation; no second payment action has been started.",
        });
        return false;
      }
      const [expiredRequest] = await tx.update(itemRequests).set({
        depositStatus: "EXPIRED_UNSECURED", depositRenewalStatus: null,
        depositOperationToken: null, depositOperationType: null,
      }).where(and(
        eq(itemRequests.id, row.id),
        ne(itemRequests.depositStatus, "EXPIRED_UNSECURED"),
        current.depositOperationToken ? eq(itemRequests.depositOperationToken, current.depositOperationToken) : isNull(itemRequests.depositOperationToken),
      )).returning({ id: itemRequests.id });
      if (!expiredRequest) return false;
        await tx.update(securityClaims).set({ settlementStatus: "MANUAL_REVIEW", updatedAt: now })
          .where(and(eq(securityClaims.requestId, row.id), inArray(securityClaims.status, ACTIVE_CLAIM_STATUSES)));
        const activeClaims = await tx.select({ ownerId: securityClaims.ownerId, borrowerId: securityClaims.borrowerId }).from(securityClaims)
          .where(and(eq(securityClaims.requestId, row.id), inArray(securityClaims.status, ACTIVE_CLAIM_STATUSES)));
        const recipients = activeClaims.length ? [...new Set(activeClaims.flatMap(c => [c.ownerId, c.borrowerId]))] : [row.requesterId];
        await tx.insert(notifications).values(recipients.map(userId => ({
          userId, type: "deposit_unsecured", title: HOLD_EXPIRED_TITLE,
          message: HOLD_EXPIRED_BODY, requestId: row.id,
        })));
      return true;
    });
    if (changed) expired++;
  }
  return { checked: rows.length, expired };
}

/**
 * Reconciles an indeterminate settlement without age-based fence stealing.
 * Any retry uses the operation's original deterministic Stripe key.
 */
export async function reconcileSettlementOperation(
  operationId: number,
  stripe: ClaimStripeClient,
  hooks: { beforeFinancialRetry?: () => Promise<void> } = {},
) {
  const [kind] = await db.select({ operationType: itemRequests.depositOperationType, operationKey: depositSettlementOperations.operationKey }).from(depositSettlementOperations)
    .innerJoin(itemRequests, eq(itemRequests.id, depositSettlementOperations.requestId))
    .where(eq(depositSettlementOperations.id, operationId)).limit(1);
  if (kind?.operationKey?.startsWith("claim-capture-")) return reconcileClaimCaptureOperation(operationId, stripe);
  if (kind?.operationType === "cancel") return reconcileRejectedReleaseOperation(operationId, stripe);
  const snapshot = await db.transaction(async tx => {
    await tx.execute(sql`SELECT 1 FROM ${depositSettlementOperations} WHERE ${depositSettlementOperations.id} = ${operationId} FOR UPDATE`);
    const [operation] = await tx.select().from(depositSettlementOperations).where(eq(depositSettlementOperations.id, operationId)).limit(1);
    if (!operation || !operation.claimId) throw new Error("Settlement operation not found");
    if (operation.status === "SETTLED") return { settled: true as const, operation };
    await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${operation.requestId} FOR UPDATE`);
    await tx.execute(sql`SELECT 1 FROM ${securityClaims} WHERE ${securityClaims.id} = ${operation.claimId} FOR UPDATE`);
    const [request] = await tx.select().from(itemRequests).where(eq(itemRequests.id, operation.requestId)).limit(1);
    const [claim] = await tx.select().from(securityClaims).where(eq(securityClaims.id, operation.claimId)).limit(1);
    if (!request || !claim || request.depositOperationType !== "capture" || !request.depositOperationToken)
      throw new Error("Settlement capture fence is not active");
    return { settled: false as const, operation, request, claim, fenceToken: request.depositOperationToken };
  });
  if (snapshot.settled) return { status: "settled" as const };
  const approved = Number(snapshot.operation.approvedAmount);
  const deposit = Number(snapshot.request.depositCapturedAmount ?? snapshot.request.trustDepositAmount ?? 0);
  const refundAmount = dollars(deposit - approved);
  let refundId: string | null = snapshot.operation.stripeRefundId;
  const recordDefinitiveRetryFailure = async (error: unknown) => {
    await db.transaction(async tx => {
      await tx.update(depositSettlementOperations).set({ status: "FAILED", error: `definitive: ${safeOperationError(error)}` }).where(eq(depositSettlementOperations.id, operationId));
      await tx.update(securityClaims).set({ status: "APPROVED", settlementStatus: "PENDING", updatedAt: new Date() }).where(and(eq(securityClaims.id, snapshot.claim.id), eq(securityClaims.status, "PROCESSING")));
      await tx.update(itemRequests).set({ depositRenewalStatus: null, depositOperationToken: null, depositOperationType: null }).where(and(eq(itemRequests.id, snapshot.request.id), eq(itemRequests.depositOperationToken, snapshot.fenceToken)));
    });
  };

  if (!isSimulatedIntent(snapshot.request.depositPaymentIntentId)) {
    const intent = await stripe.paymentIntents.retrieve(snapshot.request.depositPaymentIntentId!);
    // The deposit was charged at claim open; anything else needs a human.
    if (intent.status !== "succeeded") return { status: "manual_processing" as const };
    if (refundAmount > 0) {
      const refunds = await stripe.refunds.list({ payment_intent: intent.id, limit: 100 });
      const prior = refunds.data.find(refund => refund.metadata?.operationKey === snapshot.operation.operationKey);
      if (prior?.status === "succeeded") {
        refundId = prior.id;
      } else if (prior) {
        return { status: "manual_processing" as const };
      } else {
        if (snapshot.operation.status !== "INDETERMINATE") return { status: "manual_processing" as const };
        if (hooks.beforeFinancialRetry) await hooks.beforeFinancialRetry();
        let refund: any;
        try {
          refund = await stripe.refunds.create({ payment_intent: intent.id, amount: cents(refundAmount), metadata: { operationKey: snapshot.operation.operationKey } }, {
            idempotencyKey: `${snapshot.operation.operationKey}-refund`, maxNetworkRetries: 0,
          });
        } catch (error) {
          if (!stripeOutcomeIsIndeterminate(error)) await recordDefinitiveRetryFailure(error);
          throw error;
        }
        refundId = refund.id;
      }
    }
  }

  const finalized = await finalizeApprovedSettlement({
    claim: snapshot.claim, request: snapshot.request, operationId, key: snapshot.operation.operationKey,
    fenceToken: snapshot.fenceToken, amount: approved, deposit, refundAmount, refundId, reconciled: true,
  });
  return { status: finalized ? "settled" as const : "manual_processing" as const };
}

export async function reconcileRejectedReleaseOperation(operationId: number, stripe: ClaimStripeClient) {
  const snapshot = await db.transaction(async tx => {
    await tx.execute(sql`SELECT 1 FROM ${depositSettlementOperations} WHERE ${depositSettlementOperations.id} = ${operationId} FOR UPDATE`);
    const [operation] = await tx.select().from(depositSettlementOperations).where(eq(depositSettlementOperations.id, operationId)).limit(1);
    if (!operation?.claimId) throw new Error("Rejected release operation not found");
    if (operation.status === "SETTLED") return { settled: true as const, operation };
    await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${operation.requestId} FOR UPDATE`);
    const [request] = await tx.select().from(itemRequests).where(eq(itemRequests.id, operation.requestId)).limit(1);
    const [claim] = await tx.select().from(securityClaims).where(eq(securityClaims.id, operation.claimId)).limit(1);
    if (!request || !claim || claim.status !== "REJECTED" || request.depositOperationType !== "cancel" || !request.depositOperationToken)
      throw new Error("Rejected release fence is not active");
    return { settled: false as const, operation, request, claim, fenceToken: request.depositOperationToken };
  });
  if (snapshot.settled) return { status: "settled" as const };
  const simulated = isSimulatedIntent(snapshot.request.depositPaymentIntentId);
  const intent: any = simulated ? { id: snapshot.request.depositPaymentIntentId, status: "canceled" } : await stripe.paymentIntents.retrieve(snapshot.request.depositPaymentIntentId!);
  let released = false;
  let refundId = snapshot.operation.stripeRefundId;
  if (intent.status === "succeeded") {
    // Charged at claim open (or a refundable charge): the release is a full refund.
    const refunds = await stripe.refunds.list({ payment_intent: intent.id, limit: 100 });
    const prior = refunds.data.find(refund => refund.metadata?.operationKey === snapshot.operation.operationKey);
    if (prior?.status === "succeeded") { released = true; refundId = prior.id; }
    else if (!prior && snapshot.operation.status === "INDETERMINATE") {
      try {
        const refund = await stripe.refunds.create({ payment_intent: intent.id, metadata: { operationKey: snapshot.operation.operationKey } }, {
          idempotencyKey: `${snapshot.operation.operationKey}-refund`, maxNetworkRetries: 0,
        });
        refundId = refund.id;
        released = refund.status === "succeeded";
      } catch (error) {
        if (!stripeOutcomeIsIndeterminate(error)) {
          await db.update(depositSettlementOperations).set({ status: "FAILED", error: `definitive: ${safeOperationError(error)}` }).where(eq(depositSettlementOperations.id, operationId));
          await releaseDepositFenceIfOwned(snapshot.request.id, snapshot.fenceToken);
        }
        throw error;
      }
    }
  } else if (snapshot.request.depositMode === "authorization") {
    if (intent.status === "canceled") released = true;
    else if (intent.status === "requires_capture" && snapshot.operation.status === "INDETERMINATE") {
      try {
        await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `${snapshot.operation.operationKey}-cancel`, maxNetworkRetries: 0 } as any);
        released = true;
      } catch (error) {
        if (!stripeOutcomeIsIndeterminate(error)) {
          await db.update(depositSettlementOperations).set({ status: "FAILED", error: `definitive: ${safeOperationError(error)}` }).where(eq(depositSettlementOperations.id, operationId));
          await releaseDepositFenceIfOwned(snapshot.request.id, snapshot.fenceToken);
        }
        throw error;
      }
    }
  }
  if (!released) return { status: "manual_processing" as const };
  const finalized = await finalizeRejectedRelease({
    claim: snapshot.claim, request: snapshot.request, operationId, key: snapshot.operation.operationKey,
    fenceToken: snapshot.fenceToken, refundId, completedAt: new Date(), reconciled: true,
  });
  return { status: finalized ? "settled" as const : "manual_processing" as const };
}

async function releaseDepositFenceIfOwned(requestId: number, token: string) {
  await db.update(itemRequests).set({ depositRenewalStatus: null, depositOperationToken: null, depositOperationType: null })
    .where(and(eq(itemRequests.id, requestId), eq(itemRequests.depositOperationToken, token)));
}

/**
 * Final transition for a rejected claim. A deposit that was charged is
 * REFUNDED in full (phase "resolved"); a hold that was never charged is simply
 * released.
 */
async function finalizeRejectedRelease(args: {
  claim: typeof securityClaims.$inferSelect; request: typeof itemRequests.$inferSelect; operationId: number; key: string;
  fenceToken: string; refundId: string | null; completedAt: Date; reconciled: boolean;
}): Promise<boolean> {
  const { claim, request, operationId, key, fenceToken, refundId, completedAt, reconciled } = args;
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${request.id} FOR UPDATE`);
    await tx.execute(sql`SELECT 1 FROM ${securityClaims} WHERE ${securityClaims.id} = ${claim.id} FOR UPDATE`);
    const [owned] = await tx.select({ id: itemRequests.id }).from(itemRequests).where(and(eq(itemRequests.id, request.id), eq(itemRequests.depositOperationToken, fenceToken), eq(itemRequests.depositOperationType, "cancel"))).limit(1);
    if (!owned) {
      if (reconciled) return false;
      throw new Error("Deposit operation fence was superseded");
    }
    const [settledOperation] = await tx.update(depositSettlementOperations).set({ status: "SETTLED", stripeRefundId: refundId, completedAt, error: null }).where(and(
      eq(depositSettlementOperations.id, operationId),
      eq(depositSettlementOperations.operationKey, key),
      inArray(depositSettlementOperations.status, ["PROCESSING", "INDETERMINATE"]),
    )).returning({ id: depositSettlementOperations.id });
    if (!settledOperation) throw new Error(reconciled ? "Reconciled release ledger finalization was superseded" : "Release ledger finalization was superseded");
    await tx.update(securityClaims).set({ settlementStatus: "SETTLED", updatedAt: completedAt }).where(and(eq(securityClaims.id, claim.id), eq(securityClaims.status, "REJECTED")));
    const wasCharged = !!request.depositCapturedAt || request.depositMode === "refundable_charge";
    const amount = Number(request.depositCapturedAmount ?? request.trustDepositAmount ?? 0);
    await tx.update(itemRequests).set({
      depositStatus: wasCharged ? "settled" : "released", depositReleasedAt: completedAt,
      ...(wasCharged ? { depositRefundedAmount: amount.toFixed(2), depositRetainedAmount: "0.00" } : {}),
      depositRenewalStatus: null, depositOperationToken: null, depositOperationType: null,
    }).where(and(eq(itemRequests.id, request.id), eq(itemRequests.depositOperationToken, fenceToken)));
    if (wasCharged) {
      const amounts = { charged: amount, refunded: amount, retained: 0 };
      await tx.insert(notifications).values([
        { userId: claim.borrowerId, requestId: request.id, itemId: request.itemId, ...resolutionBorrower(amounts, request.depositCardLast4) },
        { userId: claim.ownerId, requestId: request.id, itemId: request.itemId, ...resolutionOwner(amounts) },
      ]);
      await insertClaimChatEvent(tx, claim, request.id, claimResolvedChat(amount, 0), {
        eventType: "claim_resolved", claimId: claim.id, chargedAmount: amount, refundedAmount: amount, retainedAmount: 0,
        cardLast4: request.depositCardLast4, depositMode: request.depositMode, outcome: "refunded_full",
      });
    } else {
      await tx.insert(notifications).values([
        { userId: claim.borrowerId, requestId: request.id, itemId: request.itemId, ...rejectedHoldReleasedBorrower(amount) },
        { userId: claim.ownerId, requestId: request.id, itemId: request.itemId, ...rejectedHoldReleasedOwner(amount) },
      ]);
      await insertClaimChatEvent(tx, claim, request.id, holdReleasedChat(amount), { eventType: "deposit_released", amount, depositMode: request.depositMode });
    }
    return true;
  });
}

/**
 * A rejected claim returns everything: a deposit already charged at claim open
 * is refunded in full; a hold that was never charged is released (canceled).
 */
export async function releaseRejectedClaim(claimId: number, stripe: ClaimStripeClient, now = new Date()) {
  const data = await db.transaction(async tx => {
    await tx.execute(sql`SELECT 1 FROM ${securityClaims} WHERE ${securityClaims.id} = ${claimId} FOR UPDATE`);
    const [claim] = await tx.select().from(securityClaims).where(eq(securityClaims.id, claimId)).limit(1);
    if (!claim || claim.status !== "REJECTED") throw new Error("Only a rejected claim can be released");
    await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${claim.requestId} FOR UPDATE`);
    const [request] = await tx.select().from(itemRequests).where(eq(itemRequests.id, claim.requestId)).limit(1);
    if (!request?.depositPaymentIntentId) throw new Error("No platform deposit is attached");
    const key = `rejected-claim-release-${claim.id}-${request.depositPaymentIntentId}`;
    const [existing] = await tx.select().from(depositSettlementOperations).where(eq(depositSettlementOperations.operationKey, key)).limit(1);
    if (existing?.status === "SETTLED") return { done: true, request, operation: existing, key, claim };
    const [operation] = existing ? [existing] : await tx.insert(depositSettlementOperations).values({
      claimId, requestId: request.id, operationKey: key, status: "PENDING", approvedAmount: "0",
      stripePaymentIntentId: request.depositPaymentIntentId, releasedAmount: request.trustDepositAmount || "0",
    }).returning();
    return { done: false, request, operation, key, claim };
  });
  if (data.done) return data;
  if (["INDETERMINATE", "PROCESSING"].includes(data.operation.status) && data.request.depositOperationType === "cancel") {
    return reconcileRejectedReleaseOperation(data.operation.id, stripe);
  }
  // An unresolved capture must be settled by its own ledger before we decide
  // between refunding and canceling.
  const [pendingCapture] = await db.select().from(depositSettlementOperations)
    .where(eq(depositSettlementOperations.operationKey, `claim-capture-${claimId}`)).limit(1);
  if (pendingCapture && ["INDETERMINATE", "PROCESSING"].includes(pendingCapture.status)) {
    const outcome = await reconcileClaimCaptureOperation(pendingCapture.id, stripe);
    if (outcome.status !== "captured") throw new Error(`A deposit charge is still being reconciled: ${outcome.reason}`);
  }
  const terminal = await claimDepositTerminalAction(data.request.id, "cancel", now);
  if (terminal.status !== "claimed") throw new Error(terminal.reason);
  let financialCallInvoked = false;
  try {
    await db.update(securityClaims).set({ settlementStatus: "PROCESSING", updatedAt: new Date() }).where(eq(securityClaims.id, claimId));
    const [startedOperation] = await db.update(depositSettlementOperations).set({ status: "PROCESSING", error: null }).where(and(
      eq(depositSettlementOperations.id, data.operation.id),
      eq(depositSettlementOperations.operationKey, data.key),
      inArray(depositSettlementOperations.status, ["PENDING", "INDETERMINATE", "PROCESSING"]),
    )).returning({ id: depositSettlementOperations.id });
    if (!startedOperation) throw new Error("Release ledger operation could not enter processing");
    // Re-read: the capture may have completed after the first snapshot.
    const [freshRequest] = await db.select().from(itemRequests).where(eq(itemRequests.id, data.request.id)).limit(1);
    const request = freshRequest || data.request;
    let refundId: string | null = null;
    if (!isSimulatedIntent(request.depositPaymentIntentId)) {
      const intent = await stripe.paymentIntents.retrieve(request.depositPaymentIntentId!);
      if (intent.status === "succeeded") {
        financialCallInvoked = true;
        const refund = await stripe.refunds.create({ payment_intent: intent.id, metadata: { operationKey: data.key } }, { idempotencyKey: `${data.key}-refund`, maxNetworkRetries: 0 });
        refundId = refund.id;
      } else if (request.depositMode === "refundable_charge") {
        if (intent.status !== "canceled") throw new Error(`Refundable deposit is not settled (${intent.status})`);
      } else if (intent.status !== "canceled") {
        if (intent.status !== "requires_capture") throw new Error(`Hold cannot be released (${intent.status})`);
        financialCallInvoked = true;
        await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `${data.key}-cancel`, maxNetworkRetries: 0 } as any);
      }
    }
    await finalizeRejectedRelease({
      claim: data.claim, request, operationId: data.operation.id, key: data.key,
      fenceToken: terminal.operationToken, refundId, completedAt: now, reconciled: false,
    });
    await event(data.request.id, "REJECTED_CLAIM_DEPOSIT_RELEASED", data.key, { claimId });
    return { done: true };
  } catch (error) {
    const uncertain = financialCallInvoked && stripeOutcomeIsIndeterminate(error);
    await db.update(depositSettlementOperations).set({
      status: uncertain ? "INDETERMINATE" : "FAILED",
      error: `${uncertain ? "indeterminate" : "definitive"}: ${safeOperationError(error)}`,
    }).where(eq(depositSettlementOperations.id, data.operation.id));
    if (!uncertain) {
      await db.update(securityClaims).set({ settlementStatus: "PENDING", updatedAt: new Date() }).where(eq(securityClaims.id, claimId));
    }
    throw error;
  } finally {
    const [operation] = await db.select({ status: depositSettlementOperations.status }).from(depositSettlementOperations).where(eq(depositSettlementOperations.id, data.operation.id)).limit(1);
    if (operation && !["SETTLED", "INDETERMINATE", "PROCESSING"].includes(operation.status)) await releaseDepositTerminalClaim(terminal);
  }
}
