import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  Calendar,
  ArrowLeftRight,
  Camera,
  Coins,
  Check,
  Shield,
  Truck,
  MapPin,
} from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  formatReplacementValue,
  hasValidReplacementValue,
} from "@/lib/replacement-value";
import { useState } from "react";
import * as z from "zod";
import { Link } from "wouter";
import type { SelectItem } from "@db/schema";
import { calculateSwap, getSwapTierLabel } from "@/lib/swap-calculator";

const formSchema = z.object({
  message: z.string().min(1, "Please include a message to the owner"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  conditionConfirmed: z.boolean().optional(),
  replacementValueAcknowledged: z.boolean().optional(),
  deliveryMethod: z.enum(["in_person", "courier"]).default("in_person"),
  depositMethod: z.enum(["in_app", "in_person"]).default("in_app"),
});

type Props = {
  item: SelectItem;
  requestType: "BORROW" | "RENT" | "SWAP";
  isOpen: boolean;
  onClose: () => void;
  swapOfferItem?: SelectItem | null;
};

export function ItemRequestForm({
  item,
  requestType,
  isOpen,
  onClose,
  swapOfferItem,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showTemplates, setShowTemplates] = useState(false);

  // Get current user info for personalized messages
  const { data: user } = useQuery({
    queryKey: ["/api/user"],
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      message: "",
      startDate: "",
      endDate: "",
      conditionConfirmed: false,
      replacementValueAcknowledged: false,
      deliveryMethod: "in_person",
      depositMethod: "in_app",
    },
  });

  // Generate automated message templates
  const generateAutomatedMessage = (
    templateType: "quick" | "polite" | "detailed",
  ) => {
    const ownerName = "there"; // Will be populated with actual owner name from API
    const itemName = item.name;
    const action = requestType.toLowerCase();
    const userName = (user as any)?.username || "I";

    // Get dates for the message
    const startDate = form.getValues("startDate");
    const endDate = form.getValues("endDate");
    const dateRange =
      startDate && endDate
        ? ` from ${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}`
        : ` for a few days`;

    let message = "";
    const myItemName = swapOfferItem?.name || "my item";

    switch (templateType) {
      case "quick":
        if (requestType === "SWAP") {
          message = `Hi ${ownerName}! I would like to swap my ${myItemName} for your ${itemName} 😊😊`;
        } else {
          message = `Hi ${ownerName}! I would like to ${action} your ${itemName}${dateRange}. 😊😊`;
        }
        break;
      case "polite":
        if (requestType === "SWAP") {
          message = `Hello ${ownerName},\n\nI hope you're doing well! I would love to swap my ${myItemName} for your ${itemName}. Would this work for you?\n\nThank you so much! 😊😊`;
        } else {
          message = `Hello ${ownerName},\n\nI hope you're doing well! I would love to ${action} your ${itemName}${dateRange}. Would this work for you?\n\nThank you so much! 😊😊`;
        }
        break;
      case "detailed":
        if (requestType === "SWAP") {
          message = `Hi ${ownerName},\n\nI'm ${userName} and I'm interested in swapping items with you. I would like to trade my ${myItemName} for your ${itemName}. I'll make sure my item is in the condition stated.\n\nPlease let me know if this works for you!\n\nBest regards! 😊😊`;
        } else {
          message = `Hi ${ownerName},\n\nI'm ${userName} and I'm interested in your ${itemName}. I would like to ${action} it${dateRange}. I'll take great care of it and return it in perfect condition.\n\nPlease let me know if these dates work for you!\n\nBest regards! 😊😊`;
        }
        break;
    }

    form.setValue("message", message);
    setShowTemplates(false);
  };

  // Auto-populate dates with common ranges
  const setQuickDateRange = (days: number) => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() + 1); // Start tomorrow
    const end = new Date(start);
    end.setDate(start.getDate() + days - 1);

    form.setValue("startDate", start.toISOString().split("T")[0]);
    form.setValue("endDate", end.toISOString().split("T")[0]);
  };

  const createRequestMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      const res = await apiRequest("POST", `/api/items/${item.id}/request`, {
        ...data,
        requestType,
        swapOfferItemId: swapOfferItem?.id,
        deliveryMethod: data.deliveryMethod,
        depositMethod: data.depositMethod,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({
        title: "Request Sent!",
        description: "The owner will be notified of your request.",
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to send request",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">
            Request to {requestType.toLowerCase()} {item.name}
          </DialogTitle>
        </DialogHeader>

        {requestType === "SWAP" && swapOfferItem && (
          <div className="bg-[#E6FBF5] border border-[#0DCEA1]/30 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 text-[#0BB88C] font-medium">
              <ArrowLeftRight className="h-4 w-4" />
              Swap Summary
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="text-xs text-[#0DCEA1] mb-1">
                  You're offering:
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                    {swapOfferItem.photos?.[0] ? (
                      <img
                        src={swapOfferItem.photos[0]}
                        alt={swapOfferItem.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Camera className="h-4 w-4 text-gray-400" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 max-w-[100px] overflow-visible">
                    <p
                      className="text-sm font-medium text-gray-900 truncate"
                      style={{ lineHeight: "1.4" }}
                    >
                      {swapOfferItem.name}
                    </p>
                    <Badge
                      variant="outline"
                      className="text-xs border-[#0DCEA1]/50 text-[#0BB88C]"
                    >
                      {getSwapTierLabel((swapOfferItem as any).tier || 2)}
                    </Badge>
                  </div>
                </div>
              </div>
              <ArrowLeftRight className="h-5 w-5 text-[#0DCEA1]/70" />
              <div className="flex-1">
                <div className="text-xs text-[#0DCEA1] mb-1">For their:</div>
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                    {item.photos?.[0] ? (
                      <img
                        src={item.photos[0]}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Camera className="h-4 w-4 text-gray-400" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 max-w-[100px] overflow-visible">
                    <p
                      className="text-sm font-medium text-gray-900 truncate"
                      style={{ lineHeight: "1.4" }}
                    >
                      {item.name}
                    </p>
                    <Badge
                      variant="outline"
                      className="text-xs border-[#0DCEA1]/50 text-[#0BB88C]"
                    >
                      {getSwapTierLabel((item as any).tier || 2)}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
            {(() => {
              const yourTier = (swapOfferItem as any).tier || 2;
              const theirTier = (item as any).tier || 2;
              const swap = calculateSwap(yourTier, theirTier);
              if (swap.fairness === "offset_required") {
                return (
                  <div className="flex items-center gap-2 text-[#0BB88C] text-sm bg-[#E6FBF5] p-2 rounded">
                    <Coins className="h-4 w-4" />
                    {swap.message}
                  </div>
                );
              }
              return null;
            })()}
          </div>
        )}

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) =>
              createRequestMutation.mutate(data),
            )}
            className="space-y-4 mt-4"
          >
            {/* Date Selection - Hide for SWAP */}
            {requestType !== "SWAP" && (
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        Start Date
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          {...field}
                          min={new Date().toISOString().split("T")[0]}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Date</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          {...field}
                          min={
                            form.watch("startDate") ||
                            new Date().toISOString().split("T")[0]
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* Delivery Method Selection */}
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
                          id="in_person"
                          className="mt-0.5"
                        />
                        <div className="flex-1">
                          <label
                            htmlFor="in_person"
                            className="flex items-center gap-1.5 cursor-pointer font-medium text-sm"
                          >
                            <MapPin className="h-4 w-4 text-gray-500" />
                            Pick Up Yourself
                          </label>
                          <p className="text-xs text-green-600 font-medium mt-0.5">
                            Free
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            Meet the owner to pick up the item
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2 border rounded-lg p-2.5 cursor-pointer hover:bg-gray-50">
                        <RadioGroupItem
                          value="courier"
                          id="courier"
                          className="mt-0.5"
                        />
                        <div className="flex-1">
                          <label
                            htmlFor="courier"
                            className="flex items-center gap-1.5 cursor-pointer font-medium text-sm"
                          >
                            <Truck className="h-4 w-4 text-blue-600" />
                            Uber Direct
                          </label>
                          <p className="text-xs text-gray-500 font-medium mt-0.5">
                            +$15
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            Courier delivers to you
                          </p>
                        </div>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  {form.watch("deliveryMethod") === "courier" && (
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-2 text-xs text-blue-800">
                      <strong>Note:</strong> If you book the courier, you handle
                      any courier issues (lost/damaged in transit).
                      Trust-deposit only activates after successful delivery
                      confirmation.
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Rental Cost Breakdown - Only for RENT */}
            {requestType === "RENT" && (
              (() => {
                const startDate = form.watch("startDate");
                const endDate = form.watch("endDate");
                const deliveryMethod = form.watch("deliveryMethod");
                
                // Calculate rental days
                let rentalDays = 0;
                if (startDate && endDate) {
                  const start = new Date(startDate);
                  const end = new Date(endDate);
                  rentalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
                }
                
                // Get rental rate from item (weekly rate)
                const weeklyRate = (item as any).rentalRate || 10;
                const dailyRate = Math.max(1, Math.round(weeklyRate / 7));
                const rentalCost = rentalDays > 0 ? dailyRate * rentalDays : 0;
                
                // Platform fee (0% for 2025, but show the line)
                const platformFeePercent = 0;
                const platformFee = Math.round(rentalCost * platformFeePercent);
                
                // Processing fee (3%)
                const processingFeePercent = 0.03;
                const processingFee = Math.round(rentalCost * processingFeePercent);
                
                // Delivery cost
                const deliveryCost = deliveryMethod === "courier" ? 15 : 0;
                
                // Deposit (from item)
                const deposit = (item as any).rentalDeposit || Math.round(((item as any).aiValuation || 50) * 0.3);
                
                // Total due now (rental + fees + delivery)
                const totalDueNow = rentalCost + platformFee + processingFee + deliveryCost;
                
                return (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                    <div className="text-gray-700 font-medium text-sm">
                      Cost Breakdown
                    </div>
                    
                    {rentalDays > 0 ? (
                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Rental ({rentalDays} {rentalDays === 1 ? 'day' : 'days'} × ${dailyRate}/day)</span>
                          <span className="font-medium">${rentalCost}</span>
                        </div>
                        {deliveryCost > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Courier delivery</span>
                            <span className="font-medium">${deliveryCost}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-gray-600">Platform fee (0% for 2025)</span>
                          <span className="font-medium text-green-600">Free</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Payment processing (3%)</span>
                          <span className="font-medium">${processingFee}</span>
                        </div>
                        
                        <div className="border-t border-gray-200 pt-1.5 mt-1.5">
                          <div className="flex justify-between font-medium">
                            <span className="text-gray-700">Total due now</span>
                            <span className="text-teal-600">${totalDueNow}</span>
                          </div>
                        </div>
                        
                        <div className="border-t border-gray-200 pt-1.5 mt-1.5">
                          <div className="flex justify-between">
                            <span className="text-gray-600 flex items-center gap-1">
                              <Shield className="h-3 w-3" />
                              Security deposit (refundable)
                            </span>
                            <span className="font-medium">${deposit}</span>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            Held securely, auto-refunded on return
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500">Select dates to see cost breakdown</p>
                    )}
                  </div>
                );
              })()
            )}

            {/* Deposit Handoff Method - Only for BORROW */}
            {requestType === "BORROW" && (
              <FormField
                control={form.control}
                name="depositMethod"
                render={({ field }) => {
                  const isCourier = form.watch("deliveryMethod") === "courier";
                  // Auto-lock to in_app when courier is selected
                  if (isCourier && field.value !== "in_app") {
                    field.onChange("in_app");
                  }
                  return (
                    <FormItem className="space-y-3">
                      <FormLabel className="flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        How would you like to handle the deposit?
                      </FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          value={isCourier ? "in_app" : field.value}
                          className="grid grid-cols-2 gap-2"
                        >
                          <div className="flex items-start space-x-2 border rounded-lg p-2.5 cursor-pointer hover:bg-gray-50">
                            <RadioGroupItem
                              value="in_app"
                              id="deposit_in_app"
                              className="mt-0.5"
                            />
                            <div className="flex-1">
                              <label
                                htmlFor="deposit_in_app"
                                className="flex items-center gap-1.5 cursor-pointer font-medium text-sm"
                              >
                                <Shield className="h-4 w-4 text-gray-500" />
                                In-app
                              </label>
                              <p className="text-xs text-teal-600 font-medium mt-0.5">
                                Recommended
                              </p>
                              <p className="text-[10px] text-gray-400 mt-0.5">
                                Held securely, auto-refunded
                              </p>
                            </div>
                          </div>
                          <div
                            className={`flex items-start space-x-2 border rounded-lg p-2.5 ${isCourier ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-gray-50"}`}
                          >
                            <RadioGroupItem
                              value="in_person"
                              id="deposit_in_person"
                              disabled={isCourier}
                              className="mt-0.5"
                            />
                            <div className="flex-1">
                              <label
                                htmlFor="deposit_in_person"
                                className={`flex items-center gap-1.5 font-medium text-sm ${isCourier ? "cursor-not-allowed" : "cursor-pointer"}`}
                              >
                                <MapPin className="h-4 w-4 text-gray-500" />
                                In person
                              </label>
                              <p className="text-xs text-gray-500 font-medium mt-0.5">
                                No fees
                              </p>
                              <p className="text-[10px] text-gray-400 mt-0.5">
                                Handled directly with neighbour
                              </p>
                            </div>
                          </div>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            )}

            {/* Non-Return Charge Acknowledgment - Only for BORROW */}
            {requestType === "BORROW" &&
              hasValidReplacementValue((item as any).replacementValue) && (
                <div className="bg-white border border-gray-200 rounded-lg p-2 space-y-1">
                  <div className="flex items-center gap-2 text-gray-700 font-medium text-sm">
                    <Shield className="h-3.5 w-3.5 text-gray-500" />
                    Maximum Charge if Item Is Not Returned: $
                    {(item as any).replacementValue}
                  </div>
                  <p className="text-[10px] text-gray-400">
                    Most borrowers never pay this.
                  </p>

                  <div className="bg-gray-50 rounded-md p-1.5 space-y-1 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-green-500">🟢</span>
                      <span className="text-gray-600">
                        <span className="font-medium">Trust Deposit</span> —
                        temporarily held and fully refunded after a safe return
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-orange-500">🟠</span>
                      <span className="text-gray-600">
                        <span className="font-medium">Non-Return Charge</span> —
                        only applied if the item is not returned
                      </span>
                    </div>
                  </div>

                  <FormField
                    control={form.control}
                    name="replacementValueAcknowledged"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <input
                            type="checkbox"
                            checked={field.value}
                            onChange={field.onChange}
                            className="h-3.5 w-3.5 mt-0.5 accent-teal-600"
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="text-xs font-normal cursor-pointer text-gray-700">
                            I understand I may be charged up to $
                            {(item as any).replacementValue} only if the item is
                            not returned.
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <Link
                    href="/faq#deposits-coverage"
                    className="text-xs text-teal-600 hover:text-teal-700 hover:underline inline-block"
                  >
                    How protection works
                  </Link>
                </div>
              )}

            {/* Condition Confirmation - Only for SWAP */}
            {requestType === "SWAP" && (
              <FormField
                control={form.control}
                name="conditionConfirmed"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3">
                    <FormControl>
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={field.onChange}
                        className="h-4 w-4 mt-0.5 accent-[#0DCEA1]"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="text-sm font-normal cursor-pointer">
                        I confirm this item matches the condition stated.
                      </FormLabel>
                    </div>
                  </FormItem>
                )}
              />
            )}

            {/* Automated Message Templates */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FormLabel>Message to Owner</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowTemplates(!showTemplates)}
                  className="text-xs"
                >
                  <Sparkles className="h-3 w-3 mr-1" />
                  Quick Messages
                </Button>
              </div>

              {showTemplates && (
                <div className="flex gap-2 flex-wrap mb-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => generateAutomatedMessage("quick")}
                  >
                    Quick & Friendly
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => generateAutomatedMessage("polite")}
                  >
                    Polite & Formal
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => generateAutomatedMessage("detailed")}
                  >
                    Detailed & Personal
                  </Button>
                </div>
              )}
            </div>

            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={6}
                      placeholder={
                        requestType === "SWAP"
                          ? "Send a message to the owner explaining why you'd like to swap items..."
                          : "Send a message to the owner explaining why you'd like to borrow this item..."
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  createRequestMutation.isPending ||
                  (requestType === "BORROW" &&
                    hasValidReplacementValue((item as any).replacementValue) &&
                    !form.watch("replacementValueAcknowledged"))
                }
              >
                Send Request
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
