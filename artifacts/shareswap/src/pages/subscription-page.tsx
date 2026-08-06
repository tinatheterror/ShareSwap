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
import {
  ArrowLeft,
  Check,
  Crown,
  Star,
  Zap,
  Loader2,
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
    accentBorder: string;
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
    accentBorder: "border-slate-200",
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
    accentBorder: "border-teal-400",
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
    accentBorder: "border-amber-400",
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

  const anyPending = checkoutMutation.isPending || portalMutation.isPending;

  return (
    <>
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Back */}
        <button
          onClick={() => navigate("/profile")}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to profile
        </button>

        {/* ── Compact summary ── */}
        {isLoading ? (
          <Card className="mb-8">
            <CardContent className="p-6 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </CardContent>
          </Card>
        ) : (
          <Card className={`border-2 ${plan.accentBorder} mb-8`}>
            <CardContent className="p-5">
              <p className="text-[11px] text-slate-400 uppercase tracking-wide font-medium mb-2">
                Subscription
              </p>
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-lg ${plan.iconBg}`}>
                  <PlanIcon className={`h-4 w-4 ${plan.iconColor}`} />
                </div>
                <p className="text-xl font-bold text-slate-900">{plan.name}</p>
                {hasActivePaidSub && (
                  <Badge className="bg-green-50 text-green-700 border-green-200 text-xs">
                    Active
                  </Badge>
                )}
              </div>

              {/* Borrow usage */}
              {currentTier === "free" ? (
                <>
                  <p className="text-sm text-slate-500 mb-0.5">
                    {subStatus?.monthlyBorrowCount ?? 0} / 3 borrows used
                  </p>
                  <p className="text-sm text-slate-400 mb-4">
                    Upgrade for unlimited borrows
                  </p>
                </>
              ) : (
                <p className="text-sm text-teal-600 mb-4">Unlimited borrows</p>
              )}

              {/* Manage Subscription */}
              {hasActivePaidSub ? (
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => portalMutation.mutate()}
                  disabled={anyPending}
                >
                  {portalMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Settings className="h-4 w-4" />
                  )}
                  Manage Subscription
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="w-full gap-2 text-slate-500"
                  disabled
                >
                  <Settings className="h-4 w-4" />
                  Manage Subscription
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Plans & Pricing ── */}
        {!isLoading && (
          <>
            <div className="text-center mb-4">
              <h2 className="flex flex-wrap items-center justify-center gap-2 text-xl font-bold">
                <Crown className="h-5 w-5 text-teal-600" />
                Plans &amp; Pricing
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Share more, own less. Upgrade to Member for unlimited borrows.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
              {/* Free */}
              <div className={`relative bg-white rounded-xl border-2 border-slate-200 p-4 flex flex-col shadow-sm ${currentTier === "free" ? "ring-2 ring-teal-400 ring-offset-1" : ""}`}>
                {currentTier === "free" && (
                  <div className="mb-3 pb-3 border-b border-slate-100">
                    <p className="text-[10px] text-slate-400 mb-0.5">Current Plan</p>
                    <p className="text-xs text-slate-500">
                      {subStatus?.monthlyBorrowCount ?? 0} / 3 borrows used this month
                    </p>
                  </div>
                )}
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="p-1.5 rounded-lg bg-slate-100">
                    <Zap className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm leading-tight">Free</h3>
                    <p className="text-xs text-slate-400">Free forever</p>
                  </div>
                </div>
                <div className="mb-3">
                  <span className="text-2xl font-bold text-slate-600">$0</span>
                </div>
                <ul className="space-y-2 mb-4 flex-1 text-xs">
                  <li className="flex items-start gap-1.5 text-slate-600">
                    <Check className="w-3.5 h-3.5 text-teal-500 shrink-0 mt-0.5" />3 borrows per month
                  </li>
                  <li className="flex items-start gap-1.5 text-slate-600">
                    <Check className="w-3.5 h-3.5 text-teal-500 shrink-0 mt-0.5" />Unlimited swaps &amp; gifts
                  </li>
                  <li className="flex items-start gap-1.5 text-slate-400">
                    <div className="w-3.5 h-3.5 shrink-0 mt-1 flex items-center justify-center">
                      <div className="w-1 h-1 rounded-full bg-slate-300" />
                    </div>
                    5% service fee on rentals
                  </li>
                </ul>
                {currentTier === "free" ? (
                  <Button variant="outline" className="w-full rounded-lg text-slate-400 text-xs h-8" disabled>
                    Your Current Plan
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => portalMutation.mutate()}
                    disabled={anyPending}
                    className="w-full rounded-lg text-slate-400 text-xs h-8"
                  >
                    {portalMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Downgrade"}
                  </Button>
                )}
              </div>

              {/* Member */}
              <div className={`relative bg-white rounded-xl border-2 border-teal-400 p-4 flex flex-col shadow-sm shadow-teal-100 ${currentTier === "member" ? "ring-2 ring-teal-500 ring-offset-1" : ""}`}>
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                  <Badge className="bg-teal-600 text-white text-[10px] px-2.5">Most Popular</Badge>
                </div>
                {currentTier === "member" && (
                  <div className="mb-3 pb-3 border-b border-teal-100 pt-1">
                    <p className="text-[10px] text-slate-400 mb-0.5">Current Plan</p>
                    <Badge className="bg-green-50 text-green-700 border-green-200 text-[10px]">Active</Badge>
                  </div>
                )}
                <div className="flex items-center gap-2.5 mb-3 pt-1">
                  <div className="p-1.5 rounded-lg bg-teal-50">
                    <Star className="w-4 h-4 text-teal-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm leading-tight">Member</h3>
                    <p className="text-xs text-slate-400">$4.99 / month</p>
                  </div>
                </div>
                <div className="mb-3">
                  <span className="text-2xl font-bold text-slate-800">$4.99<span className="text-xs font-normal text-slate-400"> /mo</span></span>
                </div>
                <ul className="space-y-2 mb-4 flex-1 text-xs">
                  <li className="flex items-start gap-1.5 text-slate-600">
                    <Check className="w-3.5 h-3.5 text-teal-500 shrink-0 mt-0.5" />Unlimited borrows
                  </li>
                  <li className="flex items-start gap-1.5 text-slate-600">
                    <Check className="w-3.5 h-3.5 text-teal-500 shrink-0 mt-0.5" />Unlimited swaps &amp; gifts
                  </li>
                  <li className="flex items-start gap-1.5 text-slate-400">
                    <div className="w-3.5 h-3.5 shrink-0 mt-1 flex items-center justify-center">
                      <div className="w-1 h-1 rounded-full bg-slate-300" />
                    </div>
                    5% service fee on rentals
                  </li>
                </ul>
                {currentTier === "member" ? (
                  <div className="flex flex-col gap-2">
                    <Button variant="outline" className="w-full rounded-lg border-teal-200 text-teal-600 text-xs h-8" disabled>
                      ✓ Current Plan
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => portalMutation.mutate()}
                      disabled={anyPending}
                      className="w-full flex items-center justify-center gap-1.5 text-slate-500 text-xs h-7"
                    >
                      {portalMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Settings className="w-3 h-3" />}
                      Manage Subscription
                    </Button>
                  </div>
                ) : (
                  <Button
                    onClick={() => checkoutMutation.mutate("member")}
                    disabled={anyPending}
                    className="w-full rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs h-8 font-semibold"
                  >
                    {checkoutMutation.isPending && (checkoutMutation.variables as string) === "member"
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : hasActivePaidSub ? "Switch" : "Subscribe — $4.99/mo"}
                  </Button>
                )}
              </div>

              {/* Pro */}
              <div className={`relative bg-white rounded-xl border-2 border-amber-400 p-4 flex flex-col shadow-sm ${currentTier === "pro" ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}>
                {currentTier === "pro" && (
                  <div className="mb-3 pb-3 border-b border-amber-100">
                    <p className="text-[10px] text-slate-400 mb-0.5">Current Plan</p>
                    <Badge className="bg-green-50 text-green-700 border-green-200 text-[10px]">Active</Badge>
                  </div>
                )}
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="p-1.5 rounded-lg bg-amber-50">
                    <Crown className="w-4 h-4 text-amber-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm leading-tight">Pro</h3>
                    <p className="text-xs text-slate-400">$9.99 / month</p>
                  </div>
                </div>
                <div className="mb-3">
                  <span className="text-2xl font-bold text-slate-800">$9.99<span className="text-xs font-normal text-slate-400"> /mo</span></span>
                </div>
                <ul className="space-y-2 mb-4 flex-1 text-xs">
                  <li className="flex items-start gap-1.5 text-slate-600">
                    <Check className="w-3.5 h-3.5 text-teal-500 shrink-0 mt-0.5" />Unlimited borrows
                  </li>
                  <li className="flex items-start gap-1.5 text-slate-600">
                    <Check className="w-3.5 h-3.5 text-teal-500 shrink-0 mt-0.5" />Unlimited swaps &amp; gifts
                  </li>
                  <li className="flex items-start gap-1.5 text-slate-600">
                    <Check className="w-3.5 h-3.5 text-teal-500 shrink-0 mt-0.5" />Reduced 4% service fee on rentals
                  </li>
                  <li className="flex items-start gap-1.5 text-slate-600">
                    <Check className="w-3.5 h-3.5 text-teal-500 shrink-0 mt-0.5" />Activity &amp; Insights dashboard
                  </li>
                  <li className="flex items-start gap-1.5 text-slate-600">
                    <div className="flex flex-col">
                      <span className="flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5 text-teal-500 shrink-0" />$1.50 courier convenience fee waived (5/mo)
                      </span>
                      <span className="text-[10px] text-slate-400 ml-5">Neither party sees the other's address</span>
                    </div>
                  </li>
                </ul>
                {currentTier === "pro" ? (
                  <div className="flex flex-col gap-2">
                    <Button variant="outline" className="w-full rounded-lg border-amber-200 text-amber-600 text-xs h-8" disabled>
                      ✓ Current Plan
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => portalMutation.mutate()}
                      disabled={anyPending}
                      className="w-full flex items-center justify-center gap-1.5 text-slate-500 text-xs h-7"
                    >
                      {portalMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Settings className="w-3 h-3" />}
                      Manage Subscription
                    </Button>
                  </div>
                ) : (
                  <Button
                    onClick={() => checkoutMutation.mutate("pro")}
                    disabled={anyPending}
                    className="w-full rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs h-8 font-semibold"
                  >
                    {checkoutMutation.isPending && (checkoutMutation.variables as string) === "pro"
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : hasActivePaidSub ? "Upgrade" : "Subscribe — $9.99/mo"}
                  </Button>
                )}
              </div>
            </div>

            <p className="text-[10px] md:text-xs text-center text-gray-400 mt-4">
              Subscriptions renew monthly · Cancel anytime via Manage Subscription · Service fee includes Stripe payment processing
            </p>
          </>
        )}
      </div>
    </>
  );
}
