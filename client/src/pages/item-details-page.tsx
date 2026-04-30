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
import { useQuery } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import {
  Coins,
  HandHeart,
  DollarSign,
  ArrowLeftRight,
  Info,
  Clock,
  Gift,
} from "lucide-react";
import type { SelectItem } from "@db/schema";
import { UserBadges } from "@/components/user-badges";
import { getSwapTierLabel } from "@/lib/swap-calculator";
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
  const [selectedSwapItem, setSelectedSwapItem] = useState<SelectItem | null>(
    null,
  );
  const [showGiftClaimModal, setShowGiftClaimModal] = useState(false);
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

  const { data: item } = useQuery<SelectItem>({
    queryKey: [`/api/items/${itemId}`],
    enabled: !!itemId,
  });

  // Fetch pending requests to check if user already has a pending request for this item
  const { data: requests } = useQuery<ItemRequest[]>({
    queryKey: ["/api/requests"],
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
  const getSharingOptions = () => {
    const itemReplacementValue = (item as any).replacementValue;
    const itemTier = (item as any).tier || 2;
    const itemOriginalValue = (item as any).originalValue || "$50–$150";
    const reputationScore = user?.reputationScore || 0;
    const viewerTrustScore = Math.min(
      100,
      Math.round((reputationScore / 500) * 100),
    );
    const depositCalc = isOwner
      ? calculateSecurityDeposit(itemTier, itemOriginalValue, 0)
      : calculateSecurityDeposit(itemTier, itemOriginalValue, viewerTrustScore);

    const borrowOption = item.isLendable ? (
      <div
        key="borrow"
        className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3"
      >
        <div>
          <p className="font-medium">Borrow</p>
          <div className="flex items-center gap-2 mb-1">
            <Coins className="h-4 w-4 text-teal-600" />
            <span className="text-lg font-bold text-teal-700">
              {item.shareCoinPrice || item.shareCoinsReward || "5"} ShareCoins
            </span>
          </div>
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <span>Trust-Deposit:</span>
            {depositCalc.discountPercentage > 0 ? (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1.5 cursor-help">
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
                  <TooltipContent
                    side="bottom"
                    className="p-0 border-0 bg-transparent shadow-none"
                  >
                    <div className="bg-[#E6FBF5] border border-[#0DCEA1]/30 rounded-md p-2 text-xs text-[#0BB88C]">
                      <Info className="h-3 w-3 inline mr-1" />
                      Discounted {depositCalc.discountPercentage}% by your trust
                      score
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <span>${depositCalc.finalDeposit}</span>
            )}
          </div>
          {hasValidReplacementValue(itemReplacementValue) && (
            <p className="text-[10px] text-gray-400 mt-1">
              Max charge if not returned: ${itemReplacementValue}
            </p>
          )}
        </div>
        {hasPendingBorrow ? (
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
        )}
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
        {hasPendingRent ? (
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
        )}
      </div>
    ) : null;

    const swapOption = item.isSwappable ? (
      <div key="swap" className="space-y-2">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <div>
            <p className="font-medium">Swap</p>
            <div className="flex items-center gap-2 mb-1">
              <ArrowLeftRight className="h-4 w-4 text-teal-700" />
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="focus:outline-none">
                      <Badge
                        variant="outline"
                        className="border-teal-700 text-teal-700 cursor-help"
                      >
                        {getSwapTierLabel(itemTier) + " " + "Item"}
                      </Badge>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    className="p-0 border-0 bg-transparent shadow-none"
                  >
                    <div className="bg-[#E6FBF5] border border-[#0DCEA1]/30 rounded-md p-2 text-xs text-[#0BB88C]">
                      <Info className="h-3 w-3 inline mr-1" />
                      Swaps allow same-tier or ±1 tier items, with ShareCoins
                      balancing the difference.
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {(item as any).swapDesiredItem && (
              <p className="text-sm text-muted-foreground mt-1">
                <span className="font-medium text-slate-700">Looking for:</span>{" "}
                {(item as any).swapDesiredItem}
              </p>
            )}
          </div>
          {hasPendingSwap ? (
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
              Request Swap
            </Button>
          )}
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
        {hasPendingGift ? (
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
        )}
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
                  {item.photos[0] && (
                    <img
                      src={item.photos[0]}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {item.photos.slice(1).map((photo, i) => (
                    <div
                      key={i}
                      className="aspect-square bg-muted rounded-lg overflow-hidden"
                    >
                      <img
                        src={photo}
                        alt={`${item.name} ${i + 2}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <h1 className="text-2xl font-bold">{item.name}</h1>
                  <p className="text-muted-foreground mt-2">
                    {item.description}
                  </p>

                  {(item as any).owner && (
                    <div className="flex items-center gap-2 mt-3">
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
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <h3 className="font-medium">Condition</h3>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{item.conditionRating}/10</Badge>
                  </div>
                </div>

                {isOwner ? (
                  <div className="pt-2 rounded-xl border border-dashed border-muted-foreground/30 bg-muted/30 p-4 text-center space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">
                      This is your listing
                    </p>
                    <p className="text-xs text-muted-foreground">
                      You can't request your own items
                    </p>
                    <Link href={`/lend?edit=${item.id}`}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-1 text-xs"
                      >
                        Edit listing
                      </Button>
                    </Link>
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
                  <div className="space-y-4">
                    <h3 className="font-medium">Sharing Options</h3>
                    {getSharingOptions()}
                  </div>
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
              setSelectedSwapItem(null);
              setPrefill(null);
            }}
            swapOfferItem={selectedSwapItem}
            prefill={prefill}
          />
        )}

        <SwapInventorySelector
          targetItem={item}
          isOpen={showSwapSelector}
          onClose={() => setShowSwapSelector(false)}
          onSelectItem={(selectedItem) => {
            setSelectedSwapItem(selectedItem);
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
