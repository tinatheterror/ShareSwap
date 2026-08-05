import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Navbar } from "@/components/shared/navbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Check,
  Crown,
  Star,
  Zap,
  Loader2,
  CreditCard,
} from "lucide-react";

interface SubStatus {
  subscriptionTier: string;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus: string | null;
  monthlyBorrowCount: number;
  monthlyBorrowResetAt: string | null;
}

type Tier = "free" | "member" | "pro";

const PLANS: Record<
  Tier,
  {
    name: string;
    price: string;
    priceNum: number;
    Icon: React.ElementType;
    iconBg: string;
    iconColor: string;
    borderColor: string;
    features: string[];
    limitations: string[];
  }
> = {
  free: {
    name: "Free",
    price: "$0",
    priceNum: 0,
    Icon: Zap,
    iconBg: "bg-slate-100",
    iconColor: "text-slate-500",
    borderColor: "border-slate-200",
    features: ["3 borrows per month", "Unlimited swaps & gifts"],
    limitations: ["5% service fee on rentals"],
  },
  member: {
    name: "Member",
    price: "$4.99/mo",
    priceNum: 4.99,
    Icon: Star,
    iconBg: "bg-teal-50",
    iconColor: "text-teal-600",
    borderColor: "border-teal-400",
    features: ["Unlimited borrows", "Unlimited swaps & gifts", "5% service fee on rentals"],
    limitations: [],
  },
  pro: {
    name: "Pro",
    price: "$9.99/mo",
    priceNum: 9.99,
    Icon: Crown,
    iconBg: "bg-amber-50",
    iconColor: "text-amber-500",
    borderColor: "border-amber-400",
    features: [
      "Unlimited borrows",
      "Unlimited swaps & gifts",
      "Reduced 4% service fee on rentals",
      "Activity & Insights dashboard",
      "$1.50 courier fee waived (5/mo)",
    ],
    limitations: [],
  },
};

export default function SubscriptionPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: subStatus, isLoading } = useQuery<SubStatus>({
    queryKey: ["/api/subscription/status"],
    enabled: !!user,
  });

  const currentTier: Tier = (subStatus?.subscriptionTier ?? "free") as Tier;
  const hasActivePaidSub =
    currentTier !== "free" && subStatus?.stripeSubscriptionStatus === "active";
  const plan = PLANS[currentTier] ?? PLANS.free;
  const { Icon: PlanIcon } = plan;

  const checkoutMutation = useMutation({
    mutationFn: async (tier: string) => {
      const res = await apiRequest("POST", "/api/subscription/checkout", { tier });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (error: any) => {
      toast({
        title: "Checkout failed",
        description: error.message || "Failed to start checkout.",
        variant: "destructive",
      });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/subscription/portal", {});
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (error: any) => {
      toast({
        title: "Failed to open billing portal",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Handle Stripe redirect back after checkout
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("sub_success") === "true") {
      toast({ title: "Subscription activated!", description: "Your new plan benefits are now active." });
      window.history.replaceState({}, "", "/subscription");
      queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
    } else if (params.get("sub_canceled") === "true") {
      toast({ title: "Checkout canceled", description: "No charges were made." });
      window.history.replaceState({}, "", "/subscription");
    }
  }, []);

  const billingDate = subStatus?.monthlyBorrowResetAt
    ? new Date(subStatus.monthlyBorrowResetAt).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
      })
    : null;

  const otherTiers = (["free", "member", "pro"] as Tier[]).filter(
    (t) => t !== currentTier
  );

  return (
    <>
      <Navbar />
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Back */}
        <button
          onClick={() => navigate("/profile")}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to profile
        </button>

        <h1 className="text-2xl font-bold text-slate-900 mb-1">Subscription</h1>
        <p className="text-sm text-slate-500 mb-6">Manage your plan and billing</p>

        {/* ── Current plan card ── */}
        {isLoading ? (
          <Card>
            <CardContent className="p-6 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </CardContent>
          </Card>
        ) : (
          <Card className={`border-2 ${plan.borderColor} mb-6`}>
            <CardContent className="p-6">
              {/* Header row */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${plan.iconBg}`}>
                    <PlanIcon className={`h-5 w-5 ${plan.iconColor}`} />
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400 uppercase tracking-wide font-medium">
                      Current plan
                    </p>
                    <p className="text-xl font-bold text-slate-900">{plan.name}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  {hasActivePaidSub ? (
                    <Badge className="bg-green-50 text-green-700 border-green-200 text-xs">
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      Free
                    </Badge>
                  )}
                  <span className="text-sm font-semibold text-slate-700">{plan.price}</span>
                </div>
              </div>

              <Separator className="mb-4" />

              {/* Billing & usage */}
              <div className="space-y-3 mb-4">
                {billingDate && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">
                      {hasActivePaidSub ? "Next billing" : "Usage resets"}
                    </span>
                    <span className="font-medium text-slate-700">{billingDate}</span>
                  </div>
                )}
                {currentTier === "free" ? (
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="text-slate-500">Borrows this month</span>
                      <span className="font-medium text-slate-700">
                        {subStatus?.monthlyBorrowCount ?? 0} / 3
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-500 rounded-full transition-all"
                        style={{
                          width: `${Math.min(
                            ((subStatus?.monthlyBorrowCount ?? 0) / 3) * 100,
                            100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Borrows this month</span>
                    <span className="font-medium text-teal-600">Unlimited</span>
                  </div>
                )}
              </div>

              <Separator className="mb-4" />

              {/* Features */}
              <ul className="space-y-2 mb-5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-slate-600">
                    <Check className="h-3.5 w-3.5 text-teal-500 shrink-0" />
                    {f}
                  </li>
                ))}
                {plan.limitations.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-slate-400">
                    <div className="h-3.5 w-3.5 flex items-center justify-center shrink-0">
                      <div className="w-1 h-1 rounded-full bg-slate-300" />
                    </div>
                    {f}
                  </li>
                ))}
              </ul>

              {/* Primary action */}
              {hasActivePaidSub ? (
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => portalMutation.mutate()}
                  disabled={portalMutation.isPending}
                >
                  {portalMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CreditCard className="h-4 w-4" />
                  )}
                  Manage billing
                </Button>
              ) : (
                <Button
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white gap-2"
                  onClick={() => checkoutMutation.mutate("member")}
                  disabled={checkoutMutation.isPending}
                >
                  {checkoutMutation.isPending &&
                  (checkoutMutation.variables as string) === "member" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Star className="h-4 w-4" />
                  )}
                  Upgrade to Member — $4.99/mo
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Other plans ── */}
        {!isLoading && (
          <>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">
              {hasActivePaidSub ? "Switch plan" : "Available plans"}
            </p>
            <div className="space-y-2">
              {otherTiers.map((tier) => {
                const p = PLANS[tier];
                const { Icon: TierIcon } = p;
                const isLoading =
                  checkoutMutation.isPending &&
                  (checkoutMutation.variables as string) === tier;

                return (
                  <Card key={tier} className={`border ${p.borderColor}`}>
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className={`p-1.5 rounded-lg ${p.iconBg} shrink-0`}>
                        <TierIcon className={`h-4 w-4 ${p.iconColor}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                        <p className="text-xs text-slate-400">{p.price}</p>
                      </div>
                      {/* Action */}
                      {tier === "free" ? (
                        /* Downgrade: open portal so user can cancel */
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-slate-500"
                          onClick={() => portalMutation.mutate()}
                          disabled={portalMutation.isPending}
                        >
                          {portalMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Downgrade"
                          )}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant={tier === "pro" ? "default" : "outline"}
                          className={
                            tier === "pro"
                              ? "bg-amber-500 hover:bg-amber-600 text-white text-xs"
                              : "text-xs"
                          }
                          onClick={() =>
                            hasActivePaidSub
                              ? portalMutation.mutate()
                              : checkoutMutation.mutate(tier)
                          }
                          disabled={
                            checkoutMutation.isPending || portalMutation.isPending
                          }
                        >
                          {isLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : hasActivePaidSub ? (
                            tier === "pro" ? "Upgrade" : "Switch"
                          ) : (
                            "Subscribe"
                          )}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        <p className="text-xs text-center text-slate-400 mt-8">
          Subscriptions renew monthly · Cancel anytime via Manage billing · Service fee includes
          Stripe payment processing
        </p>
      </div>
    </>
  );
}
