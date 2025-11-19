import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Upload, CheckCircle, XCircle } from "lucide-react";
import { useState } from "react";
import type { SelectItem } from "@db/schema";

const verificationFormSchema = z.object({
  actualConditionRating: z.coerce
    .number()
    .min(1)
    .max(10, "Rating must be between 1 and 10"),
  notes: z.string().min(1, "Please provide verification notes"),
  status: z.enum(["approved", "rejected"]),
});

export default function VerifyItemsPage() {
  const { toast } = useToast();
  const [selectedItem, setSelectedItem] = useState<SelectItem | null>(null);
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([]);

  const form = useForm<z.infer<typeof verificationFormSchema>>({
    resolver: zodResolver(verificationFormSchema),
    defaultValues: {
      actualConditionRating: 10,
      notes: "",
      status: "approved",
    },
  });

  const { data: items = [] } = useQuery<SelectItem[]>({
    queryKey: ['/api/items'],
    select: (items) => items.filter(item => !item.isConditionVerified),
  });

  const verifyItemMutation = useMutation({
    mutationFn: async (data: z.infer<typeof verificationFormSchema>) => {
      if (!selectedItem) throw new Error("No item selected");
      
      const formData = new FormData();
      selectedPhotos.forEach((photo) => {
        formData.append("photos", photo);
      });
      Object.entries(data).forEach(([key, value]) => {
        formData.append(key, String(value));
      });
      
      const res = await apiRequest("POST", `/api/items/${selectedItem.id}/verify-condition`, formData);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Verification Submitted",
        description: "The item condition has been verified.",
      });
      setSelectedItem(null);
      setSelectedPhotos([]);
      form.reset();
      queryClient.invalidateQueries({ queryKey: ['/api/items'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Verification Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedPhotos(Array.from(e.target.files));
    }
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Verify Item Conditions</h1>
          <p className="text-muted-foreground">
            Review and verify the condition of items in the marketplace
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-xl font-semibold mb-4">Items Pending Verification</h2>
              <div className="space-y-4">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                      selectedItem?.id === item.id
                        ? "border-primary bg-primary/5"
                        : "hover:border-primary/50"
                    }`}
                    onClick={() => setSelectedItem(item)}
                  >
                    <h3 className="font-medium">{item.name}</h3>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                    <div className="mt-2 flex justify-between text-sm">
                      <span>Owner's Rating: {item.conditionRating}/10</span>
                      <span>Security Deposit: ${item.securityDeposit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {selectedItem && (
            <Card>
              <CardContent className="pt-6">
                <h2 className="text-xl font-semibold mb-4">Verify Condition</h2>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit((data) => verifyItemMutation.mutate(data))}
                    className="space-y-6"
                  >
                    <FormField
                      control={form.control}
                      name="actualConditionRating"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Actual Condition Rating (1-10)</FormLabel>
                          <FormControl>
                            <Input type="number" min="1" max="10" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Verification Notes</FormLabel>
                          <FormControl>
                            <Textarea {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div>
                      <FormLabel>Verification Photos</FormLabel>
                      <div className="mt-2 border-2 border-dashed rounded-lg p-6 text-center">
                        <Input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          id="verification-photos"
                          onChange={handlePhotoChange}
                        />
                        <label htmlFor="verification-photos">
                          <div className="cursor-pointer">
                            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">
                              Click to upload verification photos
                            </p>
                          </div>
                        </label>
                        {selectedPhotos.length > 0 && (
                          <p className="mt-2 text-sm">
                            {selectedPhotos.length} photos selected
                          </p>
                        )}
                      </div>
                    </div>

                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Verification Status</FormLabel>
                          <div className="grid grid-cols-2 gap-4">
                            <Button
                              type="button"
                              variant={field.value === "approved" ? "default" : "outline"}
                              className="w-full"
                              onClick={() => form.setValue("status", "approved")}
                            >
                              <CheckCircle className="w-4 h-4 mr-2" />
                              Approve
                            </Button>
                            <Button
                              type="button"
                              variant={field.value === "rejected" ? "destructive" : "outline"}
                              className="w-full"
                              onClick={() => form.setValue("status", "rejected")}
                            >
                              <XCircle className="w-4 h-4 mr-2" />
                              Reject
                            </Button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={verifyItemMutation.isPending}
                    >
                      Submit Verification
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
