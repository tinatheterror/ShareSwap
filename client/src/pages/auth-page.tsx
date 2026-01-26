import { useAuth } from "@/hooks/use-auth";
import { Redirect, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery, useMutation } from "@tanstack/react-query";
import { RollingCounter } from "@/components/rolling-counter";
import { Lock, Mail, RotateCcw, AlertCircle, Eye, EyeOff, Users, CheckCircle2 } from "lucide-react";
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

// Generate a simple device fingerprint for anti-fraud
function generateDeviceFingerprint(): string {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillText("ShareSwap", 2, 2);
  }
  const canvasData = canvas.toDataURL();
  const screen = `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const language = navigator.language;
  const platform = navigator.platform;
  const fingerprint = `${canvasData}-${screen}-${timezone}-${language}-${platform}`;
  // Create a simple hash
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export default function AuthPage() {
  const { user } = useAuth();
  const searchString = useSearch();
  const [showEmailAuth, setShowEmailAuth] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [showReactivate, setShowReactivate] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showReferralInput, setShowReferralInput] = useState(false);
  const { toast } = useToast();

  // Extract referral code from URL and handle verification status
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const ref = params.get("ref");
    if (ref) {
      setReferralCode(ref);
      setIsLogin(false); // Switch to signup mode when coming from referral
    }
    
    // Handle email verification status
    const verified = params.get("verified");
    const error = params.get("error");
    
    if (verified === "true") {
      toast({
        title: "Email verified!",
        description: "Your email has been successfully verified. You can now log in.",
      });
    } else if (error) {
      const errorMessages: Record<string, string> = {
        missing_token: "Verification link is invalid.",
        invalid_token: "This verification link is invalid or has already been used.",
        token_expired: "This verification link has expired. Please request a new one.",
        verification_failed: "Email verification failed. Please try again.",
      };
      toast({
        title: "Verification failed",
        description: errorMessages[error] || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    }
  }, [searchString, toast]);

  // Fetch platform statistics
  const { data: stats, isLoading: statsLoading } = useQuery<{
    itemsShared: number;
    totalUsers: number;
    successfulTransactions: number;
  }>({
    queryKey: ["/api/stats"],
    staleTime: 5 * 60 * 1000,
  });

  const reactivateMutation = useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      const response = await fetch("/api/reactivate-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Reactivation failed");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Welcome back!",
        description: "Your account has been reactivated successfully.",
      });
      window.location.href = "/";
    },
    onError: (error: Error) => {
      toast({
        title: "Reactivation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: { username: string; password: string; deviceFingerprint?: string }) => {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      if (!response.ok) {
        const error = await response.json();
        if (response.status === 403 && error.accountStatus === "deactivated") {
          throw { ...error, isDeactivated: true };
        }
        throw new Error(error.message || "Login failed");
      }
      return response.json();
    },
    onSuccess: () => {
      window.location.href = "/";
    },
    onError: (error: any) => {
      if (error.isDeactivated) {
        setShowReactivate(true);
        return;
      }
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (credentials: { username: string; password: string; referralCode?: string; deviceFingerprint?: string }) => {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Registration failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.referralApplied) {
        sessionStorage.setItem("referralApplied", "true");
      }
      toast({
        title: "Account created!",
        description: "Please check your email to verify your account.",
      });
      window.location.href = "/";
    },
    onError: (error: Error) => {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEmailAuth = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLogin) {
      const deviceFingerprint = generateDeviceFingerprint();
      loginMutation.mutate({ username: email, password, deviceFingerprint });
    } else {
      const deviceFingerprint = generateDeviceFingerprint();
      registerMutation.mutate({ 
        username: email, 
        password, 
        referralCode: referralCode.trim() || undefined,
        deviceFingerprint 
      });
    }
  };

  if (user) {
    return <Redirect to="/" />;
  }

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      <div className="flex flex-col items-center px-8 pt-4">
        <div className="w-full max-w-md mb-4">
          <img
            src="/shareswap-full-logo.png"
            alt="ShareSwap"
            className="w-9/12 h-auto my-4 pt-16 mx-auto"
          />
        </div>
        <Card className="w-full max-w-md border-primary/20">
          <CardContent className="pt-6">
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold text-center mb-1">
                Sign in and discover a world of shared resources
              </h2>

              <Button
                onClick={() => {
                  const url = referralCode.trim() 
                    ? `/api/auth/google?ref=${encodeURIComponent(referralCode.trim())}`
                    : "/api/auth/google";
                  window.location.href = url;
                }}
                className="w-full bg-primary hover:bg-primary/90 h-11"
              >
                Continue with Google
              </Button>

              <Button variant="outline" className="w-full h-11" disabled>
                Continue with Phone Number
              </Button>

              <div className="text-center mt-6">
                <button
                  onClick={() => setShowEmailAuth(true)}
                  className="text-xs text-muted-foreground underline font-medium"
                >
                  Continue with Email
                </button>
              </div>

              {!showReferralInput ? (
                <div className="flex items-start gap-2 ml-4">
                  <Users className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    onClick={() => setShowReferralInput(true)}
                    className="text-[10px] text-muted-foreground hover:text-primary transition-colors underline"
                  >
                    Have a referral code?
                  </button>
                </div>
              ) : (
                <div className="space-y-2 animate-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center justify-center gap-2">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    <Label htmlFor="main-referral" className="text-xs text-muted-foreground">Referral code</Label>
                  </div>
                  <Input
                    id="main-referral"
                    type="text"
                    placeholder="Enter referral code"
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                    className="h-9 text-sm"
                    autoFocus
                  />
                </div>
              )}

              <div className="flex items-start justify-center gap-2 text-sm text-primary mt-4 pt-4 border-t font-medium">
                <Lock className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>Your identity helps keep ShareSwap safe and honest.</span>
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

      <Dialog open={showEmailAuth} onOpenChange={setShowEmailAuth}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isLogin ? "Sign in with Email" : "Create Account"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="text"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            {!isLogin && referralCode && (
              <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg border border-green-200">
                <Users className="h-4 w-4 text-green-600" />
                <p className="text-xs text-green-700">
                  Referral code <span className="font-medium">{referralCode}</span> applied
                </p>
              </div>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending || registerMutation.isPending}
            >
              {loginMutation.isPending || registerMutation.isPending
                ? "Please wait..."
                : isLogin
                  ? "Sign In"
                  : "Create Account"}
            </Button>
            {!isLogin && (
              <p className="text-xs text-gray-500 text-center">
                You can browse right away. Verification is only required for
                borrowing and renting.
              </p>
            )}
            <div className="text-center">
              <button
                type="button"
                onClick={() => setIsLogin(!isLogin)}
                className="text-sm text-primary hover:underline"
              >
                {isLogin
                  ? "New here? Create an account"
                  : "Already have an account? Sign in"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showReactivate} onOpenChange={setShowReactivate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Account Deactivated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-gray-600">
              Your account has been deactivated. Your profile and listings are
              currently hidden from other users.
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800 font-medium mb-1">
                Want to come back?
              </p>
              <p className="text-sm text-blue-700">
                Click the button below to instantly reactivate your account and
                restore your profile.
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowReactivate(false);
                  setEmail("");
                  setPassword("");
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={() =>
                  reactivateMutation.mutate({ username: email, password })
                }
                disabled={reactivateMutation.isPending}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                {reactivateMutation.isPending
                  ? "Reactivating..."
                  : "Reactivate Account"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
