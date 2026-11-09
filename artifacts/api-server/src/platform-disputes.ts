import { and, desc, eq, gt, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import {
  accountReviewFlags, db, itemRequests, items, notifications, PLATFORM_CURRENCY, platformDisputes, rentalPayouts, requestLifecycleEvents, securityClaims, users, type PlatformDispute,
} from "@workspace/db";
import { TERMINAL_REQUEST_STATUSES } from "./account-deletion/retention";
import { sendPushToUsers } from "./push-notifications";

/**
 * Every Stripe dispute, recorded on the platform side (launch policy, see chargeback-policy.ts): ShareSwap absorbs the amount and
 * Stripe's dispute fee, so they are kept here as the platform's loss and never touch a member's wallet.
 *
 * A dispute is recorded the first time ANY of its events is seen (Stripe does not promise the order), and the first sighting does the
 * follow-up exactly once: an in-app notice to every admin, the borrower's account flagged for review, and a request to the owner
 * for evidence. A dispute stays "pending_admin" until an admin reviews it, and while it does the rental's deposit hold is not
 * released (claimDepositTerminalAction and the return release both ask holdForDisputeReview).
 */
export const DISPUTE_REVIEW_PENDING = "pending_admin";
export const DISPUTE_REVIEWED = "reviewed";
export const ADMIN_DISPUTE_NOTIFICATION_TYPE = "admin_dispute_review";
export const OWNER_EVIDENCE_NOTIFICATION_TYPE = "dispute_evidence_requested";

export interface DisputeContext {
  requestId: number | null;
  ownerId: number | null;
  borrowerId: number | null;
  rentalOpen: boolean;
  itemName: string | null;
}

/** Who and what a disputed payment was for: the rental payment or the deposit charge of a request, or its platform fee. */
export async function findDisputeContext(paymentIntentId: string | null, chargeId: string | null = null): Promise<DisputeContext> {
  const none: DisputeContext = { requestId: null, ownerId: null, borrowerId: null, rentalOpen: false, itemName: null };
  let requestId: number | null = null;
  if (paymentIntentId) {
    const [payout] = await db.select({ requestId: rentalPayouts.requestId }).from(rentalPayouts)
      .where(eq(rentalPayouts.stripePaymentIntentId, paymentIntentId)).orderBy(desc(rentalPayouts.id)).limit(1);
    requestId = payout?.requestId ?? null;
  }
  if (!requestId && (paymentIntentId || chargeId)) {
    const [request] = await db.select({ id: itemRequests.id }).from(itemRequests)
      .where(or(
        paymentIntentId ? eq(itemRequests.depositPaymentIntentId, paymentIntentId) : sql`false`,
        chargeId ? eq(itemRequests.platformFeeChargeId, chargeId) : sql`false`,
      )).limit(1);
    requestId = request?.id ?? null;
  }
  if (!requestId) return none;
  const [row] = await db.select({ status: itemRequests.status, borrowerId: itemRequests.requesterId, ownerId: items.ownerId, itemName: items.name })
    .from(itemRequests).innerJoin(items, eq(items.id, itemRequests.itemId)).where(eq(itemRequests.id, requestId)).limit(1);
  if (!row) return none;
  return {
    requestId, ownerId: row.ownerId ?? null, borrowerId: row.borrowerId ?? null, itemName: row.itemName ?? null,
    rentalOpen: !(TERMINAL_REQUEST_STATUSES as readonly string[]).includes(row.status),
  };
}

export interface DisputeLoss { lossAmountCents: number; lossFeeCents: number }

/**
 * What the platform is out of pocket on a dispute. While it is undecided and when it is lost, the whole amount Stripe withdrew and
 * the fee. When it is won, only what Stripe did not give back: the amount comes back first, and the fee only if Stripe returned more
 * than the amount (it usually does not).
 */
export function disputeLoss(input: { outcome: string; amountCents: number; feeCents: number; returnedCents: number }): DisputeLoss {
  const amount = Math.max(0, input.amountCents);
  const fee = Math.max(0, input.feeCents);
  if (input.outcome !== "won") return { lossAmountCents: amount, lossFeeCents: fee };
  const returned = Math.max(0, input.returnedCents);
  return { lossAmountCents: amount - Math.min(amount, returned), lossFeeCents: fee - Math.min(fee, Math.max(0, returned - amount)) };
}

const dollars = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
const idOf = (value: unknown): string | null => (typeof value === "string" ? value : (value as { id?: string } | null)?.id ?? null);

export async function adminUserIds(executor: Pick<typeof db, "select"> = db): Promise<number[]> {
  const rows = await executor.select({ id: users.id }).from(users)
    .where(and(eq(users.isAdmin, true), sql`COALESCE(${users.accountStatus}, 'active') NOT IN ('banned', 'deleted')`));
  return rows.map((r) => r.id);
}

/**
 * Records the dispute from a Stripe dispute object (any event type). Returns the row and whether this call created it; only the
 * creating call sends the follow-up, in the same transaction as the row, so a retry after a crash does it once and never half.
 */
export async function recordPlatformDispute(dispute: any): Promise<{ row: PlatformDispute; created: boolean }> {
  const disputeId = String(dispute?.id ?? "");
  if (!disputeId) throw new Error("recordPlatformDispute: the dispute has no id");
  const paymentIntentId = idOf(dispute.payment_intent);
  const context = await findDisputeContext(paymentIntentId, idOf(dispute.charge));
  const amountCents = Math.max(0, Math.round(Number(dispute.amount) || 0));
  const currency = String(dispute.currency ?? "").toLowerCase() || PLATFORM_CURRENCY;
  const reason = typeof dispute.reason === "string" && dispute.reason ? dispute.reason : null;
  const dueBy = Number(dispute.evidence_details?.due_by) > 0 ? new Date(Number(dispute.evidence_details.due_by) * 1000) : null;

  const pushes: Array<{ userIds: number[]; title: string; body: string; data: Record<string, unknown>; category?: "payments" }> = [];
  const result = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(platformDisputes).values({
      disputeId, paymentIntentId, requestId: context.requestId, ownerId: context.ownerId, borrowerId: context.borrowerId, reason,
      amountCents, currency, lossAmountCents: amountCents, rentalWasOpen: context.rentalOpen, evidenceDueBy: dueBy,
      evidenceRequestedAt: context.ownerId && context.ownerId !== context.borrowerId ? new Date() : null,
    }).onConflictDoNothing({ target: platformDisputes.disputeId }).returning();
    if (!inserted) {
      const [existing] = await tx.select().from(platformDisputes).where(eq(platformDisputes.disputeId, disputeId));
      return { row: existing, created: false };
    }

    const what = context.itemName ? `"${context.itemName}"` : "a payment";
    const adminIds = await adminUserIds(tx);
    if (adminIds.length) {
      const message = `Dispute ${disputeId} (${reason ?? "no reason given"}): ${dollars(amountCents, currency)} on ${what}${context.requestId ? `, request #${context.requestId}` : ", not matched to a request"}. `
        + (context.rentalOpen ? "The rental is still open: its deposit hold stays in place until you review the case. " : "")
        + "ShareSwap absorbs the loss; no member is charged. "
        + (context.ownerId ? "The owner has been asked for evidence. " : "")
        + `The evidence bundle is at /api/admin/chargebacks/${disputeId}/evidence${dueBy ? `; Stripe needs it by ${dueBy.toISOString().slice(0, 10)}` : ""}.`;
      await tx.insert(notifications).values(adminIds.map((userId) => ({
        userId, type: ADMIN_DISPUTE_NOTIFICATION_TYPE, title: "A payment was disputed: review needed", message, requestId: context.requestId, isRead: false,
      })));
      pushes.push({ userIds: adminIds, title: "A payment was disputed", body: `${dollars(amountCents, currency)} on ${what}: review needed`, data: { type: ADMIN_DISPUTE_NOTIFICATION_TYPE, disputeId, requestId: context.requestId } });
    }

    if (context.borrowerId) {
      await tx.insert(accountReviewFlags).values({
        userId: context.borrowerId, source: "dispute", disputeId, requestId: context.requestId,
        reason: `Stripe dispute ${disputeId}${reason ? ` (${reason})` : ""}${context.requestId ? ` on request #${context.requestId}` : ""}`,
      }).onConflictDoNothing();
    }

    if (context.ownerId && context.ownerId !== context.borrowerId) {
      await tx.insert(notifications).values({
        userId: context.ownerId, type: OWNER_EVIDENCE_NOTIFICATION_TYPE, title: "Please send us your evidence", requestId: context.requestId, isRead: false,
        message: `The card issuer of the person who paid for ${what} disputed the payment. You will not be charged; ShareSwap handles it with the payment processor. `
          + "To help us answer it, send what you have: your handoff confirmation, photos of the item, and any messages about the rental"
          + `${dueBy ? ` (we need it by ${dueBy.toISOString().slice(0, 10)})` : ""}.`,
      });
      pushes.push({ userIds: [context.ownerId], title: "Please send us your evidence", body: `A payment for ${what} was disputed. You will not be charged; we need your evidence.`, data: { type: OWNER_EVIDENCE_NOTIFICATION_TYPE, disputeId, requestId: context.requestId }, category: "payments" });
    }
    return { row: inserted, created: true };
  });

  // Pushes are best-effort and only after the rows are committed; the in-app notices above are what counts.
  for (const push of pushes) await sendPushToUsers(push.userIds, { title: push.title, body: push.body, data: push.data }, push.category);
  return result;
}

/** The fee Stripe charged for the dispute: the platform's loss, never a member's. Safe to repeat. */
export async function applyPlatformDisputeFee(dispute: any, feeCents: number): Promise<"recorded" | "unchanged"> {
  const { row } = await recordPlatformDispute(dispute);
  if (feeCents <= 0 || row.feeCents === feeCents) return "unchanged";
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(platformDisputes).where(eq(platformDisputes.id, row.id)).for("update");
    const loss = disputeLoss({ outcome: locked.outcome, amountCents: locked.amountCents, feeCents, returnedCents: locked.returnedCents });
    await tx.update(platformDisputes).set({ feeCents, ...loss }).where(eq(platformDisputes.id, row.id));
  });
  return "recorded";
}

/** The dispute was decided. Won: the platform is out only what Stripe did not return. Lost: all of it. Safe to repeat. */
export async function closePlatformDispute(
  dispute: any, outcome: "won" | "lost", stripeReturn: { returnedCents: number; disputeAmountCents: number },
): Promise<"won" | "lost" | "duplicate"> {
  const { row } = await recordPlatformDispute(dispute);
  const adminIds: number[] = [];
  const closedNow = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(platformDisputes).where(eq(platformDisputes.id, row.id)).for("update");
    if (locked.outcome !== "open") return false;
    const returnedCents = outcome === "won" ? Math.max(0, stripeReturn.returnedCents) : 0;
    const amountCents = stripeReturn.disputeAmountCents > 0 ? stripeReturn.disputeAmountCents : locked.amountCents;
    const loss = disputeLoss({ outcome, amountCents, feeCents: locked.feeCents, returnedCents });
    await tx.update(platformDisputes).set({ outcome, returnedCents, ...loss, closedAt: new Date() }).where(eq(platformDisputes.id, row.id));
    const admins = await adminUserIds(tx);
    adminIds.push(...admins);
    if (admins.length) {
      await tx.insert(notifications).values(admins.map((userId) => ({
        userId, type: ADMIN_DISPUTE_NOTIFICATION_TYPE, title: `Dispute ${outcome === "won" ? "won" : "lost"}`, requestId: locked.requestId, isRead: false,
        message: `Dispute ${locked.disputeId} was ${outcome}. Platform loss: ${dollars(loss.lossAmountCents, locked.currency)} plus ${dollars(loss.lossFeeCents, locked.currency)} in Stripe's fee.`
          + `${locked.reviewStatus === DISPUTE_REVIEW_PENDING ? " It has not been reviewed yet, so the rental's deposit hold is still in place." : ""}`,
      })));
    }
    return true;
  });
  return closedNow ? outcome : "duplicate";
}

/**
 * True while a dispute on this rental has not been reviewed by an admin: the borrower filed a dispute, so their deposit hold must
 * stay exactly as it is until a person has looked. Used by every path that would release the hold.
 */
export async function holdForDisputeReview(requestId: number, executor: Pick<typeof db, "select"> = db): Promise<boolean> {
  const rows = await executor.select({ id: platformDisputes.id }).from(platformDisputes)
    .innerJoin(itemRequests, eq(itemRequests.id, platformDisputes.requestId))
    .where(and(
      eq(platformDisputes.requestId, requestId), eq(platformDisputes.reviewStatus, DISPUTE_REVIEW_PENDING),
      // Once the authorization has run out there is no live hold left to protect, so the guard has nothing to guard (see noteDepositUncollectible).
      sql`COALESCE(${itemRequests.depositStatus}, '') <> 'EXPIRED_UNSECURED'`,
    )).limit(1);
  return rows.length > 0;
}
export const DISPUTE_HOLD_MESSAGE = "A payment dispute on this rental is waiting for an admin to review it, so the deposit hold stays in place for now.";

export const DEPOSIT_UNCOLLECTIBLE_ALERT_TYPE = "admin_dispute_deposit_uncollectible";

/**
 * The rental's deposit authorization expired (EXPIRED_UNSECURED). If a dispute on it is still unreviewed, flag that case as urgent manual
 * review, record on the dispute when the deposit stopped being collectible through the original authorization, note it on the rental's
 * timeline and alert every admin, once per dispute. It only records: it never creates a new authorization, charges the card, releases
 * anything or touches the Stripe dispute, and every transaction and piece of evidence stays as it was. Call it in the transaction
 * that marks the deposit expired. Returns how many disputes it flagged.
 */
export async function noteDepositUncollectible(
  requestId: number, executor: Pick<typeof db, "select" | "update" | "insert">, now: Date = new Date(),
): Promise<number> {
  const flagged = await executor.update(platformDisputes).set({ urgentManualReview: true, depositUncollectibleAt: now })
    .where(and(
      eq(platformDisputes.requestId, requestId), eq(platformDisputes.reviewStatus, DISPUTE_REVIEW_PENDING),
      isNull(platformDisputes.depositUncollectibleAt),
    )).returning({ disputeId: platformDisputes.disputeId });
  if (flagged.length === 0) return 0;
  const admins = await adminUserIds(executor);
  for (const { disputeId } of flagged) {
    await executor.insert(requestLifecycleEvents).values({
      requestId, eventType: "DEPOSIT_UNCOLLECTIBLE_DURING_DISPUTE", idempotencyKey: `deposit-uncollectible-${disputeId}`,
      details: { disputeId, at: now.toISOString() }, actorId: null,
    }).onConflictDoNothing();
    if (admins.length) {
      await executor.insert(notifications).values(admins.map((userId) => ({
        userId, type: DEPOSIT_UNCOLLECTIBLE_ALERT_TYPE, requestId, isRead: false,
        title: "URGENT: a disputed rental's deposit hold has expired",
        message: `The deposit authorization on request #${requestId} expired while dispute ${disputeId} was unreviewed. The deposit can no longer be collected through the original authorization, and nothing will be charged automatically. Review the case now.`,
      })));
    }
  }
  return flagged.length;
}

export type OperationalCompletion = { status: "completed" | "not_found" | "note_required" | "conflict"; error?: string };

/**
 * An admin closes the rental operationally while the dispute stays open. Only for a rental whose deposit authorization has expired (no live
 * hold) and that has no claim or deposit operation in flight. It sets the request COMPLETED and stamps the dispute; it does not review or
 * close the dispute, release or charge anything, or call Stripe.
 */
export async function completeRentalOperationally(input: { disputeId: string; adminId: number; note: string }): Promise<OperationalCompletion> {
  const note = (input.note ?? "").trim();
  if (note.length < 5) return { status: "note_required" };
  return db.transaction(async (tx) => {
    const [dispute] = await tx.select().from(platformDisputes).where(eq(platformDisputes.disputeId, input.disputeId)).for("update");
    if (!dispute || !dispute.requestId) return { status: "not_found" as const };
    if (dispute.rentalCompletedAt) return { status: "conflict" as const, error: "This rental was already marked operationally complete." };
    await tx.execute(sql`SELECT 1 FROM ${itemRequests} WHERE ${itemRequests.id} = ${dispute.requestId} FOR UPDATE`);
    const [request] = await tx.select().from(itemRequests).where(eq(itemRequests.id, dispute.requestId)).limit(1);
    if (!request) return { status: "not_found" as const };
    if ((TERMINAL_REQUEST_STATUSES as readonly string[]).includes(request.status)) return { status: "conflict" as const, error: "The rental has already ended." };
    if (request.depositStatus !== "EXPIRED_UNSECURED") {
      return { status: "conflict" as const, error: "The deposit hold is still live. Release it through the normal flow; this action is only for an expired authorization." };
    }
    if (request.depositOperationToken || request.depositRenewalStatus === "terminal_action") {
      return { status: "conflict" as const, error: "A deposit operation is in progress on this rental." };
    }
    const [activeClaim] = await tx.select({ id: securityClaims.id }).from(securityClaims)
      .where(and(eq(securityClaims.requestId, request.id), notInArray(securityClaims.status, ["SETTLED", "REJECTED", "CLOSED", "WITHDRAWN"]))).limit(1);
    if (activeClaim) return { status: "conflict" as const, error: "A security claim is still open on this rental. Resolve it first." };
    const now = new Date();
    await tx.update(itemRequests).set({ status: "COMPLETED" }).where(eq(itemRequests.id, request.id));
    await tx.update(platformDisputes).set({ rentalCompletedAt: now, rentalCompletedBy: input.adminId }).where(eq(platformDisputes.id, dispute.id));
    await tx.insert(requestLifecycleEvents).values({
      requestId: request.id, eventType: "RENTAL_COMPLETED_OPERATIONALLY", idempotencyKey: `rental-completed-operationally-${dispute.disputeId}`,
      details: { disputeId: dispute.disputeId, previousStatus: request.status, note }, actorId: input.adminId,
    }).onConflictDoNothing();
    return { status: "completed" as const };
  });
}

/** An admin has looked at the case. Releases the hold guard; optionally records that the evidence went to Stripe and clears the flag. */
export async function markDisputeReviewed(input: { disputeId: string; adminId: number; note: string; evidenceSubmittedToStripe?: boolean; clearBorrowerFlag?: boolean }):
  Promise<{ status: "reviewed" | "already_reviewed" | "not_found" | "note_required" }> {
  const note = (input.note ?? "").trim();
  if (note.length < 5) return { status: "note_required" };
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(platformDisputes).where(eq(platformDisputes.disputeId, input.disputeId)).for("update");
    if (!row) return { status: "not_found" as const };
    const now = new Date();
    if (input.evidenceSubmittedToStripe && !row.evidenceSubmittedToStripeAt) {
      await tx.update(platformDisputes).set({ evidenceSubmittedToStripeAt: now }).where(eq(platformDisputes.id, row.id));
    }
    if (input.clearBorrowerFlag) {
      await tx.update(accountReviewFlags).set({ resolvedAt: now, resolvedBy: input.adminId })
        .where(and(eq(accountReviewFlags.disputeId, row.disputeId), sql`${accountReviewFlags.resolvedAt} IS NULL`));
    }
    if (row.reviewStatus === DISPUTE_REVIEWED) return { status: "already_reviewed" as const };
    await tx.update(platformDisputes).set({ reviewStatus: DISPUTE_REVIEWED, reviewNote: note, reviewedBy: input.adminId, reviewedAt: now }).where(eq(platformDisputes.id, row.id));
    return { status: "reviewed" as const };
  });
}

/** The admin list: every dispute with Stripe's evidence deadline and the rental's deposit authorization expiry beside it. */
export async function listPlatformDisputes(filter: { reviewStatus?: string } = {}) {
  return db.select({
    dispute: platformDisputes,
    itemName: items.name,
    requestStatus: itemRequests.status,
    depositStatus: itemRequests.depositStatus,
    depositAuthorizationExpiresAt: itemRequests.depositAuthorizationExpiresAt,
  }).from(platformDisputes)
    .leftJoin(itemRequests, eq(itemRequests.id, platformDisputes.requestId))
    .leftJoin(items, eq(items.id, itemRequests.itemId))
    .where(filter.reviewStatus ? eq(platformDisputes.reviewStatus, filter.reviewStatus) : undefined)
    .orderBy(desc(platformDisputes.createdAt)).limit(200)
    .then((rows) => rows.map((r) => ({
      ...r.dispute,
      itemName: r.itemName,
      requestStatus: r.requestStatus,
      depositStatus: r.depositStatus,
      /** Stripe's deadline for our evidence (the dispute's evidence_details.due_by). */
      evidenceDueBy: r.dispute.evidenceDueBy,
      /** When the card-network authorization behind the rental's deposit hold runs out; after it the deposit can no longer be captured. */
      depositAuthorizationExpiresAt: r.depositAuthorizationExpiresAt,
    })));
}

export const DISPUTE_ALERT_WINDOW_MS = 48 * 3_600_000;
export const EVIDENCE_DUE_ALERT_TYPE = "admin_dispute_evidence_due";
export const AUTH_EXPIRY_ALERT_TYPE = "admin_dispute_auth_expiring";

/**
 * Alerts every admin, once per dispute and kind, when Stripe's evidence deadline or the deposit authorization of the disputed rental
 * falls within the next 48 hours. Evidence: only while the dispute is open and the evidence has not been marked as sent to Stripe.
 * Authorization: only while the dispute is unreviewed and the deposit is still an uncaptured authorization on an open rental.
 * The stamp is claimed with an UPDATE ... WHERE it is null, so two sweeps running at once cannot alert twice. Called from the
 * durable reminder sweep; returns how many alerts it made.
 */
export async function alertDisputeDeadlines(now: Date = new Date()): Promise<{ evidence: number; authorization: number }> {
  const horizon = new Date(now.getTime() + DISPUTE_ALERT_WINDOW_MS);
  const counts = { evidence: 0, authorization: 0 };
  const day = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

  const evidenceDue = await db.select().from(platformDisputes).where(and(
    eq(platformDisputes.outcome, "open"), isNull(platformDisputes.evidenceSubmittedToStripeAt), isNull(platformDisputes.evidenceDueAlertSentAt),
    gt(platformDisputes.evidenceDueBy, now), lte(platformDisputes.evidenceDueBy, horizon),
  ));
  for (const d of evidenceDue) {
    const sent = await db.transaction(async (tx) => {
      const [claimed] = await tx.update(platformDisputes).set({ evidenceDueAlertSentAt: now })
        .where(and(eq(platformDisputes.id, d.id), isNull(platformDisputes.evidenceDueAlertSentAt))).returning({ id: platformDisputes.id });
      if (!claimed) return false;
      const admins = await adminUserIds(tx);
      if (admins.length) {
        await tx.insert(notifications).values(admins.map((userId) => ({
          userId, type: EVIDENCE_DUE_ALERT_TYPE, requestId: d.requestId, isRead: false,
          title: "Dispute evidence is due within 48 hours",
          message: `Stripe needs the evidence for dispute ${d.disputeId} by ${day(d.evidenceDueBy!)}. It has not been marked as sent. The bundle is at /api/admin/chargebacks/${d.disputeId}/evidence.`,
        })));
      }
      return true;
    });
    if (sent) counts.evidence++;
  }

  const expiring = await db.select({ d: platformDisputes, expires: itemRequests.depositAuthorizationExpiresAt }).from(platformDisputes)
    .innerJoin(itemRequests, eq(itemRequests.id, platformDisputes.requestId))
    .where(and(
      eq(platformDisputes.reviewStatus, DISPUTE_REVIEW_PENDING), isNull(platformDisputes.authExpiryAlertSentAt),
      eq(itemRequests.depositMode, "authorization"),
      notInArray(itemRequests.status, [...TERMINAL_REQUEST_STATUSES]),
      sql`COALESCE(${itemRequests.depositStatus}, '') NOT IN ('captured', 'settled', 'released', 'EXPIRED_UNSECURED')`,
      gt(itemRequests.depositAuthorizationExpiresAt, now), lte(itemRequests.depositAuthorizationExpiresAt, horizon),
    ));
  for (const { d, expires } of expiring) {
    const sent = await db.transaction(async (tx) => {
      const [claimed] = await tx.update(platformDisputes).set({ authExpiryAlertSentAt: now })
        .where(and(eq(platformDisputes.id, d.id), isNull(platformDisputes.authExpiryAlertSentAt))).returning({ id: platformDisputes.id });
      if (!claimed) return false;
      const admins = await adminUserIds(tx);
      if (admins.length) {
        await tx.insert(notifications).values(admins.map((userId) => ({
          userId, type: AUTH_EXPIRY_ALERT_TYPE, requestId: d.requestId, isRead: false,
          title: "A disputed rental's deposit hold expires within 48 hours",
          message: `The deposit authorization on request #${d.requestId} runs out at ${day(expires!)} and dispute ${d.disputeId} has not been reviewed. After that the deposit can no longer be captured. Review the case and decide before then.`,
        })));
      }
      return true;
    });
    if (sent) counts.authorization++;
  }
  return counts;
}

/** Open account-review flags, newest first (what an admin works through). */
export async function listOpenAccountFlags() {
  return db.select().from(accountReviewFlags).where(sql`${accountReviewFlags.resolvedAt} IS NULL`).orderBy(desc(accountReviewFlags.createdAt)).limit(200);
}
