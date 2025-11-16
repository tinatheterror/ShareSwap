import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { RollingCounter } from "@/components/rolling-counter";
import { Lock, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function AuthPage() {
  const { user } = useAuth();

  // Fetch platform statistics
  const { data: stats, isLoading: statsLoading } = useQuery<{
    itemsShared: number;
    totalUsers: number;
    successfulTransactions: number;
  }>({
    queryKey: ["/api/stats"],
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  if (user) {
    return <Redirect to="/" />;
  }

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      <div className="flex flex-col items-center px-8 pt-4">
        <div className="w-full max-w-md mb-4">
          <img
            src="/logo-shareswap.png"
            alt="ShareSwap Logo"
            className="w-11/12 h-auto my-4 pt-16"
          />
        </div>
        <Card className="w-full max-w-md border-primary/20">
          <CardContent className="pt-6">
            <TooltipProvider>
              <div className="space-y-3">
                <h2 className="text-2xl font-semibold text-center mb-1">
                  Sign in and spread a little neighbourly magic✨
                </h2>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => (window.location.href = "/api/auth/google")}
                    className="flex-1 bg-primary hover:bg-primary/90 h-11"
                  >
                    Continue with Google
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-muted-foreground cursor-help flex-shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>Secure and simple. Your privacy always comes first.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>

                <div className="flex items-center gap-2">
                  <Button variant="outline" className="flex-1 h-11" disabled>
                    Continue with Phone Number
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-muted-foreground cursor-help flex-shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>Verify your number to build local trust.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>

              <div className="flex items-center justify-center gap-2 text-sm text-foreground/80 mt-4 font-medium">
                <Lock className="h-4 w-4" />
                <span>Your identity helps keep ShareSwap safe and honest.</span>
              </div>

                <div className="text-center mt-6 pt-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    No account? Signing in will create one for you.
                  </p>
                </div>
              </div>
            </TooltipProvider>
          </CardContent>
        </Card>
      </div>

      <div className="hidden md:block bg-primary">
        <div className="h-full w-full p-12 flex items-center">
          <div className="max-w-lg">
            <h1 className="text-3xl font-bold text-white mb-8">
              Welcome to ShareSwap
            </h1>
            <p className="text-lg text-primary-foreground/90 mb-12">
              Share more, own less. Connect with your neighbours and discover a
              world of shared resources.
            </p>

            {/* Platform Statistics */}
            <div className="flex items-baseline gap-3">
              <span className="text-xl font-bold text-white">
                {statsLoading ? (
                  "Loading..."
                ) : (
                  <RollingCounter
                    target={stats?.itemsShared || 0}
                    duration={3000}
                    className="text-white"
                  />
                )}
              </span>
              <span className="text-xl text-primary-foreground/90 font-bold italic tracking-wide">
                items shared within our community.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
