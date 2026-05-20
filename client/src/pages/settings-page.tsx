import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  Settings,
  Shield,
  AlertTriangle,
  UserX,
  Mail,
  Phone,
  Coins,
  CheckCircle2,
  XCircle,
  CreditCard,
  TrendingUp,
  Package,
  Clock,
  Award,
  MessageSquare,
  Calendar,
  Star,
  DollarSign,
  ChevronRight,
} from "lucide-react";
import { Navbar } from "@/components/shared/navbar";

const TEAL = "#0DCEA1";

export default function SettingsPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [isDeactivated, setIsDeactivated] = useState(false);
  const [phone, setPhone] = useState((user as any)?.phone || "");
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const { data: profile } = useQuery<any>({
    queryKey: ["/api/user-profile"],
  });

  const updatePhoneMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      const res = await apiRequest("PATCH", "/api/user-profile", { phone: phoneNumber });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "Phone number saved", description: "Your phone number has been updated." });
    },
    onError: (error: any) => {
      toast({ title: "Failed to save", description: error.message || "Could not update phone number.", variant: "destructive" });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/account/change-password", { currentPassword, newPassword });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Password changed", description: "Your password has been updated successfully." });
      setShowChangePassword(false);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    },
    onError: (error: any) => {
      toast({ title: "Failed to change password", description: error.message || "Could not update password.", variant: "destructive" });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/account/deactivate", { confirmDeactivation: true });
      return res.json();
    },
    onSuccess: () => {
      setIsDeactivated(true);
      setIsDeactivateOpen(false);
      queryClient.clear();
    },
    onError: (error: any) => {
      toast({ title: "Cannot Deactivate", description: error.message || "Failed to deactivate account", variant: "destructive" });
    },
  });

  if (isDeactivated) {
    return (
      <div className="min-h-screen bg-[#F3F4F6] flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <div className="mx-auto w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-4">
              <UserX className="h-8 w-8 text-amber-600" />
            </div>
            <CardTitle className="text-2xl">Account Deactivated</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-600 text-sm">Your profile and listings are now hidden. Transaction history, messages, and reviews are preserved.</p>
            <Button onClick={() => navigate("/auth")} className="w-full mt-4">Return to Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const shareCoins = Number(profile?.shareCoins ?? (user as any)?.shareCoins ?? 0);
  const rentalBalance = Number((user as any)?.rentalBalance ?? 0);
  const pendingRentalBalance = Number((user as any)?.pendingRentalBalance ?? 0);
  const trustScore = profile?.trustScore ?? 0;
  const reputationLevel = profile?.reputationLevel ?? (user as any)?.reputationLevel ?? "Newcomer";
  const reputationScore = profile?.reputationScore ?? 0;
  const completedShares = profile?.completedShares ?? 0;
  const onTimeReturnRate = profile?.onTimeReturnRate;
  const replyRate = profile?.replyRate;
  const issuesCount = profile?.issuesCount ?? 0;
  const emailVerified = profile?.emailVerified ?? false;
  const idVerified = profile?.idVerified ?? false;
  const paymentVerified = profile?.paymentVerified ?? false;
  const isFullyVerified = idVerified && paymentVerified;

  const levelColors: Record<string, string> = {
    Newcomer: "bg-gray-100 text-gray-700",
    "Trusted Sharer": "bg-blue-100 text-blue-700",
    "Community Star": "bg-purple-100 text-purple-700",
    "ShareSwap Hero": "bg-amber-100 text-amber-700",
    "Legend": "bg-teal-100 text-teal-700",
  };
  const levelColor = levelColors[reputationLevel] || "bg-gray-100 text-gray-700";

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <Button variant="ghost" onClick={() => window.history.back()} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />Back
        </Button>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg" style={{ backgroundColor: `${TEAL}18` }}>
            <Settings className="h-6 w-6" style={{ color: TEAL }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Account</h1>
            <p className="text-gray-500 text-sm">Manage your profile, balance & settings</p>
          </div>
        </div>

        {/* ── My Balance ── */}
        <section className="mb-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2 px-1">My Balance</h2>
          <Card>
            <CardContent className="pt-4 pb-3 space-y-3">
              {/* ShareCoins */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: `${TEAL}18` }}>
                    <Coins className="h-5 w-5" style={{ color: TEAL }} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">ShareCoins</p>
                    <p className="text-xs text-gray-500">Used for borrowing & swapping</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold" style={{ color: TEAL }}>{Math.round(shareCoins)}</p>
                  <p className="text-[10px] text-gray-400">coins</p>
                </div>
              </div>

              <Separator />

              {/* Rental Balance */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-green-50 flex items-center justify-center">
                    <DollarSign className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Rental Earnings</p>
                    <p className="text-xs text-gray-500">
                      {pendingRentalBalance > 0 ? `$${pendingRentalBalance.toFixed(2)} pending` : "From completed rentals"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-green-600">${rentalBalance.toFixed(2)}</p>
                  <p className="text-[10px] text-gray-400">available</p>
                </div>
              </div>

              <div className="pt-1">
                <Link href="/sharecoins-info">
                  <button className="text-xs font-medium flex items-center gap-1" style={{ color: TEAL }}>
                    Learn about ShareCoins <ChevronRight className="h-3 w-3" />
                  </button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ── Verification Status ── */}
        <section className="mb-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2 px-1">Verification Status</h2>
          <Card>
            <CardContent className="pt-4 pb-3 space-y-3">
              {/* Overall badge */}
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-gray-700">Overall Status</p>
                {isFullyVerified ? (
                  <Badge className="bg-teal-100 text-teal-700 border-teal-200">✓ Fully Verified</Badge>
                ) : (
                  <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">Verification Incomplete</Badge>
                )}
              </div>

              <Separator />

              {/* Email */}
              <div className="flex items-center justify-between py-0.5">
                <div className="flex items-center gap-2.5">
                  <Mail className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Email Address</p>
                    <p className="text-xs text-gray-500">{(user as any)?.email || user?.username}</p>
                  </div>
                </div>
                {emailVerified
                  ? <CheckCircle2 className="h-5 w-5 text-teal-500 flex-shrink-0" />
                  : <XCircle className="h-5 w-5 text-gray-300 flex-shrink-0" />}
              </div>

              <Separator />

              {/* ID */}
              <div className="flex items-center justify-between py-0.5">
                <div className="flex items-center gap-2.5">
                  <Shield className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Identity (ID + Selfie)</p>
                    <p className="text-xs text-gray-500">{idVerified ? "Verified via Persona" : "Not yet verified"}</p>
                  </div>
                </div>
                {idVerified
                  ? <CheckCircle2 className="h-5 w-5 text-teal-500 flex-shrink-0" />
                  : (
                    <div className="flex items-center gap-1.5">
                      <XCircle className="h-5 w-5 text-gray-300 flex-shrink-0" />
                      <Link href="/verify">
                        <button className="text-xs font-medium" style={{ color: TEAL }}>Verify →</button>
                      </Link>
                    </div>
                  )}
              </div>

              <Separator />

              {/* Payment */}
              <div className="flex items-center justify-between py-0.5">
                <div className="flex items-center gap-2.5">
                  <CreditCard className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Payment Method</p>
                    <p className="text-xs text-gray-500">
                      {paymentVerified && profile?.paymentMethodBrand
                        ? `${profile.paymentMethodBrand} ····${profile.paymentMethodLast4}`
                        : "No card on file"}
                    </p>
                  </div>
                </div>
                {paymentVerified
                  ? <CheckCircle2 className="h-5 w-5 text-teal-500 flex-shrink-0" />
                  : (
                    <div className="flex items-center gap-1.5">
                      <XCircle className="h-5 w-5 text-gray-300 flex-shrink-0" />
                      <Link href="/verify">
                        <button className="text-xs font-medium" style={{ color: TEAL }}>Add →</button>
                      </Link>
                    </div>
                  )}
              </div>

              {!isFullyVerified && (
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 mt-1">
                  <p className="text-xs text-amber-700">
                    Complete ID + payment verification to unlock full borrowing and renting access.
                  </p>
                  <Link href="/verify">
                    <Button size="sm" className="mt-2 h-7 text-xs" style={{ backgroundColor: TEAL }}>
                      Complete Verification
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── Account Statistics ── */}
        <section className="mb-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2 px-1">Account Statistics</h2>
          <Card>
            <CardContent className="pt-4 pb-3">
              {/* Reputation level */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center flex-shrink-0">
                    <Award className="h-5 w-5 text-amber-500" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Reputation</p>
                    <p className="text-sm font-semibold">{reputationScore} pts</p>
                  </div>
                </div>
                <Badge className={levelColor}>{reputationLevel}</Badge>
              </div>

              {/* Trust score bar */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5" style={{ color: TEAL }} />
                    <p className="text-xs font-medium text-gray-700">Trust Score</p>
                  </div>
                  <p className="text-xs font-semibold" style={{ color: TEAL }}>{trustScore}/100</p>
                </div>
                <Progress value={trustScore} className="h-2" />
              </div>

              <Separator className="my-3" />

              {/* Stat grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Package className="h-3.5 w-3.5 text-gray-400" />
                    <p className="text-xs text-gray-500">Completed Shares</p>
                  </div>
                  <p className="text-lg font-bold text-gray-800">{completedShares}</p>
                </div>

                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className="h-3.5 w-3.5 text-gray-400" />
                    <p className="text-xs text-gray-500">On-Time Returns</p>
                  </div>
                  <p className="text-lg font-bold text-gray-800">
                    {onTimeReturnRate != null ? `${onTimeReturnRate}%` : "—"}
                  </p>
                </div>

                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <MessageSquare className="h-3.5 w-3.5 text-gray-400" />
                    <p className="text-xs text-gray-500">Reply Rate</p>
                  </div>
                  <p className="text-lg font-bold text-gray-800">
                    {replyRate != null ? `${replyRate}%` : "—"}
                  </p>
                </div>

                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-gray-400" />
                    <p className="text-xs text-gray-500">Issues Reported</p>
                  </div>
                  <p className={`text-lg font-bold ${issuesCount > 0 ? "text-red-500" : "text-gray-800"}`}>{issuesCount}</p>
                </div>
              </div>

              {profile?.createdAt && (
                <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-100">
                  <Calendar className="h-3.5 w-3.5 text-gray-400" />
                  <p className="text-xs text-gray-500">
                    Member since {new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── Settings ── */}
        <section className="mb-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2 px-1">Settings</h2>

          <Card className="mb-3">
            <CardHeader className="py-3 pb-2">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4" style={{ color: TEAL }} />
                <CardTitle className="text-base">Contact</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="py-2">
              <div className="space-y-2">
                <p className="text-sm font-medium">Phone Number</p>
                <p className="text-xs text-gray-500">Used for account security and recovery. Not publicly visible.</p>
                <div className="flex gap-2">
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. +1 (416) 555-0123" className="flex-1" />
                  <Button size="sm" onClick={() => updatePhoneMutation.mutate(phone)} disabled={updatePhoneMutation.isPending} style={{ backgroundColor: TEAL }} className="text-white">
                    {updatePhoneMutation.isPending ? "Saving..." : "Register"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3 pb-2">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4" style={{ color: TEAL }} />
                <CardTitle className="text-base">Account</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 py-2">
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium">Email Address</p>
                  <p className="text-xs text-gray-500">{(user as any)?.email || user?.username}</p>
                </div>
              </div>
              <div className="pl-0 pb-1">
                {!showChangePassword ? (
                  <button onClick={() => setShowChangePassword(true)} className="text-xs font-medium hover:underline" style={{ color: TEAL }}>
                    Change password
                  </button>
                ) : (
                  <div className="space-y-2 pt-1">
                    <Input type="password" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="h-8 text-sm" />
                    <Input type="password" placeholder="New password (min 8 characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="h-8 text-sm" />
                    <Input type="password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="h-8 text-sm" />
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" onClick={() => {
                        if (newPassword !== confirmPassword) { toast({ title: "Passwords don't match", variant: "destructive" }); return; }
                        changePasswordMutation.mutate();
                      }} disabled={changePasswordMutation.isPending || !currentPassword || !newPassword || !confirmPassword} style={{ backgroundColor: TEAL }} className="text-white">
                        {changePasswordMutation.isPending ? "Saving..." : "Update Password"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setShowChangePassword(false); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              <Separator />
              <div className="flex items-center justify-between py-1">
                <p className="text-sm font-medium">Account Status</p>
                <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">Active</span>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ── Account Actions ── */}
        <Card className="border-gray-200 mb-8">
          <CardHeader className="py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-gray-400" />
              <CardTitle className="text-sm font-medium text-gray-600">Account Actions</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-700">Deactivate Account</p>
                <p className="text-xs text-gray-500 mt-0.5">Hide your profile and listings. Reactivate anytime by logging back in.</p>
              </div>
              <Dialog open={isDeactivateOpen} onOpenChange={setIsDeactivateOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-gray-600 hover:bg-gray-50">Deactivate</Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <UserX className="h-5 w-5 text-amber-500" />Deactivate Your Account
                    </DialogTitle>
                    <DialogDescription>This will temporarily hide your presence on ShareSwap</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <Alert className="bg-amber-50 border-amber-200">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <AlertTitle className="text-amber-800">What happens when you deactivate?</AlertTitle>
                      <AlertDescription className="text-amber-700 mt-2">
                        <ul className="list-disc list-inside space-y-1 text-sm">
                          <li>Your profile will be hidden from discovery</li>
                          <li>All your listings will be archived</li>
                          <li>You won't be able to send or receive new requests</li>
                          <li>Your trust score and reputation will be frozen</li>
                        </ul>
                      </AlertDescription>
                    </Alert>
                    <Alert className="bg-blue-50 border-blue-200">
                      <Shield className="h-4 w-4 text-blue-600" />
                      <AlertTitle className="text-blue-800">Your data is preserved</AlertTitle>
                      <AlertDescription className="text-blue-700 mt-2 text-sm">
                        Your transaction history, messages, and reviews are retained for trust, safety, and legal compliance.
                      </AlertDescription>
                    </Alert>
                    <div className="flex items-start space-x-3 pt-2">
                      <Checkbox id="confirm-deactivate" checked={confirmChecked} onCheckedChange={(c) => setConfirmChecked(c === true)} />
                      <label htmlFor="confirm-deactivate" className="text-sm text-gray-700 leading-snug cursor-pointer">
                        I understand that deactivating my account hides my profile and listings, and that my history is retained for trust and safety.
                      </label>
                    </div>
                  </div>
                  <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={() => { setIsDeactivateOpen(false); setConfirmChecked(false); }}>Cancel</Button>
                    <Button variant="destructive" onClick={() => deactivateMutation.mutate()} disabled={!confirmChecked || deactivateMutation.isPending}>
                      {deactivateMutation.isPending ? "Deactivating..." : "Deactivate Account"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <Separator />

            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-700">Delete Account</p>
                <p className="text-xs text-gray-500 mt-0.5">Permanently delete your account and data.</p>
              </div>
              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-gray-600" onClick={() => {
                toast({
                  title: "Contact Support",
                  description: "Please email support@shareswap.com to request account deletion.",
                });
              }}>
                Contact Support
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
