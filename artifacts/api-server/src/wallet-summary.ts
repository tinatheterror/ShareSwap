import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db, users, walletChargebacks, walletTransactions } from "@workspace/db";
import { PLATFORM_CURRENCY } from "@workspace/db";
import type { WalletKind } from "./wallet-ledger";

/** What `GET /api/wallet` returns: the balance, what is pending, what is owed, and a page of the wallet history. */
export const WALLET_KIND_LABELS: Record<WalletKind, string> = {
  rental_payout: "Rental earnings",
  claim_award: "Claim award",
  withdrawal: "Withdrawal",
  withdrawal_reversal: "Withdrawal returned",
  chargeback: "Chargeback",
  chargeback_fee: "Chargeback fee",
  chargeback_reversal: "Chargeback returned",
  debt_payment: "Chargeback repayment",
  currency_conversion: "Currency conversion",
  rental_payout_freeze: "Earnings on hold",
  rental_payout_unfreeze: "Earnings released",
  adjustment: "Adjustment",
};

export const labelForKind = (kind: string) => WALLET_KIND_LABELS[kind as WalletKind] ?? "Wallet activity";

const cents = (value: string | number | null | undefined) => Math.round(Number(value ?? 0) * 100);
const dollars = (amountCents: number) => (amountCents / 100).toFixed(2);

export const WALLET_PAGE_DEFAULT = 20;
export const WALLET_PAGE_MAX = 100;

export function parsePageLimit(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, WALLET_PAGE_MAX) : WALLET_PAGE_DEFAULT;
}

export function parseCursor(raw: unknown): number | null {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface WalletTransactionView {
  id: number;
  kind: string;
  label: string;
  /** Signed, in dollars, e.g. "-20.00". */
  amount: string;
  currency: string;
  requestId: number | null;
  createdAt: string;
}

export interface WalletSummary {
  currency: string;
  balance: { available: string; pending: string; debt: string; total: string };
  transactions: WalletTransactionView[];
  /** Pass as `cursor` to get the next page; null when this was the last. */
  nextCursor: number | null;
}

export async function getWalletSummary(userId: number, options: { limit?: number; cursor?: number | null } = {}): Promise<WalletSummary> {
  const limit = options.limit ?? WALLET_PAGE_DEFAULT;
  const [user] = await db.select({ available: users.rentalBalance, pending: users.pendingRentalBalance }).from(users).where(eq(users.id, userId)).limit(1);
  const debts = await db.select().from(walletChargebacks).where(and(eq(walletChargebacks.userId, userId), inArray(walletChargebacks.status, ["open", "lost"])));
  const debtCents = debts.reduce((total, d) => total + Math.max(0, d.principalCents + d.feeCents - d.collectedCents), 0);
  const rows = await db.select().from(walletTransactions)
    .where(options.cursor ? and(eq(walletTransactions.userId, userId), lt(walletTransactions.id, options.cursor)) : eq(walletTransactions.userId, userId))
    .orderBy(desc(walletTransactions.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const availableCents = cents(user?.available);
  const pendingCents = cents(user?.pending);
  return {
    currency: PLATFORM_CURRENCY,
    balance: { available: dollars(availableCents), pending: dollars(pendingCents), debt: dollars(debtCents), total: dollars(availableCents + pendingCents) },
    transactions: page.map(row => ({
      id: row.id, kind: row.kind, label: labelForKind(row.kind), amount: dollars(row.amountCents), currency: row.currency,
      requestId: row.requestId, createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  };
}
