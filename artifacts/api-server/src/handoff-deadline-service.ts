import {
  db,
  itemRequests,
  items,
  messages,
  notifications,
  shareCoinsTransactions,
  users,
} from "@workspace/db";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import * as depositCopy from "./deposit-copy";

// Handoff deadline transitions, shared by the web-polled endpoint
// (POST /api/requests/check-handoff-deadlines) and the server interval:
//   - AWAITING_HANDOFF_CONFIRM past handoffConfirmDeadline:
//       one side denied, other silent  -> HANDOFF_FLAGGED (admin review)
//       one side confirmed, no denial  -> auto-confirm (IN_PROGRESS / COMPLETED for swaps)
//   - ACCEPTED, in-app deposit unpaid 48h after acceptance -> CANCELLED
//
// Every transition is claimed with UPDATE ... WHERE status = <expected> inside a
// transaction and its side effects only run if that claim changed a row, so the
// endpoint, the interval and several server instances can overlap safely.

export const DEPOSIT_PAYMENT_TIMEOUT_MS = 48 * 3_600_000;
export const HANDOFF_SWEEP_INTERVAL_MS = 60_000;
/** The interval only acts on transitions whose deadline passed within this window. */
export const HANDOFF_SWEEP_MAX_DEADLINE_AGE_MS = 3 * 24 * 3_600_000;

export type HandoffSweepMode = "off" | "dry-run" | "live";

/** Anything other than an explicit "off" or "live" is a dry run, never a live one. */
export function resolveHandoffSweepMode(raw: string | undefined): HandoffSweepMode {
  const value = raw?.trim().toLowerCase();
  if (value === "live") return "live";
  if (value === "off") return "off";
  return "dry-run";
}

export type HandoffTransition = "auto_confirm" | "flag" | "deposit_timeout";

export interface HandoffDeadlineCandidate {
  requestId: number;
  transition: HandoffTransition;
  requestType: string;
  itemName: string;
  deadline: Date;
  detail: string;
}

export interface HandoffDeadlineOptions {
  now?: Date;
  /** Select and report candidates only; change nothing. */
  dryRun?: boolean;
  /** Only act on transitions whose deadline passed no more than this long ago. Unset = no limit. */
  maxDeadlineAgeMs?: number;
  /** Restrict to these requests (tests, so they never touch unrelated rows). */
  onlyRequestIds?: number[];
}

export interface AutoConfirmedSwapContext {
  requestId: number;
  ownerId: number;
  borrowerId: number;
  itemId: number;
  itemName: string;
  swapOfferedItemIds: number[] | null;
  counterSwapOwnerItemIds: number[] | null;
  counterSwapRequesterItemIds: number[] | null;
}

export interface HandoffDeadlineDeps {
  /** Rewards for an auto-confirmed SWAP; runs after the transition commits and may not throw. */
  onSwapAutoConfirmed: (context: AutoConfirmedSwapContext) => Promise<void>;
}

export interface HandoffDeadlineResult {
  autoAdvancedCount: number;
  flaggedCount: number;
  depositExpiredCount: number;
  dryRun: boolean;
  /** Dry runs: what would change. Live runs: empty. */
  candidates: HandoffDeadlineCandidate[];
}

// ShareCoin borrow cost. End date = return day (not last usage day), so usage days
// = end - start (no +1). Formula: round( (weeklyPrice / 7) × days ).
// e.g. 10 SC/week item, start=Mon, return=Fri → 4 usage days → round(10/7 × 4) = 6 SC
export function calcBorrowShareCoinCost(
  shareCoinPrice: number,
  startDate: Date | string | null | undefined,
  endDate: Date | string | null | undefined,
): number {
  if (!startDate || !endDate || shareCoinPrice <= 0) return Math.max(1, shareCoinPrice);
  const start = new Date(startDate);
  const end = new Date(endDate);
  const borrowDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
  return Math.max(1, Math.round((shareCoinPrice / 7) * borrowDays));
}

const short = (name: string, max: number) => (name.length > max ? name.slice(0, max) + "…" : name);

export async function processHandoffDeadlines(
  deps: HandoffDeadlineDeps,
  options: HandoffDeadlineOptions = {},
): Promise<HandoffDeadlineResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  const earliestDeadline =
    options.maxDeadlineAgeMs === undefined
      ? null
      : new Date(now.getTime() - options.maxDeadlineAgeMs);
  const scope = options.onlyRequestIds
    ? [inArray(itemRequests.id, options.onlyRequestIds)]
    : [];

  const result: HandoffDeadlineResult = {
    autoAdvancedCount: 0,
    flaggedCount: 0,
    depositExpiredCount: 0,
    dryRun,
    candidates: [],
  };

  // ── Auto-advance: AWAITING requests past their confirmation deadline ──
  const expiredHandoffs = await db
    .select()
    .from(itemRequests)
    .innerJoin(items, eq(items.id, itemRequests.itemId))
    .where(
      and(
        eq(itemRequests.status, "AWAITING_HANDOFF_CONFIRM"),
        lt(itemRequests.handoffConfirmDeadline, now),
        ...(earliestDeadline ? [gte(itemRequests.handoffConfirmDeadline, earliestDeadline)] : []),
        ...scope,
      ),
    );

  for (const request of expiredHandoffs) {
    const ownerConfirmed = request.item_requests.ownerConfirmedHandoff;
    const borrowerConfirmed = request.item_requests.borrowerConfirmedHandoff;
    const ownerDenied = (request.item_requests as any).ownerDeniedHandoff;
    const borrowerDenied = (request.item_requests as any).borrowerDeniedHandoff;
    const ownerId2 = request.items.ownerId!;
    const borrowerId2 = request.item_requests.requesterId!;
    const reqId = request.item_requests.id;
    const deadline = request.item_requests.handoffConfirmDeadline!;
    const itemName = request.items.name;

    // ── Case 2: One denied, other is silent → flag for review (DO NOT auto-confirm) ──
    if ((ownerDenied || borrowerDenied) && !ownerConfirmed && !borrowerConfirmed) {
      if (dryRun) {
        result.candidates.push({
          requestId: reqId,
          transition: "flag",
          requestType: request.item_requests.requestType,
          itemName,
          deadline,
          detail: "AWAITING_HANDOFF_CONFIRM -> HANDOFF_FLAGGED (one party denied, other silent)",
        });
        result.flaggedCount++;
        continue;
      }

      const flagged = await db.transaction(async (tx) => {
        const [claimed] = await tx.update(itemRequests)
          .set({ status: "HANDOFF_FLAGGED" })
          .where(and(eq(itemRequests.id, reqId), eq(itemRequests.status, "AWAITING_HANDOFF_CONFIRM")))
          .returning({ id: itemRequests.id });
        if (!claimed) return false;

        await tx.insert(messages).values({
          content: `🚩 This exchange has been flagged for review. One party reported the item was not handed off and no response was received in time.`,
          senderId: ownerId2,
          receiverId: borrowerId2,
          messageType: "system",
          requestId: reqId,
        });

        await tx.insert(notifications).values([
          { userId: ownerId2, type: "handoff_flagged", title: "Exchange Flagged", message: `"${short(itemName, 22)}" flagged for admin review.`, itemId: request.items.id, requestId: reqId },
          { userId: borrowerId2, type: "handoff_flagged", title: "Exchange Flagged", message: `"${short(itemName, 22)}" flagged for admin review.`, itemId: request.items.id, requestId: reqId },
        ]);
        return true;
      });

      if (flagged) result.flaggedCount++;
      continue;
    }

    // ── Case 1: One confirmed, other is silent (no denial) → auto-confirm ──
    if ((ownerConfirmed || borrowerConfirmed) && !ownerDenied && !borrowerDenied) {
      // Use counter-proposed dates if present — they are the agreed-upon dates after negotiation
      const effectiveStart4 = request.item_requests.counterStartDate || request.item_requests.startDate;
      const effectiveEnd4   = request.item_requests.counterEndDate   || request.item_requests.endDate;
      // ShareCoin amount is always based on the original booked period — never adjusted for early/late handoff
      const shareCoinAmount = request.item_requests.requestType === "BORROW"
        ? calcBorrowShareCoinCost(
            parseFloat(request.items.shareCoinPrice || "0"),
            effectiveStart4,
            effectiveEnd4,
          )
        : parseFloat(request.item_requests.shareCoinAmount || request.items.shareCoinPrice || "0");

      const isAutoSwap = request.item_requests.requestType === "SWAP";

      if (dryRun) {
        let coinNote = "no ShareCoin charge";
        if (shareCoinAmount > 0 && request.item_requests.requestType === "BORROW") {
          const [borrower] = await db.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, borrowerId2)).limit(1);
          const balance = Math.floor(parseFloat(borrower?.shareCoins || "0"));
          coinNote = balance >= shareCoinAmount
            ? `would move ${shareCoinAmount} ShareCoins borrower ${borrowerId2} -> owner ${ownerId2} (borrower balance ${balance})`
            : `borrower ${borrowerId2} has ${balance} of ${shareCoinAmount} ShareCoins: no coins moved, status still advances`;
        }
        result.candidates.push({
          requestId: reqId,
          transition: "auto_confirm",
          requestType: request.item_requests.requestType,
          itemName,
          deadline,
          detail: `AWAITING_HANDOFF_CONFIRM -> ${isAutoSwap ? "COMPLETED" : "IN_PROGRESS"} (${ownerConfirmed ? "owner" : "borrower"} confirmed, other silent); item set unavailable; ${coinNote}`,
        });
        result.autoAdvancedCount++;
        continue;
      }

      const advanced = await db.transaction(async (tx) => {
        const [claimed] = await tx.update(itemRequests)
          .set({ status: isAutoSwap ? "COMPLETED" : "IN_PROGRESS", handoffConfirmedAt: now, borrowPeriodStartedAt: now, actualHandoffAt: now, shareCoinsCharged: true, shareCoinsChargedAt: now, depositStatus: "held", handoffAutoAdvanced: true })
          .where(and(eq(itemRequests.id, reqId), eq(itemRequests.status, "AWAITING_HANDOFF_CONFIRM")))
          .returning({ id: itemRequests.id });
        if (!claimed) return false;

        if (shareCoinAmount > 0 && request.item_requests.requestType === "BORROW") {
          const [borrower] = await tx.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, borrowerId2)).limit(1);
          const currentBalance = Math.floor(parseFloat(borrower?.shareCoins || "0"));
          if (currentBalance >= shareCoinAmount) {
            await tx.update(users).set({ shareCoins: (currentBalance - shareCoinAmount).toString() }).where(eq(users.id, borrowerId2));
            await tx.insert(shareCoinsTransactions).values({ userId: borrowerId2, amount: (-shareCoinAmount).toString(), description: `Borrowed: ${itemName} (auto-confirmed)`, transactionType: "BORROW_CHARGE" });
            if (ownerId2) {
              const [lender] = await tx.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, ownerId2)).limit(1);
              const lenderBalance = Math.floor(parseFloat(lender?.shareCoins || "0"));
              await tx.update(users).set({ shareCoins: (lenderBalance + shareCoinAmount).toString() }).where(eq(users.id, ownerId2));
              await tx.insert(shareCoinsTransactions).values({ userId: ownerId2, amount: shareCoinAmount.toString(), description: `Lent: ${itemName} (auto-confirmed)`, transactionType: "LEND_REWARD" });
            }
          }
        }

        await tx.update(items).set({ isAvailable: false }).where(eq(items.id, request.items.id));

        // For swaps: also mark offered/counter items from both sides as swapped + unavailable
        if (isAutoSwap) {
          await tx.update(items).set({ isSwapped: true }).where(eq(items.id, request.items.id));
          const autoOfferedIds: number[] = [
            ...((request.item_requests.swapOfferedItemIds as number[] | null) ?? []),
            ...((request.item_requests.counterSwapOwnerItemIds as number[] | null) ?? []),
            ...((request.item_requests.counterSwapRequesterItemIds as number[] | null) ?? []),
          ].filter((id) => typeof id === "number");
          if (autoOfferedIds.length > 0) {
            await tx.update(items).set({ isAvailable: false, isSwapped: true }).where(inArray(items.id, autoOfferedIds));
          }
        }

        await tx.insert(notifications).values([
          { userId: borrowerId2, type: "handoff_auto_advanced", title: "Exchange Auto-Confirmed", message: `"${short(itemName, 20)}" auto-confirmed — no response received.`, itemId: request.items.id, requestId: reqId },
          ...(ownerId2 ? [{ userId: ownerId2, type: "handoff_auto_advanced", title: "Exchange Auto-Confirmed", message: `"${short(itemName, 20)}" auto-confirmed — no response received.`, itemId: request.items.id, requestId: reqId }] : []),
        ]);
        return true;
      });

      if (!advanced) continue;

      // Award coins/milestones for SWAP at auto-confirmed handoff (after the commit,
      // as before: failures there never undo the transition).
      if (isAutoSwap && ownerId2) {
        await deps.onSwapAutoConfirmed({
          requestId: reqId,
          ownerId: ownerId2,
          borrowerId: borrowerId2,
          itemId: request.item_requests.itemId!,
          itemName,
          swapOfferedItemIds: request.item_requests.swapOfferedItemIds as number[] | null,
          counterSwapOwnerItemIds: request.item_requests.counterSwapOwnerItemIds as number[] | null,
          counterSwapRequesterItemIds: request.item_requests.counterSwapRequesterItemIds as number[] | null,
        });
      }

      result.autoAdvancedCount++;
    }
    // ── Case 3 / Other edge cases: both silent past deadline — skip (no deadline was set without first confirm) ──
  }

  // ── Deposit timeout: ACCEPTED requests where deposit not paid within 48hrs ──
  const depositDeadline = new Date(now.getTime() - DEPOSIT_PAYMENT_TIMEOUT_MS);
  const earliestAccepted = earliestDeadline
    ? new Date(earliestDeadline.getTime() - DEPOSIT_PAYMENT_TIMEOUT_MS)
    : null;
  const depositExpired = await db
    .select()
    .from(itemRequests)
    .innerJoin(items, eq(items.id, itemRequests.itemId))
    .where(
      and(
        eq(itemRequests.status, "ACCEPTED"),
        eq(itemRequests.depositMethod, "in_app"),
        inArray(itemRequests.requestType, ["RENT", "BORROW"]),
        lt(itemRequests.acceptedAt, depositDeadline),
        ...(earliestAccepted ? [gte(itemRequests.acceptedAt, earliestAccepted)] : []),
        ...scope,
      ),
    );

  for (const row of depositExpired) {
    const reqId = row.item_requests.id;
    const ownerId2 = row.items.ownerId!;
    const requesterId2 = row.item_requests.requesterId!;

    if (dryRun) {
      result.candidates.push({
        requestId: reqId,
        transition: "deposit_timeout",
        requestType: row.item_requests.requestType,
        itemName: row.items.name,
        deadline: new Date(row.item_requests.acceptedAt!.getTime() + DEPOSIT_PAYMENT_TIMEOUT_MS),
        detail: "ACCEPTED -> CANCELLED (in-app deposit not paid within 48h); item set available; no hold exists to release",
      });
      result.depositExpiredCount++;
      continue;
    }

    const cancelled = await db.transaction(async (tx) => {
      const [claimed] = await tx.update(itemRequests)
        .set({ status: "CANCELLED", unarchivedAt: new Date() })
        .where(and(eq(itemRequests.id, reqId), eq(itemRequests.status, "ACCEPTED")))
        .returning({ id: itemRequests.id });
      if (!claimed) return false;

      await tx.update(items)
        .set({ isAvailable: true, updatedAt: new Date() })
        .where(eq(items.id, row.items.id));

      await tx.insert(messages).values({
        content: depositCopy.TRANSACTION_EXPIRED_HOLD_CHAT,
        senderId: ownerId2,
        receiverId: requesterId2,
        messageType: "system",
        requestId: reqId,
      });

      const itemShort = short(row.items.name, 22);
      await tx.insert(notifications).values([
        { userId: ownerId2, type: "request_expired", title: "Transaction Expired", message: depositCopy.transactionExpiredHoldBody(itemShort), itemId: row.items.id, requestId: reqId },
        { userId: requesterId2, type: "request_expired", title: "Transaction Expired", message: depositCopy.transactionExpiredHoldBody(itemShort), itemId: row.items.id, requestId: reqId },
      ]);
      return true;
    });

    if (cancelled) result.depositExpiredCount++;
  }

  return result;
}

// ── Interval wrapper ───────────────────────────────────────────────────────────

const reportedCandidates = new Set<string>();

function describeCandidate(candidate: HandoffDeadlineCandidate): string {
  return (
    `request ${candidate.requestId} (${candidate.requestType}, "${short(candidate.itemName, 40)}") ` +
    `${candidate.transition} — deadline ${candidate.deadline.toISOString()}: ${candidate.detail}`
  );
}

/**
 * One interval tick. "dry-run" only logs (each candidate once per process, so a
 * minute-by-minute sweep does not repeat itself); "live" applies the transitions.
 */
export async function runHandoffDeadlineSweep(
  deps: HandoffDeadlineDeps,
  mode: Exclude<HandoffSweepMode, "off">,
  log: (line: string) => void = (line) => console.log(line),
  options: Pick<HandoffDeadlineOptions, "now" | "onlyRequestIds"> = {},
): Promise<HandoffDeadlineResult> {
  const result = await processHandoffDeadlines(deps, {
    ...options,
    dryRun: mode === "dry-run",
    maxDeadlineAgeMs: HANDOFF_SWEEP_MAX_DEADLINE_AGE_MS,
  });

  if (mode === "dry-run") {
    if (reportedCandidates.size > 5000) reportedCandidates.clear();
    for (const candidate of result.candidates) {
      const key = `${candidate.requestId}:${candidate.transition}`;
      if (reportedCandidates.has(key)) continue;
      reportedCandidates.add(key);
      log(`[handoff-deadlines] DRY-RUN would change ${describeCandidate(candidate)}`);
    }
  } else if (result.autoAdvancedCount + result.flaggedCount + result.depositExpiredCount > 0) {
    log(
      `[handoff-deadlines] applied: autoConfirmed=${result.autoAdvancedCount} flagged=${result.flaggedCount} depositCancelled=${result.depositExpiredCount}`,
    );
  }
  return result;
}

/** Test hook: forget which dry-run candidates were already reported. */
export function resetHandoffSweepReportState(): void {
  reportedCandidates.clear();
}
