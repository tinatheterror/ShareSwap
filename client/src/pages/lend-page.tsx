import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Upload } from "lucide-react";
import { useState } from "react";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(10, "Please provide a detailed description"),
  isLendable: z.boolean().default(false),
  isSwappable: z.boolean().default(false),
  isRentable: z.boolean().default(false),
  // Lending fields
  lendingDuration: z.coerce
    .number()
    .min(1, "Minimum lending duration is 1 day")
    .optional()
    .nullable(),
  securityDeposit: z.coerce
    .number()
    .min(0, "Security deposit must be positive")
    .optional()
    .nullable(),
  conditionRating: z.coerce
    .number()
    .min(1)
    .max(10, "Rating must be between 1 and 10"),
});

export default function LendPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      isLendable: false,
      isSwappable: false,
      isRentable: false,
      lendingDuration: null,
      securityDeposit: null,
      conditionRating: 10,
    },
  });

  const createItemMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      const formData = new FormData();
      selectedPhotos.forEach((photo) => {
        formData.append("photos", photo);
      });
      Object.entries(data).forEach(([key, value]) => {
        if (value !== null) {
          formData.append(key, String(value));
        }
      });

      const res = await apiRequest("POST", "/api/items", formData);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Successfully Listed!",
        description: `Your item has been added to ShareChest. You'll earn ${data.shareCoinsReward} ShareCoins for this listing.`,
      });
      navigate("/borrow");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to list item",
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

  const watchIsLendable = form.watch("isLendable");

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">List Your Item</h1>
          <p className="text-muted-foreground">
            Share your items with the community and earn ShareCoins
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((data) => createItemMutation.mutate(data))}
                className="space-y-6"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Item Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Features and Details</FormLabel>
                      <FormControl>
                        <Textarea {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-4">
                  <FormLabel>Sharing Options</FormLabel>
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="isLendable"
                      render={({ field }) => (
                        <FormItem className="flex items-center space-x-2">
                          <FormControl>
                            <Checkbox 
                              checked={field.value} 
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="!mt-0">Available for Lending</FormLabel>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="isSwappable"
                      render={({ field }) => (
                        <FormItem className="flex items-center space-x-2">
                          <FormControl>
                            <Checkbox 
                              checked={field.value} 
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="!mt-0">Available for Swaps</FormLabel>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="isRentable"
                      render={({ field }) => (
                        <FormItem className="flex items-center space-x-2">
                          <FormControl>
                            <Checkbox 
                              checked={field.value} 
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="!mt-0">Available for Rent</FormLabel>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {watchIsLendable && (
                  <div className="space-y-4 border-t pt-4">
                    <h3 className="font-medium">Lending Details</h3>
                    <FormField
                      control={form.control}
                      name="lendingDuration"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Lending Duration (days)</FormLabel>
                          <FormControl>
                            <Input type="number" min="1" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="securityDeposit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Security Deposit ($)</FormLabel>
                          <FormControl>
                            <Input type="number" min="0" step="0.01" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                <div className="space-y-4">
                  <FormLabel>Photos</FormLabel>
                  <div className="border-2 border-dashed rounded-lg p-6 text-center">
                    <Input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      id="photos"
                      onChange={handlePhotoChange}
                    />
                    <label htmlFor="photos">
                      <div className="cursor-pointer">
                        <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          Click to upload photos
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
                  name="conditionRating"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Condition Rating (1-10)</FormLabel>
                      <FormControl>
                        <Input type="number" min="1" max="10" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={createItemMutation.isPending}
                >
                  List Item
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}