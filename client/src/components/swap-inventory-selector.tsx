import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Camera,
  Check,
  Coins,
  Package,
  Plus,
} from "lucide-react";
import type { SelectItem } from "@db/schema";
import {
  calculateSwap,
  getSwapTierLabel,
  getTierShareCoins,
} from "@/lib/swap-calculator";

type Props = {
  targetItem: SelectItem;
  isOpen: boolean;
  onClose: () => void;
  onSelectItem: (item: SelectItem) => void;
};

export function SwapInventorySelector({
  targetItem,
  isOpen,
  onClose,
  onSelectItem,
}: Props) {
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);

  const { data: myItems = [], isLoading } = useQuery<SelectItem[]>({
    queryKey: ["/api/my-items"],
    enabled: isOpen,
  });

  const targetTier = (targetItem as any).tier || 2;
  const targetShareCoins = getTierShareCoins(targetTier);

  const allUserItems = myItems.filter((item) => item.id !== targetItem.id);

  const tierCompatibleItems = allUserItems.filter((item) => {
    const itemTier = (item as any).tier || 2;
    const swap = calculateSwap(itemTier, targetTier);
    return swap.fairness !== "not_allowed";
  });

  const swappableItems = tierCompatibleItems.filter((item) => item.isSwappable);
  const needsSwapEnabled = tierCompatibleItems.filter(
    (item) => !item.isSwappable,
  );

  const handleConfirmSelection = () => {
    const selectedItem = swappableItems.find((i) => i.id === selectedItemId);
    if (selectedItem) {
      onSelectItem(selectedItem);
    }
  };

  const formatTierDisplay = (tier: number) => {
    const coins = getTierShareCoins(tier);
    return { tier, coins };
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden">
        {/* Hero Section - Target Item */}
        <div className="bg-gradient-to-br from-purple-600 to-purple-700 p-6 text-white">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 bg-white/10 rounded-xl overflow-hidden flex-shrink-0 shadow-lg">
              {targetItem.photos?.[0] ? (
                <img
                  src={targetItem.photos[0]}
                  alt={targetItem.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Camera className="h-8 w-8 text-white/50" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold truncate">
                Swap for {targetItem.name}
              </h2>
              <div className="flex items-center gap-1.5 mt-2 text-white/90 text-sm">
                <span>Tier {targetTier} -</span>
                <Coins className="h-3.5 w-3.5" />
                <span>{targetShareCoins} ShareCoins</span>
              </div>
            </div>
          </div>
        </div>

        {/* Content Section - White Background */}
        <div className="p-5 bg-white">
          <h3 className="text-sm font-medium text-gray-500 mb-3">
            Select one of your items to trade
          </h3>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            </div>
          ) : swappableItems.length === 0 && needsSwapEnabled.length === 0 ? (
            <div className="text-center py-10">
              <Package className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No eligible items</p>
              <p className="text-sm text-gray-400 mt-1 mb-4">
                Add items in Tier {Math.max(1, targetTier - 1)}-{targetTier + 1}{" "}
                to swap
              </p>
              <Button onClick={() => (window.location.href = "/lend")}>
                Add an item
              </Button>
            </div>
          ) : swappableItems.length === 0 && needsSwapEnabled.length > 0 ? (
            <div className="space-y-4">
              {/* Calm instructional message */}
              <p className="text-sm text-gray-500 py-2 text-center">
                To swap items, enable "Swap It" on your listings.
              </p>

              {/* Items list - showing disabled items with inline text */}
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {needsSwapEnabled.map((item) => {
                  const itemTier = (item as any).tier || 2;
                  const tierInfo = formatTierDisplay(itemTier);
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-gray-100"
                    >
                      <div className="w-14 h-14 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                        {item.photos?.[0] ? (
                          <img
                            src={item.photos[0]}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Camera className="h-5 w-5 text-gray-400" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {item.name}
                        </p>
                        <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                          <span>Tier {tierInfo.tier} -</span>
                          <Coins className="h-3 w-3" />
                          <span>{tierInfo.coins} ShareCoins</span>
                        </div>
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        Swap turned off
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Two buttons side by side */}
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => (window.location.href = "/my-items")}
                >
                  Turn on Swap It on your items
                </Button>
                <Button
                  variant="outline"
                  className="flex-shrink-0"
                  onClick={() => (window.location.href = "/lend")}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add an item
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {swappableItems.map((item) => {
                  const itemTier = (item as any).tier || 2;
                  const tierInfo = formatTierDisplay(itemTier);
                  const swap = calculateSwap(itemTier, targetTier);
                  const isSelected = selectedItemId === item.id;

                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border ${
                        isSelected
                          ? "border-purple-500 bg-purple-50"
                          : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                      }`}
                      onClick={() => setSelectedItemId(item.id)}
                    >
                      <div className="w-14 h-14 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0 relative">
                        {item.photos?.[0] ? (
                          <img
                            src={item.photos[0]}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Camera className="h-5 w-5 text-gray-400" />
                          </div>
                        )}
                        {isSelected && (
                          <div className="absolute inset-0 bg-purple-500/30 flex items-center justify-center">
                            <Check className="h-5 w-5 text-white" />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {item.name}
                        </p>
                        <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                          <span>Tier {tierInfo.tier} -</span>
                          <Coins className="h-3 w-3" />
                          <span>{tierInfo.coins} ShareCoins</span>
                          {swap.fairness === "fair" ? (
                            <>
                              <span className="text-gray-300 ml-1">·</span>
                              <span className="text-green-600">Fair swap</span>
                            </>
                          ) : (
                            <>
                              <span className="text-gray-300 ml-1">·</span>
                              <span className="text-gray-500">
                                {swap.offsetDirection === "you_pay"
                                  ? `+${swap.offsetRequired} SC`
                                  : `-${swap.offsetRequired} SC`}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-4 mt-4 border-t">
                <Button variant="outline" className="flex-1" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-purple-600 hover:bg-purple-700"
                  disabled={!selectedItemId}
                  onClick={handleConfirmSelection}
                >
                  <ArrowLeftRight className="h-4 w-4 mr-2" />
                  Continue
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
