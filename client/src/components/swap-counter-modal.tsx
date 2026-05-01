import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, Circle, ArrowLeftRight, AlertTriangle, Info } from "lucide-react";
import { getTierShareCoins } from "@/lib/swap-calculator";

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

function scToTier(sc: number): number {
  if (sc <= 5) return 1;
  if (sc <= 10) return 2;
  if (sc <= 20) return 3;
  return 4;
}

function ValueBar({ label, sc, other }: { label: string; sc: number; other: number }) {
  const tier = scToTier(sc);
  const otherTier = scToTier(other);
  const diff = Math.abs(tier - otherTier);
  const color = diff === 0 ? "text-emerald-500" : diff === 1 ? "text-amber-500" : "text-red-500";

  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
      <span className={`text-lg font-bold ${color}`}>{sc} SC</span>
      <span className="text-[10px] text-muted-foreground">Tier {tier}</span>
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
          <img
            src={photo}
            alt={item.name}
            className="w-full h-full object-cover"
          />
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
  partnerSC,
  isLoading,
  emptyLabel,
}: {
  items: SwapItem[];
  selected: number[];
  onToggle: (id: number) => void;
  partnerSC: number;
  isLoading: boolean;
  emptyLabel: string;
}) {
  const partnerTier = scToTier(Math.max(partnerSC, 1));

  return (
    <div className="min-h-[120px]">
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 px-1">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="rounded-xl border bg-muted/40 aspect-[4/3] animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-sm text-muted-foreground italic">
          {emptyLabel}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 px-1">
          {items.map((item) => {
            const myTier = item.tier ?? 1;
            const tierOk = Math.abs(myTier - partnerTier) <= 1 || selected.includes(item.id);
            const selSC = getTotalSC(selected, items) + (selected.includes(item.id) ? 0 : getTierShareCoins(myTier));
            const wouldBeTier = scToTier(selSC);
            const stillOk = Math.abs(wouldBeTier - partnerTier) <= 2;
            return (
              <ItemCard
                key={item.id}
                item={item}
                selected={selected.includes(item.id)}
                onToggle={onToggle}
                disabled={!tierOk && !selected.includes(item.id) && !stillOk}
              />
            );
          })}
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

  // Pre-fill from existing counter or from the initial request
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

  // Fetch my swap-eligible items
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

  // Fetch partner's swap-eligible items
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

  // All items for SC calculation
  const allItems = useMemo(() => [...myItems, ...partnerItems], [myItems, partnerItems]);

  // Owner items: items the owner offers; Requester items: items requester offers
  const ownerSC = getTotalSC(ownerItemIds, allItems);
  const requesterSC = getTotalSC(requesterItemIds, allItems);
  const ownerTier = scToTier(Math.max(ownerSC, 1));
  const requesterTier = scToTier(Math.max(requesterSC, 1));
  const tierDiff = Math.abs(ownerTier - requesterTier);
  const isCompatible = ownerItemIds.length > 0 && requesterItemIds.length > 0 && tierDiff <= 1;

  // Make sure the owner's item from the request is in partnerItems / myItems as fallback
  const ownerItem = request.item;

  // Owner picks from: their own items (if isOwner) or myItems
  // Requester picks from: their own items (if !isOwner) or myItems
  const myItemsPanel = isOwner ? myItems : myItems;
  const partnerPanel = isOwner ? partnerItems : partnerItems;

  // If owner's requested item isn't in partnerItems (their own items may not have the requested item in partnerItems)
  // we inject the current item so it can always be seen
  const ownerPanelItems: SwapItem[] = useMemo(() => {
    if (isOwner) {
      // My own items + ensure the original item is present if it happens to be mine
      const hasIt = myItems.some((i) => i.id === ownerItem.id);
      if (!hasIt) {
        return [
          {
            id: ownerItem.id,
            name: ownerItem.name,
            photos: ownerItem.photos,
            tier: ownerItem.tier,
            shareCoinPrice: ownerItem.shareCoinPrice,
            originalValue: ownerItem.originalValue,
            ownerId: ownerItem.ownerId,
          },
          ...myItems,
        ];
      }
      return myItems;
    } else {
      // Partner (owner) items — ensure the original item is present
      const hasIt = partnerItems.some((i) => i.id === ownerItem.id);
      if (!hasIt) {
        return [
          {
            id: ownerItem.id,
            name: ownerItem.name,
            photos: ownerItem.photos,
            tier: ownerItem.tier,
            shareCoinPrice: ownerItem.shareCoinPrice,
            originalValue: ownerItem.originalValue,
            ownerId: ownerItem.ownerId,
          },
          ...partnerItems,
        ];
      }
      return partnerItems;
    }
  }, [isOwner, myItems, partnerItems, ownerItem]);

  const requesterPanelItems: SwapItem[] = useMemo(() => {
    if (isOwner) return partnerItems;
    return myItems;
  }, [isOwner, myItems, partnerItems]);

  const toggleOwnerItem = useCallback((id: number) => {
    setOwnerItemIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const toggleRequesterItem = useCallback((id: number) => {
    setRequesterItemIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const handleSubmit = () => {
    onSubmit({
      swapOwnerItemIds: ownerItemIds,
      swapRequesterItemIds: requesterItemIds,
      counterNote: note.trim(),
      isResponse,
    });
  };

  const statusColor =
    tierDiff === 0
      ? "text-emerald-500"
      : tierDiff === 1
      ? "text-amber-500"
      : "text-red-500";

  const statusMsg =
    !isCompatible
      ? ownerItemIds.length === 0 || requesterItemIds.length === 0
        ? "Select at least one item on each side"
        : `${tierDiff} tier gap — max 1 tier difference allowed`
      : tierDiff === 0
      ? "Fair swap — no offset needed"
      : `${tierDiff} tier gap — ${Math.abs(ownerSC - requesterSC)} SC offset required`;

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
          <DialogDescription className="text-xs">
            Select the items you want to exchange. Both sides must be within 1 tier of each other.
          </DialogDescription>
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
            <div className="px-5 py-4 space-y-5">
              {/* Value balance bar */}
              <div className="rounded-xl border bg-muted/30 px-4 py-3 flex items-center justify-between gap-4">
                <ValueBar label={isOwner ? "Your offer" : "Owner's offer"} sc={ownerSC} other={requesterSC} />
                <div className="flex flex-col items-center gap-1">
                  <ArrowLeftRight className={`h-5 w-5 ${statusColor}`} />
                  <span className={`text-[10px] font-medium text-center max-w-[100px] leading-tight ${statusColor}`}>
                    {statusMsg}
                  </span>
                </div>
                <ValueBar label={isOwner ? "Their offer" : "Your offer"} sc={requesterSC} other={ownerSC} />
              </div>

              {/* Owner's items panel */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label className="text-sm font-semibold">
                    {isOwner ? "Your items (what you offer)" : "Owner's items (what you want)"}
                  </Label>
                  {ownerItemIds.length > 0 && (
                    <Badge className="text-[10px] h-4 px-1.5 bg-primary/10 text-primary border-primary/20">
                      {ownerItemIds.length} selected
                    </Badge>
                  )}
                </div>
                <ItemGrid
                  items={ownerPanelItems}
                  selected={ownerItemIds}
                  onToggle={toggleOwnerItem}
                  partnerSC={requesterSC}
                  isLoading={isOwner ? myLoading : partnerLoading}
                  emptyLabel={isOwner ? "No swap-eligible items in your inventory" : "Owner has no swap-eligible items"}
                />
              </div>

              {/* Requester's items panel */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label className="text-sm font-semibold">
                    {isOwner ? "Their items (what you'll take)" : "Your items (what you offer)"}
                  </Label>
                  {requesterItemIds.length > 0 && (
                    <Badge className="text-[10px] h-4 px-1.5 bg-primary/10 text-primary border-primary/20">
                      {requesterItemIds.length} selected
                    </Badge>
                  )}
                </div>
                <ItemGrid
                  items={requesterPanelItems}
                  selected={requesterItemIds}
                  onToggle={toggleRequesterItem}
                  partnerSC={ownerSC}
                  isLoading={isOwner ? partnerLoading : myLoading}
                  emptyLabel={isOwner ? "Requester has no swap-eligible items" : "No swap-eligible items in your inventory"}
                />
              </div>

              {/* Tier info hint */}
              {(ownerPanelItems.length > 0 || requesterPanelItems.length > 0) && (
                <div className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>You can combine multiple items to balance value. T1=5SC · T2=10SC · T3=20SC · T4=40SC</span>
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
              {isPending ? "Sending…" : "Send Counter Offer"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
