import { and, eq, sql } from "drizzle-orm";
import { db, itemRequests, users } from "@workspace/db";

// The Free plan's borrow limits (Member and above have none):
//   - 3 borrows per 30-day window, counted when a borrow is ACCEPTED (not when it is sent), so a request nobody answers
//     never uses one up. Accepting reserves the slot in the same transaction that accepts.
//   - 3 pending borrow requests open at once, so a requester cannot send requests to everyone at the same time.

export const FREE_MONTHLY_BORROW_LIMIT = 3;
export const FREE_PENDING_BORROW_LIMIT = 3;
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export const BORROW_LIMIT_REACHED_CODE = "BORROW_LIMIT_REACHED";
export const PENDING_BORROW_LIMIT_CODE = "PENDING_BORROW_LIMIT";
export const BORROW_LIMIT_MESSAGE = `You've reached your monthly borrow limit of ${FREE_MONTHLY_BORROW_LIMIT} items on the Free plan. Upgrade to Member for unlimited borrows.`;
export const PENDING_BORROW_LIMIT_MESSAGE = `You already have ${FREE_PENDING_BORROW_LIMIT} borrow requests waiting for an answer. Wait for a reply, or withdraw one, before sending another.`;

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function borrowLimitBody() {
  return { error: BORROW_LIMIT_MESSAGE, code: BORROW_LIMIT_REACHED_CODE, currentTier: "free", limit: FREE_MONTHLY_BORROW_LIMIT };
}

export function pendingBorrowLimitBody() {
  return { error: PENDING_BORROW_LIMIT_MESSAGE, code: PENDING_BORROW_LIMIT_CODE, currentTier: "free", limit: FREE_PENDING_BORROW_LIMIT };
}

/** Whether a 30-day window that began at `resetAt` has run out (a person who never borrowed has no window yet). */
const windowExpired = (resetAt: Date | string | null | undefined, now: Date) =>
  Boolean(resetAt) && now.getTime() - new Date(resetAt as Date | string).getTime() > WINDOW_MS;

/**
 * Read-only: has this person used the monthly allowance up? Used when a request is SENT, so one that could never be
 * accepted is not sent. It counts nothing.
 */
export async function monthlyAllowanceUsedUp(userId: number, exec: Executor = db, now = new Date()): Promise<boolean> {
  const [row] = await exec
    .select({ tier: users.subscriptionTier, count: users.monthlyBorrowCount, resetAt: users.monthlyBorrowResetAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if ((row?.tier || "free") !== "free") return false;
  if (!row?.resetAt || windowExpired(row.resetAt, now)) return false;
  return (row.count ?? 0) >= FREE_MONTHLY_BORROW_LIMIT;
}

/** How many borrow requests this person has waiting for an answer. */
export async function pendingBorrowCount(userId: number, exec: Executor = db): Promise<number> {
  const [row] = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(itemRequests)
    .where(and(eq(itemRequests.requesterId, userId), eq(itemRequests.requestType, "BORROW"), eq(itemRequests.status, "PENDING")));
  return Number(row?.n ?? 0);
}

/** Free plan only: is the requester already at the cap of open pending borrow requests? */
export async function pendingBorrowCapReached(userId: number, exec: Executor = db): Promise<boolean> {
  const [row] = await exec.select({ tier: users.subscriptionTier }).from(users).where(eq(users.id, userId)).limit(1);
  if ((row?.tier || "free") !== "free") return false;
  return (await pendingBorrowCount(userId, exec)) >= FREE_PENDING_BORROW_LIMIT;
}

/**
 * Inside the accepting transaction: lock the requester's row, start a fresh window when the old one ran out, and take
 * one slot. Returns false (nothing changed) when the Free plan's allowance is already used up. Other plans always pass.
 */
export async function takeMonthlyBorrowSlot(tx: Executor, userId: number, now = new Date()): Promise<boolean> {
  const [row] = await tx
    .select({ tier: users.subscriptionTier, count: users.monthlyBorrowCount, resetAt: users.monthlyBorrowResetAt })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  if ((row?.tier || "free") !== "free") return true;
  const fresh = !row?.resetAt || windowExpired(row.resetAt, now);
  const used = fresh ? 0 : row?.count ?? 0;
  if (used >= FREE_MONTHLY_BORROW_LIMIT) return false;
  await tx
    .update(users)
    .set({ monthlyBorrowCount: used + 1, ...(fresh ? { monthlyBorrowResetAt: now } : {}) } as any)
    .where(eq(users.id, userId));
  return true;
}

/** Checks the allowance under the same row lock without taking a slot (the accept path decides funds first, then takes it). */
export async function monthlyBorrowSlotAvailable(tx: Executor, userId: number, now = new Date()): Promise<boolean> {
  const [row] = await tx
    .select({ tier: users.subscriptionTier, count: users.monthlyBorrowCount, resetAt: users.monthlyBorrowResetAt })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  if ((row?.tier || "free") !== "free") return true;
  if (!row?.resetAt || windowExpired(row.resetAt, now)) return true;
  return (row?.count ?? 0) < FREE_MONTHLY_BORROW_LIMIT;
}
