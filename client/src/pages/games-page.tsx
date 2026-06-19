import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Navbar } from "@/components/shared/navbar";
import { Gamepad2, Coins, Lock, CheckCircle2, CalendarDays, RefreshCw, Loader2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface SponsoredGame {
  id: number;
  name: string;
  description: string;
  imageUrl: string;
  rewardAmount: string;
  sponsorName: string;
  gameUrl: string;
  isActive: boolean;
}

interface GameSession {
  id: number;
  gameId: number;
  status: string;
  rewardAmount?: string;
  completedAt?: string;
}

interface OfferStatus {
  hasCompletedTransaction: boolean;
  dailyClaimed: number;
  dailyMax: number;
  dailyLimitReached: boolean;
  monthlyClaimed: number;
  monthlyMax: number;
  monthlyLimitReached: boolean;
  canClaim: boolean;
}

export default function GamesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [claimingId, setClaimingId] = useState<number | null>(null);

  const { data: games, isLoading: gamesLoading } = useQuery<SponsoredGame[]>({
    queryKey: ["/api/games"],
  });

  const { data: offerStatus, isLoading: statusLoading } = useQuery<OfferStatus>({
    queryKey: ["/api/games/offer-status"],
  });

  const claimMutation = useMutation({
    mutationFn: async (game: SponsoredGame) => {
      setClaimingId(game.id);
      // Start session
      const startRes = await apiRequest("POST", `/api/games/${game.id}/start-session`, {});
      const session: GameSession = await startRes.json();
      // Complete immediately (simulated offer completion)
      const completeRes = await apiRequest("POST", `/api/games/${game.id}/complete-session`, {
        sessionId: session.id,
        score: null,
      });
      return completeRes.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/games/offer-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({
        title: "+1 ShareCoin earned!",
        description: "Your ShareCoin has been added to your balance.",
      });
    },
    onError: async (error: any) => {
      let message = "Failed to claim offer. Please try again.";
      try {
        const body = await error.json?.();
        message = body?.error || message;
      } catch {}
      toast({ title: "Cannot claim offer", description: message, variant: "destructive" });
    },
    onSettled: () => setClaimingId(null),
  });

  const isLoading = gamesLoading || statusLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F3F4F6]">
        <Navbar />
        <main className="max-w-lg mx-auto px-4 py-12 flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
        </main>
      </div>
    );
  }

  const activeOffers = games?.filter((g) => g.isActive) ?? [];
  const showNoOffers = !offerStatus?.canClaim || activeOffers.length === 0;

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="max-w-lg mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Gamepad2 className="w-5 h-5 text-teal-600" />
            <h1 className="text-xl font-bold text-slate-800">Sponsored Offers</h1>
          </div>
          <p className="text-sm text-slate-500">
            Complete optional offers from our partners to earn ShareCoins.
          </p>
        </div>

        {/* Monthly progress */}
        <div className="bg-white rounded-2xl border border-slate-100 p-4 mb-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-medium text-slate-700">Monthly earnings</span>
            </div>
            <span className="text-sm font-bold text-teal-600">
              {offerStatus?.monthlyClaimed ?? 0} / {offerStatus?.monthlyMax ?? 20} SC
            </span>
          </div>
          <Progress
            value={((offerStatus?.monthlyClaimed ?? 0) / (offerStatus?.monthlyMax ?? 20)) * 100}
            className="h-2"
          />
          <p className="text-xs text-slate-400 mt-2">
            Daily maximum: 1 SC · Monthly maximum: 20 SC · Resets each month
          </p>
        </div>

        {/* Locked state — no completed transaction yet */}
        {!offerStatus?.hasCompletedTransaction && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-5 flex gap-3">
            <Lock className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-800 text-sm mb-0.5">Offers locked</p>
              <p className="text-sm text-amber-700">
                Complete your first borrow, rent, swap, or gift to unlock ShareCoin rewards from sponsored offers.
              </p>
            </div>
          </div>
        )}

        {/* Daily limit reached */}
        {offerStatus?.hasCompletedTransaction && offerStatus.dailyLimitReached && !offerStatus.monthlyLimitReached && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 mb-5 flex gap-3">
            <CheckCircle2 className="w-5 h-5 text-teal-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-700 text-sm mb-0.5">Today's reward claimed</p>
              <p className="text-sm text-slate-500">
                No sponsored offers available today. Check back tomorrow.
              </p>
            </div>
          </div>
        )}

        {/* Monthly limit reached */}
        {offerStatus?.monthlyLimitReached && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 mb-5 flex gap-3">
            <RefreshCw className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-700 text-sm mb-0.5">Monthly limit reached</p>
              <p className="text-sm text-slate-500">
                You've earned 20 SC from offers this month. Resets at the start of next month.
              </p>
            </div>
          </div>
        )}

        {/* Offers list */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">
              {showNoOffers && activeOffers.length === 0
                ? "Today's Available Offers"
                : "Today's Available Offers"}
            </h2>
          </div>

          {activeOffers.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Gamepad2 className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-sm text-slate-500 font-medium">No sponsored offers available today.</p>
              <p className="text-xs text-slate-400 mt-1">Check back tomorrow.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {activeOffers.map((game) => {
                const isClaiming = claimingId === game.id && claimMutation.isPending;
                const isDisabled = !offerStatus?.canClaim || claimMutation.isPending;

                return (
                  <li key={game.id} className="flex items-center gap-4 px-4 py-4">
                    <div className="w-11 h-11 rounded-xl bg-teal-50 flex items-center justify-center shrink-0">
                      <Gamepad2 className="w-5 h-5 text-teal-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{game.name}</p>
                      <p className="text-xs text-slate-400 truncate">{game.sponsorName}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge className="bg-teal-50 text-teal-700 border-teal-100 text-xs">
                        <Coins className="w-3 h-3 mr-1" />
                        +1 SC
                      </Badge>
                      <Button
                        size="sm"
                        onClick={() => claimMutation.mutate(game)}
                        disabled={isDisabled}
                        className="rounded-lg text-xs h-8 px-3 bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-40"
                      >
                        {isClaiming ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : offerStatus?.dailyLimitReached ? (
                          "Claimed"
                        ) : !offerStatus?.hasCompletedTransaction ? (
                          "Locked"
                        ) : (
                          "Claim"
                        )}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Only one offer can be claimed per day · 20 SC monthly cap
        </p>
      </main>
    </div>
  );
}
