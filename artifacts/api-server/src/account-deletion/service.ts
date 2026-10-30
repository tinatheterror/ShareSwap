import { unlink } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { bannedEmailHashes, connectCleanupFailures, db, items, notifications, requestLifecycleEvents, users } from "@workspace/db";
import { sendAccountDeletedEmail, sendAccountDeletionRequestedEmail } from "../sendgrid";
import { publicName } from "../public-identity";
import { anonymizeUser } from "./anonymize";
import { accountEmail, hashBannedEmail } from "./banned-email";
import { getDeletionEligibility, type DeletionBlocker } from "./eligibility";
import { DELETION_GRACE_DAYS, TERMINAL_REQUEST_STATUSES } from "./retention";

// The life of a deletion: request (the account stays usable for the grace period, so the person can withdraw a small
// balance or change their mind), cancel, and finalize (the manifest runs). Finalizing is idempotent: a second call on
// a deleted account does nothing, and a failed one changes nothing.

export class DeletionError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409, readonly blockers?: DeletionBlocker[]) {
    super(message);
    this.name = "DeletionError";
  }
}

/** What has to be ended on Stripe's side before the account's data is erased. */
export type StripeCleanupTarget = {
  userId: number;
  customerId: string | null;
  subscriptionId: string | null;
  connectedAccountId: string | null;
};

/** What stripeCleanup reports back. A Connect refusal does not stop the deletion; it is recorded for staff. */
export type StripeCleanupResult = { connectRefused?: string };

export type DeletionDeps = {
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  /** Ends the subscription and removes the Customer and Connect account. Must be safe to repeat. */
  stripeCleanup?: (target: StripeCleanupTarget) => Promise<StripeCleanupResult | void>;
  /** Deletes a Connect account for a retry: resolves when it is gone (or already was), throws when Stripe refuses. */
  deleteConnectAccount?: (accountId: string) => Promise<void>;
  sendRequestedEmail?: (to: string, deleteOn: Date, name?: string) => Promise<unknown>;
  sendDeletedEmail?: (to: string, name?: string) => Promise<unknown>;
  removeUpload?: (publicPath: string) => Promise<void>;
};

export type DeletionState = {
  status: "active" | "pending_deletion";
  deletionRequestedAt: Date | null;
  /** When the finalize job will delete the account; null unless a deletion is requested. */
  scheduledFor: Date | null;
};

const DAY_MS = 24 * 3_600_000;
export const scheduledFor = (requestedAt: Date) => new Date(requestedAt.getTime() + DELETION_GRACE_DAYS * DAY_MS);
const stateOf = (status: string, requestedAt: Date | null): DeletionState =>
  status === "pending_deletion" && requestedAt
    ? { status: "pending_deletion", deletionRequestedAt: requestedAt, scheduledFor: scheduledFor(requestedAt) }
    : { status: "active", deletionRequestedAt: null, scheduledFor: null };

const clock = (deps: DeletionDeps) => (deps.now ?? (() => new Date()))();

async function loadUser(userId: number) {
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      displayName: users.displayName,
      accountStatus: users.accountStatus,
      bannedAt: users.bannedAt,
      deletionRequestedAt: users.deletionRequestedAt,
      stripeCustomerId: users.stripeCustomerId,
      stripeSubscriptionId: users.stripeSubscriptionId,
      stripeConnectedAccountId: users.stripeConnectedAccountId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new DeletionError("not_found", "Account not found", 404);
  return user;
}

/** Best effort: a failed email never undoes or blocks the deletion. */
async function tryEmail(send: () => Promise<unknown>) {
  try {
    await send();
  } catch (error) {
    console.error("[account-deletion] email failed:", error);
  }
}

/** Starts the grace period. Re-checks eligibility on the server; requesting twice returns the same schedule. */
export async function requestDeletion(userId: number, input: { acknowledgeForfeit: boolean }, deps: DeletionDeps = {}): Promise<DeletionState> {
  const user = await loadUser(userId);
  if (user.accountStatus === "pending_deletion" && user.deletionRequestedAt) return stateOf("pending_deletion", user.deletionRequestedAt);
  if (user.accountStatus !== "active") throw new DeletionError("account_not_active", "This account cannot be deleted right now.");

  const eligibility = await getDeletionEligibility(userId);
  if (!eligibility.eligible) {
    throw new DeletionError("blocked", "Finish what is still open before deleting your account.", 409, eligibility.blockers);
  }
  if (eligibility.wallet.forfeitedOnDeletion !== "0.00" && !input.acknowledgeForfeit) {
    throw new DeletionError("forfeit_acknowledgement_required", `Deleting the account forfeits your balance of $${eligibility.wallet.forfeitedOnDeletion}. Acknowledge this to continue.`, 400);
  }

  const requestedAt = clock(deps);
  const started = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ accountStatus: "pending_deletion", deletionRequestedAt: requestedAt })
      .where(and(eq(users.id, userId), eq(users.accountStatus, "active")))
      .returning({ id: users.id });
    if (!row) return false;
    // New requests stop arriving while the account waits to be deleted.
    await tx.update(items).set({ isAvailable: false }).where(and(eq(items.ownerId, userId), eq(items.isDeleted, false)));
    return true;
  });
  if (!started) {
    // Someone else changed the account first (a second tab, an admin ban): report what it is now.
    const now = await loadUser(userId);
    if (now.accountStatus === "pending_deletion" && now.deletionRequestedAt) return stateOf("pending_deletion", now.deletionRequestedAt);
    throw new DeletionError("account_not_active", "This account cannot be deleted right now.");
  }

  const to = accountEmail(user);
  if (to) await tryEmail(() => (deps.sendRequestedEmail ?? sendAccountDeletionRequestedEmail)(to, scheduledFor(requestedAt), publicName(user) ?? undefined));
  return stateOf("pending_deletion", requestedAt);
}

/** Changes of mind: back to active, listings visible again. Cancelling an account that is not pending does nothing. */
export async function cancelDeletion(userId: number): Promise<DeletionState> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ accountStatus: "active", deletionRequestedAt: null })
      .where(and(eq(users.id, userId), eq(users.accountStatus, "pending_deletion")))
      .returning({ id: users.id });
    if (row) await tx.update(items).set({ isAvailable: true }).where(and(eq(items.ownerId, userId), eq(items.isDeleted, false)));
  });
  const user = await loadUser(userId);
  return stateOf(user.accountStatus ?? "active", user.deletionRequestedAt);
}

export type FinalizeResult = { deleted: true; alreadyDeleted: boolean; requestsCancelled: number };

/** Deletes the account now. Safe to call again: a deleted account answers `alreadyDeleted` and nothing else happens. */
export async function finalizeDeletion(userId: number, deps: DeletionDeps = {}): Promise<FinalizeResult> {
  const user = await loadUser(userId);
  if (user.accountStatus === "deleted") return { deleted: true, alreadyDeleted: true, requestsCancelled: 0 };
  const banned = user.accountStatus === "banned" || !!user.bannedAt;
  const requested = !!user.deletionRequestedAt && (user.accountStatus === "pending_deletion" || user.accountStatus === "banned");
  if (!requested) throw new DeletionError("deletion_not_requested", "Request the deletion of this account first.");

  // A banned person's email is blocked from signing up again. Without the key that block cannot exist, so stop here,
  // before anything is changed, instead of deleting the account without it.
  const email = accountEmail(user);
  const bannedHash = banned && email ? hashBannedEmail(email, deps.env ?? process.env) : null;

  const eligibility = await getDeletionEligibility(userId);
  if (!eligibility.eligible) {
    throw new DeletionError("blocked", "Finish what is still open before this account can be deleted.", 409, eligibility.blockers);
  }

  // Stripe first: every call is idempotent, so if the database step fails the next attempt repeats them harmlessly.
  const target: StripeCleanupTarget = {
    userId,
    customerId: user.stripeCustomerId,
    subscriptionId: user.stripeSubscriptionId,
    connectedAccountId: user.stripeConnectedAccountId,
  };
  let connectRefused: string | undefined;
  if (deps.stripeCleanup) connectRefused = (await deps.stripeCleanup(target))?.connectRefused;
  else if (target.customerId || target.subscriptionId || target.connectedAccountId) {
    throw new DeletionError("stripe_cleanup_unavailable", "Stripe cleanup is not configured, so an account with Stripe data cannot be deleted.", 500);
  }

  const outcome = await db.transaction(async (tx) => {
    const [locked] = await tx.execute(sql`SELECT account_status FROM users WHERE id = ${userId} FOR UPDATE`).then((r) => r.rows as { account_status: string | null }[]);
    if (!locked) throw new DeletionError("not_found", "Account not found", 404);
    if (locked.account_status === "deleted") return null;
    if (locked.account_status !== "pending_deletion" && locked.account_status !== "banned") {
      throw new DeletionError("deletion_not_requested", "The deletion of this account was cancelled.");
    }

    // Hold the open bookings still while they are checked and cancelled.
    await tx.execute(sql`
      SELECT t.id FROM item_requests t JOIN items i ON i.id = t.item_id
      WHERE (t.requester_id = ${userId} OR i.owner_id = ${userId})
        AND t.status NOT IN (${sql.join(TERMINAL_REQUEST_STATUSES.map((s) => sql`${s}`), sql`, `)})
      FOR UPDATE OF t`);
    const recheck = await getDeletionEligibility(userId, tx);
    if (!recheck.eligible) throw new DeletionError("blocked", "Finish what is still open before this account can be deleted.", 409, recheck.blockers);

    // Everything still open is a booking nothing has moved for: cancel it and tell the other side.
    const cancelled = (await tx.execute(sql`
      UPDATE item_requests AS t SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = ${userId},
        cancelled_from_status = t.status, cancel_reason = 'account_deleted', cancelled_with_penalty = false, cancel_deposit_state = 'none'
      FROM items i
      WHERE i.id = t.item_id AND (t.requester_id = ${userId} OR i.owner_id = ${userId})
        AND t.status NOT IN (${sql.join(TERMINAL_REQUEST_STATUSES.map((s) => sql`${s}`), sql`, `)})
      RETURNING t.id, t.requester_id, i.owner_id, i.id AS item_id, i.name AS item_name`)).rows as
      { id: number; requester_id: number | null; owner_id: number | null; item_id: number; item_name: string }[];
    for (const request of cancelled) {
      const otherSide = request.requester_id === userId ? request.owner_id : request.requester_id;
      if (otherSide && otherSide !== userId) {
        await tx.insert(notifications).values({
          userId: otherSide,
          type: "request_cancelled" as any,
          title: "Request cancelled",
          message: `Your request for "${request.item_name}" was cancelled because the other member's account was deleted.`,
          itemId: request.item_id,
          requestId: request.id,
        });
      }
      await tx
        .insert(requestLifecycleEvents)
        .values({
          requestId: request.id,
          eventType: "request_cancelled",
          actorId: userId,
          idempotencyKey: `account-deletion:${request.id}`,
          details: { cause: "account_deleted", cancelledByRole: request.requester_id === userId ? "requester" : "owner" },
        })
        .onConflictDoNothing();
    }

    const { uploads } = await anonymizeUser(tx, userId);
    if (bannedHash) await tx.insert(bannedEmailHashes).values({ emailHash: bannedHash }).onConflictDoNothing();
    // Stripe would not delete the Connect account: leave a durable note for staff, in the same transaction as the
    // deletion, and let later finalize runs retry it.
    if (connectRefused && target.connectedAccountId) {
      await tx
        .insert(connectCleanupFailures)
        .values({ userId, connectedAccountId: target.connectedAccountId, reason: connectRefused })
        .onConflictDoUpdate({ target: connectCleanupFailures.userId, set: { reason: connectRefused, lastAttemptAt: new Date(), resolvedAt: null } });
    }
    return { uploads, requestsCancelled: cancelled.length };
  });

  if (!outcome) return { deleted: true, alreadyDeleted: true, requestsCancelled: 0 };

  const remove = deps.removeUpload ?? removeUploadedFile;
  for (const file of outcome.uploads) {
    try {
      await remove(file);
    } catch (error) {
      console.error("[account-deletion] could not remove an uploaded file:", error);
    }
  }
  if (email) await tryEmail(() => (deps.sendDeletedEmail ?? sendAccountDeletedEmail)(email, publicName(user) ?? undefined));
  return { deleted: true, alreadyDeleted: false, requestsCancelled: outcome.requestsCancelled };
}

/** "/uploads/x.jpg" is served from the server's uploads folder; anything else (a data: or http URL) is not ours to remove. */
async function removeUploadedFile(publicPath: string) {
  const file = path.basename(publicPath);
  if (!file || file !== publicPath.slice("/uploads/".length)) return;
  try {
    await unlink(path.resolve("uploads", file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export type ConnectRetryResult = { tried: number; resolved: number };

/** Retries the Connect accounts Stripe refused earlier. Each failure stays on the list until Stripe lets go of it. */
export async function retryConnectFailures(deps: Pick<DeletionDeps, "deleteConnectAccount" | "now"> = {}): Promise<ConnectRetryResult> {
  const result: ConnectRetryResult = { tried: 0, resolved: 0 };
  if (!deps.deleteConnectAccount) return result;
  const open = await db.select().from(connectCleanupFailures).where(isNull(connectCleanupFailures.resolvedAt)).orderBy(connectCleanupFailures.id).limit(100);
  for (const failure of open) {
    result.tried++;
    const at = clock(deps);
    try {
      await deps.deleteConnectAccount(failure.connectedAccountId);
      await db.update(connectCleanupFailures).set({ resolvedAt: at, lastAttemptAt: at, attempts: failure.attempts + 1 }).where(eq(connectCleanupFailures.id, failure.id));
      result.resolved++;
    } catch (error) {
      await db
        .update(connectCleanupFailures)
        .set({ reason: error instanceof Error ? error.message : String(error), lastAttemptAt: at, attempts: failure.attempts + 1 })
        .where(eq(connectCleanupFailures.id, failure.id));
    }
  }
  return result;
}

export type DueSweepResult = { due: number; deleted: number; blocked: number; failed: number; wouldDelete: number; connectTried: number; connectResolved: number };

/** Accounts whose grace period is over. A banned account that asked to be deleted is deleted too. */
export async function finalizeDueDeletions(deps: DeletionDeps & { dryRun?: boolean; limit?: number } = {}): Promise<DueSweepResult> {
  let connectTried = 0;
  let connectResolved = 0;
  if (!deps.dryRun) {
    // Connect accounts Stripe refused on earlier runs are tried again on every live run.
    try {
      const retried = await retryConnectFailures(deps);
      connectTried = retried.tried;
      connectResolved = retried.resolved;
    } catch (error) {
      console.error("[account-deletion] could not retry Connect cleanups:", error instanceof Error ? error.message : error);
    }
  }
  const cutoff = new Date(clock(deps).getTime() - DELETION_GRACE_DAYS * DAY_MS);
  const due = await db
    .select({ id: users.id })
    .from(users)
    .where(and(isNotNull(users.deletionRequestedAt), lte(users.deletionRequestedAt, cutoff), inArray(users.accountStatus, ["pending_deletion", "banned"])))
    .orderBy(users.deletionRequestedAt)
    .limit(deps.limit ?? 25);
  const result: DueSweepResult = { due: due.length, deleted: 0, blocked: 0, failed: 0, wouldDelete: 0, connectTried, connectResolved };
  for (const { id } of due) {
    try {
      if (deps.dryRun) {
        const eligibility = await getDeletionEligibility(id);
        if (eligibility.eligible) result.wouldDelete++;
        else result.blocked++;
        continue;
      }
      await finalizeDeletion(id, deps);
      result.deleted++;
    } catch (error) {
      if (error instanceof DeletionError && error.code === "blocked") result.blocked++;
      else {
        result.failed++;
        console.error(`[account-deletion] could not delete user ${id}:`, error instanceof Error ? error.message : error);
      }
    }
  }
  return result;
}
