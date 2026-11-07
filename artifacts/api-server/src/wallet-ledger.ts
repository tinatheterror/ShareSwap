import { db, walletTransactions } from "@workspace/db";

/**
 * The wallet ledger (wallet_transactions, 0019). users.rental_balance is the cached total of the wallet; every change to it
 * writes one signed row here, in the same transaction. The idempotency key is unique, so the same event cannot be recorded
 * twice: a retry, a reconcile pass and the backfill all use the same key for the same event.
 */
export type WalletKind = "rental_payout" | "claim_award" | "withdrawal" | "withdrawal_reversal" | "currency_conversion" | "rental_payout_freeze" | "rental_payout_unfreeze" | "chargeback" | "chargeback_fee" | "chargeback_reversal" | "debt_payment";

/** A transaction handle or the db itself: anything that can insert. */
type Inserter = Pick<typeof db, "insert">;

export interface WalletEntry {
  userId: number;
  kind: WalletKind;
  /** Signed: positive credits the wallet, negative debits it. */
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  requestId?: number | null;
  claimId?: number | null;
  rentalPayoutId?: number | null;
  createdAt?: Date;
}

export const rentalEarningKey = (rentalPayoutId: number) => `rental-earning-${rentalPayoutId}`;
export const claimAwardKey = (claimId: number) => `claim-award-${claimId}`;
export const withdrawalKey = (rentalPayoutId: number) => `withdrawal-${rentalPayoutId}`;
export const conversionOutKey = (ledgerId: number) => `currency-conversion-out-${ledgerId}`;
export const conversionInKey = (ledgerId: number) => `currency-conversion-in-${ledgerId}`;
export const rentalFreezeKey = (rentalPayoutId: number) => `rental-freeze-${rentalPayoutId}`;
export const rentalUnfreezeKey = (rentalPayoutId: number) => `rental-unfreeze-${rentalPayoutId}`;
export const chargebackKey = (disputeId: string) => `chargeback-${disputeId}`;
export const chargebackFeeKey = (disputeId: string) => `chargeback-fee-${disputeId}`;
export const chargebackReversalKey = (disputeId: string) => `chargeback-reversal-${disputeId}`;
export const debtPaymentKey = (chargebackId: number, sourceKey: string) => `debt-payment-${chargebackId}-${sourceKey}`;
export const withdrawalReversalKey = (rentalPayoutId: number) => `withdrawal-reversal-${rentalPayoutId}`;

export const toCents = (dollars: string | number | null | undefined) => Math.round(Number(dollars ?? 0) * 100);

/** Records the entry; returns false when that event was already recorded (nothing is written then). */
export async function recordWalletEntry(executor: Inserter, entry: WalletEntry): Promise<boolean> {
  const inserted = await executor.insert(walletTransactions).values({
    userId: entry.userId,
    kind: entry.kind,
    amountCents: entry.amountCents,
    currency: entry.currency,
    requestId: entry.requestId ?? null,
    claimId: entry.claimId ?? null,
    rentalPayoutId: entry.rentalPayoutId ?? null,
    idempotencyKey: entry.idempotencyKey,
    ...(entry.createdAt ? { createdAt: entry.createdAt } : {}),
  }).onConflictDoNothing({ target: walletTransactions.idempotencyKey }).returning({ id: walletTransactions.id });
  return inserted.length > 0;
}
