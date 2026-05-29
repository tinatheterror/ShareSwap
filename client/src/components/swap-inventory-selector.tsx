import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Camera, Check, Coins, Package, Plus, AlertTriangle, Info } from "lucide-react";
import type { SelectItem } from "@db/schema";
import { getTierShareCoins, calculateMultiSwap, MAX_SWAP_OFFSET } from "@/lib/swap-calculator";
import { useAuth } from "@/hooks/use-auth";
import { InsufficientShareCoinsModal } from "@/components/borrow/insufficient-sharecoins-modal";

type Props = {
  targetItem: SelectItem;
  isOpen: boolean;
  onClose: () => void;
  onSelectItem: (items: SelectItem[]) => void;
};

export function SwapInventorySelector({ targetItem, isOpen, onClose, onSelectItem }: Props) {
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [showInsufficientCoins, setShowInsufficientCoins] = useState(false);
  const [insufficientRequired, setInsufficientRequired] = useState(0);
  const { user } = useAuth();

  const { data: myItems = [], isLoading } = useQuery<SelectItem[]>({
    queryKey: ["/api/my-items"],
    enabled: isOpen,
    staleTime: 0,
  });

  const targetTier = (targetItem as any).tier || 2;
  const targetSC = getTierShareCoins(targetTier);

  // Only show items that are both swappable and currently available
  const swappableItems = myItems.filter(
    (item) => item.id !== targetItem.id && item.isSwappable && item.isAvailable !== false,
  );

  // Value calculation
  const yourSC = selectedItemIds.reduce((sum, id) => {
    const item = swappableItems.find((i) => i.id === id);
    return sum + (item ? getTierShareCoins((item as any).tier || 2) : 0);
  }, 0);
  const valuation = calculateMultiSwap(yourSC, targetSC);

  const toggleItem = (id: number) => {
    setSelectedItemIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleConfirmSelection = () => {
    if (selectedItemIds.length === 0) return;
    const selected = swappableItems.filter((i) => selectedItemIds.includes(i.id));
    if (valuation.exceedsMax) return;

    if (valuation.offsetDirection === "you_pay" && valuation.offset > 0) {
      const balance = Number(user?.shareCoins || 0);
      if (balance < valuation.offset) {
        setInsufficientRequired(valuation.offset);
        setShowInsufficientCoins(true);
        return;
      }
    }
    onSelectItem(selected);
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
                  <span>Tier {targetTier} –</span>
                  <Coins className="h-3.5 w-3.5" />
                  <span>{targetSC} SC</span>
                </div>
              </div>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-5 bg-white min-w-0">
            <h3 className="text-sm font-medium text-gray-500 mb-3">
              Select one or more of your items to trade
            </h3>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0DCEA1]" />
              </div>
            ) : swappableItems.length === 0 ? (
              <div className="text-center py-10">
                <Package className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">No eligible items</p>
                <p className="text-sm text-gray-400 mt-1 mb-4">Add items and mark them as swappable</p>
                <Button onClick={() => (window.location.href = `/lend?swapReturnTo=/items/${targetItem.id}`)}>
                  Add an item
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {swappableItems.map((item) => {
                    const tier = (item as any).tier || 2;
                    const sc = getTierShareCoins(tier);
                    const isSelected = selectedItemIds.includes(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center gap-3 p-3 rounded-lg transition-all border cursor-pointer ${
                          isSelected
                            ? "border-[#0DCEA1] bg-[#E6FBF5]"
                            : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                        }`}
                        onClick={() => toggleItem(item.id)}
                      >
                        <div className="w-12 h-12 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0 relative">
                          {item.photos?.[0] ? (
                            <img src={item.photos[0]} alt={item.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Camera className="h-4 w-4 text-gray-400" />
                            </div>
                          )}
                          {isSelected && (
                            <div className="absolute inset-0 bg-[#0DCEA1]/30 flex items-center justify-center">
                              <Check className="h-4 w-4 text-white" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 text-sm truncate">{item.name}</p>
                          <div className="flex items-center flex-wrap gap-1 text-xs text-gray-500 mt-0.5">
                            <span>Tier {tier}</span>
                            <span className="text-gray-300">·</span>
                            <Coins className="h-3 w-3" />
                            <span>{sc} SC</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Fairness summary */}
                {selectedItemIds.length > 0 && (
                  <div className={`mt-3 rounded-lg px-3 py-2.5 text-xs border ${
                    valuation.exceedsMax
                      ? "bg-red-50 border-red-200 text-red-700"
                      : valuation.isFair
                      ? "bg-green-50 border-green-200 text-green-700"
                      : "bg-amber-50 border-amber-200 text-amber-700"
                  }`}>
                    <div className="flex items-center justify-between mb-1.5 font-medium">
                      <span>Your offer: {yourSC} SC</span>
                      <ArrowLeftRight className="h-3 w-3 mx-1" />
                      <span>Their offer: {targetSC} SC</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {valuation.exceedsMax
                        ? <AlertTriangle className="h-3 w-3 shrink-0" />
                        : <Info className="h-3 w-3 shrink-0" />}
                      <span>
                        {valuation.isFair
                          ? "Fair swap — no ShareCoin adjustment"
                          : valuation.offsetDirection === "you_pay"
                          ? `You pay ${valuation.offset} SC to balance`
                          : valuation.offsetDirection === "you_receive"
                          ? `You receive +${valuation.offset} SC`
                          : valuation.message}
                      </span>
                    </div>
                    {valuation.exceedsMax && (
                      <p className="mt-1 text-[10px] opacity-80">Maximum allowed offset is {MAX_SWAP_OFFSET} SC</p>
                    )}
                  </div>
                )}

                {/* SC scale hint */}
                {selectedItemIds.length === 0 && (
                  <div className="flex items-center gap-1.5 mt-3 text-[11px] text-muted-foreground">
                    <Info className="h-3 w-3 shrink-0" />
                    <span>Differences are settled with ShareCoins</span>
                  </div>
                )}
              </>
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
