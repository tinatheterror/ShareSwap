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
import { Loader2, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

const formSchema = z.object({
  fullName: z.string().min(3),
  idNumber: z.string().min(6),
});

export default function VerificationPage() {
  const [selectedIdFile, setSelectedIdFile] = useState<File | null>(null);
  const { toast } = useToast();
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: "",
      idNumber: "",
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

      const res = await apiRequest("POST", "/api/verify", formData);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Verification Submitted",
        description: "We'll review your information and get back to you soon.",
      });
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
                      <p className="mt-2 text-sm text-green-600">
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
      </main>
    </div>
  );
}
