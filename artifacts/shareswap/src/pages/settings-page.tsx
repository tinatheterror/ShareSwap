import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  ArrowLeft,
  Settings,
  Shield,
  AlertTriangle,
  UserX,
  Mail,
  User,
  Phone,
  ChevronRight,
} from "lucide-react";
import { Navbar } from "@/components/shared/navbar";

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
  const [showChangeEmail, setShowChangeEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailCurrentPassword, setEmailCurrentPassword] = useState("");

  const updatePhoneMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      const res = await apiRequest("PATCH", "/api/user-profile", {
        phone: phoneNumber,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({
        title: "Phone number saved",
        description: "Your phone number has been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save",
        description: error.message || "Could not update phone number.",
        variant: "destructive",
      });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/account/change-password", {
        currentPassword,
        newPassword,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Password changed", description: "Your password has been updated successfully." });
      setShowChangePassword(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (error: any) => {
      toast({ title: "Failed to change password", description: error.message || "Could not update password.", variant: "destructive" });
    },
  });

  const changeEmailMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/account/change-email", {
        newEmail: newEmail.trim().toLowerCase(),
        currentPassword: emailCurrentPassword,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || "Could not update email.");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "Confirmation sent", description: "Check your new inbox and click the link to confirm the change. Your current email stays active until then." });
      setShowChangeEmail(false);
      setNewEmail("");
      setEmailCurrentPassword("");
    },
    onError: (error: any) => {
      toast({ title: "Failed to update email", description: error.message || "Could not update email.", variant: "destructive" });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/account/deactivate", {
        confirmDeactivation: true,
      });
      return res.json();
    },
    onSuccess: () => {
      setIsDeactivated(true);
      setIsDeactivateOpen(false);
      queryClient.clear();
    },
    onError: (error: any) => {
      toast({
        title: "Cannot Deactivate",
        description: error.message || "Failed to deactivate account",
        variant: "destructive",
      });
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
            <CardDescription>
              Your account has been successfully deactivated
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-600 text-sm">
              Your profile and listings are now hidden from other users. All
              your transaction history, messages, and reviews have been
              preserved for trust and safety purposes.
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left">
              <p className="text-sm text-blue-800 font-medium mb-2">
                Want to come back?
              </p>
              <p className="text-sm text-blue-700">
                Simply log in again with your credentials and you'll have the
                option to reactivate your account instantly.
              </p>
            </div>
            <Button onClick={() => navigate("/auth")} className="w-full mt-4">
              Return to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <Button
          variant="ghost"
          onClick={() => window.history.back()}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-[#0BB88C]/10 rounded-lg">
            <Settings className="h-6 w-6 text-[#0BB88C]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <p className="text-gray-500">Manage your account preferences</p>
          </div>
        </div>

        <Card className="mb-4">
          <CardHeader className="py-3 pb-2">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-[#0BB88C]" />
              <CardTitle className="text-base">Contact</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="py-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">Phone Number</p>
              <p className="text-xs text-gray-500">
                Used to manage account security and recovery. Not publicly
                visible.
              </p>
              <div className="flex gap-2">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. +1 (416) 555-0123"
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={() => updatePhoneMutation.mutate(phone)}
                  disabled={updatePhoneMutation.isPending}
                  style={{ backgroundColor: "#0BB88C" }}
                  className="text-white"
                >
                  {updatePhoneMutation.isPending ? "Saving..." : "Register"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardHeader className="py-3 pb-2">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-[#0BB88C]" />
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
            {!(user as any)?.authProvider || (user as any)?.authProvider === "local" ? (
              <div className="pl-0 pb-1 flex gap-4">
                {!showChangeEmail && (
                  <button
                    onClick={() => setShowChangeEmail(true)}
                    className="text-xs text-[#0BB88C] hover:underline font-medium"
                  >
                    Change email
                  </button>
                )}
              </div>
            ) : null}
            {showChangeEmail && (
              <div className="space-y-2 pt-1 pb-1">
                <p className="text-xs font-medium text-gray-600">Change Email Address</p>
                <Input
                  type="email"
                  placeholder="New email address"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="h-8 text-sm"
                />
                <Input
                  type="password"
                  placeholder="Current password to confirm"
                  value={emailCurrentPassword}
                  onChange={(e) => setEmailCurrentPassword(e.target.value)}
                  className="h-8 text-sm"
                />
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => changeEmailMutation.mutate()}
                    disabled={changeEmailMutation.isPending || !newEmail || !emailCurrentPassword}
                    style={{ backgroundColor: "#0BB88C" }}
                    className="text-white"
                  >
                    {changeEmailMutation.isPending ? "Saving..." : "Update Email"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowChangeEmail(false);
                      setNewEmail("");
                      setEmailCurrentPassword("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            <div className="pl-0 pb-1">
              {!showChangePassword ? (
                <button
                  onClick={() => setShowChangePassword(true)}
                  className="text-xs text-[#0BB88C] hover:underline font-medium"
                >
                  Change password
                </button>
              ) : (
                <div className="space-y-2 pt-1">
                  <Input
                    type="password"
                    placeholder="Current password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <Input
                    type="password"
                    placeholder="New password (min 8 characters)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <Input
                    type="password"
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => {
                        if (newPassword !== confirmPassword) {
                          toast({ title: "Passwords don't match", description: "New password and confirmation must match.", variant: "destructive" });
                          return;
                        }
                        changePasswordMutation.mutate();
                      }}
                      disabled={changePasswordMutation.isPending || !currentPassword || !newPassword || !confirmPassword}
                      style={{ backgroundColor: "#0BB88C" }}
                      className="text-white"
                    >
                      {changePasswordMutation.isPending ? "Saving..." : "Update Password"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setShowChangePassword(false);
                        setCurrentPassword("");
                        setNewPassword("");
                        setConfirmPassword("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <Separator />
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium">Account Status</p>
              </div>
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                Active
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200">
          <CardHeader className="py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-gray-400" />
              <CardTitle className="text-sm font-medium text-gray-600">
                Account Actions
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-700">
                  Deactivate Account
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Hide your profile and listings. Reactivate anytime by logging
                  back in.
                </p>
              </div>
              <Dialog
                open={isDeactivateOpen}
                onOpenChange={setIsDeactivateOpen}
              >
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-gray-600 hover:bg-gray-50"
                  >
                    Deactivate
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <UserX className="h-5 w-5 text-amber-500" />
                      Deactivate Your Account
                    </DialogTitle>
                    <DialogDescription>
                      This will temporarily hide your presence on ShareSwap
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 py-4">
                    <Alert className="bg-amber-50 border-amber-200">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <AlertTitle className="text-amber-800">
                        What happens when you deactivate?
                      </AlertTitle>
                      <AlertDescription className="text-amber-700 mt-2 space-y-2">
                        <ul className="list-disc list-inside space-y-1 text-sm">
                          <li>Your profile will be hidden from discovery</li>
                          <li>All your listings will be archived</li>
                          <li>
                            You won't be able to send or receive new requests
                          </li>
                          <li>
                            Your trust score and reputation will be frozen
                          </li>
                        </ul>
                      </AlertDescription>
                    </Alert>

                    <Alert className="bg-blue-50 border-blue-200">
                      <Shield className="h-4 w-4 text-blue-600" />
                      <AlertTitle className="text-blue-800">
                        Your data is preserved
                      </AlertTitle>
                      <AlertDescription className="text-blue-700 mt-2 text-sm">
                        Your transaction history, messages, and reviews are
                        retained for trust, safety, and legal compliance.
                        Nothing is deleted.
                      </AlertDescription>
                    </Alert>

                    <div className="flex items-start space-x-3 pt-2">
                      <Checkbox
                        id="confirm-deactivate"
                        checked={confirmChecked}
                        onCheckedChange={(checked) =>
                          setConfirmChecked(checked === true)
                        }
                      />
                      <label
                        htmlFor="confirm-deactivate"
                        className="text-sm text-gray-700 leading-snug cursor-pointer"
                      >
                        I understand that deactivating my account hides my
                        profile and listings, and that my history is retained
                        for trust and safety.
                      </label>
                    </div>
                  </div>

                  <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsDeactivateOpen(false);
                        setConfirmChecked(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => deactivateMutation.mutate()}
                      disabled={!confirmChecked || deactivateMutation.isPending}
                    >
                      {deactivateMutation.isPending
                        ? "Deactivating..."
                        : "Deactivate Account"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <Separator />

            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-700">
                  Delete Account
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Permanently delete your account and data.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-400 hover:text-gray-600"
                onClick={() => {
                  toast({
                    title: "Contact Support",
                    description: (
                      <div className="flex items-center gap-2 mt-1">
                        <Mail className="h-4 w-4" />
                        <span>
                          Please email support@shareswap.com to request account
                          deletion.
                        </span>
                      </div>
                    ),
                  });
                }}
              >
                Contact Support
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
