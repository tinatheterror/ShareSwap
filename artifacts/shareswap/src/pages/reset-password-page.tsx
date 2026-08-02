import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Key, Eye, EyeOff, CheckCircle2, AlertCircle } from "lucide-react";

export default function ResetPasswordPage() {
  const searchString = useSearch();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Read token from URL query param (?token=...)
  const params = new URLSearchParams(searchString);
  const tokenFromUrl = params.get("token") ?? "";

  const [token, setToken] = useState(tokenFromUrl);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [done, setDone] = useState(false);

  // Keep token in sync if URL param is set after mount
  useEffect(() => {
    if (tokenFromUrl) setToken(tokenFromUrl);
  }, [tokenFromUrl]);

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!token.trim()) throw new Error("Reset token is required.");
      if (newPassword.length < 8) throw new Error("Password must be at least 8 characters.");
      if (newPassword !== confirmPassword) throw new Error("Passwords do not match.");

      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), newPassword }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Could not reset password.");
      return body;
    },
    onSuccess: () => {
      setDone(true);
    },
    onError: (error: Error) => {
      toast({
        title: "Reset failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-md border-primary/20">
          <CardContent className="pt-8 pb-6 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <h1 className="text-2xl font-bold">Password updated!</h1>
            <p className="text-muted-foreground text-sm">
              Your password has been changed successfully. You can now sign in with your new password.
            </p>
            <Button className="w-full mt-2" onClick={() => navigate("/auth")}>
              Back to sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md space-y-4">
        {/* Logo */}
        <div className="flex justify-center">
          <img
            src="/shareswap-full-logo.png"
            alt="ShareSwap"
            className="h-12 w-auto"
          />
        </div>

        <Card className="border-primary/20">
          <CardContent className="pt-6 space-y-5">
            {/* Header */}
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                <Key className="h-7 w-7 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Set a new password</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter the token from your reset email and choose a new password.
                </p>
              </div>
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); resetMutation.mutate(); }}
              className="space-y-4"
            >
              {/* Token field (pre-filled from URL, but editable) */}
              <div className="space-y-2">
                <Label htmlFor="reset-token">Reset token</Label>
                <Input
                  id="reset-token"
                  type="text"
                  placeholder="Paste token from email"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Copy the token from the reset email, or click the link in the email to pre-fill it.
                </p>
              </div>

              {/* New password */}
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNew ? "text" : "password"}
                    placeholder="At least 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    className="pr-10"
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirm ? "text" : "password"}
                    placeholder="Re-enter new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Passwords do not match
                  </p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={resetMutation.isPending}
              >
                {resetMutation.isPending ? "Updating…" : "Reset password"}
              </Button>
            </form>

            <div className="text-center">
              <button
                type="button"
                onClick={() => navigate("/auth")}
                className="text-sm text-muted-foreground hover:text-primary underline inline-flex items-center gap-1"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to sign in
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
