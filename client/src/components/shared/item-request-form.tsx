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
  BadgeCheck,
  Truck,
  MapPin,
  Gift,
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
import { calculateSecurityDeposit } from "@/lib/deposit-calculator";
import { useVerification } from "@/hooks/use-verification";

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
  requestType: "BORROW" | "RENT" | "SWAP" | "GIFT";
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
  const { requireVerification, showVerificationModal, VerificationModal } = useVerification();

  // Get current user info for personalized messages
  const { data: userData } = useQuery({
    queryKey: ["/api/user"],
  });
  const user = userData as { 
    id?: number;
    username?: string;
    verificationLevel?: 'unverified' | 'email_only' | 'fully_verified';
    idVerified?: boolean;
    paymentVerified?: boolean;
  } | null;

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
        } else if (requestType === "GIFT") {
          message = `Hi ${ownerName}! I would love to receive your ${itemName}. Thank you for sharing! 😊😊`;
        } else {
          message = `Hi ${ownerName}! I would like to ${action} your ${itemName}${dateRange}. 😊😊`;
        }
        break;
      case "polite":
        if (requestType === "SWAP") {
          message = `Hello ${ownerName},\n\nI hope you're doing well! I would love to swap my ${myItemName} for your ${itemName}. Would this work for you?\n\nThank you so much! 😊😊`;
        } else if (requestType === "GIFT") {
          message = `Hello ${ownerName},\n\nI hope you're doing well! I would love to receive your ${itemName}. Thank you so much for your generosity!\n\nBest wishes! 😊😊`;
        } else {
          message = `Hello ${ownerName},\n\nI hope you're doing well! I would love to ${action} your ${itemName}${dateRange}. Would this work for you?\n\nThank you so much! 😊😊`;
        }
        break;
      case "detailed":
        if (requestType === "SWAP") {
          message = `Hi ${ownerName},\n\nI'm ${userName} and I'm interested in swapping items with you. I would like to trade my ${myItemName} for your ${itemName}. I'll make sure my item is in the condition stated.\n\nPlease let me know if this works for you!\n\nBest regards! 😊😊`;
        } else if (requestType === "GIFT") {
          message = `Hi ${ownerName},\n\nI'm ${userName} and I'm interested in receiving your ${itemName}. I would really appreciate it and will put it to good use.\n\nThank you so much for your generosity!\n\nBest regards! 😊😊`;
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
      if (!res.ok) {
        const errorData = await res.json();
        const error = new Error(errorData.error || "Failed to send request") as Error & { code?: string };
        (error as any).code = errorData.code;
        throw error;
      }
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
    onError: (error: Error & { code?: string }) => {
      if ((error as any).code === "EMAIL_NOT_VERIFIED") {
        toast({
          title: "Email Verification Required",
          description: "Please verify your email address to send requests.",
          variant: "destructive",
        });
      } else if ((error as any).code === "FULL_VERIFICATION_REQUIRED") {
        showVerificationModal();
      } else {
        toast({
          title: "Failed to send request",
          description: error.message,
          variant: "destructive",
        });
      }
    },
  });

  return (
    <><Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6 leading-tight break-words">
            {requestType === "GIFT" 
              ? `Request ${item.name} as a gift`
              : `Request to ${requestType.toLowerCase()} ${item.name}`}
          </DialogTitle>
        </DialogHeader>

        {/* Verification warning for BORROW/RENT if user is not fully verified */}
        {(requestType === "BORROW" || requestType === "RENT") && user && user.verificationLevel !== 'fully_verified' && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-1 text-amber-800 font-medium">
              <BadgeCheck className="h-4 w-4" />
              <span>Verification</span>
              <span className="font-normal">is Required to {requestType === "BORROW" ? "Borrow" : "Rent"} Items</span>
            </div>
            <div className="flex flex-col gap-1 text-sm">
              <div className="flex items-center gap-2">
                {user.idVerified ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <div className="h-4 w-4 rounded border-2 border-amber-400" />
                )}
                <span className={user.idVerified ? "text-green-700" : "text-amber-700"}>
                  Identity verification
                </span>
              </div>
              <div className="flex items-center gap-2">
                {user.paymentVerified ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <div className="h-4 w-4 rounded border-2 border-amber-400" />
                )}
                <span className={user.paymentVerified ? "text-green-700" : "text-amber-700"}>
                  Payment method on file
                </span>
              </div>
            </div>
            <Link href="/verification" className="text-sm text-teal-600 hover:text-teal-700 font-medium underline">
              Complete verification →
            </Link>
          </div>
        )}

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

        {requestType === "GIFT" && (
          <div className="bg-pink-50 border border-pink-200 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-pink-600 font-medium">
              <Gift className="h-4 w-4" />
              Gift Request
            </div>
            <p className="text-sm text-pink-700">
              You're requesting <span className="font-medium">{item.name}</span> as a free gift from the owner. 
              No ShareCoins or payment required!
            </p>
          </div>
        )}

        <VerificationModal />
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => {
              if (requestType === "SWAP" || requestType === "GIFT") {
                createRequestMutation.mutate(data);
              } else {
                requireVerification(() => createRequestMutation.mutate(data));
              }
            })}
            className="space-y-4 mt-4"
          >
            {/* Date Selection - Hide for SWAP and GIFT */}
            {requestType !== "SWAP" && requestType !== "GIFT" && (
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

            {/* Rental Cost Breakdown - Only for RENT */}
            {requestType === "RENT" &&
              (() => {
                const startDate = form.watch("startDate");
                const endDate = form.watch("endDate");
                const deliveryMethod = form.watch("deliveryMethod");

                // Calculate rental days
                let rentalDays = 0;
                if (startDate && endDate) {
                  const start = new Date(startDate);
                  const end = new Date(endDate);
                  rentalDays = Math.max(
                    1,
                    Math.ceil(
                      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
                    ),
                  );
                }

                const weeklyRate = Number((item as any).dollarsPrice) || 10;
                const dailyRate = Math.max(1, Math.round(weeklyRate / 7));
                const rentalCost = rentalDays > 0 ? dailyRate * rentalDays : 0;

                // Delivery cost
                const deliveryCost = deliveryMethod === "courier" ? 15 : 0;

                // Deposit (from item's securityDeposit field)
                const deposit = Number((item as any).securityDeposit) || 25;

                return (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                    <div className="text-gray-700 font-medium text-sm">
                      Cost Breakdown
                    </div>

                    {rentalDays > 0 ? (
                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">
                            Rental ({rentalDays}{" "}
                            {rentalDays === 1 ? "day" : "days"} × $
                            {dailyRate.toFixed(2)}/day)
                          </span>
                          <span className="font-medium">
                            ${rentalCost.toFixed(2)}
                          </span>
                        </div>
                        {deliveryCost > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">
                              Courier delivery
                            </span>
                            <span className="font-medium">${deliveryCost}</span>
                          </div>
                        )}

                        <div className="border-t border-gray-200 pt-1.5 mt-1.5">
                          <div className="flex justify-between">
                            <span className="text-gray-600 flex items-center gap-1">
                              <Shield className="h-3 w-3" />
                              Security deposit (refundable)
                            </span>
                            <span className="font-medium">
                              ${deposit.toFixed(2)}
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            Held securely, auto-refunded on return
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500">
                        Select dates to see cost breakdown
                      </p>
                    )}
                  </div>
                );
              })()}

            {/* Borrow Cost Breakdown - Only for BORROW */}
            {requestType === "BORROW" &&
              (() => {
                // Tier-based weekly ShareCoin borrow rates
                const TIER_WEEKLY_RATES: Record<number, number> = {
                  1: 2, // Tier 1: Under $50 - 2 SC/week
                  2: 5, // Tier 2: $50-$199 - 5 SC/week
                  3: 10, // Tier 3: $200-$499 - 10 SC/week
                  4: 20, // Tier 4: $500-$2,000 - 20 SC/week
                };
                const itemTierForRate = (item as any).tier || 2;
                const weeklyRate = TIER_WEEKLY_RATES[itemTierForRate] || 5;

                // Watch dates and calculate days
                const startDate = form.watch("startDate");
                const endDate = form.watch("endDate");
                const deliveryMethod = form.watch("deliveryMethod");

                let borrowDays = 0;
                if (startDate && endDate) {
                  const start = new Date(startDate);
                  const end = new Date(endDate);
                  borrowDays = Math.max(
                    1,
                    Math.ceil(
                      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
                    ) + 1,
                  );
                }

                // Calculate prorated ShareCoin cost: (Weekly Rate ÷ 7) × days, rounded down, minimum 1
                const proratedCost =
                  borrowDays > 0
                    ? Math.max(1, Math.floor((weeklyRate / 7) * borrowDays))
                    : weeklyRate;

                // Delivery cost for courier
                const deliveryCost = deliveryMethod === "courier" ? 15 : 0;

                // Calculate trust-based deposit
                const itemTier = (item as any).tier || 2;
                const itemOriginalValue =
                  (item as any).originalValue || "$50–$150";
                const reputationScore = (user as any)?.reputationScore || 0;
                const viewerTrustScore = Math.min(
                  100,
                  Math.round((reputationScore / 500) * 100),
                );
                const depositCalc = calculateSecurityDeposit(
                  itemTier,
                  itemOriginalValue,
                  viewerTrustScore,
                );

                // Check if deposit is applicable (has valid replacement value)
                const hasDeposit = hasValidReplacementValue(
                  (item as any).replacementValue,
                );

                return (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                    <div className="text-gray-700 font-medium text-sm">
                      Cost Breakdown
                    </div>

                    {borrowDays > 0 ? (
                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600 flex items-center gap-1">
                            <Coins className="h-3 w-3 text-teal-600" />
                            ShareCoins ({borrowDays}{" "}
                            {borrowDays === 1 ? "day" : "days"})
                          </span>
                          <span className="font-medium">{proratedCost} SC</span>
                        </div>
                        <p className="text-[10px] text-gray-400">
                          Weekly rate: {weeklyRate} SC/week
                        </p>
                        {deliveryCost > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">
                              Courier delivery
                            </span>
                            <span className="font-medium">${deliveryCost}</span>
                          </div>
                        )}

                        {hasDeposit && (
                          <div className="border-t border-gray-200 pt-1.5 mt-1.5">
                            <div className="flex justify-between">
                              <span className="text-gray-600 flex items-center gap-1">
                                <Shield className="h-3 w-3" />
                                Trust-deposit (refundable)
                              </span>
                              {depositCalc.discountPercentage > 0 ? (
                                <span className="font-medium flex items-center gap-1.5">
                                  <span className="relative text-gray-400">
                                    <span className="absolute inset-0 flex items-center">
                                      <span className="w-full h-[1px] bg-gray-400"></span>
                                    </span>
                                    ${depositCalc.baseDeposit}
                                  </span>
                                  <span className="text-teal-600">
                                    ${depositCalc.finalDeposit}
                                  </span>
                                </span>
                              ) : (
                                <span className="font-medium">
                                  ${depositCalc.finalDeposit}
                                </span>
                              )}
                            </div>
                            {depositCalc.discountPercentage > 0 && (
                              <p className="text-[10px] text-teal-600 mt-0.5">
                                {depositCalc.discountPercentage}% discount from
                                your trust score
                              </p>
                            )}
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              Held securely, auto-refunded on return
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              Processing fee: $
                              {(depositCalc.finalDeposit * 0.03).toFixed(2)}
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500">
                        Select dates to see cost breakdown
                      </p>
                    )}
                  </div>
                );
              })()}

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

                  // Calculate deposit for processing fee display
                  const itemTierForDeposit = (item as any).tier || 2;
                  const itemOriginalValueForDeposit =
                    (item as any).originalValue || "$50–$150";
                  const reputationScoreForDeposit =
                    (user as any)?.reputationScore || 0;
                  const viewerTrustScoreForDeposit = Math.min(
                    100,
                    Math.round((reputationScoreForDeposit / 500) * 100),
                  );
                  const depositCalcForFee = calculateSecurityDeposit(
                    itemTierForDeposit,
                    itemOriginalValueForDeposit,
                    viewerTrustScoreForDeposit,
                  );
                  const processingFee = (
                    depositCalcForFee.finalDeposit * 0.03
                  ).toFixed(2);

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
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                Processing fee: ${processingFee}
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
                                Direct exchange
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
                            className="flex items-start gap-1.5 cursor-pointer font-medium text-sm"
                          >
                            <MapPin className="h-4 w-4 text-gray-500 mt-0.5" />
                            Pick Up Yourself
                          </label>
                          <p className="text-xs text-gray-500 font-medium mt-0.5">
                            Direct exchange
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

            {/* Non-Return Charge Acknowledgment - Only for BORROW */}
            {requestType === "BORROW" &&
              hasValidReplacementValue((item as any).replacementValue) && (
                <div className="bg-white border border-gray-200 rounded-lg p-2 space-y-1">
                  <div className="flex items-center gap-2 text-gray-700 font-medium text-sm">
                    Maximum Charge if Item Is Not Returned: $
                    {(item as any).replacementValue}
                  </div>

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

            {/* Non-Return Charge Acknowledgment - Only for RENT */}
            {requestType === "RENT" &&
              hasValidReplacementValue((item as any).replacementValue) && (
                <div className="bg-white border border-gray-200 rounded-lg p-2 space-y-1">
                  <div className="flex items-center gap-2 text-gray-700 font-medium text-sm">
                    Maximum Charge if Item Is Not Returned: $
                    {(item as any).replacementValue}
                  </div>

                  <div className="bg-gray-50 rounded-md p-1.5 space-y-1 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-green-500">🟢</span>
                      <span className="text-gray-600">
                        <span className="font-medium">Security Deposit</span> —
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

    <VerificationModal />
    </>
  );
}
