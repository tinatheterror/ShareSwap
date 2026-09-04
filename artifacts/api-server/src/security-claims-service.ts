import Stripe from "stripe";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, depositSettlementOperations, itemRequests, notifications, requestLifecycleEvents, securityClaims } from "@workspace/db";
import { OVERDUE_POLICY } from "./overdue-policy";
import { claimDepositTerminalAction, getPaymentIntentCaptureBefore, releaseDepositTerminalClaim } from "./deposit-renewal-service";

export type ClaimStripeClient = Pick<Stripe, "paymentIntents" | "refunds">;

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

/** Locks the claim and request before any Stripe side effect. */
export async function settleApprovedClaim(
  claimId: number,
  stripe: ClaimStripeClient,
  _startedAt = new Date(),
  hooks: { beforeCaptureCheck?: () => Promise<void> } = {},
) {
  const [identity] = await db.select({ requestId: securityClaims.requestId, status: securityClaims.status, settlementStatus: securityClaims.settlementStatus })
    .from(securityClaims).where(eq(securityClaims.id, claimId)).limit(1);
  if (!identity) throw new Error("Claim not found");
  if (identity.settlementStatus === "SETTLED") return { done: true as const };
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
      if (!["authorized", "held", "disputed", "SECURED_REFUNDABLE", "secured_refundable"].includes(request.depositStatus || "") || !request.depositPaymentIntentId) throw new Error("Deposit is no longer secured");
      const startDeadline = request.settlementStartDeadlineAt ||
        (request.claimDecisionDeadlineAt ? new Date(request.claimDecisionDeadlineAt.getTime() - OVERDUE_POLICY.CAPTURE_OPERATION_SAFETY_BUFFER_MINUTES * 60_000) : null);
      if (request.depositMode === "authorization" && startDeadline && checkedAt >= startDeadline) {
        await tx.update(itemRequests).set({ depositRenewalStatus: null, depositOperationToken: null, depositOperationType: null }).where(and(eq(itemRequests.id, request.id), eq(itemRequests.depositOperationToken, terminal.operationToken)));
        await tx.update(securityClaims).set({ settlementStatus: "MANUAL_REVIEW", updatedAt: checkedAt }).where(and(eq(securityClaims.id, claim.id), inArray(securityClaims.status, ["APPROVED", "PROCESSING"])));
        return { expired: true as const };
      }
      const amount = Number(claim.approvedAmount || 0), deposit = Number(request.trustDepositAmount || 0);
      if (amount <= 0 || amount > deposit || !claim.reason || !Array.isArray(claim.evidence) || !claim.evidence.length || !claim.borrowerNotifiedAt) throw new Error("Approved claim does not meet settlement requirements");
      const key = `claim-settlement-${claim.id}-${amount.toFixed(2)}`;
      const [existing] = await tx.select().from(depositSettlementOperations).where(eq(depositSettlementOperations.operationKey, key)).limit(1);
      if (existing?.status === "SETTLED") return { done: true as const, claim, request, amount, deposit, key, operation: existing };
      const [op] = existing ? [existing] : await tx.insert(depositSettlementOperations).values({ claimId, requestId: request.id, operationKey: key, approvedAmount: amount.toFixed(2), stripePaymentIntentId: request.depositPaymentIntentId }).returning();
      if (existing && !["INDETERMINATE", "PROCESSING"].includes(existing.status)) await tx.update(depositSettlementOperations).set({ status: "PENDING", error: null }).where(eq(depositSettlementOperations.id, existing.id));
      await tx.update(securityClaims).set({ status: "PROCESSING", settlementStatus: "PROCESSING", updatedAt: checkedAt }).where(and(eq(securityClaims.id, claim.id), inArray(securityClaims.status, ["APPROVED", "PROCESSING"])));
      return { done: false as const, claim, request, amount, deposit, key, operation: op };
    });
    if ("expired" in preflight) throw new Error("Settlement start deadline elapsed; zero capture attempted");
    operation = preflight.operation;
    if (preflight.done) return preflight;
    const { claim, request, amount, deposit, key } = preflight;
    const [startedOperation] = await db.update(depositSettlementOperations).set({ status: "PROCESSING", error: null }).where(and(
      eq(depositSettlementOperations.id, operation.id),
      eq(depositSettlementOperations.operationKey, key),
      inArray(depositSettlementOperations.status, ["PENDING", "INDETERMINATE", "PROCESSING"]),
    )).returning({ id: depositSettlementOperations.id });
    if (!startedOperation) throw new Error("Settlement ledger operation could not enter processing");
    const intent = await stripe.paymentIntents.retrieve(request.depositPaymentIntentId!, { expand: ["latest_charge"] } as any);
    if (request.depositMode === "authorization" && intent.status === "succeeded") {
      // A previous response may have been lost after Stripe captured. The
      // durable reconciler finalizes under this exact fence without recapture.
      return await reconcileSettlementOperation(operation.id, stripe);
    }
    let refundId: string | null = null;
    let captureId: string | null = null;
    if (request.depositMode === "authorization") {
      if (intent.status !== "requires_capture") throw new Error(`Authorization is not capturable (${intent.status})`);
      const captureBefore = getPaymentIntentCaptureBefore(intent);
      if (!captureBefore || captureBefore <= new Date()) {
        await db.transaction(async tx => {
          await tx.update(itemRequests).set({ depositStatus: "EXPIRED_UNSECURED", depositRenewalStatus: null, depositOperationToken: null, depositOperationType: null })
            .where(and(eq(itemRequests.id, request.id), eq(itemRequests.depositOperationToken, terminal.operationToken)));
          await tx.update(securityClaims).set({ settlementStatus: "MANUAL_REVIEW", updatedAt: new Date() })
            .where(and(eq(securityClaims.id, claim.id), eq(securityClaims.status, "PROCESSING")));
        });
        throw new Error("Stripe authorization is expired; manual claim payment review required");
      }
      if (hooks.beforeCaptureCheck) await hooks.beforeCaptureCheck();
      // Last DB check is deliberately after live Stripe retrieval and directly
      // before capture. Reconciliation skips our live fence, so this owns the
      // cutoff decision.
      const mayCapture = await db.transaction(async tx => {
        await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${request.id} FOR UPDATE`);
        const [current] = await tx.select().from(itemRequests).where(eq(itemRequests.id, request.id)).limit(1);
        const checkedAt = new Date();
        if (!current || current.depositOperationToken !== terminal.operationToken || current.depositOperationType !== "capture") return false;
        const startDeadline = current.settlementStartDeadlineAt ||
          (current.claimDecisionDeadlineAt ? new Date(current.claimDecisionDeadlineAt.getTime() - OVERDUE_POLICY.CAPTURE_OPERATION_SAFETY_BUFFER_MINUTES * 60_000) : null);
        if (current.depositMode === "authorization" && startDeadline && checkedAt >= startDeadline) {
          await tx.update(itemRequests).set({ depositRenewalStatus: null, depositOperationToken: null, depositOperationType: null }).where(and(eq(itemRequests.id, request.id), eq(itemRequests.depositOperationToken, terminal.operationToken)));
          await tx.update(securityClaims).set({ settlementStatus: "MANUAL_REVIEW", updatedAt: checkedAt }).where(and(eq(securityClaims.id, claim.id), eq(securityClaims.status, "PROCESSING")));
          return false;
        }
        return true;
      });
      if (!mayCapture) throw new Error("Settlement start deadline elapsed; zero capture attempted");
      financialCallInvoked = true;
      const captured = await stripe.paymentIntents.capture(intent.id, { amount_to_capture: Math.round(amount * 100) }, { idempotencyKey: `${key}-capture`, maxNetworkRetries: 0 });
      captureId = typeof captured.latest_charge === "string" ? captured.latest_charge : captured.latest_charge?.id || null;
    } else if (request.depositMode === "refundable_charge") {
      if (intent.status !== "succeeded") throw new Error(`Refundable deposit is not captured (${intent.status})`);
      if (deposit > amount) {
        financialCallInvoked = true;
        const refund = await stripe.refunds.create({ payment_intent: intent.id, amount: Math.round((deposit - amount) * 100) }, { idempotencyKey: `${key}-refund`, maxNetworkRetries: 0 });
        refundId = refund.id;
      }
    } else throw new Error("Unsupported deposit mechanism; manual review required");
    await db.transaction(async tx => {
      const completedAt = new Date();
      await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${request.id} FOR UPDATE`);
      await tx.execute(sql`SELECT 1 FROM ${securityClaims} WHERE ${securityClaims.id} = ${claim.id} FOR UPDATE`);
      const [owned] = await tx.select({ id: itemRequests.id }).from(itemRequests).where(and(eq(itemRequests.id, request.id), eq(itemRequests.depositOperationToken, terminal.operationToken), eq(itemRequests.depositOperationType, "capture"))).limit(1);
      if (!owned) throw new Error("Deposit operation fence was superseded");
      const [eligible] = await tx.select({ id: securityClaims.id }).from(securityClaims).where(and(eq(securityClaims.id, claim.id), eq(securityClaims.status, "PROCESSING"), ne(securityClaims.settlementStatus, "MANUAL_REVIEW"))).limit(1);
      if (!eligible) throw new Error("Claim became ineligible during settlement");
      const [settledOperation] = await tx.update(depositSettlementOperations).set({ status: "SETTLED", retainedAmount: amount.toFixed(2), releasedAmount: (deposit - amount).toFixed(2), stripeCaptureId: captureId, stripeRefundId: refundId, completedAt }).where(and(
        eq(depositSettlementOperations.id, operation!.id),
        eq(depositSettlementOperations.operationKey, key),
        eq(depositSettlementOperations.status, "PROCESSING"),
      )).returning({ id: depositSettlementOperations.id });
      if (!settledOperation) throw new Error("Settlement ledger finalization was superseded");
      await tx.update(securityClaims).set({ status: "SETTLED", settlementStatus: "SETTLED", updatedAt: completedAt }).where(and(eq(securityClaims.id, claim.id), eq(securityClaims.status, "PROCESSING")));
      await tx.update(itemRequests).set({ depositStatus: "settled", depositReleasedAt: completedAt, depositRenewalStatus: null, depositOperationToken: null, depositOperationType: null }).where(and(eq(itemRequests.id, request.id), eq(itemRequests.depositOperationToken, terminal.operationToken)));
      await tx.insert(notifications).values([
        { userId: claim.ownerId, type: "security_claim_settled", title: "Claim settled", message: `An approved ${amount.toFixed(2)} claim was settled.`, requestId: request.id },
        { userId: claim.borrowerId, type: "security_claim_settled", title: "Claim settled", message: `A security claim was settled for ${amount.toFixed(2)}.`, requestId: request.id },
      ]);
    });
    await event(request.id, "DEPOSIT_SETTLED", key, { claimId, retainedAmount: amount, releasedAmount: deposit - amount });
    return { done: true, retainedAmount: amount, releasedAmount: deposit - amount };
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

/** Called by the durable reminder sweep. It never calls Stripe or renews/captures. */
export async function reconcileClaimDeadlines(now = new Date()) {
  const rows = await db.select({ id: itemRequests.id, expires: itemRequests.depositAuthorizationExpiresAt, depositStatus: itemRequests.depositStatus, requesterId: itemRequests.requesterId })
    .from(itemRequests).where(eq(itemRequests.depositMode, "authorization"));
  let expired = 0;
  for (const row of rows) {
    if (row.expires) await markClaimDecisionDeadline(row.id, row.expires);
    const changed = await db.transaction(async tx => {
      await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${row.id} FOR UPDATE`);
      const [current] = await tx.select().from(itemRequests).where(eq(itemRequests.id, row.id)).limit(1);
      if (!current?.claimDecisionDeadlineAt || current.claimDecisionDeadlineAt > now || current.depositStatus === "EXPIRED_UNSECURED") return false;
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
          title: "Payment reconciliation in progress", message: "A deposit operation needs reconciliation; no second payment action has been started.",
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
          .where(and(eq(securityClaims.requestId, row.id), inArray(securityClaims.status, ["OPEN", "CUSTOMER_RESPONSE_PENDING", "UNDER_REVIEW", "APPROVED", "PROCESSING"])));
        const activeClaims = await tx.select({ ownerId: securityClaims.ownerId, borrowerId: securityClaims.borrowerId }).from(securityClaims)
          .where(and(eq(securityClaims.requestId, row.id), inArray(securityClaims.status, ["OPEN", "CUSTOMER_RESPONSE_PENDING", "UNDER_REVIEW", "APPROVED", "PROCESSING"])));
        const recipients = activeClaims.length ? [...new Set(activeClaims.flatMap(c => [c.ownerId, c.borrowerId]))] : [row.requesterId];
        await tx.insert(notifications).values(recipients.map(userId => ({
          userId, type: "deposit_unsecured", title: "Deposit protection decision deadline passed",
          message: "The authorization is now unsecured and was not renewed or charged. Any claim requires manual review.", requestId: row.id,
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
  const [kind] = await db.select({ operationType: itemRequests.depositOperationType }).from(depositSettlementOperations)
    .innerJoin(itemRequests, eq(itemRequests.id, depositSettlementOperations.requestId))
    .where(eq(depositSettlementOperations.id, operationId)).limit(1);
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
  const intent = await stripe.paymentIntents.retrieve(snapshot.request.depositPaymentIntentId!, { expand: ["latest_charge"] } as any);
  const approved = Number(snapshot.operation.approvedAmount);
  const deposit = Number(snapshot.request.trustDepositAmount || 0);
  let captureId: string | null = null;
  let refundId: string | null = snapshot.operation.stripeRefundId;
  const recordDefinitiveRetryFailure = async (error: unknown) => {
    await db.transaction(async tx => {
      await tx.update(depositSettlementOperations).set({ status: "FAILED", error: `definitive: ${safeOperationError(error)}` }).where(eq(depositSettlementOperations.id, operationId));
      await tx.update(securityClaims).set({ status: "APPROVED", settlementStatus: "PENDING", updatedAt: new Date() }).where(and(eq(securityClaims.id, snapshot.claim.id), eq(securityClaims.status, "PROCESSING")));
      await tx.update(itemRequests).set({ depositRenewalStatus: null, depositOperationToken: null, depositOperationType: null }).where(and(eq(itemRequests.id, snapshot.request.id), eq(itemRequests.depositOperationToken, snapshot.fenceToken)));
    });
  };

  if (snapshot.request.depositMode === "authorization") {
    if (intent.status === "requires_capture") {
      if (snapshot.operation.status !== "INDETERMINATE") {
        return { status: "manual_processing" as const };
      }
      const cutoff = snapshot.request.settlementStartDeadlineAt;
      if (!cutoff || new Date() >= cutoff) {
        await db.update(securityClaims).set({ settlementStatus: "MANUAL_REVIEW", updatedAt: new Date() })
          .where(and(eq(securityClaims.id, snapshot.claim.id), eq(securityClaims.status, "PROCESSING")));
        return { status: "manual_processing" as const };
      }
      if (hooks.beforeFinancialRetry) await hooks.beforeFinancialRetry();
      if (new Date() >= cutoff) return { status: "manual_processing" as const };
      let captured: any;
      try {
        captured = await stripe.paymentIntents.capture(intent.id, { amount_to_capture: Math.round(approved * 100) }, {
          idempotencyKey: `${snapshot.operation.operationKey}-capture`, maxNetworkRetries: 0,
        });
      } catch (error) {
        if (!stripeOutcomeIsIndeterminate(error)) await recordDefinitiveRetryFailure(error);
        throw error;
      }
      captureId = typeof captured.latest_charge === "string" ? captured.latest_charge : captured.latest_charge?.id || null;
    } else if (intent.status === "succeeded") {
      captureId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id || null;
    } else if (intent.status === "canceled") {
      await db.transaction(async tx => {
        await tx.update(depositSettlementOperations).set({ status: "FAILED", error: "definitive: authorization is canceled" })
          .where(eq(depositSettlementOperations.id, operationId));
        await tx.update(securityClaims).set({ status: "APPROVED", settlementStatus: "PENDING", updatedAt: new Date() })
          .where(and(eq(securityClaims.id, snapshot.claim.id), eq(securityClaims.status, "PROCESSING")));
        await tx.update(itemRequests).set({ depositRenewalStatus: null, depositOperationToken: null, depositOperationType: null })
          .where(and(eq(itemRequests.id, snapshot.request.id), eq(itemRequests.depositOperationToken, snapshot.fenceToken)));
      });
      return { status: "failed" as const };
    } else {
      return { status: "manual_processing" as const };
    }
  } else if (snapshot.request.depositMode === "refundable_charge") {
    if (intent.status !== "succeeded") return { status: "manual_processing" as const };
    if (deposit > approved) {
      if (snapshot.operation.status !== "INDETERMINATE") return { status: "manual_processing" as const };
      let refund: any;
      try {
        refund = await stripe.refunds.create({ payment_intent: intent.id, amount: Math.round((deposit - approved) * 100) }, {
          idempotencyKey: `${snapshot.operation.operationKey}-refund`, maxNetworkRetries: 0,
        });
      } catch (error) {
        if (!stripeOutcomeIsIndeterminate(error)) await recordDefinitiveRetryFailure(error);
        throw error;
      }
      refundId = refund.id;
    }
  } else return { status: "manual_processing" as const };

  const finalized = await db.transaction(async tx => {
    await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${snapshot.request.id} FOR UPDATE`);
    await tx.execute(sql`SELECT 1 FROM ${securityClaims} WHERE ${securityClaims.id} = ${snapshot.claim.id} FOR UPDATE`);
    const [owned] = await tx.select({ id: itemRequests.id }).from(itemRequests).where(and(
      eq(itemRequests.id, snapshot.request.id), eq(itemRequests.depositOperationToken, snapshot.fenceToken),
      eq(itemRequests.depositOperationType, "capture"),
    )).limit(1);
    const [processing] = await tx.select({ id: securityClaims.id }).from(securityClaims).where(and(
      eq(securityClaims.id, snapshot.claim.id), eq(securityClaims.status, "PROCESSING"),
      ne(securityClaims.settlementStatus, "MANUAL_REVIEW"),
    )).limit(1);
    if (!owned || !processing) return false;
    const completedAt = new Date();
    const [settledOperation] = await tx.update(depositSettlementOperations).set({
      status: "SETTLED", retainedAmount: approved.toFixed(2), releasedAmount: (deposit - approved).toFixed(2),
      stripeCaptureId: captureId, stripeRefundId: refundId, completedAt, error: null,
    }).where(and(
      eq(depositSettlementOperations.id, operationId),
      eq(depositSettlementOperations.operationKey, snapshot.operation.operationKey),
      inArray(depositSettlementOperations.status, ["PROCESSING", "INDETERMINATE"]),
    )).returning({ id: depositSettlementOperations.id });
    if (!settledOperation) throw new Error("Reconciled settlement ledger finalization was superseded");
    await tx.update(securityClaims).set({ status: "SETTLED", settlementStatus: "SETTLED", updatedAt: completedAt })
      .where(and(eq(securityClaims.id, snapshot.claim.id), eq(securityClaims.status, "PROCESSING")));
    await tx.update(itemRequests).set({ depositStatus: "settled", depositReleasedAt: completedAt, depositRenewalStatus: null, depositOperationToken: null, depositOperationType: null })
      .where(and(eq(itemRequests.id, snapshot.request.id), eq(itemRequests.depositOperationToken, snapshot.fenceToken)));
    await tx.insert(notifications).values([
      { userId: snapshot.claim.ownerId, type: "security_claim_settled", title: "Claim settled", message: "The pending settlement was reconciled.", requestId: snapshot.request.id },
      { userId: snapshot.claim.borrowerId, type: "security_claim_settled", title: "Claim settled", message: "The pending settlement was reconciled.", requestId: snapshot.request.id },
    ]);
    return true;
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
  const intent = await stripe.paymentIntents.retrieve(snapshot.request.depositPaymentIntentId!);
  let released = false;
  let refundId = snapshot.operation.stripeRefundId;
  if (snapshot.request.depositMode === "authorization") {
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
  } else if (snapshot.request.depositMode === "refundable_charge" && intent.status === "succeeded") {
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
  }
  if (!released) return { status: "manual_processing" as const };
  const finalized = await db.transaction(async tx => {
    await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${snapshot.request.id} FOR UPDATE`);
    await tx.execute(sql`SELECT 1 FROM ${securityClaims} WHERE ${securityClaims.id} = ${snapshot.claim.id} FOR UPDATE`);
    const [owned] = await tx.select({ id: itemRequests.id }).from(itemRequests).where(and(eq(itemRequests.id, snapshot.request.id), eq(itemRequests.depositOperationToken, snapshot.fenceToken), eq(itemRequests.depositOperationType, "cancel"))).limit(1);
    if (!owned) return false;
    const completedAt = new Date();
    const [settledOperation] = await tx.update(depositSettlementOperations).set({ status: "SETTLED", stripeRefundId: refundId, completedAt, error: null }).where(and(
      eq(depositSettlementOperations.id, operationId),
      eq(depositSettlementOperations.operationKey, snapshot.operation.operationKey),
      inArray(depositSettlementOperations.status, ["PROCESSING", "INDETERMINATE"]),
    )).returning({ id: depositSettlementOperations.id });
    if (!settledOperation) throw new Error("Reconciled release ledger finalization was superseded");
    await tx.update(securityClaims).set({ settlementStatus: "SETTLED", updatedAt: completedAt }).where(and(eq(securityClaims.id, snapshot.claim.id), eq(securityClaims.status, "REJECTED")));
    await tx.update(itemRequests).set({ depositStatus: "released", depositReleasedAt: completedAt, depositRenewalStatus: null, depositOperationToken: null, depositOperationType: null }).where(and(eq(itemRequests.id, snapshot.request.id), eq(itemRequests.depositOperationToken, snapshot.fenceToken)));
    await tx.insert(notifications).values([
      { userId: snapshot.claim.ownerId, type: "security_claim_rejected", title: "Claim rejected", message: "The deposit release/refund was reconciled.", requestId: snapshot.request.id },
      { userId: snapshot.claim.borrowerId, type: "security_claim_rejected", title: "Claim rejected", message: "Your deposit release/refund was reconciled.", requestId: snapshot.request.id },
    ]);
    return true;
  });
  return { status: finalized ? "settled" as const : "manual_processing" as const };
}

async function releaseDepositFenceIfOwned(requestId: number, token: string) {
  await db.update(itemRequests).set({ depositRenewalStatus: null, depositOperationToken: null, depositOperationType: null })
    .where(and(eq(itemRequests.id, requestId), eq(itemRequests.depositOperationToken, token)));
}

/** A rejected claim always releases the entire still-secured deposit. */
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
    if (existing?.status === "SETTLED") return { done: true, request, operation: existing, key };
    const [operation] = existing ? [existing] : await tx.insert(depositSettlementOperations).values({
      claimId, requestId: request.id, operationKey: key, status: "PENDING", approvedAmount: "0",
      stripePaymentIntentId: request.depositPaymentIntentId, releasedAmount: request.trustDepositAmount || "0",
    }).returning();
    return { done: false, request, operation, key };
  });
  if (data.done) return data;
  if (["INDETERMINATE", "PROCESSING"].includes(data.operation.status) && data.request.depositOperationType === "cancel") {
    return reconcileRejectedReleaseOperation(data.operation.id, stripe);
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
    const intent = await stripe.paymentIntents.retrieve(data.request.depositPaymentIntentId!);
    let refundId: string | null = null;
    if (data.request.depositMode === "refundable_charge") {
      if (intent.status === "succeeded") {
        financialCallInvoked = true;
        const refund = await stripe.refunds.create({ payment_intent: intent.id, metadata: { operationKey: data.key } }, { idempotencyKey: `${data.key}-refund`, maxNetworkRetries: 0 });
        refundId = refund.id;
      } else if (intent.status !== "canceled") throw new Error(`Refundable deposit is not settled (${intent.status})`);
    } else if (intent.status !== "canceled") {
      if (intent.status !== "requires_capture") throw new Error(`Authorization cannot be released (${intent.status})`);
      financialCallInvoked = true;
      await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `${data.key}-cancel`, maxNetworkRetries: 0 } as any);
    }
    await db.transaction(async tx => {
      // Fence must still be ours before final state changes.
      await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${data.request.id} FOR UPDATE`);
      await tx.execute(sql`SELECT 1 FROM ${securityClaims} WHERE ${securityClaims.id} = ${claimId} FOR UPDATE`);
      const [owned] = await tx.select({ id: itemRequests.id }).from(itemRequests).where(and(eq(itemRequests.id, data.request.id), eq(itemRequests.depositOperationToken, terminal.operationToken), eq(itemRequests.depositOperationType, "cancel"))).limit(1);
      if (!owned) throw new Error("Deposit operation fence was superseded");
    const [settledOperation] = await tx.update(depositSettlementOperations).set({ status: "SETTLED", stripeRefundId: refundId, completedAt: now })
      .where(and(
        eq(depositSettlementOperations.id, data.operation.id),
        eq(depositSettlementOperations.operationKey, data.key),
        eq(depositSettlementOperations.status, "PROCESSING"),
      )).returning({ id: depositSettlementOperations.id });
    if (!settledOperation) throw new Error("Release ledger finalization was superseded");
    await tx.update(securityClaims).set({ settlementStatus: "SETTLED", updatedAt: now }).where(eq(securityClaims.id, claimId));
    await tx.update(itemRequests).set({
      depositStatus: "released", depositReleasedAt: now, depositRenewalStatus: null,
      depositOperationToken: null, depositOperationType: null,
    }).where(and(eq(itemRequests.id, data.request.id), eq(itemRequests.depositOperationToken, terminal.operationToken)));
    const [claim] = await tx.select({ ownerId: securityClaims.ownerId, borrowerId: securityClaims.borrowerId }).from(securityClaims).where(eq(securityClaims.id, claimId)).limit(1);
    if (claim) await tx.insert(notifications).values([
      { userId: claim.ownerId, type: "security_claim_rejected", title: "Claim rejected", message: "The deposit was released/refunded in full.", requestId: data.request.id },
      { userId: claim.borrowerId, type: "security_claim_rejected", title: "Claim rejected", message: "Your deposit was released/refunded in full.", requestId: data.request.id },
    ]);
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