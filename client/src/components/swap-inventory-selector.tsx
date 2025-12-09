import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Camera,
  Check,
  AlertCircle,
  Coins,
  Package,
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

  // Get all user items except the target item
  const allUserItems = myItems.filter((item) => item.id !== targetItem.id);

  // Filter for tier-compatible items (regardless of isSwappable flag)
  const tierCompatibleItems = allUserItems.filter((item) => {
    const itemTier = (item as any).tier || 2;
    const swap = calculateSwap(itemTier, targetTier);
    return swap.fairness !== "not_allowed";
  });

  // Items that are fully eligible (tier compatible AND marked as swappable)
  const swappableItems = tierCompatibleItems.filter((item) => item.isSwappable);

  // Items that are tier-compatible but not marked as swappable
  const needsSwapEnabled = tierCompatibleItems.filter((item) => !item.isSwappable);

  const handleConfirmSelection = () => {
    const selectedItem = swappableItems.find((i) => i.id === selectedItemId);
    if (selectedItem) {
      onSelectItem(selectedItem);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-purple-600" />
            Select Your Item to Swap
          </DialogTitle>
          <DialogDescription>
            Choose one of your items to offer in exchange for "{targetItem.name}"
          </DialogDescription>
        </DialogHeader>

        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
              {targetItem.photos?.[0] ? (
                <img
                  src={targetItem.photos[0]}
                  alt={targetItem.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Camera className="h-6 w-6 text-gray-400" />
                </div>
              )}
            </div>
            <div>
              <p className="font-medium text-purple-900">You want:</p>
              <p className="text-purple-700">{targetItem.name}</p>
              <Badge
                variant="outline"
                className="mt-1 border-purple-300 text-purple-700"
              >
                {getSwapTierLabel(targetTier)}
              </Badge>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="font-medium text-sm text-gray-700">
            Your eligible items ({swappableItems.length})
          </h4>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            </div>
          ) : swappableItems.length === 0 && needsSwapEnabled.length === 0 ? (
            <div className="text-center py-8 px-4">
              <Package className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No eligible items</p>
              <p className="text-sm text-gray-400 mt-1">
                You don't have any items in Tier {Math.max(1, targetTier - 1)} to{" "}
                {targetTier + 1}
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => (window.location.href = "/lend")}
              >
                Add items to swap
              </Button>
            </div>
          ) : swappableItems.length === 0 && needsSwapEnabled.length > 0 ? (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-amber-800 font-medium text-sm">Enable swapping on your items</p>
                    <p className="text-amber-700 text-xs mt-1">
                      You have {needsSwapEnabled.length} tier-compatible item{needsSwapEnabled.length > 1 ? "s" : ""} but swapping isn't enabled. 
                      Edit your items and turn on "Swap It" to make them available for trading.
                    </p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 max-h-[200px] overflow-y-auto opacity-60">
                {needsSwapEnabled.map((item) => {
                  const itemTier = (item as any).tier || 2;
                  return (
                    <Card key={item.id} className="bg-gray-50">
                      <CardContent className="p-3">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 bg-gray-200 rounded-lg overflow-hidden flex-shrink-0">
                            {item.photos?.[0] ? (
                              <img src={item.photos[0]} alt={item.name} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Camera className="h-4 w-4 text-gray-400" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-600 truncate text-sm">{item.name}</p>
                            <Badge variant="outline" className="text-xs mt-1">
                              {getSwapTierLabel(itemTier)}
                            </Badge>
                          </div>
                          <Badge variant="secondary" className="text-xs">
                            Swap disabled
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => (window.location.href = "/inventory")}
              >
                Edit my items
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 max-h-[300px] overflow-y-auto">
              {swappableItems.map((item) => {
                const itemTier = (item as any).tier || 2;
                const swap = calculateSwap(itemTier, targetTier);
                const isSelected = selectedItemId === item.id;

                return (
                  <Card
                    key={item.id}
                    className={`cursor-pointer transition-all ${
                      isSelected
                        ? "ring-2 ring-purple-500 bg-purple-50"
                        : "hover:bg-gray-50"
                    }`}
                    onClick={() => setSelectedItemId(item.id)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0 relative">
                          {item.photos?.[0] ? (
                            <img
                              src={item.photos[0]}
                              alt={item.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Camera className="h-6 w-6 text-gray-400" />
                            </div>
                          )}
                          {isSelected && (
                            <div className="absolute inset-0 bg-purple-500/20 flex items-center justify-center">
                              <Check className="h-6 w-6 text-purple-700" />
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">
                            {item.name}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge
                              variant="outline"
                              className="text-xs border-purple-300 text-purple-700"
                            >
                              {getSwapTierLabel(itemTier)}
                            </Badge>

                            {swap.fairness === "fair" ? (
                              <span className="text-xs text-green-600 flex items-center gap-1">
                                <Check className="h-3 w-3" />
                                Fair swap
                              </span>
                            ) : (
                              <span className="text-xs text-amber-600 flex items-center gap-1">
                                <Coins className="h-3 w-3" />
                                {swap.offsetDirection === "you_pay"
                                  ? `You add +${swap.offsetRequired} SC`
                                  : `They add +${swap.offsetRequired} SC`}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {swappableItems.length > 0 && (
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="bg-purple-600 hover:bg-purple-700"
              disabled={!selectedItemId}
              onClick={handleConfirmSelection}
            >
              <ArrowLeftRight className="h-4 w-4 mr-2" />
              Continue with Swap
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
