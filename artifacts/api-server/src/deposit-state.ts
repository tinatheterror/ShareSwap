import type { itemRequests } from "@workspace/db";
import type { CancelDepositState } from "./cancel-copy";

// Where a request's deposit stands, read from its own deposit fields and never from its status.
// Cancel uses it for the penalty rule and the record; expiry uses it for expired_reason.

type DepositFields = Pick<
  typeof itemRequests.$inferSelect,
  "status" | "depositMethod" | "depositPaymentIntentId" | "depositStatus" | "depositMode"
>;

const LIVE_DEPOSIT_STATUSES = ["authorized", "held"];

export function classifyDepositState(request: DepositFields): CancelDepositState {
  if (request.depositMethod === "in_person") return "in_person";
  if (request.depositPaymentIntentId && LIVE_DEPOSIT_STATUSES.includes(request.depositStatus ?? "")) {
    return request.depositMode === "refundable_charge" ? "charged" : "authorized";
  }
  return request.status === "PENDING" ? "none" : "unpaid";
}

/** True once an in-app deposit is authorized, or a refundable charge was paid. */
export function depositWasPlaced(depositState: CancelDepositState): boolean {
  return depositState === "authorized" || depositState === "charged";
}

/** The flat cancellation penalty applies exactly when a deposit was placed. */
export const cancelPenaltyApplies = depositWasPlaced;

export const EXPIRED_NO_DEPOSIT = "no_handoff_no_deposit";
export const EXPIRED_DEPOSIT_PAID = "no_handoff_deposit_paid";

/** Why a request expired: nobody handed off, and whether a deposit was already paid (for a future no-show report). */
export function expiredReasonFor(depositState: CancelDepositState): string {
  return depositWasPlaced(depositState) ? EXPIRED_DEPOSIT_PAID : EXPIRED_NO_DEPOSIT;
}
