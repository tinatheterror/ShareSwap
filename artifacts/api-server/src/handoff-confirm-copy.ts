// What the person who has not yet confirmed is told when the other person confirms a swap or a gift. If they do
// nothing for HANDOFF_CONFIRM_WINDOW_HOURS the handoff sweep confirms it for them (handoff-deadline-service.ts).

export const HANDOFF_CONFIRM_WINDOW_HOURS = 24;

/**
 * After the sweep auto-confirms a borrow or rental, either person may still open a dispute for this long. A borrow's
 * ShareCoins stay held for the whole window and are settled when it closes (settleElapsedAutoConfirmedBorrows).
 */
export const AUTO_CONFIRM_DISPUTE_WINDOW_HOURS = 24;
export const DISPUTE_WINDOW_CLOSED_CODE = "DISPUTE_WINDOW_CLOSED";
export const DISPUTE_WINDOW_CLOSED_MESSAGE = `This exchange was confirmed automatically more than ${AUTO_CONFIRM_DISPUTE_WINDOW_HOURS} hours ago, so it can no longer be disputed.`;

export type ConfirmNoticeType = "SWAP" | "GIFT";

export const SILENT_PERSON_NOTICE_TITLE: Record<ConfirmNoticeType, string> = {
  SWAP: "Swap confirmed by the other person",
  GIFT: "Gift confirmed by the other person",
};

/** "[name] confirmed the [swap/gift]. Confirm, or report a problem within 24 hours." */
export function silentPersonNotice(type: ConfirmNoticeType, confirmerName: string): string {
  return `${confirmerName} confirmed the ${type === "SWAP" ? "swap" : "gift"}. Confirm, or report a problem within ${HANDOFF_CONFIRM_WINDOW_HOURS} hours.`;
}

export const isConfirmNoticeType = (type: string | null | undefined): type is ConfirmNoticeType => type === "SWAP" || type === "GIFT";

/**
 * The 12 hour and 2 hour reminders to whoever has not yet confirmed a swap or gift the other person confirmed. Borrows
 * and rentals keep their own wording (handoff-reminders.ts).
 */
export function silentPersonReminder(type: ConfirmNoticeType, confirmerName: string, hours: number): { title: string; message: string } {
  const word = type === "SWAP" ? "swap" : "gift";
  return {
    title: hours <= 2 ? `Last chance: confirm the ${word}` : `Confirm the ${word}`,
    message: `${confirmerName} confirmed the ${word}. Confirm, or report a problem, within ${hours} hours. If you do nothing, it will be confirmed for you.`,
  };
}
