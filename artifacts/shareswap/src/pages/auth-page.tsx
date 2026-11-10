import { useAuth } from "@/hooks/use-auth";
import { AgeFields, ageComplete, emptyAge, type AgeValue } from "@/components/age-fields";
import { Redirect, useSearch, useLocation } from "wouter";
import { rememberReturnTo } from "@/lib/return-to";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery, useMutation } from "@tanstack/react-query";
import { RollingCounter } from "@/components/rolling-counter";
import { Lock, Mail, RotateCcw, AlertCircle, Eye, EyeOff, Users, CheckCircle2, ArrowLeft } from "lucide-react";
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
import { googleSignInHref, isEmbeddedBrowser } from "@/lib/google-sign-in";
import { APPLE_SIGN_IN_MESSAGES, appleSignInHref } from "@/lib/apple-sign-in";

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
  const [, navigate] = useLocation();
  const [showEmailAuth, setShowEmailAuth] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [age, setAge] = useState<AgeValue>(emptyAge);
  const [referralCode, setReferralCode] = useState("");
  const [showReactivate, setShowReactivate] = useState(false);
  // Set when Google sign-in found a deactivated account: the one-time token that reactivates it.
  const [googleReactivateToken, setGoogleReactivateToken] = useState<string | null>(null);
  // Which provider issued that token; Apple and Google tokens are redeemed at different paths.
  const [reactivateProvider, setReactivateProvider] = useState<"google" | "apple">("google");
  const [showPassword, setShowPassword] = useState(false);
  const [showReferralInput, setShowReferralInput] = useState(false);
  const [isEmbeddedPreview, setIsEmbeddedPreview] = useState(false);
  // Forgot-password state
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setIsEmbeddedPreview(isEmbeddedBrowser(window));
  }, []);

  // A page that asked for a sign-in ("/auth?returnTo=/delete-account") gets the person back after it.
  useEffect(() => {
    rememberReturnTo(searchString);
  }, [searchString]);

  // Extract referral code from URL and handle verification status
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const reactivateFrom = params.get("reactivate");
    const reactivateToken = reactivateFrom === "google" || reactivateFrom === "apple" ? params.get("token") : null;
    if (reactivateToken) {
      setReactivateProvider(reactivateFrom === "apple" ? "apple" : "google");
      setGoogleReactivateToken(reactivateToken);
      setShowReactivate(true);
      // Keep the token out of the address bar and the history.
      window.history.replaceState(null, "", window.location.pathname);
    }
    const ref = params.get("ref");
    if (ref) {
      setReferralCode(ref);
      setIsLogin(false); // Switch to signup mode when coming from referral
    }
    
    const appleReason = params.get("apple");
    if (appleReason) {
      toast({
        title: "Sign in with Apple",
        description: APPLE_SIGN_IN_MESSAGES[appleReason] || APPLE_SIGN_IN_MESSAGES.failed,
        variant: "destructive",
      });
      window.history.replaceState(null, "", window.location.pathname);
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

  const forgotPasswordMutation = useMutation({
    mutationFn: async (emailArg: string) => {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailArg.trim().toLowerCase() }),
      });
      // Always 200 from backend — if not ok, surface the error
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Request failed");
      return body;
    },
    onSuccess: () => setForgotSent(true),
    onError: () => {
      // Still show "check your email" — backend intentionally non-discloses
      setForgotSent(true);
    },
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

  const googleReactivateMutation = useMutation({
    mutationFn: async (token: string) => {
      const response = await fetch(reactivateProvider === "apple" ? "/api/auth/oauth-reactivate" : "/api/auth/google-reactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `Reactivation failed. Please sign in with ${reactivateProvider === "apple" ? "Apple" : "Google"} again.`);
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Welcome back!", description: "Your account has been reactivated successfully." });
      window.location.href = "/";
    },
    onError: (error: Error) => {
      setGoogleReactivateToken(null);
      setShowReactivate(false);
      toast({ title: "Reactivation failed", description: error.message, variant: "destructive" });
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
    mutationFn: async (credentials: { username: string; password: string; fullName?: string; referralCode?: string; deviceFingerprint?: string; acceptedTerms: boolean; dateOfBirth: string; region: string }) => {
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
        fullName: fullName.trim() || undefined,
        referralCode: referralCode.trim() || undefined,
        deviceFingerprint,
        acceptedTerms,
        dateOfBirth: age.dateOfBirth,
        region: age.region,
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
            className="w-9/12 h-auto my-4 pt-16 mx-auto scale-y-[0.70] sm:scale-y-100"
          />
        </div>
        <Card className="w-full max-w-md border-primary bg-primary text-primary-foreground [&_.text-muted-foreground]:text-primary-foreground/80 [&_.text-primary]:text-primary-foreground [&_.border-t]:border-primary-foreground/30">
          <CardContent className="pt-6">
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold text-center mb-1">
                Sign in and discover a world of shared resources
              </h2>

              <Button asChild variant="outline" className="w-full bg-white text-black border-black hover:bg-neutral-100 hover:text-black h-11 gap-2">
                <a
                  href={appleSignInHref(referralCode, import.meta.env.BASE_URL)}
                  target={isEmbeddedPreview ? "_blank" : undefined}
                  rel={isEmbeddedPreview ? "noopener noreferrer" : undefined}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" /></svg>
                  Continue with Apple
                </a>
              </Button>

              <Button
                asChild
                variant="outline"
                className="w-full bg-white text-black border-black hover:bg-neutral-100 hover:text-black h-11 gap-2"
              >
                <a
                  href={googleSignInHref(referralCode, import.meta.env.BASE_URL)}
                  target={isEmbeddedPreview ? "_blank" : undefined}
                  rel={isEmbeddedPreview ? "noopener noreferrer" : undefined}
                >
                  <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" /><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" /></svg>
                  Continue with Google
                </a>
              </Button>
              {isEmbeddedPreview && (
                <p className="text-xs text-center text-muted-foreground">
                  Apple and Google sign-in open in a new tab. Continue using ShareSwap in that tab.
                </p>
              )}

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
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  type="text"
                  placeholder="Avery Smith"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
            )}
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
            {!isLogin && <AgeFields value={age} onChange={setAge} idPrefix="signup-age" />}
            {!isLogin && (
              <label className="flex items-start gap-2 text-sm text-gray-700" htmlFor="acceptedTerms">
                <input
                  id="acceptedTerms"
                  type="checkbox"
                  className="mt-1"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  data-testid="accept-terms-checkbox"
                />
                <span>
                  I agree to the{" "}
                  <a href="/terms" target="_blank" rel="noreferrer" className="text-teal-600 underline">Terms of Service</a>
                  {" "}and{" "}
                  <a href="/community-guidelines" target="_blank" rel="noreferrer" className="text-teal-600 underline">Community Guidelines</a>
                  , including no tolerance for objectionable content or abusive people.
                </span>
              </label>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending || registerMutation.isPending || (!isLogin && (!acceptedTerms || !ageComplete(age)))}
            >
              {loginMutation.isPending || registerMutation.isPending
                ? "Please wait..."
                : isLogin
                  ? "Sign In"
                  : "Create Account"}
            </Button>
            {isLogin && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setForgotEmail(email);
                    setForgotSent(false);
                    setShowEmailAuth(false);
                    setShowForgotPassword(true);
                  }}
                  className="text-xs text-muted-foreground hover:text-primary underline"
                >
                  Forgot password?
                </button>
              </div>
            )}
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

      {/* ── Forgot Password Dialog ─────────────────────────────────── */}
      <Dialog
        open={showForgotPassword}
        onOpenChange={(open) => {
          setShowForgotPassword(open);
          if (!open) { setForgotEmail(""); setForgotSent(false); }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-primary" />
              {forgotSent ? "Check your email" : "Forgot password?"}
            </DialogTitle>
          </DialogHeader>

          {!forgotSent ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                forgotPasswordMutation.mutate(forgotEmail);
              }}
              className="space-y-4"
            >
              <p className="text-sm text-muted-foreground">
                Enter your account email and we'll send you a reset link.
              </p>
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="your@email.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={forgotPasswordMutation.isPending}
              >
                {forgotPasswordMutation.isPending ? "Sending…" : "Send reset link"}
              </Button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setShowEmailAuth(true);
                  }}
                  className="text-sm text-muted-foreground hover:text-primary underline inline-flex items-center gap-1"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back to sign in
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="h-7 w-7 text-green-600" />
                </div>
                <p className="text-sm text-muted-foreground">
                  If an account exists for{" "}
                  <span className="font-medium text-foreground">{forgotEmail.trim().toLowerCase()}</span>
                  , you'll receive a reset email shortly.
                </p>
                <p className="text-xs text-muted-foreground">
                  Click the link in the email to open the reset page, or copy the token and enter it manually.
                </p>
              </div>
              <Button
                className="w-full"
                onClick={() => {
                  setShowForgotPassword(false);
                  navigate("/reset-password");
                }}
              >
                Enter reset token
              </Button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setForgotSent(false);
                    setShowEmailAuth(true);
                  }}
                  className="text-sm text-muted-foreground hover:text-primary underline inline-flex items-center gap-1"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back to sign in
                </button>
              </div>
            </div>
          )}
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
                  setGoogleReactivateToken(null);
                  setEmail("");
                  setPassword("");
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={() =>
                  googleReactivateToken
                    ? googleReactivateMutation.mutate(googleReactivateToken)
                    : reactivateMutation.mutate({ username: email, password })
                }
                disabled={reactivateMutation.isPending || googleReactivateMutation.isPending}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                {reactivateMutation.isPending || googleReactivateMutation.isPending
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
