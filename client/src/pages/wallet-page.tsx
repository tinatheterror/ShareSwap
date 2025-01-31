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
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">ShareCoin Wallet</h1>
          <p className="text-4xl font-bold text-primary">
            {Number(user?.shareCoins).toFixed(2)} ShareCoins
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <h2 className="text-xl font-semibold mb-4">Transaction History</h2>
            <div className="space-y-4">
              {transactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between p-4 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    {transaction.transactionType === "EARNED" ? (
                      <ArrowUpCircle className="h-8 w-8 text-green-500" />
                    ) : (
                      <ArrowDownCircle className="h-8 w-8 text-red-500" />
                    )}
                    <div>
                      <p className="font-medium">{transaction.description}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(transaction.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <p className={`text-lg font-semibold ${
                    transaction.transactionType === "EARNED" 
                      ? "text-green-600" 
                      : "text-red-600"
                  }`}>
                    {transaction.transactionType === "EARNED" ? "+" : "-"}
                    {Number(transaction.amount).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
