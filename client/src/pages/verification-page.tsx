import { Navbar } from "@/components/shared/navbar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useState } from "react";
import {
  Loader2,
  Upload,
  ArrowLeft,
  Shield,
  CheckCircle2,
  Clock,
  AlertTriangle,
  BadgeCheck,
  Star,
  Eye,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation, Link } from "wouter";

const formSchema = z.object({
  legalFullName: z
    .string()
    .min(3, "Please enter your full legal name as it appears on your ID"),
});

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
      <Shield className="h-4 w-4" />
      Not Verified
    </div>
  );
}

export default function VerificationPage() {
  const [selectedIdFile, setSelectedIdFile] = useState<File | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: verification, isLoading } = useQuery<VerificationData>({
    queryKey: ["/api/verification-status"],
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      legalFullName: "",
    },
  });

  const verificationMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      if (!selectedIdFile) {
        throw new Error("Please upload an ID document");
      }

      const formData = new FormData();
      formData.append("idDocument", selectedIdFile);
      formData.append("legalFullName", data.legalFullName);

      const res = await apiRequest("POST", "/api/verify-identity", formData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/verification-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({
        title: "Verification Submitted",
        description:
          "We're reviewing your documents. This usually takes 1-2 business days.",
      });
      form.reset();
      setSelectedIdFile(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Submission Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleIdFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedIdFile(e.target.files[0]);
    }
  };

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

        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-teal-100 rounded-lg">
            <Shield className="h-6 w-6 text-teal-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Verification Status
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
                    <span className="text-gray-500">ID Document</span>
                    <span className="font-medium text-gray-900">On file</span>
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
                    We're reviewing your documents. This usually takes 1-2
                    business days. We'll notify you once complete.
                  </AlertDescription>
                </Alert>

                <Separator className="my-4" />

                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Legal Name</span>
                    <span className="font-medium text-gray-900">
                      {verification.legalFullName}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">ID Document</span>
                    <span className="font-medium text-gray-900">Uploaded</span>
                  </div>
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
                    "Your verification couldn't be completed. Please try again with a clearer image of your ID."}
                </AlertDescription>
              </Alert>
            )}

            <Card className="bg-gradient-to-br from-teal-50 to-white border-teal-100">
              <CardContent className="p-6">
                <h3 className="font-semibold text-teal-900 mb-4">
                  Why Verify Your Identity?
                </h3>
                <div className="grid grid-cols-3 gap-4 text-xs text-teal-800">
                  <div className="flex items-start gap-3">
                    <BadgeCheck className="h-12 w-12 flex-shrink-0 text-teal-600" />
                    <span>
                      A verified badge builds instant trust with neighbors
                    </span>
                  </div>
                  <div className="flex items-start gap-3">
                    <Star className="h-12 w-12 flex-shrink-0 text-teal-600" />
                    <span>
                      Improve your trust score and become a preferred choice for
                      sharing
                    </span>
                  </div>
                  <div className="flex items-start gap-3">
                    <Eye className="h-12 w-12 flex-shrink-0 text-teal-600" />
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
                  Upload a government-issued ID and confirm your legal name
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit((data) =>
                      verificationMutation.mutate(data),
                    )}
                    className="space-y-6"
                  >
                    <div>
                      <Label className="text-sm font-medium">
                        Government ID
                      </Label>
                      <p className="text-xs text-gray-500 mb-2">
                        Driver's license, passport, or national ID card
                      </p>
                      <div className="mt-2 border-2 border-dashed rounded-lg p-6 text-center hover:border-teal-300 transition-colors">
                        <Input
                          type="file"
                          accept="image/*,.pdf"
                          className="hidden"
                          id="id-upload"
                          onChange={handleIdFileChange}
                        />
                        <label htmlFor="id-upload" className="cursor-pointer">
                          <Upload className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                          {selectedIdFile ? (
                            <p className="text-sm text-teal-600 font-medium">
                              {selectedIdFile.name}
                            </p>
                          ) : (
                            <>
                              <Button
                                variant="outline"
                                type="button"
                                className="pointer-events-none"
                              >
                                Add ID Photo
                              </Button>
                              <p className="text-xs text-gray-400 mt-2">
                                JPG, PNG, or PDF up to 10MB
                              </p>
                            </>
                          )}
                        </label>
                      </div>
                      <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                        <BadgeCheck className="h-3 w-3" />
                        We never share your ID. It's used only to confirm your
                        identity.
                      </p>
                    </div>

                    <FormField
                      control={form.control}
                      name="legalFullName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Legal Full Name</FormLabel>
                          <p className="text-xs text-gray-500 mb-1">
                            Enter your name exactly as it appears on your ID
                          </p>
                          <FormControl>
                            <Input
                              placeholder="e.g. John Michael Smith"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={
                        verificationMutation.isPending || !selectedIdFile
                      }
                    >
                      {verificationMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        "Submit for Verification"
                      )}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>

            <p className="text-xs text-gray-400 text-center">
              Your ID is encrypted and stored securely. We only use it to verify
              your identity.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
