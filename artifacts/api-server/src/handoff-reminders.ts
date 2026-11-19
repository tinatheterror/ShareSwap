import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db, itemRequests, items, notifications, requestLifecycleEvents, users } from "@workspace/db";
import { sendPushToUser } from "./push-notifications";
import { isConfirmNoticeType, silentPersonReminder } from "./handoff-confirm-copy";
import { publicName } from "./public-identity";
import { envFlagOn } from "./scheduled-job-options";
import { handoff2HourReminderEnabled } from "./handoff-flags";

/**
 * Reminds the person who has not confirmed, before an auto-confirm, that the handoff will be confirmed for them when the
 * deadline passes. For a borrow or rental that is the borrower once the owner has confirmed ("The owner says ... was handed
 * over to you"), or the owner once the borrower has ("The borrower says they received ..."). For a swap or gift it is whichever of the two has not confirmed, once the other has ("[name] confirmed the
 * swap. Confirm, or report a problem, within 12 hours"). Two reminders: 12 hours and 2 hours before the deadline. Each is sent
 * once per deadline: the lifecycle event's idempotency key (reminder, request, deadline) is what claims it, so the route,
 * the server timer and several instances can all call this. A reminder that is already late for the 12 hour mark when the
 * sweep first sees the request (it is under 2 hours away) sends only the 2 hour one.
 *
 * The 12 hour reminder is OFF unless HANDOFF_REMINDER_12H is explicitly on (on, true, 1 or yes): everyone, whichever type
 * of request and whichever side is waiting, then gets only the 2 hour reminder. Nothing is claimed for a 12 hour reminder
 * that is not sent, so switching it on later reminds the requests still waiting. The code for it is intact.
 *
 * The 2 hour reminder is OFF unless HANDOFF_REMINDER_2H is explicitly on, the same way. With both off nobody is reminded.
 */
export const HANDOFF_REMINDER_HOURS = [12, 2] as const;

/** True when the 12 hour reminder is switched on (HANDOFF_REMINDER_12H). Off by default. */
export const handoff12HourReminderEnabled = (env: NodeJS.ProcessEnv = process.env) => envFlagOn(env.HANDOFF_REMINDER_12H);
const HOUR_MS = 3_600_000;

export const handoffReminderKey = (hours: number, requestId: number, deadline: Date) => `handoff-reminder-${hours}h-${requestId}-${deadline.getTime()}`;

export interface HandoffReminderOptions {
  requestTypes?: readonly string[];
  onlyRequestIds?: number[];
  /** The 12 hour reminder; defaults to the HANDOFF_REMINDER_12H switch (off). Tests and callers can say. */
  include12Hour?: boolean;
  /** The 2 hour reminder; defaults to the HANDOFF_REMINDER_2H switch (off). */
  include2Hour?: boolean;
}

/** Returns how many reminders were sent. Never throws: a failed reminder must not stop the sweep. */
export async function sendBorrowerHandoffReminders(now: Date = new Date(), options: HandoffReminderOptions = {}): Promise<number> {
  try {
    const include12Hour = options.include12Hour ?? handoff12HourReminderEnabled();
    const include2Hour = options.include2Hour ?? handoff2HourReminderEnabled();
    if (!include12Hour && !include2Hour) return 0;
    // Without the 12 hour reminder only requests inside the last 2 hours are looked at.
    const horizon = new Date(now.getTime() + HANDOFF_REMINDER_HOURS[include12Hour ? 0 : 1] * HOUR_MS);
    const rows = await db
      .select({
        id: itemRequests.id, requesterId: itemRequests.requesterId, deadline: itemRequests.handoffConfirmDeadline,
        requestType: itemRequests.requestType, ownerId: items.ownerId,
        ownerConfirmed: itemRequests.ownerConfirmedHandoff, borrowerConfirmed: itemRequests.borrowerConfirmedHandoff,
        ownerDenied: itemRequests.ownerDeniedHandoff, borrowerDenied: itemRequests.borrowerDeniedHandoff,
        itemId: items.id, itemName: items.name,
      })
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(and(
        eq(itemRequests.status, "AWAITING_HANDOFF_CONFIRM"),
        gt(itemRequests.handoffConfirmDeadline, now),
        lte(itemRequests.handoffConfirmDeadline, horizon),
        ...(options.requestTypes ? [inArray(itemRequests.requestType, [...options.requestTypes])] : []),
        ...(options.onlyRequestIds ? [inArray(itemRequests.id, options.onlyRequestIds)] : []),
      ));

    // Who is waiting on whom. Someone who confirmed or reported a problem is never reminded.
    const due = rows.flatMap((row) => {
      const ownerConfirmed = row.ownerConfirmed === true;
      const borrowerConfirmed = row.borrowerConfirmed === true;
      const ownerDenied = row.ownerDenied === true;
      const borrowerDenied = row.borrowerDenied === true;
      const exchange = isConfirmNoticeType(row.requestType) ? row.requestType : null;
      if (ownerConfirmed && !borrowerConfirmed && !borrowerDenied && row.requesterId !== null) {
        return [{ ...row, recipientId: row.requesterId, confirmerId: row.ownerId, exchange }];
      }
      // The owner is reminded too when the borrower, renter, swapper or receiver confirmed first.
      if (borrowerConfirmed && !ownerConfirmed && !ownerDenied && row.ownerId !== null) {
        return [{ ...row, recipientId: row.ownerId, confirmerId: row.requesterId, exchange }];
      }
      return [];
    });

    let sent = 0;
    for (const request of due) {
      const deadline = request.deadline!;
      const hoursLeft = (deadline.getTime() - now.getTime()) / HOUR_MS;
      const step = hoursLeft <= HANDOFF_REMINDER_HOURS[1] ? HANDOFF_REMINDER_HOURS[1] : HANDOFF_REMINDER_HOURS[0];
      // Nothing is claimed for a reminder that is switched off, so switching it on later still sends it.
      if (step === HANDOFF_REMINDER_HOURS[1] && !include2Hour) continue;
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

      let title: string;
      let message: string;
      if (request.exchange) {
        const confirmer = request.confirmerId === null
          ? null
          : (await db.select({ displayName: users.displayName, username: users.username }).from(users).where(eq(users.id, request.confirmerId)).limit(1))[0];
        ({ title, message } = silentPersonReminder(request.exchange, publicName(confirmer) || "The other person", step));
      } else if (request.recipientId === request.ownerId) {
        // A borrow or rental the borrower confirmed first: the owner is the one who has not answered.
        const name = request.itemName.length > 30 ? `${request.itemName.slice(0, 30)}…` : request.itemName;
        const who = request.requestType === "RENT" ? "renter" : "borrower";
        title = step === HANDOFF_REMINDER_HOURS[1] ? "Last chance: confirm the handoff" : "Did you hand it over?";
        message = `The ${who} says they received "${name}". Confirm it, or report a problem, within ${step} hours. If you do nothing, it will be confirmed for you.`;
      } else {
        const name = request.itemName.length > 30 ? `${request.itemName.slice(0, 30)}…` : request.itemName;
        title = step === HANDOFF_REMINDER_HOURS[1] ? "Last chance: confirm you received it" : "Did you receive your item?";
        message = `The owner says "${name}" was handed over to you. Confirm it, or report a problem, within ${step} hours. If you do nothing, it will be confirmed for you.`;
      }
      await db.insert(notifications).values({
        userId: request.recipientId, type: "handoff_reminder", title, message, itemId: request.itemId, requestId: request.id, isRead: false,
      } as any);
      await sendPushToUser(request.recipientId, { title, body: message, data: { requestId: request.id, type: "handoff_reminder" } }, "requests");
      sent++;
    }
    return sent;
  } catch (error) {
    console.error("[handoff-reminders] could not send reminders:", error);
    return 0;
  }
}
