import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Wallet, DollarSign, Clock, CheckCircle, AlertCircle, ArrowDownCircle, Loader2 } from "lucide-react";
import { Navbar } from "@/components/shared/navbar";
import { format } from "date-fns";

interface BalanceData {
  balance: {
    available: number;
    pending: number;
    total: number;
  };
  hasConnectedAccount: boolean;
  payouts: Array<{
    id: number;
    requestId: number;
    amount: string;
    rentalAmount: string;
    platformFee: string;
    processingFee: string;
    netAmount: string;
    status: string;
    releasedAt: string | null;
    paidOutAt: string | null;
    createdAt: string;
  }>;
}

export default function MyBalancePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isPayoutOpen, setIsPayoutOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");

  const { data: balanceData, isLoading } = useQuery<BalanceData>({
    queryKey: ["/api/rental-balance"],
  });

  const payoutMutation = useMutation({
    mutationFn: async (amount: number) => {
      const res = await apiRequest("POST", "/api/rental-balance/payout", { amount });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Payout Requested",
        description: data.message,
      });
      setIsPayoutOpen(false);
      setPayoutAmount("");
      queryClient.invalidateQueries({ queryKey: ["/api/rental-balance"] });
    },
    onError: (error: any) => {
      toast({
        title: "Payout Failed",
        description: error.message || "Failed to process payout",
        variant: "destructive",
      });
    },
  });

  const handlePayout = () => {
    const amount = parseFloat(payoutAmount);
    if (isNaN(amount) || amount < 10) {
      toast({
        title: "Invalid Amount",
        description: "Minimum payout amount is $10",
        variant: "destructive",
      });
      return;
    }
    payoutMutation.mutate(amount);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "released":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "pending":
      case "held":
        return <Clock className="h-4 w-4 text-amber-500" />;
      case "pending_payout":
        return <ArrowDownCircle className="h-4 w-4 text-blue-500" />;
      case "paid_out":
        return <DollarSign className="h-4 w-4 text-green-600" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "released":
        return "Added to Balance";
      case "pending":
        return "Pending";
      case "held":
        return "Payment Secured";
      case "pending_payout":
        return "Payout Processing";
      case "paid_out":
        return "Paid Out";
      default:
        return status;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F3F4F6]">
        <Navbar />
        <main className="container mx-auto px-4 py-6 max-w-2xl">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#0BB88C]" />
          </div>
        </main>
      </div>
    );
  }

  const availableBalance = balanceData?.balance?.available || 0;
  const pendingBalance = balanceData?.balance?.pending || 0;
  const hasPayoutMethod = balanceData?.hasConnectedAccount || false;
  const canCashOut = availableBalance >= 10 && hasPayoutMethod;

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <Button
          variant="ghost"
          onClick={() => navigate("/profile")}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Profile
        </Button>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-green-100 rounded-lg">
            <Wallet className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Balance</h1>
            <p className="text-gray-500">Rental earnings and payouts</p>
          </div>
        </div>

        <Card className="mb-6">
          <CardContent className="py-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <p className="text-sm text-gray-500 mb-1">Available Balance</p>
                <p className="text-3xl font-bold text-green-600">
                  ${availableBalance.toFixed(2)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500 mb-1">Pending</p>
                <p className="text-2xl font-semibold text-amber-600">
                  ${pendingBalance.toFixed(2)}
                </p>
              </div>
            </div>
            
            <Separator className="my-4" />
            
            {!hasPayoutMethod && availableBalance >= 10 && (
              <Alert className="mb-4 bg-amber-50 border-amber-200">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-800">Set Up Payout Method</AlertTitle>
                <AlertDescription className="text-amber-700 text-sm">
                  To cash out your earnings, please set up your bank account in Payment Methods.
                </AlertDescription>
              </Alert>
            )}
            
            <Dialog open={isPayoutOpen} onOpenChange={setIsPayoutOpen}>
              <DialogTrigger asChild>
                <Button 
                  className="w-full bg-green-600 hover:bg-green-700"
                  disabled={!canCashOut}
                >
                  <DollarSign className="h-4 w-4 mr-2" />
                  {!hasPayoutMethod && availableBalance >= 10 
                    ? "Set Up Payout Method First" 
                    : canCashOut 
                      ? "Cash Out" 
                      : "Minimum $10 to cash out"}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ArrowDownCircle className="h-5 w-5 text-green-600" />
                    Cash Out to Bank
                  </DialogTitle>
                  <DialogDescription>
                    Request a payout to your bank account
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 py-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">
                      Amount to withdraw
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={payoutAmount}
                        onChange={(e) => setPayoutAmount(e.target.value)}
                        className="pl-8"
                        min="10"
                        max={availableBalance}
                        step="0.01"
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Available: ${availableBalance.toFixed(2)} • Minimum: $10.00
                    </p>
                  </div>
                  
                  <Button
                    variant="link"
                    className="p-0 h-auto text-sm"
                    onClick={() => setPayoutAmount(availableBalance.toFixed(2))}
                  >
                    Withdraw full balance
                  </Button>
                  
                  <Alert className="bg-blue-50 border-blue-200">
                    <Clock className="h-4 w-4 text-blue-600" />
                    <AlertTitle className="text-blue-800">Processing Time</AlertTitle>
                    <AlertDescription className="text-blue-700 text-sm">
                      Funds will be deposited to your bank account within 2-3 business days.
                    </AlertDescription>
                  </Alert>
                </div>
                
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsPayoutOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handlePayout}
                    disabled={payoutMutation.isPending || !payoutAmount}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {payoutMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      "Request Payout"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-base">Transaction History</CardTitle>
            <CardDescription>Your earnings and payouts</CardDescription>
          </CardHeader>
          <CardContent className="py-0 pb-4">
            {balanceData?.payouts && balanceData.payouts.length > 0 ? (
              <div className="space-y-3">
                {balanceData.payouts.map((payout) => (
                  <div 
                    key={payout.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      {getStatusIcon(payout.status)}
                      <div>
                        <p className="text-sm font-medium">
                          {payout.status === "pending_payout" || payout.status === "paid_out"
                            ? "Bank Payout"
                            : payout.disputeStatus === "captured"
                              ? "Damage Compensation"
                              : payout.status === "held"
                                ? "Rental Earnings (Pending)"
                                : "Rental Earnings"}
                        </p>
                        <p className="text-xs text-gray-500">
                          {payout.releasedAt 
                            ? format(new Date(payout.releasedAt), "MMM d, yyyy")
                            : payout.createdAt 
                              ? format(new Date(payout.createdAt), "MMM d, yyyy")
                              : ""}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-medium ${
                        payout.status === "pending_payout" || payout.status === "paid_out"
                          ? "text-red-600"
                          : "text-green-600"
                      }`}>
                        {payout.status === "pending_payout" || payout.status === "paid_out"
                          ? `-$${parseFloat(payout.netAmount).toFixed(2)}`
                          : `+$${parseFloat(payout.netAmount).toFixed(2)}`}
                      </p>
                      <p className="text-xs text-gray-500">
                        {getStatusLabel(payout.status)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Wallet className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p className="font-medium">No transactions yet</p>
                <p className="text-sm">
                  Your rental earnings will appear here when items are returned
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
