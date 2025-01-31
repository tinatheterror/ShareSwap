import { useState } from "react";
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { z } from "zod";

type Request = {
  request: {
    id: number;
    requestType: string;
    status: string;
    message: string;
    createdAt: string;
  };
  item: {
    id: number;
    name: string;
    photos: string[];
  };
  requester: {
    id: number;
    username: string;
  };
};

const deliveryFormSchema = z.object({
  deliveryType: z.enum(["SELF_ARRANGED", "IN_APP_SERVICE"]),
  deliveryAddress: z.string().min(1, "Delivery address is required"),
  deliveryDate: z.string().min(1, "Delivery date is required"),
  securityDeposit: z.string().min(1, "Security deposit amount is required"),
});

export default function RequestsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null);

  const { data: requests = [] } = useQuery<Request[]>({
    queryKey: ['/api/requests'],
  });

  const updateRequestMutation = useMutation({
    mutationFn: async ({ requestId, status }: { requestId: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/requests/${requestId}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/requests'] });
      toast({
        title: "Request updated",
        description: "The request status has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update request",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deliveryMutation = useMutation({
    mutationFn: async ({ requestId, data }: { requestId: number; data: z.infer<typeof deliveryFormSchema> }) => {
      const res = await apiRequest("POST", `/api/requests/${requestId}/delivery`, data);
      return res.json();
    },
    onSuccess: () => {
      setSelectedRequest(null);
      queryClient.invalidateQueries({ queryKey: ['/api/requests'] });
      toast({
        title: "Delivery arranged",
        description: "The delivery has been arranged successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to arrange delivery",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const form = useForm<z.infer<typeof deliveryFormSchema>>({
    resolver: zodResolver(deliveryFormSchema),
    defaultValues: {
      deliveryType: "SELF_ARRANGED",
      deliveryAddress: "",
      deliveryDate: "",
      securityDeposit: "",
    },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Item Requests</h1>
          <p className="text-muted-foreground">
            Manage your item requests and arrange deliveries
          </p>
        </div>

        <div className="grid gap-6">
          {requests.map((req) => (
            <Card key={req.request.id}>
              <CardContent className="p-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-semibold">{req.item.name}</h3>
                    <div className="flex gap-2 mt-2">
                      <Badge>{req.request.requestType}</Badge>
                      <Badge variant={
                        req.request.status === "ACCEPTED" ? "default" :
                        req.request.status === "DECLINED" ? "destructive" :
                        "secondary"
                      }>
                        {req.request.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      From: {req.requester.username}
                    </p>
                    <p className="text-sm mt-2">{req.request.message}</p>
                  </div>
                  <div className="flex gap-2">
                    {req.request.status === "PENDING" && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => updateRequestMutation.mutate({
                            requestId: req.request.id,
                            status: "DECLINED"
                          })}
                        >
                          Decline
                        </Button>
                        <Button
                          onClick={() => updateRequestMutation.mutate({
                            requestId: req.request.id,
                            status: "ACCEPTED"
                          })}
                        >
                          Accept
                        </Button>
                      </>
                    )}
                    {req.request.status === "ACCEPTED" && (
                      <Button onClick={() => setSelectedRequest(req)}>
                        Arrange Delivery
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Arrange Delivery</DialogTitle>
              <DialogDescription>
                Choose how you want to handle the delivery and security deposit
              </DialogDescription>
            </DialogHeader>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((data) => {
                  if (!selectedRequest) return;
                  deliveryMutation.mutate({
                    requestId: selectedRequest.request.id,
                    data,
                  });
                })}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="deliveryType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Delivery Method</FormLabel>
                      <select
                        {...field}
                        className="w-full p-2 border rounded"
                      >
                        <option value="SELF_ARRANGED">Self Arranged</option>
                        <option value="IN_APP_SERVICE">In-App Service ($10 fee)</option>
                      </select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="deliveryAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Delivery Address</FormLabel>
                      <FormControl>
                        <Textarea {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="deliveryDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Delivery Date</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} />
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
                      <FormLabel>Security Deposit Amount ($)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSelectedRequest(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={deliveryMutation.isPending}
                  >
                    Submit
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
