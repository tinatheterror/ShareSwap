import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { Check, Zap, Star, Crown, ArrowLeft, Loader2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface SubscriptionStatus {
  subscriptionTier: string;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus: string | null;
  monthlyBorrowCount: number;
  monthlyBorrowResetAt: string | null;
}

const plans = [
  {
    id: "free",
    name: "Free",
    price: 0,
    priceLabel: "Free forever",
    icon: Zap,
    iconBg: "bg-slate-100",
    iconColor: "text-slate-500",
    borderClass: "border-slate-200",
    ctaClass: "",
    features: [
      "2 borrows per month",
      "Unlimited swaps & gifts",
      "Create & list items",
      "Community messaging",
      "Basic search & browse",
    ],
    notes: ["5% platform fee on rentals", "Standard matching priority"],
    highlight: false,
  },
  {
    id: "member",
    name: "Member",
    price: 4.99,
    priceLabel: "$4.99 / month",
    icon: Star,
    iconBg: "bg-teal-50",
    iconColor: "text-teal-600",
    borderClass: "border-teal-400",
    ctaClass: "bg-teal-600 hover:bg-teal-700 text-white",
    features: [
      "Unlimited borrows",
      "Unlimited swaps & gifts",
      "Priority matching",
      "Extended borrow periods",
      "Create & list items",
    ],
    notes: ["5% platform fee on rentals"],
    highlight: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: 9.99,
    priceLabel: "$9.99 / month",
    icon: Crown,
    iconBg: "bg-amber-50",
    iconColor: "text-amber-500",
    borderClass: "border-amber-400",
    ctaClass: "bg-amber-500 hover:bg-amber-600 text-white",
    features: [
      "Everything in Member",
      "Reduced 4% platform fee (vs. 5%)",
      "Featured item listings",
      "Rental & lending analytics",
      "Instant request approval",
      "Waived late return fees",
    ],
    notes: [],
    highlight: false,
  },
];

export default function PremiumPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: subStatus, isLoading: statusLoading } = useQuery<SubscriptionStatus>({
    queryKey: ["/api/subscription/status"],
    enabled: !!user,
  });

  const currentTier = subStatus?.subscriptionTier || "free";

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
        description: error.message || "Failed to start checkout. Please try again.",
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
        title: "Failed to open subscription portal",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Handle return from Stripe Checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      toast({
        title: "Subscription activated!",
        description: "Welcome! Your new plan benefits are now active.",
      });
      window.history.replaceState({}, "", "/premium");
    } else if (params.get("canceled") === "true") {
      toast({
        title: "Checkout canceled",
        description: "No charges were made.",
      });
      window.history.replaceState({}, "", "/premium");
    }
  }, []);

  const handleSubscribe = (tier: string) => {
    if (!user) {
      navigate("/auth");
      return;
    }
    checkoutMutation.mutate(tier);
  };

  const hasActivePaidSub = currentTier !== "free" && subStatus?.stripeSubscriptionStatus === "active";

  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-50/40 to-white">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Back button */}
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-teal-600 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </button>

        {/* Page header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">Choose Your Plan</h1>
          <p className="text-slate-500 max-w-md mx-auto">
            Share more, own less. Upgrade for unlimited borrows, reduced fees, and priority access.
          </p>
        </div>

        {/* Current plan status bar */}
        {user && !statusLoading && (
          <div className="mb-8 flex flex-wrap items-center justify-between gap-3 bg-white border border-teal-100 rounded-2xl px-5 py-4 shadow-sm">
            <div>
              <p className="text-xs text-slate-400 mb-0.5">Current Plan</p>
              <p className="font-semibold text-slate-800 capitalize flex items-center gap-2">
                {currentTier === "pro" && <Crown className="w-4 h-4 text-amber-500" />}
                {currentTier === "member" && <Star className="w-4 h-4 text-teal-600" />}
                {currentTier === "free" && <Zap className="w-4 h-4 text-slate-400" />}
                ShareSwap {currentTier.charAt(0).toUpperCase() + currentTier.slice(1)}
                {hasActivePaidSub && (
                  <Badge className="bg-green-50 text-green-700 border-green-200 text-xs ml-1">Active</Badge>
                )}
              </p>
              {currentTier === "free" && (
                <p className="text-xs text-slate-400 mt-0.5">
                  {subStatus?.monthlyBorrowCount ?? 0} / 2 borrows used this month
                </p>
              )}
            </div>
            {hasActivePaidSub && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
                className="flex items-center gap-1.5 text-slate-600 border-slate-200"
              >
                {portalMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Settings className="w-3.5 h-3.5" />
                )}
                Manage Subscription
              </Button>
            )}
          </div>
        )}

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {plans.map((plan) => {
            const Icon = plan.icon;
            const isCurrentPlan = currentTier === plan.id;
            const isCheckingOut = checkoutMutation.isPending && (checkoutMutation.variables as string) === plan.id;

            return (
              <div
                key={plan.id}
                className={`relative bg-white rounded-2xl border-2 p-6 flex flex-col shadow-sm transition-all ${plan.borderClass} ${
                  plan.highlight ? "shadow-teal-100 shadow-md" : ""
                } ${isCurrentPlan ? "ring-2 ring-teal-400 ring-offset-1" : ""}`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-teal-600 text-white text-xs px-3">Most Popular</Badge>
                  </div>
                )}

                {/* Icon + title */}
                <div className="flex items-center gap-3 mb-4">
                  <div className={`p-2 rounded-xl ${plan.iconBg}`}>
                    <Icon className={`w-5 h-5 ${plan.iconColor}`} />
                  </div>
                  <div>
                    <h2 className="font-bold text-slate-800 text-lg leading-tight">{plan.name}</h2>
                    <p className="text-sm text-slate-400">{plan.priceLabel}</p>
                  </div>
                </div>

                {/* Price */}
                <div className="mb-5">
                  {plan.price === 0 ? (
                    <span className="text-2xl font-bold text-slate-600">$0</span>
                  ) : (
                    <span className="text-2xl font-bold text-slate-800">
                      ${plan.price}
                      <span className="text-sm font-normal text-slate-400"> /mo</span>
                    </span>
                  )}
                </div>

                {/* Features list */}
                <ul className="space-y-2.5 mb-6 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-slate-600">
                      <Check className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />
                      {feature}
                    </li>
                  ))}
                  {plan.notes.map((note) => (
                    <li key={note} className="flex items-start gap-2 text-sm text-slate-400">
                      <div className="w-4 h-4 shrink-0 mt-1 flex items-center justify-center">
                        <div className="w-1 h-1 rounded-full bg-slate-300" />
                      </div>
                      {note}
                    </li>
                  ))}
                </ul>

                {/* CTA button */}
                {plan.id === "free" ? (
                  <Button variant="outline" className="w-full rounded-xl text-slate-400 cursor-default" disabled>
                    {isCurrentPlan ? "Your Current Plan" : "Free Plan"}
                  </Button>
                ) : isCurrentPlan ? (
                  <Button variant="outline" className="w-full rounded-xl border-teal-200 text-teal-600" disabled>
                    ✓ Current Plan
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={checkoutMutation.isPending}
                    className={`w-full rounded-xl font-semibold ${plan.ctaClass}`}
                  >
                    {isCheckingOut ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      plan.id === "member" ? "Subscribe — $4.99/mo" : "Subscribe — $9.99/mo"
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-slate-400 mt-8">
          Subscriptions renew monthly · Cancel anytime via Manage Subscription · 3% Stripe processing fee on paid rentals
        </p>
      </div>
    </div>
  );
}
