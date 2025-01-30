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
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  fullName: z.string().min(3),
  idNumber: z.string().min(6),
  cardNumber: z.string().min(16).max(16),
  expiry: z.string().regex(/^(0[1-9]|1[0-2])\/([0-9]{2})$/),
  cvv: z.string().length(3),
});

export default function VerificationPage() {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  
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

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsUploading(true);
    // Simulated API call
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setIsUploading(false);
    toast({
      title: "Verification Submitted",
      description: "We'll review your information and get back to you soon.",
    });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Verify Your Identity</h1>
          <p className="text-muted-foreground">
            We need to verify your identity to ensure a safe marketplace
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-xl font-semibold mb-4">Upload ID</h2>
              <div className="space-y-4">
                <div>
                  <Label>Government ID</Label>
                  <div className="mt-2 border-2 border-dashed rounded-lg p-6 text-center">
                    <Button variant="outline">Upload ID Document</Button>
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
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
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
                  <Button type="submit" className="w-full" disabled={isUploading}>
                    {isUploading && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Submit Verification
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
