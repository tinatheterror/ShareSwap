import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db, itemRequests, items, notifications, requestLifecycleEvents } from "@workspace/db";
import { sendPushToUser } from "./push-notifications";

/**
 * Reminds the borrower, before an auto-confirm, that the owner says the item was handed over and that the handoff will be
 * confirmed for them when the deadline passes. Two reminders: 12 hours and 2 hours before the deadline. Each is sent
 * once per deadline: the lifecycle event's idempotency key (reminder, request, deadline) is what claims it, so the route,
 * the server timer and several instances can all call this. A reminder that is already late for the 12 hour mark when the
 * sweep first sees the request (it is under 2 hours away) sends only the 2 hour one.
 */
export const HANDOFF_REMINDER_HOURS = [12, 2] as const;
const HOUR_MS = 3_600_000;

export const handoffReminderKey = (hours: number, requestId: number, deadline: Date) => `handoff-reminder-${hours}h-${requestId}-${deadline.getTime()}`;

export interface HandoffReminderOptions {
  requestTypes?: readonly string[];
  onlyRequestIds?: number[];
}

/** Returns how many reminders were sent. Never throws: a failed reminder must not stop the sweep. */
export async function sendBorrowerHandoffReminders(now: Date = new Date(), options: HandoffReminderOptions = {}): Promise<number> {
  try {
    const horizon = new Date(now.getTime() + HANDOFF_REMINDER_HOURS[0] * HOUR_MS);
    const due = await db
      .select({
        id: itemRequests.id, borrowerId: itemRequests.requesterId, deadline: itemRequests.handoffConfirmDeadline,
        itemId: items.id, itemName: items.name,
      })
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(and(
        eq(itemRequests.status, "AWAITING_HANDOFF_CONFIRM"),
        eq(itemRequests.ownerConfirmedHandoff, true),
        sql`COALESCE(${itemRequests.borrowerConfirmedHandoff}, false) = false`,
        sql`COALESCE(${itemRequests.borrowerDeniedHandoff}, false) = false`,
        gt(itemRequests.handoffConfirmDeadline, now),
        lte(itemRequests.handoffConfirmDeadline, horizon),
        ...(options.requestTypes ? [inArray(itemRequests.requestType, [...options.requestTypes])] : []),
        ...(options.onlyRequestIds ? [inArray(itemRequests.id, options.onlyRequestIds)] : []),
      ));

    let sent = 0;
    for (const request of due) {
      const deadline = request.deadline!;
      if (request.borrowerId === null) continue;
      const hoursLeft = (deadline.getTime() - now.getTime()) / HOUR_MS;
      const step = hoursLeft <= HANDOFF_REMINDER_HOURS[1] ? HANDOFF_REMINDER_HOURS[1] : HANDOFF_REMINDER_HOURS[0];
      if (step === HANDOFF_REMINDER_HOURS[1]) {
        // Late for the 12 hour mark: claim it without sending, so it never goes out after the 2 hour one.
        await db.insert(requestLifecycleEvents).values({
          requestId: request.id, eventType: "HANDOFF_REMINDER_SKIPPED", idempotencyKey: handoffReminderKey(HANDOFF_REMINDER_HOURS[0], request.id, deadline),
          details: { hours: HANDOFF_REMINDER_HOURS[0] },
        }).onConflictDoNothing();
      }
      const claimed = await db.insert(requestLifecycleEvents).values({
        requestId: request.id, eventType: "HANDOFF_REMINDER_SENT", idempotencyKey: handoffReminderKey(step, request.id, deadline),
        details: { hours: step, deadline: deadline.toISOString() },
      }).onConflictDoNothing().returning({ id: requestLifecycleEvents.id });
      if (claimed.length === 0) continue;

      const name = request.itemName.length > 30 ? `${request.itemName.slice(0, 30)}…` : request.itemName;
      const title = step === HANDOFF_REMINDER_HOURS[1] ? "Last chance: confirm you received it" : "Did you receive your item?";
      const message = `The owner says "${name}" was handed over to you. Confirm it, or report a problem, within ${step} hours. If you do nothing, it will be confirmed for you.`;
      await db.insert(notifications).values({
        userId: request.borrowerId, type: "handoff_reminder", title, message, itemId: request.itemId, requestId: request.id, isRead: false,
      } as any);
      await sendPushToUser(request.borrowerId, { title, body: message, data: { requestId: request.id, type: "handoff_reminder" } }, "requests");
      sent++;
    }
    return sent;
  } catch (error) {
    console.error("[handoff-reminders] could not send reminders:", error);
    return 0;
  }
}
