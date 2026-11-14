import { and, desc, eq, notInArray } from "drizzle-orm";
import { db, messages } from "@workspace/db";

/**
 * A silent no-show on an accepted swap: the other person has not written anything on the request for this long
 * (counted from when the swap was accepted if they never did). Only then can they be reported, and only the person
 * who did not show is penalised. Cancelling a swap is never penalised: it tells the other person you are not coming.
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
