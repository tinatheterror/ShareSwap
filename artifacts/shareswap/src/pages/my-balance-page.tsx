import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Wallet, DollarSign, Clock, CheckCircle, AlertCircle,
  ArrowDownCircle, Loader2, ExternalLink, Building2, RefreshCw, CircleDot,
} from "lucide-react";
import { Navbar } from "@/components/shared/navbar";
import { format } from "date-fns";

interface BalanceData {
  balance: { available: number; pending: number; total: number };
  hasConnectedAccount: boolean;
  payouts: Array<{
    id: number;
    requestId: number | null;
    amount: string;
    netAmount: string;
    processingFee: string;
    status: string;
    disputeStatus?: string;
    releasedAt: string | null;
    paidOutAt: string | null;
    createdAt: string;
  }>;
}

interface ConnectStatus {
  connected: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  chargesEnabled?: boolean;
  accountId?: string;
}

export default function MyBalancePage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isPayoutOpen, setIsPayoutOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");

  const params = new URLSearchParams(search);
  const justConnected = params.get("connected") === "true";
  const needsReconnect = params.get("reconnect") === "true";

  const { data: balanceData, isLoading } = useQuery<BalanceData>({
    queryKey: ["/api/rental-balance"],
  });

  const { data: connectStatus, isLoading: isStatusLoading, refetch: refetchStatus } = useQuery<ConnectStatus>({
    queryKey: ["/api/stripe/connect/status"],
  });

  // Show success toast after returning from Stripe onboarding
  useEffect(() => {
    if (justConnected) {
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/rental-balance"] });
      toast({ title: "Bank Account Connected!", description: "Your payout account is set up. You can now cash out your earnings." });
    }
    if (needsReconnect) {
      toast({ title: "Session Expired", description: "Please start the bank setup again.", variant: "destructive" });
    }
  }, [justConnected, needsReconnect]);

  const [connectNotEnabled, setConnectNotEnabled] = useState(false);

  const onboardMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/connect/onboard", {});
      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data.message || data.error || "Failed");
        (err as any).code = data.error;
        throw err;
      }
      return data as { url: string };
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error: any) => {
      if (error.code === "CONNECT_NOT_ENABLED") {
        setConnectNotEnabled(true);
      } else {
        toast({ title: "Setup Failed", description: error.message || "Could not start bank account setup.", variant: "destructive" });
      }
    },
  });

  const payoutMutation = useMutation({
    mutationFn: async (amount: number) => {
      const res = await apiRequest("POST", "/api/rental-balance/payout", { amount });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Payout Initiated!", description: data.message });
      setIsPayoutOpen(false);
      setPayoutAmount("");
      queryClient.invalidateQueries({ queryKey: ["/api/rental-balance"] });
    },
    onError: (error: any) => {
      toast({ title: "Payout Failed", description: error.message || "Failed to process payout.", variant: "destructive" });
    },
  });

  const handlePayout = () => {
    const amount = parseFloat(payoutAmount);
    if (isNaN(amount) || amount < 10) {
      toast({ title: "Invalid Amount", description: "Minimum payout is $10.", variant: "destructive" });
      return;
    }
    payoutMutation.mutate(amount);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "released": return <CheckCircle className="h-4 w-4 text-[#0BB88C]" />;
      case "held": return <Clock className="h-4 w-4 text-amber-500" />;
      case "pending_payout": return <ArrowDownCircle className="h-4 w-4 text-blue-500" />;
      case "paid_out": return <DollarSign className="h-4 w-4 text-[#0BB88C]" />;
      default: return <AlertCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusLabel = (status: string, disputeStatus?: string) => {
    if (disputeStatus === "captured") return "Damage Compensation";
    switch (status) {
      case "released": return "Added to Balance";
      case "held": return "Pending Handoff";
      case "pending_payout": return "Payout Processing";
      case "paid_out": return "Paid to Bank";
      default: return status;
    }
  };

  const available = balanceData?.balance?.available ?? 0;
  const pending = balanceData?.balance?.pending ?? 0;
  const payoutsEnabled = connectStatus?.payoutsEnabled ?? false;
  const isConnected = connectStatus?.connected ?? false;
  const detailsSubmitted = connectStatus?.detailsSubmitted ?? false;
  const canCashOut = available >= 10 && payoutsEnabled;

  if (isLoading || isStatusLoading) {
    return (
      <div className="min-h-screen bg-[#F3F4F6]">
        <Navbar />
        <main className="container mx-auto px-4 py-6 max-w-2xl flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[#0BB88C]" />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <Button variant="ghost" onClick={() => navigate("/profile")} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Profile
        </Button>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-teal-100 rounded-lg">
            <Wallet className="h-6 w-6 text-[#0BB88C]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Balance</h1>
            <p className="text-gray-500">Rental earnings and payouts</p>
          </div>
        </div>

        {/* Balance card */}
        <Card className="mb-4">
          <CardContent className="py-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 bg-teal-50 rounded-xl">
                <p className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Available</p>
                <p className="text-3xl font-bold text-[#0BB88C]">${available.toFixed(2)}</p>
              </div>
              <div className="text-center p-4 bg-amber-50 rounded-xl">
                <p className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Pending</p>
                <p className="text-2xl font-semibold text-amber-600">${pending.toFixed(2)}</p>
                <p className="text-xs text-gray-400 mt-0.5">Released at handoff</p>
              </div>
            </div>

            {/* Cash Out button — only visible when bank is connected and balance ≥ $10 */}
            {canCashOut && (
              <>
                <Separator className="my-4" />
                <Button
                  className="w-full bg-[#0BB88C] hover:bg-[#099e77] text-white"
                  onClick={() => setIsPayoutOpen(true)}
                >
                  <ArrowDownCircle className="h-4 w-4 mr-2" />
                  Cash Out ${available.toFixed(2)}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Cash Out dialog (rendered at top level so it isn't clipped by Card) */}
        <Dialog open={isPayoutOpen} onOpenChange={setIsPayoutOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowDownCircle className="h-5 w-5 text-[#0BB88C]" />
                Cash Out to Bank
              </DialogTitle>
              <DialogDescription>Transfer earnings to your connected bank account</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Amount to withdraw</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    className="pl-8"
                    min="10"
                    max={available}
                    step="0.01"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">Available: ${available.toFixed(2)} · Minimum: $10.00</p>
              </div>
              <Button variant="link" className="p-0 h-auto text-sm text-[#0BB88C]" onClick={() => setPayoutAmount(available.toFixed(2))}>
                Withdraw full balance
              </Button>
              <Alert className="bg-blue-50 border-blue-200">
                <Clock className="h-4 w-4 text-blue-600" />
                <AlertTitle className="text-blue-800">Processing Time</AlertTitle>
                <AlertDescription className="text-blue-700 text-sm">
                  Funds arrive in your bank account within 2–5 business days.
                </AlertDescription>
              </Alert>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsPayoutOpen(false)}>Cancel</Button>
              <Button
                onClick={handlePayout}
                disabled={payoutMutation.isPending || !payoutAmount}
                className="bg-[#0BB88C] hover:bg-[#099e77] text-white"
              >
                {payoutMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</> : "Send to Bank"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Payout account / Connect section */}
        <Card className="mb-4">
          <CardHeader className="py-4 pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-gray-500" />
              Payout Account
            </CardTitle>
            <CardDescription>Your bank account for receiving rental earnings</CardDescription>
          </CardHeader>
          <CardContent className="py-2 pb-4">
            {!isConnected || !detailsSubmitted ? (
              <div className="space-y-3">
                {connectNotEnabled ? (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-blue-800">Stripe Connect Setup Required</p>
                        <p className="text-xs text-blue-700 mt-1">
                          To enable owner payouts, a Stripe admin must activate Connect on the platform account.
                        </p>
                      </div>
                    </div>
                    <a
                      href="https://dashboard.stripe.com/connect"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open Stripe Connect Dashboard →
                    </a>
                    <p className="text-xs text-blue-600">After enabling, come back and click Connect Bank Account.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs mt-1"
                      onClick={() => { setConnectNotEnabled(false); onboardMutation.mutate(); }}
                      disabled={onboardMutation.isPending}
                    >
                      {onboardMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                      Try Again
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-amber-800">No bank account connected</p>
                        <p className="text-xs text-amber-700">Connect your bank to cash out your rental earnings.</p>
                      </div>
                    </div>
                    <Button
                      onClick={() => onboardMutation.mutate()}
                      disabled={onboardMutation.isPending}
                      className="w-full bg-[#0BB88C] hover:bg-[#099e77] text-white"
                    >
                      {onboardMutation.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Redirecting to Stripe...</>
                      ) : (
                        <><ExternalLink className="h-4 w-4 mr-2" />Connect Bank Account</>
                      )}
                    </Button>
                    <p className="text-xs text-center text-gray-400">Powered by Stripe · Bank-level security · Takes ~2 minutes</p>
                  </>
                )}
              </div>
            ) : payoutsEnabled ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-teal-50 border border-teal-200 rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-[#0BB88C]" />
                    <div>
                      <p className="text-sm font-medium text-teal-800">Bank account connected</p>
                      <p className="text-xs text-teal-600">Payouts enabled · Managed by Stripe</p>
                    </div>
                  </div>
                  <Badge className="bg-[#0BB88C] text-white text-xs">Active</Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => onboardMutation.mutate()}
                  disabled={onboardMutation.isPending}
                >
                  {onboardMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                  Update bank details
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <CircleDot className="h-5 w-5 text-blue-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-blue-800">Verification in progress</p>
                    <p className="text-xs text-blue-700">Stripe is verifying your account. This usually takes a few minutes.</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="w-full text-sm"
                  onClick={() => onboardMutation.mutate()}
                  disabled={onboardMutation.isPending}
                >
                  {onboardMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ExternalLink className="h-4 w-4 mr-2" />}
                  Complete Stripe Verification
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Transaction history */}
        <Card>
          <CardHeader className="py-4 pb-2">
            <CardTitle className="text-base">Transaction History</CardTitle>
            <CardDescription>Your earnings and payouts</CardDescription>
          </CardHeader>
          <CardContent className="py-0 pb-4">
            {balanceData?.payouts && balanceData.payouts.length > 0 ? (
              <div className="space-y-2">
                {balanceData.payouts.map((payout) => {
                  const isPayout = payout.status === "paid_out" || payout.status === "pending_payout";
                  const net = parseFloat(payout.netAmount);
                  const date = payout.paidOutAt || payout.releasedAt || payout.createdAt;
                  return (
                    <div key={payout.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(payout.status)}
                        <div>
                          <p className="text-sm font-medium">
                            {isPayout
                              ? "Bank Payout"
                              : payout.disputeStatus === "captured"
                              ? "Damage Compensation"
                              : payout.status === "held"
                              ? "Rental Earnings (Held)"
                              : "Rental Earnings"}
                          </p>
                          <p className="text-xs text-gray-400">
                            {date ? format(new Date(date), "MMM d, yyyy") : ""}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold ${isPayout ? "text-red-500" : "text-[#0BB88C]"}`}>
                          {isPayout ? "-" : "+"}${net.toFixed(2)}
                        </p>
                        <p className="text-xs text-gray-400">{getStatusLabel(payout.status, payout.disputeStatus)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-10 text-gray-400">
                <Wallet className="h-12 w-12 mx-auto mb-3 text-gray-200" />
                <p className="font-medium text-gray-500">No transactions yet</p>
                <p className="text-sm">Your rental earnings will appear here after handoff.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
