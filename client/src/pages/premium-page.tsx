import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Navbar } from "@/components/shared/navbar";
import { Crown, Check, Star, Zap, Shield, Users, Gift } from "lucide-react";

interface SubscriptionPlan {
  id: number;
  name: string;
  description: string;
  monthlyPrice: string;
  annualPrice?: string;
  features: string[];
  discountPercentage: number;
  priorityAccess: boolean;
  lowerFees: boolean;
  isActive: boolean;
}

interface UserSubscription {
  id: number;
  startDate: string;
  endDate: string;
  status: string;
  autoRenew: boolean;
  planName: string;
  planDescription: string;
  monthlyPrice: string;
  features: string[];
}

export default function PremiumPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: plans, isLoading: plansLoading } = useQuery<SubscriptionPlan[]>({
    queryKey: ['/api/subscription-plans'],
  });

  const { data: currentSubscription, isLoading: subscriptionLoading } = useQuery<UserSubscription | null>({
    queryKey: ['/api/user-subscription'],
  });

  const subscribeMutation = useMutation({
    mutationFn: async (planId: number) => {
      return apiRequest("POST", "/api/subscribe", { planId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user-subscription'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      toast({
        title: "Welcome to Premium!",
        description: "Your subscription has been activated. Enjoy exclusive benefits!",
      });
    },
    onError: () => {
      toast({
        title: "Subscription failed",
        description: "Unable to process subscription. Please try again or contact support.",
        variant: "destructive",
      });
    },
  });

  const getFeatureIcon = (feature: string) => {
    if (feature.toLowerCase().includes('priority')) return <Zap className="h-4 w-4 text-teal-600" />;
    if (feature.toLowerCase().includes('fee')) return <Gift className="h-4 w-4 text-teal-600" />;
    if (feature.toLowerCase().includes('support')) return <Shield className="h-4 w-4 text-teal-600" />;
    if (feature.toLowerCase().includes('access')) return <Star className="h-4 w-4 text-teal-600" />;
    return <Check className="h-4 w-4 text-primary" />;
  };

  if (plansLoading || subscriptionLoading) {
    return (
      <div className="min-h-screen bg-[#F3F4F6]">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 py-12">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-6 md:py-12">
        <div className="text-center mb-6 md:mb-12">
          <h1 className="text-xl md:text-4xl font-bold mb-2 md:mb-4 flex items-center justify-center gap-2 md:gap-3">
            <Crown className="h-6 w-6 md:h-10 md:w-10 text-teal-600" />
            Upgrade to Premium
          </h1>
          <p className="text-sm md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Get priority access, lower fees, and exclusive features to maximize your sharing experience
          </p>
        </div>

        {/* Current Subscription Status */}
        {currentSubscription && (
          <Card className="mb-8 border-2 border-teal-200 bg-teal-50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Crown className="h-6 w-6 text-teal-600" />
                  <div>
                    <h3 className="font-semibold text-teal-800">Active Premium Subscription</h3>
                    <p className="text-sm text-teal-600">
                      {currentSubscription.planName} - Active until {new Date(currentSubscription.endDate).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <Badge className="bg-teal-100 text-teal-800">
                  {currentSubscription.status === 'active' ? 'Active' : currentSubscription.status}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Subscription Plans */}
        {!currentSubscription && (
          <div className="grid md:grid-cols-2 gap-4 md:gap-8 mb-6 md:mb-12">
            {plans?.map((plan) => {
              const isPopular = plan.name.includes('Premium');
              const annualSavings = plan.annualPrice 
                ? ((parseFloat(plan.monthlyPrice) * 12) - parseFloat(plan.annualPrice)).toFixed(2)
                : 0;

              return (
                <Card 
                  key={plan.id} 
                  className={`relative ${isPopular ? 'border-2 border-primary shadow-lg' : ''}`}
                >
                  {isPopular && (
                    <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                      <Badge className="bg-primary text-white px-3 md:px-4 py-1 text-xs md:text-sm">
                        <Star className="h-2.5 w-2.5 md:h-3 md:w-3 mr-1" />
                        Most Popular
                      </Badge>
                    </div>
                  )}
                  
                  <CardHeader className="text-center pb-2 md:pb-4 px-4 md:px-6 pt-4 md:pt-6">
                    <CardTitle className="text-base md:text-2xl font-bold flex items-center justify-center gap-1.5 md:gap-2">
                      <Crown className={`h-4 w-4 md:h-6 md:w-6 ${isPopular ? 'text-teal-600' : 'text-gray-400'}`} />
                      {plan.name}
                    </CardTitle>
                    <p className="text-xs md:text-base text-muted-foreground">{plan.description}</p>
                    
                    <div className="mt-2 md:mt-4">
                      <div className="text-2xl md:text-4xl font-bold text-primary">
                        ${plan.monthlyPrice}
                        <span className="text-sm md:text-lg text-muted-foreground">/month</span>
                      </div>
                      {plan.annualPrice && (
                        <div className="mt-1 md:mt-2">
                          <Badge variant="outline" className="bg-teal-50 text-teal-700 text-xs md:text-sm">
                            Save ${annualSavings}/year with annual billing
                          </Badge>
                        </div>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="px-4 md:px-6 pb-4 md:pb-6">
                    <div className="space-y-2 md:space-y-3 mb-3 md:mb-6">
                      {plan.features.map((feature, index) => (
                        <div key={index} className="flex items-start gap-2 md:gap-3">
                          {getFeatureIcon(feature)}
                          <span className="text-xs md:text-sm">{feature}</span>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2 md:space-y-3">
                      <Button
                        onClick={() => subscribeMutation.mutate(plan.id)}
                        disabled={subscribeMutation.isPending}
                        className={`w-full text-xs md:text-sm h-8 md:h-10 ${isPopular ? 'bg-primary hover:bg-primary/90' : ''}`}
                        variant={isPopular ? 'default' : 'outline'}
                      >
                        {subscribeMutation.isPending ? 'Processing...' : `Upgrade to ${plan.name}`}
                      </Button>
                      
                      {plan.annualPrice && (
                        <Button
                          variant="ghost"
                          className="w-full text-xs md:text-sm h-8 md:h-10"
                        >
                          Or pay ${plan.annualPrice} annually (2 months free!)
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Benefits Overview */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-center">Why Go Premium?</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="bg-teal-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Zap className="h-8 w-8 text-teal-600" />
                </div>
                <h3 className="font-semibold mb-2">Priority Access</h3>
                <p className="text-sm text-muted-foreground">
                  Get first dibs on the most popular items before they're fully booked
                </p>
              </div>
              
              <div className="text-center">
                <div className="bg-teal-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Gift className="h-8 w-8 text-teal-600" />
                </div>
                <h3 className="font-semibold mb-2">Lower Fees</h3>
                <p className="text-sm text-muted-foreground">
                  Save money with reduced transaction fees on all your borrowing and lending
                </p>
              </div>
              
              <div className="text-center">
                <div className="bg-teal-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Shield className="h-8 w-8 text-teal-600" />
                </div>
                <h3 className="font-semibold mb-2">Premium Support</h3>
                <p className="text-sm text-muted-foreground">
                  Get faster response times and dedicated support when you need help
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* FAQ Section */}
        <Card>
          <CardHeader>
            <CardTitle>Frequently Asked Questions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div>
                <h4 className="font-semibold mb-2">Can I cancel anytime?</h4>
                <p className="text-sm text-muted-foreground">
                  Yes, you can cancel your subscription at any time. You'll continue to have access until your current billing period ends.
                </p>
              </div>
              
              <div>
                <h4 className="font-semibold mb-2">What happens to my current ShareCoins?</h4>
                <p className="text-sm text-muted-foreground">
                  Your ShareCoins balance remains unchanged. Premium members just get better deals and access to exclusive opportunities to earn more.
                </p>
              </div>
              
              <div>
                <h4 className="font-semibold mb-2">Do I get priority for all items?</h4>
                <p className="text-sm text-muted-foreground">
                  Premium members get early access to high-demand items and can browse items before they're visible to free users.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}