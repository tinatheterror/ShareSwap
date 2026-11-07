import { useInfiniteQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface WalletTransactionRow {
  id: number;
  kind: string;
  /** Server-side label: Rental earnings, Claim award, Withdrawal, Chargeback, Currency conversion, ... */
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

const PAGE_SIZE = 20;

/** "+$30.00" / "-$20.00", with the currency when it is not the wallet's own (an old USD credit). */
export function formatWalletAmount(row: Pick<WalletTransactionRow, "amount" | "currency">, walletCurrency: string): string {
  const value = Number(row.amount);
  const sign = value < 0 ? "-" : "+";
  const suffix = row.currency.toLowerCase() === walletCurrency.toLowerCase() ? "" : ` ${row.currency.toUpperCase()}`;
  return `${sign}$${Math.abs(value).toFixed(2)}${suffix}`;
}

export function WalletHistoryView({ pages, hasMore, loadingMore, onLoadMore }: { pages: WalletPage[]; hasMore: boolean; loadingMore: boolean; onLoadMore: () => void }) {
  const first = pages[0];
  const rows = pages.flatMap(page => page.transactions);
  const debt = Number(first?.balance.debt ?? 0);
  return (
    <Card className="mb-4" data-testid="wallet-history">
      <CardHeader className="py-4 pb-2">
        <CardTitle className="text-base">Wallet history</CardTitle>
        <CardDescription>Every change to your wallet balance</CardDescription>
      </CardHeader>
      <CardContent className="py-0 pb-4">
        {debt > 0 && (
          <Alert className="mb-3" data-testid="wallet-debt">
            <AlertTitle>You owe ${debt.toFixed(2)} from a payment dispute</AlertTitle>
            <AlertDescription>Your next earnings pay it off first. Only what is left after that goes to your balance.</AlertDescription>
          </Alert>
        )}
        {rows.length === 0 ? (
          <p className="text-center py-6 text-sm text-gray-400" data-testid="wallet-history-empty">Nothing here yet.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map(row => (
              <li key={row.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg" data-testid={`wallet-row-${row.id}`}>
                <div>
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-gray-400">{format(new Date(row.createdAt), "MMM d, yyyy")}</p>
                </div>
                <p className={`font-semibold ${Number(row.amount) < 0 ? "text-red-500" : "text-[#0BB88C]"}`}>{formatWalletAmount(row, first?.currency ?? "cad")}</p>
              </li>
            ))}
          </ul>
        )}
        {hasMore && (
          <Button variant="outline" className="w-full mt-3 text-sm" onClick={onLoadMore} disabled={loadingMore} data-testid="wallet-history-more">
            {loadingMore ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Show more
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function WalletHistory() {
  const query = useInfiniteQuery<WalletPage>({
    queryKey: ["/api/wallet"],
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }: { pageParam: number | null }) => {
      const cursor = pageParam ? `&cursor=${pageParam}` : "";
      const res = await apiRequest("GET", `/api/wallet?limit=${PAGE_SIZE}${cursor}`);
      return res.json();
    },
    getNextPageParam: (last: WalletPage) => last.nextCursor,
  } as any);
  const pages = ((query.data as any)?.pages ?? []) as WalletPage[];
  if (query.isLoading || pages.length === 0) return null;
  return <WalletHistoryView pages={pages} hasMore={!!query.hasNextPage} loadingMore={query.isFetchingNextPage} onLoadMore={() => query.fetchNextPage()} />;
}
