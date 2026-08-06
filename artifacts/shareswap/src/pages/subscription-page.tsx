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
  Settings,
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
  const borrowUsed = subStatus?.monthlyBorrowCount ?? 0;
  const borrowPct = Math.min((borrowUsed / 3) * 100, 100);

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

        {/* ── Current plan status ── */}
        {isLoading ? (
          <Card className="mb-6">
            <CardContent className="p-6 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </CardContent>
          </Card>
        ) : (
          <Card className={`border-2 ${plan.borderColor} mb-6`}>
            <CardContent className="p-5">
              {/* Plan name + badge */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${plan.iconBg}`}>
                    <PlanIcon className={`h-5 w-5 ${plan.iconColor}`} />
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400 uppercase tracking-wide font-medium">Current plan</p>
                    <p className="text-xl font-bold text-slate-900">{plan.name}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  {hasActivePaidSub ? (
                    <Badge className="bg-green-50 text-green-700 border-green-200 text-xs">Active</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">Free</Badge>
                  )}
                  <span className="text-sm font-semibold text-slate-700">{plan.price}</span>
                </div>
              </div>

              <Separator className="mb-4" />

              {/* Billing + usage */}
              <div className="space-y-3 mb-4">
                {billingDate && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">{hasActivePaidSub ? "Next billing" : "Usage resets"}</span>
                    <span className="font-medium text-slate-700">{billingDate}</span>
                  </div>
                )}
                {hasActivePaidSub && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Amount</span>
                    <span className="font-medium text-slate-700">{plan.price}</span>
                  </div>
                )}
                {currentTier === "free" ? (
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="text-slate-500">Borrows this month</span>
                      <span className="font-medium text-slate-700">{borrowUsed} / 3</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-500 rounded-full transition-all"
                        style={{ width: `${borrowPct}%` }}
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

              {/* Features */}
              <Separator className="my-4" />
              <ul className="space-y-2 mb-4">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-slate-600">
                    <Check className="h-3.5 w-3.5 text-teal-500 shrink-0" />{f}
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

              {/* CTA */}
              <div className="flex flex-col gap-2">
                {currentTier === "free" && (
                  <Button variant="outline" className="w-full opacity-50 cursor-not-allowed text-slate-400 border-slate-200" disabled>
                    Your Current Plan
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => portalMutation.mutate()}
                  disabled={portalMutation.isPending}
                >
                  {portalMutation.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <CreditCard className="h-4 w-4" />}
                  Manage billing
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Plans & Pricing ── */}
        {!isLoading && (
          <>
            <div className="flex flex-col gap-0">
              {(["member", "pro"] as Tier[]).filter((t) => t !== currentTier).map((tier) => {
                const p = PLANS[tier];
                const { Icon: TierIcon } = p;
                const isCurrent = currentTier === tier;
                const isCheckingOut =
                  checkoutMutation.isPending &&
                  (checkoutMutation.variables as string) === tier;

                // Current free plan gets teal border; paid plans always keep their color
                const borderClass =
                  tier === "member"
                    ? "border-teal-400"
                    : tier === "pro"
                    ? "border-amber-400"
                    : isCurrent
                    ? "border-teal-400"
                    : "border-slate-200";

                const features =
                  tier === "free"
                    ? [
                        { text: "3 borrows per month", ok: true },
                        { text: "Unlimited swaps & gifts", ok: true },
                        { text: "5% service fee on rentals", ok: false },
                      ]
                    : tier === "member"
                    ? [
                        { text: "Unlimited borrows", ok: true },
                        { text: "Unlimited swaps & gifts", ok: true },
                        { text: "5% service fee on rentals", ok: true },
                      ]
                    : [
                        { text: "Unlimited borrows", ok: true },
                        { text: "Unlimited swaps & gifts", ok: true },
                        { text: "Reduced 4% service fee on rentals", ok: true },
                        { text: "Activity & Insights dashboard", ok: true },
                        { text: "$1.50 courier fee waived (5/mo)", ok: true },
                      ];

                return (
                  <div key={tier}>
                    {/* "Most Popular" badge sits in the gap between Free and Member */}
                    {tier === "member" && (
                      <div className="flex justify-center py-2">
                        <span className="bg-teal-600 text-white text-[11px] font-semibold px-3.5 py-1 rounded-full">
                          Most Popular
                        </span>
                      </div>
                    )}
                    {tier === "pro" && <div className="h-2" />}

                    <div className={`bg-white rounded-2xl border-[1.5px] ${borderClass} px-4 pt-3.5 pb-4 flex flex-col`}>
                      {/* Current-plan banner */}
                      {isCurrent && (
                        <div className="mb-3 pb-3 border-b border-slate-100">
                          <p className="text-[11px] text-slate-400 mb-0.5">Current Plan</p>
                          {tier === "free" ? (
                            <p className="text-xs text-slate-600">
                              {subStatus?.monthlyBorrowCount ?? 0} / 3 borrows used this month
                            </p>
                          ) : (
                            <span className="inline-block bg-green-50 text-green-700 border border-green-200 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                              Active
                            </span>
                          )}
                        </div>
                      )}

                      {/* Icon + name/note row + price */}
                      <div className="flex items-center gap-2.5 mb-3">
                        <div className={`p-1.5 rounded-lg ${p.iconBg} shrink-0`}>
                          <TierIcon className={`w-4 h-4 ${p.iconColor}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-800 leading-tight">{p.name}</p>
                          <p className="text-xs text-slate-400">
                            {tier === "free" ? "Free forever" : tier === "member" ? "$4.99 / month" : "$9.99 / month"}
                          </p>
                        </div>
                        <p className="text-xl font-bold text-slate-800 shrink-0">
                          {tier === "free" ? "$0" : tier === "member" ? "$4.99" : "$9.99"}
                          {tier !== "free" && (
                            <span className="text-xs font-normal text-slate-400"> /mo</span>
                          )}
                        </p>
                      </div>

                      {/* Features */}
                      <ul className="space-y-2 mb-4 flex-1">
                        {features.map(({ text, ok }) => (
                          <li key={text} className={`flex items-start gap-2 text-xs ${ok ? "text-slate-600" : "text-slate-400"}`}>
                            {ok ? (
                              <Check className="w-3.5 h-3.5 text-teal-500 shrink-0 mt-0.5" />
                            ) : (
                              <div className="w-3.5 h-3.5 shrink-0 mt-0.5 flex items-center justify-center">
                                <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                              </div>
                            )}
                            {text}
                          </li>
                        ))}
                      </ul>

                      {/* CTA */}
                      {tier === "free" ? (
                        <Button
                          variant="outline"
                          className="w-full rounded-xl h-10 text-slate-400 border-slate-200 text-sm font-normal"
                          disabled
                        >
                          {isCurrent ? "Your Current Plan" : "Free Plan"}
                        </Button>
                      ) : isCurrent ? (
                        <div className="flex flex-col gap-1.5">
                          <Button
                            variant="outline"
                            className={`w-full rounded-xl h-10 text-sm ${tier === "member" ? "border-teal-200 text-teal-600" : "border-amber-200 text-amber-600"}`}
                            disabled
                          >
                            ✓ Current Plan
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => portalMutation.mutate()}
                            disabled={portalMutation.isPending}
                            className="w-full gap-1.5 text-slate-500 text-xs h-8"
                          >
                            {portalMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Settings className="w-3 h-3" />}
                            Manage Subscription
                          </Button>
                        </div>
                      ) : (
                        <Button
                          onClick={() =>
                            hasActivePaidSub ? portalMutation.mutate() : checkoutMutation.mutate(tier)
                          }
                          disabled={checkoutMutation.isPending || portalMutation.isPending}
                          className={`w-full rounded-xl h-10 text-sm font-semibold text-white ${
                            tier === "member"
                              ? "bg-teal-600 hover:bg-teal-700"
                              : "bg-amber-500 hover:bg-amber-600"
                          }`}
                        >
                          {isCheckingOut ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            tier === "member" ? "Subscribe — $4.99/mo" : "Subscribe — $9.99/mo"
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-[10px] text-center text-slate-400 mt-4 leading-relaxed">
              Subscriptions renew monthly · Cancel anytime · Service fee includes Stripe processing
            </p>
          </>
        )}
      </div>
    </>
  );
}
