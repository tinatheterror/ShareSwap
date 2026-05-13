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
import { CheckCircle2, Circle, ArrowLeftRight, AlertTriangle, Info, Package } from "lucide-react";
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


function SelectedItemPreview({ item, label }: { item: SwapItem | null; label: string }) {
  const photo = item?.photos?.[0];
  return (
    <div className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
      {item ? (
        <>
          <div className="w-14 h-14 rounded-lg overflow-hidden border-2 border-primary shadow-sm">
            {photo ? (
              <img src={photo} alt={item.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-muted">
                <Package className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
          </div>
          <p className="text-xs font-semibold text-center leading-tight line-clamp-2 w-full px-1">{item.name}</p>
          <span className="text-[10px] text-muted-foreground">Tier {item.tier ?? 1}</span>
        </>
      ) : (
        <>
          <div className="w-14 h-14 rounded-lg border-2 border-dashed border-muted-foreground/25 flex items-center justify-center bg-muted/30">
            <Package className="h-5 w-5 text-muted-foreground/30" />
          </div>
          <p className="text-[10px] text-muted-foreground italic">None selected</p>
        </>
      )}
    </div>
  );
}

function ItemCard({
  item,
  selected,
  onToggle,
  disabled,
}: {
  item: SwapItem;
  selected: boolean;
  onToggle: (id: number) => void;
  disabled: boolean;
}) {
  const photo = item.photos?.[0];
  const sc = getTierShareCoins(item.tier ?? 1);

  return (
    <button
      onClick={() => !disabled && onToggle(item.id)}
      disabled={disabled && !selected}
      className={`relative rounded-xl border-2 text-left transition-all w-full overflow-hidden
        ${selected
          ? "border-primary bg-primary/5 shadow-md"
          : disabled
          ? "border-muted opacity-40 cursor-not-allowed"
          : "border-border hover:border-primary/50 hover:shadow-sm cursor-pointer"
        }`}
    >
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        {photo ? (
          <img src={photo} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
            No photo
          </div>
        )}
      </div>
      <div className="p-2">
        <p className="text-xs font-semibold truncate leading-tight">{item.name}</p>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">T{item.tier ?? 1}</Badge>
          <span className="text-[10px] text-muted-foreground font-medium">{sc} SC</span>
        </div>
      </div>
      <div className="absolute top-1.5 right-1.5">
        {selected ? (
          <CheckCircle2 className="h-5 w-5 text-primary drop-shadow" />
        ) : (
          <Circle className="h-4 w-4 text-white/80 drop-shadow" />
        )}
      </div>
    </button>
  );
}

function ItemGrid({
  items,
  selected,
  onToggle,
  isLoading,
}: {
  items: SwapItem[];
  selected: number[];
  onToggle: (id: number) => void;
  isLoading: boolean;
}) {
  return (
    <div className="min-h-[100px]">
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 px-1">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="rounded-xl border bg-muted/40 aspect-[4/3] animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-20 gap-1.5 text-sm text-muted-foreground">
          <Package className="h-6 w-6 text-muted-foreground/30" />
          <span className="italic text-xs">No swappable items available</span>
        </div>
      ) : (
        <div className={`grid gap-2 px-1 ${items.length === 1 ? "grid-cols-1 max-w-[160px] mx-auto" : "grid-cols-2 sm:grid-cols-3"}`}>
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              selected={selected.includes(item.id)}
              onToggle={onToggle}
              disabled={false}
            />
          ))}
        </div>
      )}
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

  const allItems = useMemo(() => [...myItems, ...partnerItems], [myItems, partnerItems]);

  const ownerSC = getTotalSC(ownerItemIds, allItems);
  const requesterSC = getTotalSC(requesterItemIds, allItems);
  const valuation = calculateMultiSwap(ownerSC, requesterSC);
  const bothSidesSelected = ownerItemIds.length > 0 && requesterItemIds.length > 0;
  const isCompatible = bothSidesSelected && !valuation.exceedsMax;

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

  const toggleOwnerItem = useCallback((id: number) => {
    setOwnerItemIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }, []);

  const toggleRequesterItem = useCallback((id: number) => {
    setRequesterItemIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }, []);

  const handleSubmit = () => {
    onSubmit({ swapOwnerItemIds: ownerItemIds, swapRequesterItemIds: requesterItemIds, counterNote: note.trim(), isResponse });
  };

  const statusColor = !bothSidesSelected
    ? "text-muted-foreground"
    : valuation.exceedsMax
    ? "text-red-500"
    : valuation.isFair
    ? "text-emerald-500"
    : "text-amber-500";

  const statusMsg = !bothSidesSelected
    ? "Select items on both sides"
    : valuation.exceedsMax
    ? `Offset ${valuation.offset} SC — max ${MAX_SWAP_OFFSET} SC`
    : valuation.isFair
    ? "Fair swap"
    : valuation.offsetDirection === "you_pay"
    ? `You pay ${valuation.offset} SC`
    : `You receive +${valuation.offset} SC`;

  // For visual comparison strip: first selected item on each side
  const ownerSelectedItem = allItems.find((i) => ownerItemIds.includes(i.id)) ?? null;
  const requesterSelectedItem = allItems.find((i) => requesterItemIds.includes(i.id)) ?? null;

  // For "Current swap" context: original items before any counter
  const originalOwnerItem = request.item;
  const originalRequesterItem = allItems.find((i) => i.id === request.swapOfferedItemIds?.[0]) ?? null;

  // Labels from current user's perspective
  const myOwnerLabel = isOwner ? "Your item" : "Their item";
  const myRequesterLabel = isOwner ? "Their item" : "Your item";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl w-full max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ArrowLeftRight className="h-4 w-4 text-primary" />
            Counter Swap Offer
            {currentRound > 0 && (
              <Badge variant="outline" className="text-[10px] ml-1">
                Round {currentRound + 1} / 3
              </Badge>
            )}
          </DialogTitle>
          {/* Current swap context */}
          <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/70">Current swap:</span>
            <span className="font-medium text-foreground truncate max-w-[120px]">{originalOwnerItem.name}</span>
            <ArrowLeftRight className="h-3 w-3 shrink-0" />
            <span className="font-medium text-foreground truncate max-w-[120px]">
              {originalRequesterItem ? originalRequesterItem.name : "their item"}
            </span>
          </div>
        </DialogHeader>

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
            <div className="px-5 py-4 space-y-4">

              {/* Visual comparison strip */}
              <div className="rounded-xl border bg-muted/20 px-4 py-3">
                <div className="flex items-center gap-3 mb-2">
                  <SelectedItemPreview item={ownerSelectedItem} label={myOwnerLabel} />
                  <div className="flex flex-col items-center gap-1 flex-shrink-0 px-1">
                    <ArrowLeftRight className={`h-5 w-5 ${statusColor}`} />
                    <span className={`text-[10px] font-medium text-center max-w-[90px] leading-tight ${statusColor}`}>
                      {statusMsg}
                    </span>
                  </div>
                  <SelectedItemPreview item={requesterSelectedItem} label={myRequesterLabel} />
                </div>
                {/* SC totals summary */}
                {bothSidesSelected && (
                  <div className={`flex items-center justify-between text-[10px] font-medium px-1 pt-2 border-t ${
                    valuation.exceedsMax ? "text-red-500" : "text-muted-foreground"
                  }`}>
                    <span>{ownerSC} SC total</span>
                    {valuation.isFair ? (
                      <span className="text-emerald-500">Fair swap</span>
                    ) : (
                      <span className={valuation.exceedsMax ? "text-red-500" : "text-amber-500"}>
                        {valuation.offset} SC offset
                      </span>
                    )}
                    <span>{requesterSC} SC total</span>
                  </div>
                )}
              </div>

              {/* Owner's items panel */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">
                  {isOwner ? "Your items" : "Owner's items"}
                </Label>
                <ItemGrid
                  items={ownerPanelItems}
                  selected={ownerItemIds}
                  onToggle={toggleOwnerItem}
                  isLoading={isOwner ? myLoading : partnerLoading}
                />
              </div>

              {/* Requester's items panel */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">
                  {isOwner ? "Their items" : "Your items"}
                </Label>
                <ItemGrid
                  items={requesterPanelItems}
                  selected={requesterItemIds}
                  onToggle={toggleRequesterItem}
                  isLoading={isOwner ? partnerLoading : myLoading}
                />
              </div>

              {/* Value hint */}
              {(ownerPanelItems.length > 0 || requesterPanelItems.length > 0) && (
                <div className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>Any tier combination is allowed — value difference is settled with ShareCoins. T1=5SC · T2=10SC · T3=20SC · T4=40SC · Max offset: {MAX_SWAP_OFFSET} SC</span>
                </div>
              )}

              {/* Optional note */}
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Message (optional)</Label>
                <Textarea
                  placeholder="Add a note about your counter offer…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="resize-none text-sm"
                  rows={2}
                  maxLength={300}
                />
              </div>
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="px-5 py-4 border-t shrink-0 gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          {!maxRoundsReached && (
            <Button
              onClick={handleSubmit}
              disabled={isPending || !isCompatible}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {isPending ? "Sending…" : "Send Counter"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
