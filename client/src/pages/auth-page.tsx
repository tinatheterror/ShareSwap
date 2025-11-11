import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { RollingCounter } from "@/components/rolling-counter";
import { Lock } from "lucide-react";

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
            className="w-11/12 h-auto my-12"
          />
        </div>
        <Card className="w-full max-w-md border-primary/20">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-center mb-2">
                Sign in and start sharing with your community
              </h2>
              <p className="text-sm text-muted-foreground text-center mb-6"></p>

              <Button
                onClick={() => (window.location.href = "/api/auth/google")}
                className="w-full bg-primary hover:bg-primary/90 h-11"
              >
                Continue with Google
              </Button>
              <p className="text-xs text-center text-muted-foreground px-2">
                Secure and simple. Your privacy always comes first.{" "}
              </p>

              <Button variant="outline" className="w-full h-11" disabled>
                Continue with Phone Number
              </Button>
              <p className="text-xs text-center text-muted-foreground px-2">
                Verify your number to build local trust. neighbourhood.
              </p>

              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mt-6">
                <Lock className="h-3 w-3" />
                <span>
                  Your identity helps keep ShareSwap safe and neighbourly.
                </span>
              </div>

              <div className="text-center mt-6 pt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  No account?{" "}
                  <span className="text-primary font-medium">Register</span>
                </p>
              </div>
            </div>
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
