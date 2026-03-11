import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Gift, MapPin, Truck, Sparkles } from "lucide-react";
import * as z from "zod";
import type { SelectItem } from "@db/schema";

const giftClaimSchema = z.object({
  message: z.string().min(1, "Please include a message to the giver"),
  deliveryMethod: z.enum(["in_person", "courier"]).default("in_person"),
});

type Props = {
  item: SelectItem;
  isOpen: boolean;
  onClose: () => void;
};

export function GiftClaimModal({ item, isOpen, onClose }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<z.infer<typeof giftClaimSchema>>({
    resolver: zodResolver(giftClaimSchema),
    defaultValues: {
      message: "",
      deliveryMethod: "in_person",
    },
  });

  const claimGiftMutation = useMutation({
    mutationFn: async (data: z.infer<typeof giftClaimSchema>) => {
      const res = await apiRequest("POST", `/api/items/${item.id}/request`, {
        message: data.message,
        requestType: "GIFT",
        deliveryMethod: data.deliveryMethod,
        depositMethod: "in_app",
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to send gift request");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({
        title: "Gift Request Sent!",
        description: "The giver will be notified of your interest.",
      });
      onClose();
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Request Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: z.infer<typeof giftClaimSchema>) => {
    claimGiftMutation.mutate(data);
  };

  const setQuickMessage = (type: "quick" | "polite" | "detailed") => {
    const itemName = item.name;
    let message = "";

    switch (type) {
      case "quick":
        message = `Hi! I would love to receive your ${itemName}. Thank you for sharing! 😊`;
        break;
      case "polite":
        message = `Hello! I hope you're doing well. I would love to receive your ${itemName}. Thank you so much for your generosity! Best wishes! 😊`;
        break;
      case "detailed":
        message = `Hi there! I'm really interested in your ${itemName}. I would really appreciate receiving it and will put it to good use. Thank you so much for your generosity! 😊`;
        break;
    }

    form.setValue("message", message);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-pink-600">
            <Gift className="h-5 w-5" />
            Claim This Gift
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Your Message</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Send a message to let the giver know you'd love this item..."
                      className="min-h-[100px] resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setQuickMessage("quick")}
                      className="text-xs"
                    >
                      <Sparkles className="h-3 w-3 mr-1" />
                      Quick
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setQuickMessage("polite")}
                      className="text-xs"
                    >
                      <Sparkles className="h-3 w-3 mr-1" />
                      Polite
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setQuickMessage("detailed")}
                      className="text-xs"
                    >
                      <Sparkles className="h-3 w-3 mr-1" />
                      Detailed
                    </Button>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="deliveryMethod"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel className="flex items-center gap-2">
                    <Truck className="h-4 w-4" />
                    How would you like to receive this item?
                  </FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="grid grid-cols-2 gap-2"
                    >
                      <div className="flex items-start space-x-2 border rounded-lg p-2.5 cursor-pointer hover:bg-gray-50">
                        <RadioGroupItem
                          value="in_person"
                          id="gift_pickup"
                          className="mt-0.5"
                        />
                        <div className="flex-1">
                          <label
                            htmlFor="gift_pickup"
                            className="flex items-start gap-1.5 cursor-pointer font-medium text-sm"
                          >
                            <MapPin className="h-4 w-4 text-gray-500 mt-0.5" />
                            Exchange Item In Person
                          </label>
                          <p className="text-xs text-gray-500 font-medium mt-0.5">
                            Direct exchange
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2 border rounded-lg p-2.5 cursor-pointer hover:bg-gray-50">
                        <RadioGroupItem
                          value="courier"
                          id="gift_courier"
                          className="mt-0.5"
                        />
                        <div className="flex-1">
                          <label
                            htmlFor="gift_courier"
                            className="flex items-center gap-1.5 cursor-pointer font-medium text-sm"
                          >
                            <Truck className="h-4 w-4 text-blue-600" />
                            Uber Direct
                          </label>
                          <p className="text-xs text-gray-500 font-medium mt-0.5">
                            +$15
                          </p>
                        </div>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={claimGiftMutation.isPending}
                className="flex-1 bg-pink-500 hover:bg-pink-600 text-white"
              >
                {claimGiftMutation.isPending ? "Sending..." : "Send Request"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
