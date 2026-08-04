import { useState, useEffect } from "react";
import { Navbar } from "@/components/shared/navbar";
import { ItemRequestForm } from "@/components/shared/item-request-form";
import { SwapInventorySelector } from "@/components/swap-inventory-selector";
import { GiftClaimModal } from "@/components/gift-claim-modal";
import { InsufficientShareCoinsModal } from "@/components/borrow/insufficient-sharecoins-modal";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation, Link } from "wouter";
import {
  Coins,
  HandHeart,
  DollarSign,
  ArrowLeftRight,
  Info,
  Clock,
  Gift,
  Pencil,
  Bell,
  BellOff,
  BookmarkPlus,
  PackageX,
  Ban,
} from "lucide-react";
import type { SelectItem } from "@db/schema";
import { UserBadges } from "@/components/user-badges";
import { getSwapTierLabel, getTierShareCoins } from "@/lib/swap-calculator";

const TIER_SUBTITLES: Record<number, string> = {
  1: "Budget Friendly Item",
  2: "Everyday Item",
  3: "Premium Item",
  4: "High Value Item",
};
import {
  formatReplacementValue,
  hasValidReplacementValue,
} from "@/lib/replacement-value";
import { calculateSecurityDeposit } from "@/lib/deposit-calculator";
import { useAuth } from "@/hooks/use-auth";
import { formatDisplayName } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type RequestType = "BORROW" | "RENT" | "SWAP" | "GIFT";

type ItemRequest = {
  id: number;
  itemId: number;
  requestType: string;
  status: string;
};

export default function ItemDetailsPage() {
  const [requestType, setRequestType] = useState<RequestType | null>(null);
  const [showSwapSelector, setShowSwapSelector] = useState(false);
  const [selectedSwapItem, setSelectedSwapItem] = useState<SelectItem[] | null>(null);
  const [selectedSwapOwnerExtraItems, setSelectedSwapOwnerExtraItems] = useState<SelectItem[]>([]);
  const [showGiftClaimModal, setShowGiftClaimModal] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [insufficientCoinsModal, setInsufficientCoinsModal] = useState<{
    required: number;
    context: "borrow" | "swap";
  } | null>(null);
  const [prefill, setPrefill] = useState<{
    startDate?: string | null;
    endDate?: string | null;
    deliveryMethod?: string | null;
    depositMethod?: string | null;
  } | null>(null);
  const [location] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();

  // Extract item ID from URL
  const itemId = location.split("/").pop();

  // Auto-open form with pre-filled terms when navigating back after a withdraw
  useEffect(() => {
    const raw = sessionStorage.getItem("shareswap_resend_prefill");
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (data.itemId && String(data.itemId) === String(itemId)) {
        sessionStorage.removeItem("shareswap_resend_prefill");
        setPrefill({
          startDate: data.startDate,
          endDate: data.endDate,
          deliveryMethod: data.deliveryMethod,
          depositMethod: data.depositMethod,
        });
        setRequestType(data.requestType as RequestType);
      }
    } catch {
      sessionStorage.removeItem("shareswap_resend_prefill");
    }
  }, [itemId]);

  // Determine which sharing option to prioritize based on referrer
  const getReferrerContext = () => {
    if (typeof window !== "undefined") {
      const referrer = document.referrer;
      if (referrer.includes("/swap")) return "swap";
      if (referrer.includes("/rent")) return "rent";
      if (referrer.includes("/borrow")) return "borrow";
    }
    return "borrow";
  };

  const prioritizedContext = getReferrerContext();

  const queryClient = useQueryClient();

  const { data: item } = useQuery<SelectItem>({
    queryKey: [`/api/items/${itemId}`],
    enabled: !!itemId,
  });

  const isCurrentlyOut = !!(item as any)?.isCurrentlyOut;
  const isCooldownActive = !!(item as any)?.isCooldownActive;
  const cooldownExpiresAt: string | null = (item as any)?.cooldownExpiresAt ?? null;
  const activeRequestEndDate: string | null = (item as any)?.activeRequestEndDate ?? null;
  const expectedAvailability = activeRequestEndDate
    ? new Date(activeRequestEndDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  // Notify-me subscription
  const { data: notifyData } = useQuery<{ subscribed: boolean }>({
    queryKey: [`/api/items/${itemId}/notify-me`],
    enabled: !!itemId && !!user && isCurrentlyOut,
  });
  const isSubscribed = notifyData?.subscribed ?? false;

  const notifyMutation = useMutation({
    mutationFn: async () => {
      if (isSubscribed) {
        return apiRequest("DELETE", `/api/items/${itemId}/notify-me`);
      } else {
        return apiRequest("POST", `/api/items/${itemId}/notify-me`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/items/${itemId}/notify-me`] });
      queryClient.invalidateQueries({ queryKey: ["/api/items/my-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items/my-subscribed-items"] });
      toast({
        title: isSubscribed ? "Notification removed" : "We'll notify you",
        description: isSubscribed
          ? "You won't be notified when this item returns."
          : "You'll get a notification when this item becomes available again.",
      });
    },
  });

  const wishlistMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/wishlists/from-item", { itemId: Number(itemId) });
    },
    onSuccess: () => {
      toast({ title: "Added to wishlist", description: "We'll notify you when something similar is listed." });
    },
    onError: (err: any) => {
      toast({ title: "Could not add to wishlist", description: err?.message || "Please try again.", variant: "destructive" });
    },
  });

  const { data: ownerSwapItems = [] } = useQuery<{ id: number }[]>({
    queryKey: ["/api/swap-eligible-items", "owner-count", (item as any)?.ownerId],
    queryFn: () => fetch(`/api/swap-eligible-items?partnerId=${(item as any)?.ownerId}`).then(r => r.json()),
    enabled: !!(item?.isSwappable && user && (item as any)?.ownerId !== user?.id),
    staleTime: 60000,
  });

  // Fetch pending requests to check if user already has a pending request for this item
  // refetchOnMount: "always" ensures stale cache never causes stuck "Request Pending" buttons
  const { data: requests } = useQuery<ItemRequest[]>({
    queryKey: ["/api/requests"],
    refetchOnMount: "always",
  });

  // Check if user has pending requests for this item
  const pendingRequests =
    requests?.filter(
      (r) => r.itemId === Number(itemId) && r.status === "PENDING",
    ) || [];

  const hasPendingBorrow = pendingRequests.some(
    (r) => r.requestType === "BORROW",
  );
  const hasPendingRent = pendingRequests.some((r) => r.requestType === "RENT");
  const hasPendingSwap = pendingRequests.some((r) => r.requestType === "SWAP");
  const hasPendingGift = pendingRequests.some((r) => r.requestType === "GIFT");
  const hasAnyPending = pendingRequests.length > 0;

  if (!item) return null;

  const isOwner = !!user && user.id === (item as any).ownerId;

  // Create ordered sharing options based on context
  const getSharingOptions = (ownerView = false) => {
    const itemReplacementValue = (item as any).replacementValue;
    const itemTier = (item as any).tier || 2;
    const itemOriginalValue = (item as any).originalValue || "$50–$150";
    const reputationScore = user?.reputationScore || 0;
    const viewerTrustScore = Math.min(
      100,
      Math.round((reputationScore / 500) * 100),
    );
    const depositCalc = ownerView
      ? calculateSecurityDeposit(itemTier, itemOriginalValue, 0)
      : calculateSecurityDeposit(itemTier, itemOriginalValue, viewerTrustScore);

    const borrowOption = item.isLendable ? (
      <div
        key="borrow"
        className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3"
      >
        <div>
          <p className="font-medium">Borrow</p>
          <div className="flex items-center gap-1 mb-1">
            <Coins className="h-4 w-4 text-teal-600" />
            <span className="text-lg font-bold text-teal-700">
              {Math.round(Number(item.shareCoinPrice || item.shareCoinsReward || 5))} ShareCoins
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Trust-Deposit:{" "}
            {depositCalc.discountPercentage > 0 ? (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1.5 cursor-help">
                      <span className="relative text-black">
                        <span className="absolute inset-0 flex items-center">
                          <span className="w-full h-[2px] bg-teal-500"></span>
                        </span>
                        ${depositCalc.baseDeposit}
                      </span>
                      <span className="font-semibold text-teal-600">
                        ${depositCalc.finalDeposit}
                      </span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <p className="text-xs">Discounted {depositCalc.discountPercentage}% by your trust score</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              `$${depositCalc.finalDeposit}`
            )}
          </p>
          {hasValidReplacementValue(itemReplacementValue) && (
            <p className="text-[10px] text-gray-400 mt-1">
              Max charge if not returned: ${itemReplacementValue}
            </p>
          )}
        </div>
        {!ownerView && (hasPendingBorrow ? (
          <Button
            disabled
            className="w-full sm:w-40 bg-gray-400 hover:bg-gray-400 cursor-not-allowed"
          >
            <Clock className="h-4 w-4 mr-1" />
            Request Pending
          </Button>
        ) : (
          <Button
            onClick={() => setRequestType("BORROW")}
            className="w-full sm:w-40"
            disabled={
              hasAnyPending || !hasValidReplacementValue(itemReplacementValue)
            }
          >
            <HandHeart className="h-4 w-4 mr-1" />
            Request to Borrow
          </Button>
        ))}
      </div>
    ) : null;

    const rentOption = item.isRentable ? (
      <div
        key="rent"
        className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3"
      >
        <div>
          <p className="font-medium">Rent</p>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg font-bold text-teal-700">
              ${Number(item.dollarsPrice || 10).toFixed(0)}/week
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Security Deposit: ${Number(item.securityDeposit || 0).toFixed(0)}
          </p>
        </div>
        {!ownerView && (hasPendingRent ? (
          <Button
            disabled
            className="w-full sm:w-40 bg-gray-400 hover:bg-gray-400 cursor-not-allowed"
          >
            <Clock className="h-4 w-4 mr-1" />
            Request Pending
          </Button>
        ) : (
          <Button
            onClick={() => setRequestType("RENT")}
            className="w-full sm:w-40"
            disabled={hasAnyPending}
          >
            <DollarSign className="h-4 w-4 mr-1" />
            Request to Rent
          </Button>
        ))}
      </div>
    ) : null;

    const swapOption = item.isSwappable ? (
      <div key="swap" className="space-y-2">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <div>
            <p className="font-medium">Swap</p>
            <div className="flex items-center gap-1 mb-1">
              <span className="text-sm text-muted-foreground">Swap Value:</span>
              <ArrowLeftRight className="h-4 w-4 text-teal-700" />
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="focus:outline-none">
                      <Badge
                        variant="outline"
                        className="border-teal-700 text-teal-700 cursor-help"
                      >
                        <span className="flex items-center gap-1">
                          {TIER_SUBTITLES[itemTier] || "Item"}:
                          <Coins className="h-3 w-3" />
                          {getTierShareCoins(itemTier)}
                        </span>
                      </Badge>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <p className="text-xs">Any item combination is allowed — ShareCoins cover the difference in value.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {(item as any).swapDesiredItem && (
              <p className="text-sm text-muted-foreground mt-1">
                Looking for: {(item as any).swapDesiredItem}
              </p>
            )}
          </div>
          {!ownerView && (hasPendingSwap ? (
            <Button
              disabled
              className="w-full sm:w-40 bg-gray-400 hover:bg-gray-400 cursor-not-allowed"
            >
              <Clock className="h-4 w-4 mr-1" />
              Request Pending
            </Button>
          ) : (
            <Button
              onClick={() => setShowSwapSelector(true)}
              className="w-full sm:w-40 bg-[#0DCEA1] hover:bg-[#0BB88C]"
              disabled={hasAnyPending}
            >
              <ArrowLeftRight className="h-4 w-4 mr-1" />
              Request to Swap
            </Button>
          ))}
        </div>
      </div>
    ) : null;

    const giftOption = item.isGift ? (
      <div
        key="gift"
        className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3"
      >
        <div>
          <p className="font-medium">Gift</p>
          <div className="flex items-center gap-2 mb-1">
            <Gift className="h-4 w-4 text-pink-500" />
            <span className="text-lg font-bold text-pink-600">
              Free to claim
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            This item is being given away for free
          </p>
        </div>
        {!ownerView && (hasPendingGift ? (
          <Button
            disabled
            className="w-full sm:w-40 bg-gray-400 hover:bg-gray-400 cursor-not-allowed"
          >
            <Clock className="h-4 w-4 mr-1" />
            Request Pending
          </Button>
        ) : (
          <Button
            onClick={() => setRequestType("GIFT")}
            className="w-full sm:w-40 bg-pink-500 hover:bg-pink-600"
            disabled={hasAnyPending}
          >
            <Gift className="h-4 w-4 mr-1" />
            Send Gift Request
          </Button>
        ))}
      </div>
    ) : null;

    // Order options based on context
    const options: JSX.Element[] = [];

    // Gift items only show the gift option
    if (giftOption) {
      options.push(giftOption);
      return options;
    }

    if (prioritizedContext === "swap") {
      if (swapOption) options.push(swapOption);
      if (borrowOption) options.push(borrowOption);
      if (rentOption) options.push(rentOption);
    } else if (prioritizedContext === "rent") {
      if (rentOption) options.push(rentOption);
      if (borrowOption) options.push(borrowOption);
      if (swapOption) options.push(swapOption);
    } else {
      // 'borrow' or default
      if (borrowOption) options.push(borrowOption);
      if (rentOption) options.push(rentOption);
      if (swapOption) options.push(swapOption);
    }

    return options;
  };

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
              <div>
                <div className="aspect-square bg-muted rounded-lg overflow-hidden">
                  {item.photos[selectedPhotoIndex] && (
                    <img
                      src={item.photos[selectedPhotoIndex]}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                {item.photos.length > 1 && (
                  <div className="grid grid-cols-4 gap-2 mt-2">
                    {item.photos.map((photo, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedPhotoIndex(i)}
                        className={`aspect-square bg-muted rounded-lg overflow-hidden border-2 transition-colors ${i === selectedPhotoIndex ? "border-teal-500" : "border-transparent hover:border-teal-300"}`}
                      >
                        <img
                          src={photo}
                          alt={`${item.name} ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-6">
                <div>
                  <h1 className="text-2xl font-bold">{item.name}</h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    {item.description}
                  </p>

                  {(item as any).owner && (
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <span className="text-sm text-muted-foreground">
                        Shared by
                      </span>
                      <Link
                        href={`/profile/${(item as any).owner.handle || (item as any).owner.username}`}
                        className="text-sm text-teal-600 hover:text-teal-700 cursor-pointer font-medium"
                      >
                        {(item as any).owner.displayName ||
                          formatDisplayName(
                            (item as any).owner.handle ||
                              (item as any).owner.username,
                          )}
                      </Link>
                      <div className="shadow-sm rounded-full">
                        <UserBadges
                          isVerified={(item as any).owner.isVerified}
                          reputationLevel={(item as any).owner.reputationLevel}
                          size="sm"
                        />
                      </div>
                      <span className="text-muted-foreground/40">·</span>
                      <Badge variant="secondary" className="text-xs">Condition: {item.conditionRating}/10</Badge>
                    </div>
                  )}
                </div>

                {isOwner ? (
                  <div className="space-y-4">
                    {(item as any).isPassedOn ? (
                      <div className="flex items-start gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                        <PackageX className="h-5 w-5 text-gray-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-gray-600 text-xs">This item has been passed on</p>
                          <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5">It was gifted or swapped to a neighbour and is no longer editable.</p>
                        </div>
                      </div>
                    ) : (
                      <>
                        {isCurrentlyOut && (
                          <div className="flex items-start gap-2 p-3 bg-teal-50 border border-teal-200 rounded-lg">
                            <PackageX className="h-5 w-5 text-teal-600 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-teal-800 text-xs">Your item is out with a neighbour</p>
                              <p className="text-[10px] sm:text-xs text-teal-700 mt-0.5">Renew your listing now so it's ready to go when it returns.</p>
                            </div>
                            <Link href={`/lend?edit=${item.id}`}>
                              <Button size="sm" className="shrink-0 bg-teal-600 hover:bg-teal-700 text-white text-xs">
                                Renew listing
                              </Button>
                            </Link>
                          </div>
                        )}
                        {getSharingOptions(true)}
                        <div className="pt-1">
                          <Link href={`/lend?edit=${item.id}`}>
                            <Button className="w-full sm:w-auto" variant="outline">
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit your listing
                            </Button>
                          </Link>
                        </div>
                      </>
                    )}
                  </div>
                ) : isCooldownActive ? (
                  <div className="pt-2 space-y-3">
                    <div className="flex items-start gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                      <Ban className="h-5 w-5 text-slate-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-slate-700 text-xs">Request declined</p>
                        <p className="text-xs text-slate-500">
                          {cooldownExpiresAt
                            ? `You can request this item again after ${new Date(cooldownExpiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}, or when the owner updates the listing.`
                            : "You can request this item again once the owner updates the listing."}
                        </p>
                      </div>
                    </div>
                    <Button
                      disabled
                      className="w-full bg-slate-100 hover:bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                      variant="outline"
                    >
                      <Ban className="h-4 w-4 mr-2" />
                      Request declined
                    </Button>
                  </div>
                ) : isCurrentlyOut ? (
                  <div className="pt-2 space-y-3">
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <PackageX className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-amber-800 text-xs whitespace-nowrap">Currently out with a neighbour</p>
                        <p className="text-[10px] sm:text-xs text-amber-700">
                          {expectedAvailability ? `This item is expected back ${expectedAvailability}.` : "This item is currently unavailable."}
                        </p>
                      </div>
                    </div>
                    {user ? (
                      <div className="flex flex-col gap-3">
                        <div className="flex-1 flex flex-col gap-0.5">
                          <Button
                            onClick={() => notifyMutation.mutate()}
                            disabled={notifyMutation.isPending}
                            className={`w-full ${isSubscribed ? "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300" : "bg-teal-600 hover:bg-teal-700 text-white"}`}
                            variant={isSubscribed ? "outline" : "default"}
                          >
                            {isSubscribed ? (
                              <><BellOff className="h-4 w-4 mr-2" />Remove Notification</>
                            ) : (
                              <><Bell className="h-4 w-4 mr-2" />Notify Me When Available</>
                            )}
                          </Button>
                          {!isSubscribed && (
                            <p className="text-[10px] text-muted-foreground text-center leading-tight px-1">
                              Notified when it returns
                            </p>
                          )}
                        </div>
                        <div className="flex-1 flex flex-col gap-0.5">
                          <Button
                            onClick={() => wishlistMutation.mutate()}
                            disabled={wishlistMutation.isPending}
                            variant="outline"
                            className="w-full border-teal-300 text-teal-700 hover:bg-teal-50"
                          >
                            <BookmarkPlus className="h-4 w-4 mr-2" />
                            Add to Wishlist
                          </Button>
                          <p className="text-[10px] text-muted-foreground text-center leading-tight px-1">
                            Notified when <span className="font-medium">anything similar</span> is listed
                          </p>
                        </div>
                      </div>
                    ) : (
                      <Link href="/auth">
                        <Button className="w-full bg-teal-600 hover:bg-teal-700 text-white">
                          <Bell className="h-4 w-4 mr-2" />
                          Sign in to get notified
                        </Button>
                      </Link>
                    )}
                  </div>
                ) : item.isGift ? (
                  <div className="pt-2">
                    {hasPendingGift ? (
                      <Button
                        disabled
                        className="w-full bg-gray-400 hover:bg-gray-400 cursor-not-allowed py-6 text-lg"
                      >
                        <Clock className="h-5 w-5 mr-2" />
                        Request Pending
                      </Button>
                    ) : (
                      <Button
                        onClick={() => setShowGiftClaimModal(true)}
                        className="w-full bg-pink-500 hover:bg-pink-600 py-6 text-lg"
                      >
                        <Gift className="h-5 w-5 mr-2" />
                        Claim Gift
                      </Button>
                    )}
                    <p className="text-sm text-muted-foreground text-center mt-3">
                      This item is being given away for free
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">{getSharingOptions()}</div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {requestType && (
          <ItemRequestForm
            onInsufficientCoins={(required) =>
              setInsufficientCoinsModal({ required, context: "borrow" })
            }
            item={item}
            requestType={requestType}
            isOpen={!!requestType}
            onClose={() => {
              setRequestType(null);
              setSelectedSwapItem(null as any);
              setSelectedSwapOwnerExtraItems([]);
              setPrefill(null);
            }}
            swapOfferItem={selectedSwapItem}
            swapRequestedExtraItems={selectedSwapOwnerExtraItems}
            prefill={prefill}
          />
        )}

        <SwapInventorySelector
          targetItem={item}
          ownerId={(item as any).ownerId}
          isOpen={showSwapSelector}
          onClose={() => setShowSwapSelector(false)}
          onSelectItem={(requesterItems, ownerExtraItems) => {
            setSelectedSwapItem(requesterItems);
            setSelectedSwapOwnerExtraItems(ownerExtraItems);
            setShowSwapSelector(false);
            setRequestType("SWAP");
          }}
        />

        <GiftClaimModal
          item={item}
          isOpen={showGiftClaimModal}
          onClose={() => setShowGiftClaimModal(false)}
        />

        {insufficientCoinsModal && (
          <InsufficientShareCoinsModal
            isOpen={!!insufficientCoinsModal}
            onClose={() => setInsufficientCoinsModal(null)}
            currentBalance={Number(user?.shareCoins || 0)}
            required={insufficientCoinsModal.required}
            context={insufficientCoinsModal.context}
          />
        )}
      </main>
    </div>
  );
}
