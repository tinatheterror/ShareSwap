import { and, eq, inArray, sql } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, users } from "@workspace/db";
import * as copy from "./request-expiry-copy";
import { calendarDayInZone, endOfLocalDay, PLATFORM_TIME_ZONE } from "./request-dates";

// An accepted SWAP that nobody confirms by the end of the 7th day after acceptance expires on its own.
//
//   - Only ACCEPTED swaps expire. Once one side confirms the handoff (AWAITING_HANDOFF_CONFIRM) the
//     handoff-deadline sweep takes over: it auto-confirms after the confirmation window.
//   - No money is involved (no deposit, no up-front charge) and nobody is penalised: the app cannot
//     tell who did not show up.
//   - Both people get a reminder 72 hours and again 24 hours before the deadline.
//   - Called by runRequestExpirySweep, so it follows the same dry-run / live switches as borrow and rent expiry.
//
// Each change is claimed with UPDATE ... WHERE status = 'ACCEPTED', so overlapping sweeps are safe, and a
// reminder is claimed under a per-request advisory lock, so each is sent at most once.

export const SWAP_REMINDER_72H_MS = 72 * 3_600_000;
export const SWAP_REMINDER_24H_MS = 24 * 3_600_000;

export interface SwapExpiryDeps {
  /** Runs after an expiry commits; failures are ignored. */
  onItemFreed?: (itemId: number, itemName: string) => void | Promise<void>;
  /** Native push; failures are ignored. */
  push?: (userId: number, payload: { title: string; body: string; data?: Record<string, unknown> }) => void | Promise<void>;
}

export interface SwapExpiryCandidate {
  requestId: number;
  action: "expire" | "remind";
  itemName: string;
  /** The moment the swap expires. */
  cutoff: Date;
}

export interface SwapExpirySweepOptions {
  now?: Date;
  /** Select and report only (no expiry, no reminders). */
  dryRun?: boolean;
  /** Report what would expire but do not expire it; reminders still go out unless `reminders` is false. */
  expireDryRun?: boolean;
  /** Send the 72h / 24h reminders. Default true. */
  reminders?: boolean;
  /** Only expire swaps whose deadline passed no more than this long ago (older ones are left alone). Unset = no limit. */
  maxCutoffAgeMs?: number;
  onlyRequestIds?: number[];
}

export interface SwapExpirySweepResult {
  expiredCount: number;
  remindedCount: number;
  failedCount: number;
  candidates: SwapExpiryCandidate[];
}

/**
 * When an accepted swap expires: the end of the calendar day (platform zone) SWAP_EXPIRY_DAYS after acceptance, so the
 * date people are shown is the last day they have. Null when it has no acceptance time.
 */
export function swapExpiryDeadline(request: { acceptedAt: Date | null }): Date | null {
  if (!request.acceptedAt) return null;
  const day = calendarDayInZone(new Date(request.acceptedAt.getTime() + copy.SWAP_EXPIRY_MS), PLATFORM_TIME_ZONE);
  return endOfLocalDay(day, PLATFORM_TIME_ZONE);
}

/** Which reminder is due right now: the 24h one inside the last day, else the 72h one inside the last three days. */
export function dueSwapReminder(deadline: Date, now: Date): 72 | 24 | null {
  const left = deadline.getTime() - now.getTime();
  if (left <= 0) return null;
  if (left <= SWAP_REMINDER_24H_MS) return 24;
  if (left <= SWAP_REMINDER_72H_MS) return 72;
  return null;
}

export async function runSwapExpirySweep(deps: SwapExpiryDeps, options: SwapExpirySweepOptions = {}): Promise<SwapExpirySweepResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  const expireDryRun = dryRun || options.expireDryRun === true;
  const remindersEnabled = options.reminders !== false;
  const oldestDeadlineMs = options.maxCutoffAgeMs === undefined ? null : now.getTime() - options.maxCutoffAgeMs;
  const result: SwapExpirySweepResult = { expiredCount: 0, remindedCount: 0, failedCount: 0, candidates: [] };

  const rows = await db
    .select()
    .from(itemRequests)
    .innerJoin(items, eq(items.id, itemRequests.itemId))
    .where(
      and(
        eq(itemRequests.requestType, "SWAP"),
        eq(itemRequests.status, "ACCEPTED"),
        ...(options.onlyRequestIds ? [inArray(itemRequests.id, options.onlyRequestIds)] : []),
      ),
    );

  for (const row of rows) {
    const request = row.item_requests;
    const deadline = swapExpiryDeadline(request);
    if (!deadline) continue;

    if (now.getTime() > deadline.getTime()) {
      if (oldestDeadlineMs !== null && deadline.getTime() < oldestDeadlineMs) continue;
      result.candidates.push({ requestId: request.id, action: "expire", itemName: row.items.name, cutoff: deadline });
      if (expireDryRun) continue;
      try {
        if (await expireSwap(request.id, row.items, deadline, deps, now)) result.expiredCount++;
      } catch (error) {
        result.failedCount++;
        console.error(`[swap-expiry] could not expire swap ${request.id}:`, error);
      }
      continue;
    }

    if (!remindersEnabled) continue;
    const level = dueSwapReminder(deadline, now);
    if (!level) continue;
    result.candidates.push({ requestId: request.id, action: "remind", itemName: row.items.name, cutoff: deadline });
    if (dryRun) continue;
    try {
      if (await sendSwapReminder(request, row.items, level, deps)) result.remindedCount++;
    } catch (error) {
      result.failedCount++;
      console.error(`[swap-expiry] could not remind about swap ${request.id}:`, error);
    }
  }
  return result;
}

async function expireSwap(
  requestId: number,
  item: { id: number; name: string; ownerId: number | null },
  deadline: Date,
  deps: SwapExpiryDeps,
  now: Date,
): Promise<boolean> {
  const done = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(itemRequests)
      .set({ status: copy.REQUEST_EXPIRED_STATUS, expiredAt: now, expiredReason: copy.SWAP_EXPIRED_REASON, handoffPin: null })
      .where(and(eq(itemRequests.id, requestId), eq(itemRequests.status, "ACCEPTED"), eq(itemRequests.requestType, "SWAP")))
      .returning({ requesterId: itemRequests.requesterId });
    if (!claimed) return null;

    const ownerId = item.ownerId!;
    const requesterId = claimed.requesterId!;
    await tx.insert(messages).values({
      content: copy.swapExpiredChat(deadline),
      senderId: ownerId,
      receiverId: requesterId,
      messageType: "system",
      requestId,
    });
    const notice = copy.swapExpiredNotice(item.name, deadline);
    await tx.insert(notifications).values(
      [requesterId, ownerId].map((userId) => ({
        userId,
        type: copy.REQUEST_EXPIRED_NOTIFICATION_TYPE,
        title: notice.title,
        message: notice.message,
        itemId: item.id,
        requestId,
      })),
    );
    return { notice, recipients: [requesterId, ownerId] };
  });
  if (!done) return false;

  if (deps.push) {
    const data = { screen: "chat", requestId, itemId: item.id };
    for (const userId of done.recipients) {
      await Promise.resolve(deps.push(userId, { title: done.notice.title, body: done.notice.message, data })).catch(() => {});
    }
  }
  return true;
}

async function sendSwapReminder(
  request: { id: number; requesterId: number | null },
  item: { id: number; name: string; ownerId: number | null },
  level: 72 | 24,
  deps: SwapExpiryDeps,
): Promise<boolean> {
  const type = level === 72 ? copy.SWAP_EXPIRY_REMINDER_TYPE_72H : copy.SWAP_EXPIRY_REMINDER_TYPE_24H;
  const recipients = [request.requesterId, item.ownerId].filter((id): id is number => typeof id === "number");
  // Each person is told the other's name ("Arrange meet up with Tina L.").
  const people = recipients.length
    ? await db.select({ id: users.id, displayName: users.displayName, username: users.username }).from(users).where(inArray(users.id, recipients))
    : [];
  const nameOf = (id: number) => {
    const person = people.find((p) => p.id === id);
    return person?.displayName || person?.username || null;
  };
  const noticeFor = (userId: number) => {
    const otherId = userId === request.requesterId ? item.ownerId : request.requesterId;
    return copy.swapExpiryReminder(item.name, level, otherId === null ? null : nameOf(otherId));
  };

  const sent = await db.transaction(async (tx) => {
    // One reminder of each kind per swap, even with two sweeps running at once.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`swap-expiry-reminder:${request.id}`}))`);
    const [existing] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.requestId, request.id), eq(notifications.type, type)))
      .limit(1);
    if (existing) return false;
    await tx.insert(notifications).values(
      recipients.map((userId) => ({ userId, type, title: noticeFor(userId).title, message: noticeFor(userId).message, itemId: item.id, requestId: request.id })),
    );
    return true;
  });

  if (sent && deps.push) {
    for (const userId of recipients) {
      const notice = noticeFor(userId);
      await Promise.resolve(
        deps.push(userId, { title: notice.title, body: notice.message, data: { screen: "chat", requestId: request.id, itemId: item.id } }),
      ).catch(() => {});
    }
  }
  return sent;
}
