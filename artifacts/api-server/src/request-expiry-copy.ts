import { formatHandoffCutoff, formatHandoffCutoffSentence } from "./request-dates";
import { shortItemName } from "./deposit-copy";

/**
 * Every server-generated sentence about a request expiring. "Expired" means
 * nobody handed the item off before the cutoff; it is never worded as a
 * cancellation or a decline.
 */

export const REQUEST_EXPIRED_STATUS = "EXPIRED";
export const REQUEST_EXPIRED_CODE = "REQUEST_EXPIRED";
export const REQUEST_EXPIRED_NOTIFICATION_TYPE = "request_expired";
export const HANDOFF_REMINDER_NOTIFICATION_TYPE = "handoff_deadline_reminder";

/** Shown instead of a generic "invalid code" when someone tries to redeem a dead handoff code. */
export function requestExpiredError(cutoff: Date | null): string {
  return cutoff
    ? `This request expired ${formatHandoffCutoffSentence(cutoff)}.`
    : "This request has expired.";
}

/** The deadline as shown on a live request: "Hand off by Oct 4, 11:59 PM". */
export function handoffDeadlineLabel(cutoff: Date): string {
  return `Hand off by ${formatHandoffCutoff(cutoff)}`;
}

export function expiredChat(cutoff: Date): string {
  return `⏰ Request expired — no handoff happened by ${formatHandoffCutoff(cutoff)}.`;
}

export interface ExpiredNoticeFlags {
  /** A deposit hold was cancelled or a refundable deposit refunded. */
  depositReleased: boolean;
  /** A rental fee charged up front was refunded in full. */
  feeRefunded: boolean;
}

export function expiredBorrowerNotice(itemName: string, cutoff: Date, flags: ExpiredNoticeFlags) {
  const parts = [`Your request for ${shortItemName(itemName, 22)} expired — no handoff happened by ${formatHandoffCutoff(cutoff)}.`];
  if (flags.depositReleased) parts.push("Your deposit hold has been released.");
  if (flags.feeRefunded) parts.push("Your rental fee has been refunded in full.");
  return { title: "Request Expired", message: parts.join(" ") };
}

export function expiredOwnerNotice(itemName: string, cutoff: Date) {
  return {
    title: "Request Expired",
    message: `The request for ${shortItemName(itemName, 22)} expired — no handoff happened by ${formatHandoffCutoff(cutoff)}. Your item is available again.`,
  };
}

/**
 * The item name in the reminder title is cut at a word boundary, never with an ellipsis (an
 * ellipsis followed by punctuation reads as a typo). The body is fixed text plus the deadline
 * so notification-copy's 54-character cap can never cut the deadline off.
 */
const REMINDER_NAME_LIMIT = 40;

function reminderItemName(name: string | null | undefined): string {
  const clean = (name || "your item").trim().replace(/\s+/g, " ");
  if (clean.length <= REMINDER_NAME_LIMIT) return clean;
  const slice = clean.slice(0, REMINDER_NAME_LIMIT + 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace >= 12 ? slice.slice(0, lastSpace) : clean.slice(0, REMINDER_NAME_LIMIT);
  return cut.replace(/[\s,;:—–-]+$/g, "");
}

/** Sent to both people a few hours before the cutoff, while nobody has confirmed a handoff. */
export function handoffReminder(itemName: string, cutoff: Date) {
  return {
    title: `Hand off soon: ${reminderItemName(itemName)}`,
    message: `Handed off? Confirm by ${formatHandoffCutoff(cutoff)} or it expires.`,
  };
}
