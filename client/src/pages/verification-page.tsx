import { Navbar } from "@/components/shared/navbar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useState, useCallback, useEffect } from "react";
import {
  Loader2,
  ArrowLeft,
  Shield,
  CheckCircle2,
  Clock,
  AlertTriangle,
  BadgeCheck,
  Star,
  Eye,
  CreditCard,
  ArrowRight,
  Camera,
  ScanFace,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation, Link } from "wouter";

type VerificationStatus = "unverified" | "pending" | "verified" | "failed";

interface VerificationData {
  status: VerificationStatus;
  legalFullName: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  failureReason: string | null;
}

function StatusBadge({ status }: { status: VerificationStatus }) {
  if (status === "verified") {
    return (
      <div className="flex items-center gap-2 text-green-700 bg-green-50 px-4 py-2 rounded-full text-sm font-medium">
        <CheckCircle2 className="h-4 w-4" />
        Verified
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="flex items-center gap-2 text-amber-700 bg-amber-50 px-4 py-2 rounded-full text-sm font-medium">
        <Clock className="h-4 w-4" />
        Under Review
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="flex items-center gap-2 text-red-700 bg-red-50 px-4 py-2 rounded-full text-sm font-medium">
        <AlertTriangle className="h-4 w-4" />
        Needs Attention
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-gray-600 bg-gray-100 px-4 py-2 rounded-full text-sm font-medium">
      <BadgeCheck className="h-4 w-4" />
      Not Verified
    </div>
  );
}

export default function VerificationPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [personaLoading, setPersonaLoading] = useState(false);
  const [personaError, setPersonaError] = useState<string | null>(null);
  const isDev = import.meta.env.DEV;

  const { data: verification, isLoading } = useQuery<VerificationData>({
    queryKey: ["/api/verification-status"],
  });

  const createInquiryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/persona/create-inquiry");
      return res.json();
    },
    onError: (error: Error) => {
      setPersonaError(error.message);
      setPersonaLoading(false);
    },
  });

  const completeInquiryMutation = useMutation({
    mutationFn: async ({ inquiryId, status }: { inquiryId: string; status: string }) => {
      const res = await apiRequest("POST", "/api/persona/inquiry-complete", {
        inquiryId,
        status,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/verification-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      if (data.status === "approved") {
        toast({
          title: "Identity Verified!",
          description: data.message || "Your identity has been verified successfully.",
        });
      } else if (data.status === "failed") {
        toast({
          title: "Verification Failed",
          description: data.message || "Please try again.",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Verification Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const devVerifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/persona/dev-verify");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/verification-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "Dev bypass applied", description: "Identity marked as verified for testing." });
    },
    onError: (error: Error) => {
      toast({ title: "Dev bypass failed", description: error.message, variant: "destructive" });
    },
  });

  const startPersonaVerification = useCallback(async () => {
    setPersonaLoading(true);
    setPersonaError(null);

    try {
      const result = await createInquiryMutation.mutateAsync();
      const inquiryId = result.inquiryId;

      if (!inquiryId) {
        throw new Error("Could not start verification");
      }

      const { Client } = await import("persona");

      let readyFired = false;
      console.log("[Persona] Creating client with inquiryId:", inquiryId);

      // Timeout: if onReady doesn't fire in 30s, the SDK may be blocked by domain restrictions
      const timeoutId = setTimeout(() => {
        if (!readyFired) {
          console.error("[Persona] onReady never fired — possible CSP or domain restriction");
          setPersonaError("Verification could not load. Please try again or contact support if this persists.");
          setPersonaLoading(false);
        }
      }, 30000);

      const client = new Client({
        inquiryId,
        onReady: () => {
          console.log("[Persona] onReady fired");
          readyFired = true;
          clearTimeout(timeoutId);
          setPersonaLoading(false);
          client.open();
        },
        onComplete: ({ inquiryId: completedId, status }: { inquiryId: string; status: string }) => {
          clearTimeout(timeoutId);
          completeInquiryMutation.mutate({
            inquiryId: completedId || inquiryId,
            status: status || "completed",
          });
        },
        onCancel: () => {
          clearTimeout(timeoutId);
          toast({
            title: "Verification Cancelled",
            description: "You can resume verification anytime.",
          });
          setPersonaLoading(false);
        },
        onError: (error: any) => {
          clearTimeout(timeoutId);
          console.error("Persona error:", error);
          setPersonaError("Verification encountered an error. Please try again.");
          setPersonaLoading(false);
        },
      });
    } catch (err: any) {
      console.error("Error starting Persona:", err);
      setPersonaError(err.message || "Failed to start verification");
      setPersonaLoading(false);
    }
  }, [createInquiryMutation, completeInquiryMutation, toast]);

  const isVerified = verification?.status === "verified";
  const isPending = verification?.status === "pending";
  const isFailed = verification?.status === "failed";

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <Button
          variant="ghost"
          onClick={() => navigate("/profile")}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        <div className="flex items-start gap-3 mb-6">
          <BadgeCheck
            className="h-8 w-8 mt-1 flex-shrink-0"
            fill="#0DCEA1"
            stroke="white"
          />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Identity Verification
            </h1>
            <p className="text-gray-500">Build trust with a verified profile</p>
          </div>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="p-8 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </CardContent>
          </Card>
        ) : isVerified ? (
          <div className="space-y-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-green-100 rounded-full">
                      <BadgeCheck className="h-6 w-6 text-green-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        Identity Verified
                      </h3>
                      <p className="text-sm text-gray-500">
                        Verified on{" "}
                        {verification.verifiedAt
                          ? new Date(
                              verification.verifiedAt,
                            ).toLocaleDateString()
                          : "N/A"}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status="verified" />
                </div>

                <Separator className="my-4" />

                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Legal Name</span>
                    <span className="font-medium text-gray-900">
                      {verification.legalFullName}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Verification Method</span>
                    <span className="font-medium text-gray-900">ID + Selfie Match</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-teal-50 to-white border-teal-100">
              <CardContent className="p-6">
                <h3 className="font-semibold text-teal-900 mb-3">
                  Your Verification Benefits
                </h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="p-1.5 bg-teal-100 rounded-full mt-0.5">
                      <BadgeCheck className="h-4 w-4 text-teal-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        Verified Badge
                      </p>
                      <p className="text-sm text-gray-600">
                        Your profile shows a verified badge, building instant
                        trust
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="p-1.5 bg-teal-100 rounded-full mt-0.5">
                      <Star className="h-4 w-4 text-teal-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        Improved Trust Score
                      </p>
                      <p className="text-sm text-gray-600">
                        Verification contributes positively to your trust score
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="p-1.5 bg-teal-100 rounded-full mt-0.5">
                      <Eye className="h-4 w-4 text-teal-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        Increased Visibility
                      </p>
                      <p className="text-sm text-gray-600">
                        Verified users may be highlighted in urgent requests
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : isPending ? (
          <div className="space-y-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-amber-100 rounded-full">
                      <Clock className="h-6 w-6 text-amber-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        Under Review
                      </h3>
                      <p className="text-sm text-gray-500">
                        Submitted on{" "}
                        {verification.submittedAt
                          ? new Date(
                              verification.submittedAt,
                            ).toLocaleDateString()
                          : "N/A"}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status="pending" />
                </div>

                <Alert className="bg-amber-50 border-amber-100">
                  <AlertDescription className="text-amber-800 text-sm">
                    We're reviewing your documents. This usually takes a few minutes.
                    We'll notify you once complete.
                  </AlertDescription>
                </Alert>

                <Separator className="my-4" />

                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Legal Name</span>
                    <span className="font-medium text-gray-900">
                      {verification.legalFullName || "Processing..."}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Verification Method</span>
                    <span className="font-medium text-gray-900">ID + Selfie Match</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-teal-200 bg-gradient-to-br from-teal-50 to-white">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-teal-100 rounded-full">
                      <CreditCard className="h-5 w-5 text-teal-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Complete Payment Setup</h3>
                      <p className="text-sm text-gray-500">Add a payment method to finish full verification</p>
                    </div>
                  </div>
                  <Button
                    onClick={() => navigate("/payment-methods")}
                    className="text-white"
                    style={{ backgroundColor: "#0DCEA1" }}
                  >
                    Add Payment
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="space-y-6">
            {isFailed && (
              <Alert className="bg-red-50 border-red-100">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">
                  {verification?.failureReason ||
                    "Your verification couldn't be completed. Please try again."}
                </AlertDescription>
              </Alert>
            )}

            {personaError && (
              <Alert className="bg-red-50 border-red-100">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">
                  {personaError}
                </AlertDescription>
              </Alert>
            )}

            <Card className="bg-gradient-to-br from-teal-50 to-white border-teal-100">
              <CardContent className="p-4 sm:p-6">
                <h3 className="font-semibold text-teal-900 mb-4 text-center sm:text-left">
                  Why Verify Your Identity?
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-teal-800">
                  <div className="flex flex-col sm:flex-row items-center sm:items-start gap-2 sm:gap-3 text-center sm:text-left">
                    <BadgeCheck className="h-8 w-8 sm:h-12 sm:w-12 flex-shrink-0 text-teal-600" />
                    <span>
                      A verified badge builds instant trust with neighbours
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center sm:items-start gap-2 sm:gap-3 text-center sm:text-left">
                    <Star className="h-8 w-8 sm:h-12 sm:w-12 flex-shrink-0 text-teal-600" />
                    <span>
                      Improve your trust score and become a preferred choice for
                      sharing
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center sm:items-start gap-2 sm:gap-3 text-center sm:text-left">
                    <Eye className="h-8 w-8 sm:h-12 sm:w-12 flex-shrink-0 text-teal-600" />
                    <span>
                      Verified users are prioritized in urgent requests and
                      search results
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Verify Your Identity</CardTitle>
                <CardDescription>
                  Securely verify with a government ID and a quick selfie
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg">
                    <div className="p-2 bg-teal-100 rounded-full flex-shrink-0">
                      <CreditCard className="h-5 w-5 text-teal-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 text-sm">Step 1: Scan your ID</p>
                      <p className="text-xs text-gray-500">Take a photo of your driver's license, passport, or national ID</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg">
                    <div className="p-2 bg-teal-100 rounded-full flex-shrink-0">
                      <ScanFace className="h-5 w-5 text-teal-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 text-sm">Step 2: Take a selfie</p>
                      <p className="text-xs text-gray-500">We'll match your selfie to your ID photo for security</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg">
                    <div className="p-2 bg-teal-100 rounded-full flex-shrink-0">
                      <CheckCircle2 className="h-5 w-5 text-teal-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 text-sm">Step 3: Get verified</p>
                      <p className="text-xs text-gray-500">Results are usually instant - earn your verified badge right away</p>
                    </div>
                  </div>
                </div>

                <Button
                  onClick={startPersonaVerification}
                  disabled={personaLoading || createInquiryMutation.isPending}
                  className="w-full text-white"
                  style={{ backgroundColor: "#0DCEA1" }}
                  size="lg"
                >
                  {personaLoading || createInquiryMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Starting Verification...
                    </>
                  ) : (
                    <>
                      <Shield className="mr-2 h-5 w-5" />
                      {isFailed ? "Try Again" : "Start Verification"}
                    </>
                  )}
                </Button>

                <div className="flex items-center gap-2 text-xs text-gray-400 justify-center">
                  <Shield className="h-3 w-3" />
                  <span>Powered by Persona - bank-level identity verification</span>
                </div>

                {isDev && (
                  <div className="border-t pt-4 mt-2">
                    <p className="text-xs text-amber-600 font-medium text-center mb-2">⚙ Dev mode — Persona only works on shareswap.app</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-amber-400 text-amber-700 hover:bg-amber-50"
                      onClick={() => devVerifyMutation.mutate()}
                      disabled={devVerifyMutation.isPending}
                    >
                      {devVerifyMutation.isPending ? "Applying..." : "Skip — Mark ID as Verified (Dev Only)"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <p className="text-xs text-gray-400 text-center">
              Your data is encrypted and processed securely. We only use it to
              verify your identity.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
