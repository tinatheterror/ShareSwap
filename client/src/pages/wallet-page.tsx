import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { ArrowUpCircle, ArrowDownCircle } from "lucide-react";
import type { SelectShareCoinsTransaction } from "@db/schema";

export default function WalletPage() {
  const { user } = useAuth();
  
  const { data: transactions = [] } = useQuery<SelectShareCoinsTransaction[]>({
    queryKey: ['/api/transactions'],
  });

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">ShareCoin Wallet</h1>
          <p className="text-4xl font-bold text-primary">
            {Math.round(Number(user?.shareCoins))} ShareCoins
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <h2 className="text-xl font-semibold mb-4">Transaction History</h2>
            <div className="space-y-2">
              {transactions.map((transaction) => {
                const isPositive = Number(transaction.amount) >= 0;
                return (
                  <div
                    key={transaction.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg border"
                  >
                    <div className="shrink-0">
                      {isPositive ? (
                        <ArrowUpCircle className="h-5 w-5 text-teal-500" />
                      ) : (
                        <ArrowDownCircle className="h-5 w-5 text-teal-700" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate leading-tight">
                        {transaction.description}
                      </p>
                      <p className="text-xs text-muted-foreground leading-tight">
                        {new Date(transaction.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <p className={`text-sm font-semibold shrink-0 ${
                      isPositive ? "text-teal-600" : "text-teal-700"
                    }`}>
                      {isPositive ? "+" : "-"}
                      {Math.abs(Number(transaction.amount)).toFixed(2)}
                    </p>
                  </div>
                );
              })}
              {transactions.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-6">No transactions yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
