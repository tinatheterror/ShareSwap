// Every retention period and threshold the account-deletion flow uses, in one place.

/** How long a record the books or a dispute may need is kept after the account is deleted. */
export const RETENTION_YEARS = {
  /** Payments, payouts, refunds, commissions, subscriptions and the bookings they belong to. */
  financial: 7,
  /** Security claims and the deposit settlements that came from them. */
  claim: 7,
  /** Evidence of abuse between two accounts. */
  abuseSignal: 2,
} as const;

export type RetentionWindow = keyof typeof RETENTION_YEARS;

/** How long a requested deletion waits before the finalize job deletes the account. The person can cancel until then. */
export const DELETION_GRACE_DAYS = 14;

/** What the people who saw the deleted account now see in its place. */
export const DELETED_DISPLAY_NAME = "Former member";
export const REMOVED_MESSAGE_TEXT = "[Message removed]";

/**
 * The block on a banned person signing up again. Only accounts that were banned leave anything behind: a keyed
 * hash of the email (never the address), kept without an end date. The key is an environment secret, so the
 * hash cannot be rebuilt from a list of emails by anyone who only has the database.
 */
export const BANNED_EMAIL_BLOCK = {
  algorithm: "HMAC-SHA256",
  keyEnvVar: "BANNED_EMAIL_HASH_KEY",
  retentionYears: null,
} as const;

/**
 * Wallet limits for deleting an account (CAD, in dollars). The platform pays out from $10 (MIN_PAYOUT in
 * rental-payout-service.ts), so what deletion does with the available balance depends on its size:
 *  - $10 or more: it must be withdrawn first, deletion is blocked until then;
 *  - $1 up to $10: it is offered as a withdrawal with the minimum waived; declining forfeits it;
 *  - under $1: it is forfeited, and the person acknowledges that before deleting.
 * Any amount held in escrow, or any payout still in flight, blocks deletion until it settles.
 */
export const WALLET_LIMITS = {
  availableBlocksAtOrAbove: 10,
  withdrawalOfferFrom: 1,
  pendingBlocksAbove: 0,
} as const;

export type WalletTier = "none" | "forfeit" | "offer_withdrawal" | "blocks";

export function walletTier(availableCents: number): WalletTier {
  if (availableCents >= WALLET_LIMITS.availableBlocksAtOrAbove * 100) return "blocks";
  if (availableCents >= WALLET_LIMITS.withdrawalOfferFrom * 100) return "offer_withdrawal";
  return availableCents > 0 ? "forfeit" : "none";
}

/**
 * The minimum payout is waived only for taking the whole of a balance in the offer band, so it cannot be
 * used to pull small slices out of a wallet that is not being closed.
 */
export const minimumWaiverApplies = (requestedCents: number, availableCents: number) =>
  walletTier(availableCents) === "offer_withdrawal" && requestedCents === availableCents;

/** Request statuses that end a booking. Anything else, including a status added later, blocks deletion. */
export const TERMINAL_REQUEST_STATUSES = ["COMPLETED", "COMPLETED_EARLY", "CANCELLED", "DECLINED", "REJECTED", "EXPIRED", "DEPOSIT_FAILED"] as const;

/** Statuses of a request that no money or item has moved for, which deletion may cancel by itself. */
export const AUTO_RESOLVABLE_REQUEST_STATUSES = ["PENDING", "ACCEPTED"] as const;

/** Security-claim statuses that are final. Any other status counts as an open claim. */
export const TERMINAL_CLAIM_STATUSES = ["SETTLED", "REJECTED", "CLOSED", "WITHDRAWN"] as const;

/** Deposit settlement operations that are still moving money. */
export const IN_FLIGHT_SETTLEMENT_STATUSES = ["PROCESSING", "INDETERMINATE", "MANUAL_REVIEW"] as const;

/** Wallet withdrawals and escrow rows whose money has not settled either way. */
export const UNSETTLED_PAYOUT_STATUSES = ["held", "pending_payout", "manual_review"] as const;
