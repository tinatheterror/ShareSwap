import { and, desc, eq, notInArray } from "drizzle-orm";
import { db, messages, requestLifecycleEvents } from "@workspace/db";

/**
 * Cancelling an accepted swap normally costs the person who cancels a trust-score penalty (after the first-offence
 * grace pass). Walking away from someone who has gone quiet should not: if the other person has not written
 * anything on the request for this long (counted from when the swap was accepted if they never did), no penalty applies.
 */
export const SWAP_PARTNER_SILENCE_MS = 72 * 3_600_000;

/** The other person's last real message on the request (system and event lines are not a reply). */
async function lastMessageFrom(requestId: number, senderId: number): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.requestId, requestId), eq(messages.senderId, senderId), notInArray(messages.messageType, ["system", "event"])))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

/** When the other person last responded: their latest message, or the acceptance if they never wrote. */
export async function partnerLastResponse(
  request: { id: number; acceptedAt: Date | null },
  partnerId: number,
): Promise<Date | null> {
  const lastMessage = await lastMessageFrom(request.id, partnerId);
  const times = [lastMessage, request.acceptedAt].filter((t): t is Date => t instanceof Date);
  return times.length ? new Date(Math.max(...times.map((t) => t.getTime()))) : null;
}

/** True when the other person has been silent for SWAP_PARTNER_SILENCE_MS or more. */
export async function swapPartnerIsUnresponsive(
  request: { id: number; acceptedAt: Date | null },
  partnerId: number | null,
  now: Date = new Date(),
): Promise<boolean> {
  if (partnerId === null) return false;
  const last = await partnerLastResponse(request, partnerId);
  return last !== null && now.getTime() - last.getTime() >= SWAP_PARTNER_SILENCE_MS;
}

// ── No-show reports on an accepted swap ───────────────────────────────────────

export const SWAP_NO_SHOW_EVENT = "swap_no_show_reported";
/** One report per swap: whoever reports first settles it, so two people cannot penalise each other. */
export const swapNoShowKey = (requestId: number) => `swap-no-show:${requestId}`;

/**
 * When a no-show may first be reported against this person: 72 hours after they last responded (their last
 * message, else the acceptance). Null when the swap has no acceptance time to count from.
 */
export async function swapNoShowEligibleAt(
  request: { id: number; acceptedAt: Date | null },
  reportedUserId: number,
): Promise<Date | null> {
  const last = await partnerLastResponse(request, reportedUserId);
  return last ? new Date(last.getTime() + SWAP_PARTNER_SILENCE_MS) : null;
}

/** True when a no-show was already reported against this person on the swap (cancelling is then free). */
export async function noShowReportedAgainst(requestId: number, userId: number | null): Promise<boolean> {
  if (userId === null) return false;
  const [event] = await db
    .select({ details: requestLifecycleEvents.details })
    .from(requestLifecycleEvents)
    .where(and(eq(requestLifecycleEvents.requestId, requestId), eq(requestLifecycleEvents.eventType, SWAP_NO_SHOW_EVENT)))
    .limit(1);
  return (event?.details as { reportedUserId?: number } | null)?.reportedUserId === userId;
}
