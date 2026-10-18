import { formatMoney } from "./deposit-copy";

// The sentence the apps show after a BORROW/RENT cancel succeeds. The server writes it, so web and
// mobile say exactly the same thing, and it describes only what actually happened.

/** Where the deposit stood when the cancel went through. */
export type CancelDepositState = "none" | "in_person" | "unpaid" | "authorized" | "charged";

export interface CancelMessageInput {
  /** Who cancelled. The owner's message describes the borrower's money. */
  role: "requester" | "owner";
  depositState: CancelDepositState;
  depositAmount: number | null;
  /** Dollars Stripe reported refunding; null when none was refunded or the amount is unknown. */
  platformFeeRefunded: number | null;
  rentalRefunded: number | null;
  /** True when a refund of that kind happened even though the amount is not known. */
  platformFeeRefundedUnknownAmount?: boolean;
  rentalRefundedUnknownAmount?: boolean;
  /** Points actually taken off the score; 0 or undefined when none. */
  penaltyPoints: number;
}

export const REQUEST_ALREADY_CANCELLED_MESSAGE = "This request was already cancelled.";
export const CANCEL_REFUND_TIMING = "Refunds can take 5–10 days to appear on your statement.";

export function penaltyAckRequiredError(points: number) {
  return `Cancelling will result in a −${points} Trust Score penalty.`;
}

export function composeCancelMessage(input: CancelMessageInput): string {
  const owner = input.role === "owner";
  const who = owner ? "The borrower's" : "Your";
  const parts: string[] = ["Request cancelled."];
  const amount = (value: number | null) => (value === null ? "" : `${formatMoney(value)} `);
  let cardRefund = false;

  switch (input.depositState) {
    case "authorized":
      parts.push(
        owner
          ? `${who} ${amount(input.depositAmount)}deposit hold was released.`
          : `${who} ${amount(input.depositAmount)}deposit hold was released. You were not charged.`,
      );
      break;
    case "charged":
      parts.push(`${who} ${amount(input.depositAmount)}refundable deposit was refunded to ${owner ? "their" : "your"} card.`);
      cardRefund = true;
      break;
    case "in_person":
      parts.push("No payment was involved.");
      break;
    case "unpaid":
      parts.push("Nothing was charged.");
      break;
    case "none":
      break;
  }

  const platformFee = input.platformFeeRefunded !== null || input.platformFeeRefundedUnknownAmount;
  const rental = input.rentalRefunded !== null || input.rentalRefundedUnknownAmount;
  if (rental) {
    parts.push(`${who} ${amount(input.rentalRefunded)}rental payment was refunded.`);
    cardRefund = true;
  }
  if (platformFee) {
    parts.push(`${who} ${amount(input.platformFeeRefunded)}platform fee was refunded.`);
    cardRefund = true;
  }
  if (cardRefund && !owner) parts.push(CANCEL_REFUND_TIMING);
  if (input.penaltyPoints > 0) parts.push(`A trust score penalty of -${input.penaltyPoints} was applied.`);
  return parts.join(" ");
}
