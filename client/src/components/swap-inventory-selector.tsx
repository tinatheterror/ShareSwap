import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Camera, Check, ChevronDown, ChevronUp, Coins, Package, Plus, AlertTriangle, Info } from "lucide-react";
import type { SelectItem } from "@db/schema";
import { getTierShareCoins, calculateMultiSwap, MAX_SWAP_OFFSET } from "@/lib/swap-calculator";
import { useAuth } from "@/hooks/use-auth";
import { InsufficientShareCoinsModal } from "@/components/borrow/insufficient-sharecoins-modal";

type Props = {
  targetItem: SelectItem;
  ownerId: number;
  isOpen: boolean;
  onClose: () => void;
  onSelectItem: (requesterItems: SelectItem[], ownerExtraItems: SelectItem[]) => void;
};

export function SwapInventorySelector({ targetItem, ownerId, isOpen, onClose, onSelectItem }: Props) {
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [selectedOwnerItemIds, setSelectedOwnerItemIds] = useState<number[]>([]);
  const [showAllOwnerItems, setShowAllOwnerItems] = useState(false);
  const [showInsufficientCoins, setShowInsufficientCoins] = useState(false);
  const [insufficientRequired, setInsufficientRequired] = useState(0);
  const { user } = useAuth();

  const { data: myItems = [], isLoading } = useQuery<SelectItem[]>({
    queryKey: ["/api/my-items"],
    enabled: isOpen,
    staleTime: 0,
  });

  const { data: ownerItemsRaw } = useQuery<SelectItem[]>({
    queryKey: ["/api/swap-eligible-items", "owner", ownerId],
    queryFn: () => fetch(`/api/swap-eligible-items?partnerId=${ownerId}`).then(r => r.json()),
    enabled: isOpen && !!ownerId,
    staleTime: 0,
  });
  const ownerItems: SelectItem[] = Array.isArray(ownerItemsRaw) ? ownerItemsRaw : [];

  const targetTier = (targetItem as any).tier || 2;
  const targetSC = getTierShareCoins(targetTier);

  const swappableItems = myItems.filter(
    (item) => item.id !== targetItem.id && item.isSwappable && item.isAvailable !== false,
  );

  const ownerExtraItems = ownerItems.filter(item => item.id !== targetItem.id);
  const previewOwnerItems = showAllOwnerItems ? ownerExtraItems : ownerExtraItems.slice(0, 6);

  const yourSC = selectedItemIds.reduce((sum, id) => {
    const item = swappableItems.find((i) => i.id === id);
    return sum + (item ? getTierShareCoins((item as any).tier || 2) : 0);
  }, 0);

  const ownerExtraSC = selectedOwnerItemIds.reduce((sum, id) => {
    const item = ownerExtraItems.find(i => i.id === id);
    return sum + (item ? getTierShareCoins((item as any).tier || 2) : 0);
  }, 0);

  const theirSC = targetSC + ownerExtraSC;
  const valuation = calculateMultiSwap(yourSC, theirSC);

  const toggleItem = (id: number) => {
    setSelectedItemIds((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleOwnerItem = (id: number) => {
    setSelectedOwnerItemIds((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleConfirmSelection = () => {
    if (selectedItemIds.length === 0) return;
    const selected = swappableItems.filter((i) => selectedItemIds.includes(i.id));
    const selectedOwner = ownerExtraItems.filter(i => selectedOwnerItemIds.includes(i.id));
    if (valuation.exceedsMax) return;

    if (valuation.offsetDirection === "you_pay" && valuation.offset > 0) {
      const balance = Number(user?.shareCoins || 0);
      if (balance < valuation.offset) {
        setInsufficientRequired(valuation.offset);
        setShowInsufficientCoins(true);
        return;
      }
    }
    onSelectItem(selected, selectedOwner);
  };

  const canSubmit = selectedItemIds.length > 0 && !valuation.exceedsMax;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-[500px] p-0 overflow-hidden flex flex-col max-h-[92dvh]">
          {/* Hero — target item */}
          <div className="bg-gradient-to-br from-[#0DCEA1] to-[#0BB88C] p-4 pr-12 text-white shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 bg-white/10 rounded-xl overflow-hidden flex-shrink-0 shadow-lg">
                {targetItem.photos?.[0] ? (
                  <img src={targetItem.photos[0]} alt={targetItem.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Camera className="h-7 w-7 text-white/50" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-bold leading-snug line-clamp-2">{targetItem.name}</h2>
                <div className="flex items-center gap-1.5 mt-1.5 text-white/80 text-sm">
                  <Coins className="h-3.5 w-3.5" />
                  <span>{targetSC} ShareCoins</span>
                </div>
              </div>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-5 bg-white min-w-0 space-y-5">

            {/* YOUR ITEMS */}
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-3">Select your items to offer</h3>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0DCEA1]" />
                </div>
              ) : swappableItems.length === 0 ? (
                <div className="text-center py-8">
                  <Package className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-medium">No eligible items</p>
                  <p className="text-sm text-gray-400 mt-1 mb-4">Add items and mark them as swappable</p>
                  <Button onClick={() => (window.location.href = `/lend?swapReturnTo=/items/${targetItem.id}`)}>
                    Add an item
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {swappableItems.map((item) => {
                    const tier = (item as any).tier || 2;
                    const sc = getTierShareCoins(tier);
                    const isSelected = selectedItemIds.includes(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`rounded-lg transition-all border cursor-pointer overflow-hidden ${
                          isSelected ? "border-[#0DCEA1] bg-[#E6FBF5]" : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                        }`}
                        onClick={() => toggleItem(item.id)}
                      >
                        <div className="relative aspect-[5/4] bg-gray-100">
                          {item.photos?.[0] ? (
                            <img src={item.photos[0]} alt={item.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Camera className="h-4 w-4 text-gray-400" />
                            </div>
                          )}
                          {isSelected && (
                            <div className="absolute inset-0 bg-[#0DCEA1]/30 flex items-center justify-center">
                              <Check className="h-5 w-5 text-white drop-shadow" />
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
                  })}
                </div>
              )}
            </div>

            {/* OWNER'S OTHER ITEMS */}
            {ownerExtraItems.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-500">+{ownerExtraItems.length} more swap items from this owner</h3>
                </div>
                <p className="text-[11px] text-muted-foreground mb-2">Select additional items you'd like alongside the primary item.</p>
                <div className="grid grid-cols-3 gap-2">
                  {/* Target item — always pre-selected, non-removable */}
                  <div className="rounded-lg border border-amber-400 bg-amber-50 overflow-hidden cursor-default">
                    <div className="relative aspect-[5/4] bg-gray-100">
                      {targetItem.photos?.[0] ? (
                        <img src={targetItem.photos[0]} alt={targetItem.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Camera className="h-4 w-4 text-gray-400" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-amber-400/30 flex items-center justify-center">
                        <Check className="h-5 w-5 text-amber-700 drop-shadow" />
                      </div>
                    </div>
                    <div className="p-1.5">
                      <p className="font-medium text-gray-900 text-[10px] leading-tight line-clamp-2">{targetItem.name}</p>
                      <div className="flex items-center gap-0.5 text-[9px] text-gray-500 mt-0.5">
                        <Coins className="h-2.5 w-2.5" />
                        <span>{targetSC} ShareCoins</span>
                      </div>
                    </div>
                  </div>
                  {previewOwnerItems.map((item) => {
                    const tier = (item as any).tier || 2;
                    const sc = getTierShareCoins(tier);
                    const isSelected = selectedOwnerItemIds.includes(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`rounded-lg transition-all border cursor-pointer overflow-hidden ${
                          isSelected ? "border-amber-400 bg-amber-50" : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                        }`}
                        onClick={() => toggleOwnerItem(item.id)}
                      >
                        <div className="relative aspect-[5/4] bg-gray-100">
                          {item.photos?.[0] ? (
                            <img src={item.photos[0]} alt={item.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Camera className="h-4 w-4 text-gray-400" />
                            </div>
                          )}
                          {isSelected && (
                            <div className="absolute inset-0 bg-amber-400/30 flex items-center justify-center">
                              <Check className="h-5 w-5 text-amber-700 drop-shadow" />
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
                  })}
                </div>
                {ownerExtraItems.length > 6 && (
                  <button
                    className="mt-2 text-sm text-[#0BB88C] hover:text-[#0DCEA1] flex items-center gap-1 font-medium"
                    onClick={() => setShowAllOwnerItems(v => !v)}
                  >
                    {showAllOwnerItems ? (
                      <><ChevronUp className="h-3.5 w-3.5" /> Show less</>
                    ) : (
                      <><ChevronDown className="h-3.5 w-3.5" /> View all {ownerExtraItems.length} swap items</>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Fairness summary */}
            {(selectedItemIds.length > 0 || selectedOwnerItemIds.length > 0) && (
              <div className={`rounded-lg px-3 py-2.5 text-xs border ${
                valuation.exceedsMax
                  ? "bg-red-50 border-red-200 text-red-700"
                  : valuation.isFair
                  ? "bg-green-50 border-green-200 text-green-700"
                  : "bg-amber-50 border-amber-200 text-amber-700"
              }`}>
                <div className="flex items-center justify-between mb-1.5 font-medium">
                  <span>Your offer: {yourSC} SC</span>
                  <ArrowLeftRight className="h-3 w-3 mx-1" />
                  <span>
                    Their offer: {theirSC} SC
                    {selectedOwnerItemIds.length > 0 && (
                      <span className="opacity-70 font-normal"> (+{ownerExtraSC} extras)</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {valuation.exceedsMax
                    ? <AlertTriangle className="h-3 w-3 shrink-0" />
                    : <Info className="h-3 w-3 shrink-0" />}
                  <span className={valuation.exceedsMax ? "text-[10px] opacity-80" : ""}>
                    {valuation.isFair
                      ? "Fair swap — no ShareCoin adjustment"
                      : valuation.offsetDirection === "you_pay"
                      ? `You pay ${valuation.offset} SC to balance`
                      : valuation.offsetDirection === "you_receive"
                      ? `You receive +${valuation.offset} SC`
                      : valuation.message}
                  </span>
                  {valuation.exceedsMax && (
                    <span className="text-[10px] opacity-80">· Maximum allowed offset is {MAX_SWAP_OFFSET} SC</span>
                  )}
                </div>
              </div>
            )}

            {/* SC scale hint */}
            {selectedItemIds.length === 0 && selectedOwnerItemIds.length === 0 && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Info className="h-3 w-3 shrink-0" />
                <span>Value differences are settled with ShareCoins</span>
              </div>
            )}
          </div>

          {/* Pinned action buttons */}
          {swappableItems.length > 0 && (
            <div className="shrink-0 border-t bg-white px-5 py-4 space-y-2">
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-[#0DCEA1] hover:bg-[#0BB88C]"
                  disabled={!canSubmit}
                  onClick={handleConfirmSelection}
                >
                  <ArrowLeftRight className="h-4 w-4 mr-2" />
                  Swap
                </Button>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => (window.location.href = `/lend?swapReturnTo=/items/${targetItem.id}`)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add an item
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <InsufficientShareCoinsModal
        isOpen={showInsufficientCoins}
        onClose={() => setShowInsufficientCoins(false)}
        currentBalance={Number(user?.shareCoins || 0)}
        required={insufficientRequired}
        context="swap"
      />
    </>
  );
}
