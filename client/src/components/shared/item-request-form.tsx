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
  Tag,
} from "lucide-react";
import {
  formatReplacementValue,
  hasValidReplacementValue,
} from "@/lib/replacement-value";
import { useState, useEffect } from "react";
import * as z from "zod";
import { Link } from "wouter";
import type { SelectItem } from "@db/schema";
import { getTierShareCoins, calculateMultiSwap } from "@/lib/swap-calculator";
import { calculateSecurityDeposit } from "@/lib/deposit-calculator";
import {
  calculateRentalPrice,
  getDiscountLabel,
} from "@/lib/rental-calculator";
import { useVerification } from "@/hooks/use-verification";

const formSchema = z.object({
  message: z.string().max(140).optional().default(""),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  conditionConfirmed: z.boolean().optional(),
  replacementValueAcknowledged: z.boolean().optional(),
  deliveryMethod: z.enum(["in_person", "courier"]).default("in_person"),
  depositMethod: z.enum(["in_app", "in_person"]).default("in_app"),
});

type Prefill = {
  startDate?: string | null;
  endDate?: string | null;
  deliveryMethod?: string | null;
  depositMethod?: string | null;
};

type Props = {
  item: SelectItem;
  requestType: "BORROW" | "RENT" | "SWAP" | "GIFT";
  isOpen: boolean;
  onClose: () => void;
  swapOfferItem?: SelectItem[] | null;
  onInsufficientCoins?: (required: number) => void;
  prefill?: Prefill | null;
};

export function ItemRequestForm({
  item,
  requestType,
  isOpen,
  onClose,
  swapOfferItem,
  onInsufficientCoins,
  prefill,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { requireVerification, showVerificationModal, VerificationModal } =
    useVerification();

  // Get current user info for personalized messages
  const { data: userData } = useQuery({
    queryKey: ["/api/user"],
  });
  const user = userData as {
    id?: number;
    username?: string;
    verificationLevel?: "unverified" | "email_only" | "fully_verified";
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

  // When the form opens with prefill data (e.g. after a withdrawn offer), apply it
  useEffect(() => {
    if (isOpen && prefill) {
      if (prefill.startDate) form.setValue("startDate", prefill.startDate);
      if (prefill.endDate) form.setValue("endDate", prefill.endDate);
      if (
        prefill.deliveryMethod === "in_person" ||
        prefill.deliveryMethod === "courier"
      )
        form.setValue("deliveryMethod", prefill.deliveryMethod);
      if (
        prefill.depositMethod === "in_app" ||
        prefill.depositMethod === "in_person"
      )
        form.setValue("depositMethod", prefill.depositMethod);
    }
  }, [isOpen, prefill]);

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
        swapOfferItemId: swapOfferItem?.[0]?.id,
        swapOfferedItemIds: swapOfferItem?.map((i) => i.id) ?? [],
        deliveryMethod: data.deliveryMethod,
        depositMethod: data.depositMethod,
      });
      if (!res.ok) {
        const errorData = await res.json();
        const error = new Error(
          errorData.error || "Failed to send request",
        ) as Error & { code?: string };
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
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[425px] bg-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-6 leading-tight break-words">
              {requestType === "GIFT"
                ? `Request ${item.name} as a gift`
                : `Request to ${requestType.toLowerCase()} ${item.name}`}
            </DialogTitle>
          </DialogHeader>

          {/* Verification warning for BORROW/RENT if user is not fully verified */}
          {(requestType === "BORROW" || requestType === "RENT") &&
            user &&
            user.verificationLevel !== "fully_verified" && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-1 text-amber-800 font-medium">
                  <BadgeCheck className="h-4 w-4" />
                  <span>Verification</span>
                  <span className="font-normal">
                    is Required to{" "}
                    {requestType === "BORROW" ? "Borrow" : "Rent"} Items
                  </span>
                </div>
                <div className="flex flex-col gap-1 text-sm">
                  <div className="flex items-center gap-2">
                    {user.idVerified ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <div className="h-4 w-4 rounded border-2 border-amber-400" />
                    )}
                    <span
                      className={
                        user.idVerified ? "text-green-700" : "text-amber-700"
                      }
                    >
                      Identity verification
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {user.paymentVerified ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <div className="h-4 w-4 rounded border-2 border-amber-400" />
                    )}
                    <span
                      className={
                        user.paymentVerified
                          ? "text-green-700"
                          : "text-amber-700"
                      }
                    >
                      Payment method on file
                    </span>
                  </div>
                </div>
                <Link
                  href="/verification"
                  className="text-sm text-teal-600 hover:text-teal-700 font-medium underline"
                >
                  Complete verification →
                </Link>
              </div>
            )}

          {requestType === "SWAP" &&
            swapOfferItem &&
            swapOfferItem.length > 0 && (
              <div className="bg-[#E6FBF5] border border-[#0DCEA1]/30 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 text-[#0BB88C] font-medium">
                  <ArrowLeftRight className="h-4 w-4" />
                  Swap Summary
                </div>
                <div className="flex items-start gap-3">
                  {/* Your side */}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[#0DCEA1] mb-1.5">
                      You're offering:
                    </div>
                    <div className="space-y-1.5">
                      {swapOfferItem.map((offerItem) => (
                        <div
                          key={offerItem.id}
                          className="flex items-center gap-2"
                        >
                          <div className="w-8 h-8 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                            {offerItem.photos?.[0] ? (
                              <img
                                src={offerItem.photos[0]}
                                alt={offerItem.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Camera className="h-3 w-3 text-gray-400" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-900 truncate">
                              {offerItem.name}
                            </p>
                            <p className="text-[10px] text-[#0BB88C]">
                              T{(offerItem as any).tier || 2} ·{" "}
                              {getTierShareCoins((offerItem as any).tier || 2)}{" "}
                              SC
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <ArrowLeftRight className="h-5 w-5 text-[#0DCEA1]/70 mt-5 flex-shrink-0" />
                  {/* Their side */}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[#0DCEA1] mb-1.5">
                      For their:
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                        {item.photos?.[0] ? (
                          <img
                            src={item.photos[0]}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Camera className="h-3 w-3 text-gray-400" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-900 truncate">
                          {item.name}
                        </p>
                        <p className="text-[10px] text-[#0BB88C]">
                          T{(item as any).tier || 2} ·{" "}
                          {getTierShareCoins((item as any).tier || 2)} SC
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Offset summary */}
                {(() => {
                  const yourSC = swapOfferItem.reduce(
                    (s, i) => s + getTierShareCoins((i as any).tier || 2),
                    0,
                  );
                  const theirSC = getTierShareCoins((item as any).tier || 2);
                  const result = calculateMultiSwap(yourSC, theirSC);
                  return (
                    <div
                      className={`flex items-center gap-2 text-sm p-2 rounded ${
                        result.isFair
                          ? "text-[#0BB88C] bg-[#E6FBF5]"
                          : "text-amber-700 bg-amber-50"
                      }`}
                    >
                      <Coins className="h-4 w-4 flex-shrink-0" />
                      <span>
                        {result.isFair
                          ? "Fair swap — no ShareCoin adjustment"
                          : result.offsetDirection === "you_pay"
                            ? `You pay ${result.offset} ShareCoins to balance the swap`
                            : `You receive +${result.offset} ShareCoins`}
                      </span>
                    </div>
                  );
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
                You're requesting{" "}
                <span className="font-medium">{item.name}</span> as a free gift
                from the owner. No ShareCoins or payment required!
              </p>
            </div>
          )}

          <VerificationModal />
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((data) => {
                if (requestType === "BORROW" && onInsufficientCoins) {
                  const weeklyPrice =
                    parseFloat((item as any).shareCoinPrice || "0") || 5;
                  let borrowDays = 0;
                  if (data.startDate && data.endDate) {
                    const start = new Date(data.startDate);
                    const end = new Date(data.endDate);
                    borrowDays = Math.max(
                      1,
                      Math.ceil(
                        (end.getTime() - start.getTime()) /
                          (1000 * 60 * 60 * 24),
                      ) + 1,
                    );
                  }
                  const proratedCost =
                    borrowDays > 0
                      ? Math.max(1, Math.ceil((weeklyPrice / 7) * borrowDays))
                      : weeklyPrice;
                  const balance = Number((user as any)?.shareCoins || 0);
                  if (balance < proratedCost) {
                    onClose();
                    onInsufficientCoins(proratedCost);
                    return;
                  }
                }
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
                        <FormLabel>Return Date</FormLabel>
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
                        (end.getTime() - start.getTime()) /
                          (1000 * 60 * 60 * 24),
                      ),
                    );
                  }

                  const weeklyRate = Number((item as any).dollarsPrice) || 10;
                  const pricing =
                    rentalDays > 0
                      ? calculateRentalPrice(weeklyRate, rentalDays)
                      : null;
                  const discountLabel = pricing
                    ? getDiscountLabel(pricing.weeks)
                    : "";

                  // Delivery cost
                  const deliveryCost = deliveryMethod === "courier" ? 15 : 0;

                  // Deposit (from item's securityDeposit field)
                  const deposit = Number((item as any).securityDeposit) || 25;

                  return (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                      <div className="text-gray-700 font-medium text-sm">
                        Cost Breakdown
                      </div>

                      {pricing ? (
                        <div className="space-y-1.5 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">
                              Rental ({pricing.weeks}{" "}
                              {pricing.weeks === 1 ? "week" : "weeks"} × $
                              {weeklyRate}/wk)
                            </span>
                            <span className="font-medium">
                              ${pricing.subtotal.toFixed(2)}
                            </span>
                          </div>
                          {pricing.discountPct > 0 && (
                            <div className="flex justify-between text-teal-700">
                              <span className="flex items-center gap-1">
                                <Tag className="h-3 w-3" />
                                {discountLabel}
                              </span>
                              <span className="font-medium">
                                −${pricing.discountAmount.toFixed(2)}
                              </span>
                            </div>
                          )}
                          {deliveryCost > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">
                                Courier delivery
                              </span>
                              <span className="font-medium">
                                ${deliveryCost}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between font-semibold border-t border-gray-200 pt-1.5 mt-0.5">
                            <span>Rental total</span>
                            <span className="text-teal-700">
                              ${(pricing.total + deliveryCost).toFixed(2)}
                            </span>
                          </div>

                          <div className="border-t border-gray-200 pt-1.5 mt-0.5">
                            <div className="flex justify-between">
                              <span className="text-gray-600 flex items-center gap-1">
                                <Shield className="h-3 w-3" />
                                Security deposit
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
                        <div className="space-y-1 text-xs text-gray-500">
                          <p>Select dates to see cost breakdown</p>
                          <div className="flex gap-3 pt-1">
                            <span className="text-teal-600 font-medium">
                              2–3 wks: 10% off
                            </span>
                            <span className="text-teal-600 font-medium">
                              4+ wks: 20% off
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

              {/* Borrow Cost Breakdown - Only for BORROW */}
              {requestType === "BORROW" &&
                (() => {
                  // Watch dates and calculate days
                  const startDate = form.watch("startDate");
                  const endDate = form.watch("endDate");
                  const deliveryMethod = form.watch("deliveryMethod");

                  const weeklyPrice =
                    parseFloat((item as any).shareCoinPrice || "0") || 5;

                  let borrowDays = 0;
                  if (startDate && endDate) {
                    const start = new Date(startDate);
                    const end = new Date(endDate);
                    // end date = return day, so usage days = end - start (no +1)
                    borrowDays = Math.max(
                      1,
                      Math.ceil(
                        (end.getTime() - start.getTime()) /
                          (1000 * 60 * 60 * 24),
                      ),
                    );
                  }

                  // Duration-based cost: ceil( (weeklyPrice / 7) × days )
                  const proratedCost =
                    borrowDays > 0
                      ? Math.max(1, Math.ceil((weeklyPrice / 7) * borrowDays))
                      : weeklyPrice;

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
                            <span className="font-medium">
                              {proratedCost} SC
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-400">
                            {weeklyPrice} SC/week × {borrowDays}{" "}
                            {borrowDays === 1 ? "day" : "days"} ÷ 7
                          </p>
                          {deliveryCost > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">
                                Courier delivery
                              </span>
                              <span className="font-medium">
                                ${deliveryCost}
                              </span>
                            </div>
                          )}

                          {hasDeposit && (
                            <div className="border-t border-gray-200 pt-1.5 mt-1.5">
                              <div className="flex justify-between">
                                <span className="text-gray-600 flex items-center gap-1">
                                  <Shield className="h-3 w-3" />
                                  Trust-deposit
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
                                  {depositCalc.discountPercentage}% discount
                                  from your trust score
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
                    const isCourier =
                      form.watch("deliveryMethod") === "courier";
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

                    const depositValue = isCourier ? "in_app" : field.value;
                    return (
                      <FormItem className="space-y-3">
                        <FormLabel className="flex items-center gap-2">
                          How would you like to handle the deposit?
                        </FormLabel>
                        <FormControl>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => field.onChange("in_app")}
                              className={`text-left flex flex-col justify-start border rounded-lg p-2.5 transition-colors ${
                                depositValue === "in_app"
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-gray-200 hover:bg-gray-50"
                              }`}
                            >
                              <span className="flex items-start gap-1.5 font-medium text-sm">
                                <Shield
                                  className={`h-4 w-4 flex-shrink-0 mt-px ${depositValue === "in_app" ? "text-primary-foreground" : "text-gray-500"}`}
                                />
                                Handle In-app
                              </span>
                              <p
                                className={`text-xs font-medium mt-0.5 ${depositValue === "in_app" ? "text-primary-foreground/80" : "text-teal-600"}`}
                              >
                                Recommended
                              </p>
                              <p
                                className={`text-[10px] mt-0.5 ${depositValue === "in_app" ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                              >
                                Processing fee: ${processingFee}
                              </p>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                !isCourier && field.onChange("in_person")
                              }
                              className={`text-left flex flex-col justify-start border rounded-lg p-2.5 transition-colors ${
                                isCourier
                                  ? "opacity-50 cursor-not-allowed border-gray-200"
                                  : depositValue === "in_person"
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-gray-200 hover:bg-gray-50"
                              }`}
                            >
                              <span className="flex items-start gap-1.5 font-medium text-sm">
                                <MapPin
                                  className={`h-4 w-4 flex-shrink-0 mt-px ${depositValue === "in_person" ? "text-primary-foreground" : "text-gray-500"}`}
                                />
                                Exchange In Person
                              </span>
                            </button>
                          </div>
                        </FormControl>
                        {depositValue === "in_person" && (
                          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            ⚠️ ShareSwap is not responsible for in-person
                            deposits. You assume full responsibility for
                            collection, return, and any disputes — no platform
                            protection applies.
                          </p>
                        )}
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
                      How would you like to receive this item?
                    </FormLabel>
                    <FormControl>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => field.onChange("in_person")}
                          className={`text-left flex flex-col justify-start border rounded-lg p-2.5 transition-colors ${
                            field.value === "in_person"
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          <span className="flex items-start gap-1.5 font-medium text-sm">
                            <MapPin
                              className={`h-4 w-4 flex-shrink-0 mt-px ${field.value === "in_person" ? "text-primary-foreground" : "text-gray-500"}`}
                            />
                            Exchange In Person
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => field.onChange("courier")}
                          className={`text-left flex flex-col justify-start border rounded-lg p-2.5 transition-colors ${
                            field.value === "courier"
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          <span className="flex items-start gap-1.5 font-medium text-sm">
                            <Truck
                              className={`h-4 w-4 flex-shrink-0 mt-px ${field.value === "courier" ? "text-primary-foreground" : "text-blue-600"}`}
                            />
                            Uber Direct
                          </span>
                          <p
                            className={`text-xs font-medium mt-0.5 ${field.value === "courier" ? "text-primary-foreground/80" : "text-gray-500"}`}
                          >
                            +$15
                          </p>
                        </button>
                      </div>
                    </FormControl>
                    {form.watch("deliveryMethod") === "courier" && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        ⚠️ ShareSwap is not responsible for courier issues (lost/damaged in transit). You assume full responsibility for delivery — no platform protection applies until successful delivery confirmation.
                      </p>
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

                    <div className="bg-gray-50 rounded-md p-1.5 space-y-1 text-[10px]">
                      <div className="flex items-center gap-2">
                        <span className="text-green-500">🟢</span>
                        <span className="text-gray-600">
                          <span className="font-medium">Trust Deposit</span>{" "}
                          <span className="italic">
                            — refunded after a safe return
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-orange-500">🟠</span>
                        <span className="text-gray-600">
                          <span className="font-medium">Non-Return Charge</span>{" "}
                          <span className="italic">
                            — only applied if item is not returned
                          </span>
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
                              {(item as any).replacementValue} if I don't return
                              the item.
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

                    <div className="bg-gray-50 rounded-md p-1.5 space-y-1 text-[10px]">
                      <div className="flex items-center gap-2">
                        <span className="text-green-500">🟢</span>
                        <span className="text-gray-600">
                          <span className="font-medium">Security Deposit</span>{" "}
                          — temporarily held and fully refunded after a safe
                          return
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-orange-500">🟠</span>
                        <span className="text-gray-600">
                          <span className="font-medium">Non-Return Charge</span>{" "}
                          <span className="italic">
                            — only applied if the item is not returned
                          </span>
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
                              {(item as any).replacementValue} only if the item
                              is not returned.
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

              {/* Short note to owner */}
              <FormField
                control={form.control}
                name="message"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>
                        Note to owner{" "}
                        <span className="font-normal text-muted-foreground">
                          (optional)
                        </span>
                      </FormLabel>
                      <span
                        className={`text-[11px] tabular-nums ${(field.value?.length ?? 0) > 120 ? "text-orange-500" : "text-muted-foreground"}`}
                      >
                        {field.value?.length ?? 0}/140
                      </span>
                    </div>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={2}
                        maxLength={140}
                        placeholder="Anything the owner should know?"
                        className="resize-none"
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
                      hasValidReplacementValue(
                        (item as any).replacementValue,
                      ) &&
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
