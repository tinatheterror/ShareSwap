import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { useState, useRef } from "react";
import { Loader2, Upload, Camera, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

const formSchema = z.object({
  fullName: z.string().min(3),
  idNumber: z.string().min(6),
  cardNumber: z.string().min(16).max(16),
  expiry: z.string().regex(/^(0[1-9]|1[0-2])\/([0-9]{2})$/),
  cvv: z.string().length(3),
});

export default function VerificationPage() {
  const [selectedIdFile, setSelectedIdFile] = useState<File | null>(null);
  const [isCameraMode, setIsCameraMode] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const cardCameraRef = useRef<HTMLInputElement>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleCardPhotoCapture = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      toast({
        title: "Card Photo Captured",
        description: "Processing card information...",
      });
      
      // Simulate card number extraction (in real app, use OCR service)
      setTimeout(() => {
        // Mock card data for demo - in production, use OCR to extract real data
        form.setValue("cardNumber", "1234567890123456");
        form.setValue("expiry", "12/25");
        form.setValue("cvv", "123");
        
        toast({
          title: "Card Information Extracted",
          description: "Please verify the information is correct",
        });
      }, 2000);
    }
  };

  const triggerCardCamera = () => {
    cardCameraRef.current?.click();
  };
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: "",
      idNumber: "",
      cardNumber: "",
      expiry: "",
      cvv: "",
    },
  });

  const verificationMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      if (!selectedIdFile) {
        throw new Error("Please upload an ID document");
      }

      const formData = new FormData();
      formData.append("idDocument", selectedIdFile);
      formData.append("fullName", data.fullName);
      formData.append("idNumber", data.idNumber);
      formData.append("cardNumber", data.cardNumber);
      formData.append("expiry", data.expiry);
      formData.append("cvv", data.cvv);

      const res = await apiRequest("POST", "/api/verify", formData);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Verification Submitted Successfully!",
        description: "Your account is now verified. You can now rent items securely.",
      });
      setIsVerified(true);
      form.reset();
      setSelectedIdFile(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Verification Failed",
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

  if (isVerified) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-2xl mx-auto px-4 py-12">
          <div className="text-center">
            <div className="bg-teal-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold mb-2 text-teal-800">Verification Complete!</h1>
            <p className="text-muted-foreground mb-8">
              Your identity has been verified successfully. You can now rent and borrow items with confidence.
            </p>
            <div className="space-y-4">
              <Button 
                onClick={() => setLocation("/borrow")} 
                className="w-full max-w-md"
                size="lg"
              >
                Continue to Browse Items
              </Button>
              <Button 
                variant="outline"
                onClick={() => setLocation("/")} 
                className="w-full max-w-md"
                size="lg"
              >
                Return to Home
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-12">
        <TooltipProvider>
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-3xl font-bold">Verify Your Identity</h1>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-5 w-5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-md">
                  <div className="space-y-2">
                    <p className="font-semibold">Why We Need This Information</p>
                    <p><strong>Government ID:</strong> Verifies your identity to ensure only real people use our platform and helps prevent fraud.</p>
                    <p><strong>Credit Card:</strong> Enables security deposits, damage protection, non-return protection, and creates trust & accountability in our community.</p>
                    <p className="text-xs">All payment information is encrypted and stored securely. We only charge your card when necessary for deposits or damages.</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

        <div className="grid md:grid-cols-2 gap-8">
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-xl font-semibold mb-4">Upload ID</h2>
              <div className="space-y-4">
                <div>
                  <Label>Government ID</Label>
                  <div className="mt-2 border-2 border-dashed rounded-lg p-6 text-center">
                    <Input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      id="id-upload"
                      onChange={handleIdFileChange}
                    />
                    <label htmlFor="id-upload">
                      <div className="cursor-pointer">
                        <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                        <Button variant="outline" type="button" className="pointer-events-none">
                          Upload ID Document
                        </Button>
                      </div>
                    </label>
                    {selectedIdFile && (
                      <p className="mt-2 text-sm text-teal-600">
                        Selected: {selectedIdFile.name}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground mt-2">
                      Supported formats: JPG, PNG, PDF
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h2 className="text-xl font-semibold mb-4">Personal Information</h2>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((data) => verificationMutation.mutate(data))} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="fullName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="idNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ID Number</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="cardNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Card Number</FormLabel>
                        <div className="space-y-2">
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={triggerCardCamera}
                            className="w-full"
                          >
                            <Camera className="mr-2 h-4 w-4" />
                            Take Photo of Credit Card
                          </Button>
                          <input
                            ref={cardCameraRef}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={handleCardPhotoCapture}
                            className="hidden"
                          />
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="expiry"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Expiry (MM/YY)</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="MM/YY" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="cvv"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>CVV</FormLabel>
                          <FormControl>
                            <Input type="password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={verificationMutation.isPending}>
                    {verificationMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Submit Verification
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
        </TooltipProvider>
      </main>
    </div>
  );
}
