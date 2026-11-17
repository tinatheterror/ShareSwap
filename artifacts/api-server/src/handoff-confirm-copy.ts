// What the person who has not yet confirmed is told when the other person confirms a swap or a gift. If they do
// nothing for HANDOFF_CONFIRM_WINDOW_HOURS the handoff sweep confirms it for them (handoff-deadline-service.ts).

export const HANDOFF_CONFIRM_WINDOW_HOURS = 24;

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
