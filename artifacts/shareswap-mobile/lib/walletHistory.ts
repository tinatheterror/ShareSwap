/** Wallet history as `GET /api/wallet` returns it (the server writes the labels). */
export interface WalletTransactionRow {
  id: number;
  kind: string;
  /** Rental earnings, Claim award, Withdrawal, Chargeback, Currency conversion, ... */
  label: string;
  /** Signed dollars, e.g. "-20.00". */
  amount: string;
  currency: string;
  createdAt: string;
}

export interface WalletPage {
  currency: string;
  balance: { available: string; pending: string; debt: string; total: string };
  transactions: WalletTransactionRow[];
  nextCursor: number | null;
}

/** "+$30.00" / "-$20.00", with the currency when it is not the wallet's own (an old USD credit). */
export function formatWalletAmount(row: Pick<WalletTransactionRow, "amount" | "currency">, walletCurrency: string): string {
  const value = Number(row.amount);
  const sign = value < 0 ? "-" : "+";
  const suffix = row.currency.toLowerCase() === walletCurrency.toLowerCase() ? "" : ` ${row.currency.toUpperCase()}`;
  return `${sign}$${Math.abs(value).toFixed(2)}${suffix}`;
}

/** The debt line, or null when nothing is owed. */
export function walletDebtNotice(debt: string | number): { title: string; body: string } | null {
  const owed = Number(debt);
  if (!(owed > 0)) return null;
  return {
    title: `You owe $${owed.toFixed(2)} from a payment dispute`,
    body: "Your next earnings pay it off first. Only what is left after that goes to your balance.",
  };
}
