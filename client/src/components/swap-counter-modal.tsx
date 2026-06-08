import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowLeftRight,
  AlertTriangle,
  Info,
  Package,
  Camera,
  Check,
  Coins,
} from "lucide-react";
import { getTierShareCoins, calculateMultiSwap, MAX_SWAP_OFFSET } from "@/lib/swap-calculator";

interface SwapItem {
  id: number;
  name: string;
  photos: string[];
  tier: number;
  shareCoinPrice: string;
  originalValue: string;
  ownerId: number;
}

interface ItemRequest {
  id: number;
  itemId: number;
  requesterId: number;
  requestType: string;
  status: string;
  swapOfferedItemIds: number[] | null;
  swapOfferedItems?: { id: number; name: string; photos: string[]; tier?: number | null }[];
  counterSwapOwnerItemIds: number[] | null;
  counterSwapRequesterItemIds: number[] | null;
  counterNote: string | null;
  counterRound: number | null;
  item: {
    id: number;
    name: string;
    photos: string[];
    tier: number;
    shareCoinPrice: string;
    originalValue: string;
    ownerId: number;
  };
  requester: { id: number; username: string; displayName: string | null };
  owner?: { username: string | null; displayName: string | null };
}

interface SwapCounterModalProps {
  open: boolean;
  onClose: () => void;
  request: ItemRequest;
  currentUserId: number;
  isOwner: boolean;
  isPending: boolean;
  onSubmit: (data: {
    swapOwnerItemIds: number[];
    swapRequesterItemIds: number[];
    counterNote: string;
    isResponse: boolean;
  }) => void;
}

function getTotalSC(itemIds: number[], allItems: SwapItem[]): number {
  return itemIds.reduce((sum, id) => {
    const item = allItems.find((i) => i.id === id);
    return sum + (item ? getTierShareCoins(item.tier ?? 1) : 0);
  }, 0);
}

function ItemCard({
  item,
  selected,
  onToggle,
  variant = "mine",
}: {
  item: SwapItem;
  selected: boolean;
  onToggle: (id: number) => void;
  variant?: "mine" | "theirs";
}) {
  const sc = getTierShareCoins(item.tier ?? 1);
  const photo = item.photos?.[0];

  const selectedCls =
    variant === "mine"
      ? "border-[#0DCEA1] bg-[#E6FBF5]"
      : "border-amber-400 bg-amber-50";
  const overlayCls =
    variant === "mine" ? "bg-[#0DCEA1]/30" : "bg-amber-400/30";
  const checkCls =
    variant === "mine" ? "text-white" : "text-amber-700";

  return (
    <div
      className={`rounded-lg transition-all border cursor-pointer overflow-hidden ${
        selected
          ? selectedCls
          : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
      }`}
      onClick={() => onToggle(item.id)}
    >
      <div className="relative aspect-[5/4] bg-gray-100">
        {photo ? (
          <img src={photo} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Camera className="h-4 w-4 text-gray-400" />
          </div>
        )}
        {selected && (
          <div className={`absolute inset-0 flex items-center justify-center ${overlayCls}`}>
            <Check className={`h-5 w-5 drop-shadow ${checkCls}`} />
          </div>
        )}
      </div>
      <div className="p-1.5">
        <p className="font-medium text-gray-900 text-[10px] leading-tight line-clamp-2">{item.name}</p>
        <div className="flex items-center gap-0.5 text-[9px] text-gray-500 mt-0.5">
          <Coins className="h-2.5 w-2.5" />
          <span>{sc} ShareCoins</span>
        </div>
      </div>
    </div>
  );
}

function ItemGrid({
  items,
  selected,
  onToggle,
  isLoading,
  variant = "mine",
}: {
  items: SwapItem[];
  selected: number[];
  onToggle: (id: number) => void;
  isLoading: boolean;
  variant?: "mine" | "theirs";
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3].map((n) => (
          <div key={n} className="rounded-lg border bg-muted/40 aspect-[5/4] animate-pulse" />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-20 gap-1.5 text-sm text-muted-foreground">
        <Package className="h-6 w-6 text-muted-foreground/30" />
        <span className="italic text-xs">No swappable items available</span>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          selected={selected.includes(item.id)}
          onToggle={onToggle}
          variant={variant}
        />
      ))}
    </div>
  );
}

export function SwapCounterModal({
  open,
  onClose,
  request,
  currentUserId,
  isOwner,
  isPending,
  onSubmit,
}: SwapCounterModalProps) {
  const partnerUserId = isOwner ? request.requester.id : request.item.ownerId;
  const isResponse = !isOwner;

  const requesterName = request.requester.displayName || request.requester.username || "Them";
  const ownerName = request.owner?.displayName || request.owner?.username || "Owner";
  const partnerName = isOwner ? requesterName : ownerName;

  const currentRound = request.counterRound ?? 0;
  const maxRoundsReached = currentRound >= 2;

  const initOwnerItemIds: number[] = (() => {
    if (request.counterSwapOwnerItemIds?.length) return request.counterSwapOwnerItemIds;
    return [request.itemId];
  })();

  const initRequesterItemIds: number[] = (() => {
    if (request.counterSwapRequesterItemIds?.length) return request.counterSwapRequesterItemIds;
    return request.swapOfferedItemIds?.length ? request.swapOfferedItemIds : [];
  })();

  const [ownerItemIds, setOwnerItemIds] = useState<number[]>(initOwnerItemIds);
  const [requesterItemIds, setRequesterItemIds] = useState<number[]>(initRequesterItemIds);
  const [note, setNote] = useState(request.counterNote ?? "");

  const handleOpenChange = useCallback((o: boolean) => { if (!o) onClose(); }, [onClose]);

  const { data: myItems = [], isLoading: myLoading } = useQuery<SwapItem[]>({
    queryKey: ["/api/swap-eligible-items", "me"],
    queryFn: async () => {
      const r = await fetch("/api/swap-eligible-items");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: open,
    staleTime: 30_000,
  });

  const { data: partnerItems = [], isLoading: partnerLoading } = useQuery<SwapItem[]>({
    queryKey: ["/api/swap-eligible-items", partnerUserId],
    queryFn: async () => {
      const r = await fetch(`/api/swap-eligible-items?partnerId=${partnerUserId}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: open && !!partnerUserId,
    staleTime: 30_000,
  });

  const ownerItem = request.item;

  const ownerPanelItems: SwapItem[] = useMemo(() => {
    if (isOwner) {
      const hasIt = myItems.some((i) => i.id === ownerItem.id);
      if (!hasIt) {
        return [{ id: ownerItem.id, name: ownerItem.name, photos: ownerItem.photos, tier: ownerItem.tier, shareCoinPrice: ownerItem.shareCoinPrice, originalValue: ownerItem.originalValue, ownerId: ownerItem.ownerId }, ...myItems];
      }
      return myItems;
    } else {
      const hasIt = partnerItems.some((i) => i.id === ownerItem.id);
      if (!hasIt) {
        return [{ id: ownerItem.id, name: ownerItem.name, photos: ownerItem.photos, tier: ownerItem.tier, shareCoinPrice: ownerItem.shareCoinPrice, originalValue: ownerItem.originalValue, ownerId: ownerItem.ownerId }, ...partnerItems];
      }
      return partnerItems;
    }
  }, [isOwner, myItems, partnerItems, ownerItem]);

  const requesterPanelItems: SwapItem[] = useMemo(() => {
    if (isOwner) return partnerItems;
    return myItems;
  }, [isOwner, myItems, partnerItems]);

  const knownItemsMap = useMemo(() => {
    const map = new Map<number, SwapItem>();
    map.set(request.item.id, { id: request.item.id, name: request.item.name, photos: request.item.photos, tier: request.item.tier, shareCoinPrice: request.item.shareCoinPrice, originalValue: request.item.originalValue, ownerId: request.item.ownerId });
    (request.swapOfferedItems ?? []).forEach(oi => {
      if (!map.has(oi.id)) {
        map.set(oi.id, { id: oi.id, name: oi.name, photos: oi.photos, tier: oi.tier ?? 2, shareCoinPrice: String(getTierShareCoins(oi.tier ?? 2)), originalValue: "", ownerId: 0 });
      }
    });
    return map;
  }, [request]);

  const allKnownItems = useMemo(() => {
    const seen = new Set<number>();
    const result: SwapItem[] = [];
    for (const item of [...ownerPanelItems, ...requesterPanelItems, ...Array.from(knownItemsMap.values())]) {
      if (!seen.has(item.id)) { seen.add(item.id); result.push(item); }
    }
    return result;
  }, [ownerPanelItems, requesterPanelItems, knownItemsMap]);

  const ownerSC = getTotalSC(ownerItemIds, allKnownItems);
  const requesterSC = getTotalSC(requesterItemIds, allKnownItems);

  // Always compute valuation from the current user's perspective
  const mySC = isOwner ? ownerSC : requesterSC;
  const theirSC = isOwner ? requesterSC : ownerSC;
  const valuation = calculateMultiSwap(mySC, theirSC);

  const bothSidesSelected = ownerItemIds.length > 0 && requesterItemIds.length > 0 && (ownerSC > 0 || requesterSC > 0);
  const isCompatible = bothSidesSelected && !valuation.exceedsMax;

  const toggleOwnerItem = useCallback((id: number) => {
    setOwnerItemIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }, []);

  const toggleRequesterItem = useCallback((id: number) => {
    setRequesterItemIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }, []);

  const handleSubmit = () => {
    onSubmit({ swapOwnerItemIds: ownerItemIds, swapRequesterItemIds: requesterItemIds, counterNote: note.trim(), isResponse });
  };

  // From user's perspective: my items / their items
  const myPanelItems = isOwner ? ownerPanelItems : requesterPanelItems;
  const theirPanelItems = isOwner ? requesterPanelItems : ownerPanelItems;
  const mySelectedIds = isOwner ? ownerItemIds : requesterItemIds;
  const theirSelectedIds = isOwner ? requesterItemIds : ownerItemIds;
  const myToggle = isOwner ? toggleOwnerItem : toggleRequesterItem;
  const theirToggle = isOwner ? toggleRequesterItem : toggleOwnerItem;

  // Context header: countering X ⇌ Y
  const originalOwnerItemName = request.item.name;
  const originalRequesterItemName =
    request.swapOfferedItems?.[0]?.name ??
    allKnownItems.find(i => i.id === request.swapOfferedItemIds?.[0])?.name ??
    null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-[500px] p-0 overflow-hidden flex flex-col max-h-[92dvh]">

        {/* Gradient hero header */}
        <div className="bg-gradient-to-br from-[#0DCEA1] to-[#0BB88C] px-4 pt-4 pb-3 pr-12 text-white shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <ArrowLeftRight className="h-4 w-4 text-white/80" />
            <h2 className="text-sm font-bold">Counter Swap Offer</h2>
            {currentRound > 0 && (
              <Badge className="text-[10px] bg-white/20 text-white border-white/30 ml-auto">
                Round {currentRound + 1} / 3
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-white/70 text-[11px]">
            <span className="truncate max-w-[130px]">{originalOwnerItemName}</span>
            <ArrowLeftRight className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate max-w-[130px]">{originalRequesterItemName ?? `${partnerName}'s item`}</span>
          </div>
        </div>

        {maxRoundsReached ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-500" />
            <p className="font-semibold">Maximum counter rounds reached</p>
            <p className="text-sm text-muted-foreground">
              You've reached the limit of 2 counter rounds. Please accept or decline the current offer.
            </p>
          </div>
        ) : (
          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="px-5 py-4 space-y-5">

              {/* My items */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-3">Your Swap Items</h3>
                <ItemGrid
                  items={myPanelItems}
                  selected={mySelectedIds}
                  onToggle={myToggle}
                  isLoading={myLoading}
                  variant="mine"
                />
              </div>

              {/* Their items */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">{partnerName}'s Swap Items</h3>
                <p className="text-[11px] text-muted-foreground mb-2">Pre-selected from their current offer</p>
                <ItemGrid
                  items={theirPanelItems}
                  selected={theirSelectedIds}
                  onToggle={theirToggle}
                  isLoading={isOwner ? partnerLoading : myLoading}
                  variant="theirs"
                />
              </div>

              {/* Fairness summary — matches SwapInventorySelector style */}
              {bothSidesSelected && (
                <div className={`rounded-lg px-3 py-3 text-xs border ${
                  valuation.exceedsMax
                    ? "bg-red-50 border-red-200 text-red-700"
                    : valuation.isFair
                    ? "bg-green-50 border-green-200 text-green-700"
                    : "bg-yellow-50 border-yellow-300 text-yellow-800"
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex-1 flex flex-col items-center">
                      <span className="text-[10px] opacity-70 mb-0.5">Your offer</span>
                      <span className="text-2xl font-bold leading-none">{mySC}</span>
                      <span className="text-[10px] mt-0.5">ShareCoins</span>
                    </div>
                    <ArrowLeftRight className="h-4 w-4 mx-2 opacity-60 shrink-0" />
                    <div className="flex-1 flex flex-col items-center">
                      <span className="text-[10px] opacity-70 mb-0.5">Their offer</span>
                      <span className="text-2xl font-bold leading-none">{theirSC}</span>
                      <span className="text-[10px] mt-0.5">ShareCoins</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-1 border-t border-current/10 pt-2 w-full">
                    {valuation.exceedsMax
                      ? <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                      : <Info className="h-3 w-3 shrink-0 mt-0.5" />}
                    <span className="text-[10px] leading-snug">
                      {valuation.isFair
                        ? "Fair swap"
                        : valuation.offsetDirection === "you_pay"
                        ? (valuation.exceedsMax ? `Swap offset is ${valuation.offset} ShareCoins` : `You pay ${valuation.offset} ShareCoins to balance`)
                        : valuation.offsetDirection === "you_receive"
                        ? (valuation.exceedsMax ? `Swap offset is ${valuation.offset} ShareCoins` : `You receive +${valuation.offset} ShareCoins`)
                        : valuation.message}
                      {valuation.exceedsMax && ` — Maximum allowed offset is ${MAX_SWAP_OFFSET} ShareCoins`}
                    </span>
                  </div>
                </div>
              )}

              {!bothSidesSelected && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Info className="h-3 w-3 shrink-0" />
                  <span>Any item combination is allowed — ShareCoins cover the difference in value. Max offset: {MAX_SWAP_OFFSET} ShareCoins</span>
                </div>
              )}

              {/* Optional note */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Add a note (optional)</Label>
                <Textarea
                  placeholder="Explain your counter offer…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="text-sm resize-none"
                  maxLength={300}
                />
              </div>

            </div>
          </ScrollArea>
        )}

        <div className="shrink-0 border-t bg-white px-5 py-4 space-y-2">
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            {!maxRoundsReached && (
              <Button
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
                onClick={handleSubmit}
                disabled={isPending || !isCompatible}
              >
                <ArrowLeftRight className="h-4 w-4 mr-2" />
                {isPending ? "Sending…" : "Send Counter"}
              </Button>
            )}
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}
