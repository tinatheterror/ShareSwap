import { PLATFORM_TIME_ZONE, formatHandoffCutoff, formatHandoffCutoffSentence } from "./request-dates";
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

export const HANDOFF_CODE_WARNING_NOTIFICATION_TYPE = "handoff_code_warning";
/** The owner is warned this long before the handoff cutoff, when the code has not been entered. */
export const HANDOFF_CODE_WARNING_LEAD_MS = 24 * 3_600_000;

/** To the owner only: "[name] hasn't entered the handoff code. If you've handed it over, report a problem before [date, time]." */
export function handoffCodeWarning(requesterName: string, cutoff: Date) {
  return {
    title: "Handoff code not entered",
    message: `${requesterName} hasn't entered the handoff code. If you've handed it over, report a problem before ${formatHandoffCutoff(cutoff)}.`,
  };
}

/** Sent to both people a few hours before the cutoff, while nobody has confirmed a handoff. */
export function handoffReminder(itemName: string, cutoff: Date) {
  return {
    title: `Hand off soon: ${reminderItemName(itemName)}`,
    message: `Handed off? Confirm by ${formatHandoffCutoff(cutoff)} or it expires.`,
  };
}

// ── Swaps and gifts ───────────────────────────────────────────────────────────
// A swap or a gift has no dates, no deposit and no handoff window, so it expires at the end of the 7th calendar day after
// the owner accepted it. Nobody is penalised: the app cannot tell which person did not show up.

export type ExchangeType = "SWAP" | "GIFT";

export const EXCHANGE_EXPIRY_DAYS = 7;
export const EXCHANGE_EXPIRY_MS = EXCHANGE_EXPIRY_DAYS * 24 * 3_600_000;
/** Why an EXPIRED swap or gift expired (requests.expired_reason), which is also how expired swaps and gifts are counted. */
export const EXCHANGE_EXPIRED_REASON: Record<ExchangeType, string> = { SWAP: "swap_no_handoff", GIFT: "gift_no_handoff" };

/** The notification type of a reminder: swap_expiry_reminder_72h, gift_expiry_reminder_24h, ... */
export const exchangeReminderType = (type: ExchangeType, hoursLeft: 72 | 24) => `${type.toLowerCase()}_expiry_reminder_${hoursLeft}h`;

const label = (type: ExchangeType) => (type === "GIFT" ? "Gift" : "Swap");

/** "Oct 8": an exchange expires at the end of this calendar day (platform zone), so no time of day is shown. */
export function formatSwapDeadlineDay(deadline: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: PLATFORM_TIME_ZONE, month: "short", day: "numeric" }).format(deadline);
}

export function exchangeExpiredChat(type: ExchangeType): string {
  return type === "GIFT" ? "⏰ Gift expired — the handoff was not confirmed" : "⏰ Swap expired — the exchange was not confirmed";
}

// Notification bodies are shortened to 54 characters when shown (notification-copy.ts), so they are kept short.
export function exchangeExpiredNotice(type: ExchangeType, itemName: string) {
  return {
    title: `${label(type)} expired: ${reminderItemName(itemName)}`,
    message: "Not confirmed in time.",
  };
}

/** `hoursLeft` is 72 or 24; `otherName` is the person they are meeting (each person is told the other's name). */
export function exchangeExpiryReminder(type: ExchangeType, itemName: string, hoursLeft: 72 | 24, otherName?: string | null) {
  return {
    title: `${label(type)} expires in ${hoursLeft === 72 ? "3 days" : "24 hours"}: ${reminderItemName(itemName)}`,
    message: `Arrange meet up with ${otherName?.trim() || "your neighbour"}`,
  };
}
