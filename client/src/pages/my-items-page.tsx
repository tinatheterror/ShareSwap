import { useState, useEffect } from "react";
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Link, useLocation } from "wouter";
import { Edit, Trash2, Plus, Package, Coins, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SelectItem } from "@db/schema";

const TIER_NAMES: Record<number, string> = {
  1: "Tier 1 – Budget Friendly",
  2: "Tier 2 – Everyday Household Item",
  3: "Tier 3 – Premium Item",
  4: "Tier 4 – High Value Item",
};

const TIER_SHARECOINS: Record<number, number> = {
  1: 5,
  2: 10,
  3: 20,
  4: 40,
};

export default function MyItemsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "available" | "unavailable">(
    "all",
  );
  const [showNoItemsDialog, setShowNoItemsDialog] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<SelectItem | null>(null);

  const { data: items = [], isLoading } = useQuery<SelectItem[]>({
    queryKey: ["/api/my-items"],
    enabled: !!user,
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: number) => {
      await apiRequest("DELETE", `/api/items/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-items"] });
      toast({
        title: "Item Removed",
        description: "Your item has been permanently removed from circulation.",
      });
      setItemToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Remove",
        description: error.message || "Could not remove the item. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!isLoading && items.length === 0 && filter === "all") {
      setShowNoItemsDialog(true);
    }
  }, [items.length, isLoading, filter]);

  const filteredItems = items.filter((item) => {
    if (filter === "available") return item.isAvailable;
    if (filter === "unavailable") return !item.isAvailable;
    return true;
  });

  const getItemCapabilities = (item: SelectItem) => {
    const capabilities = [];
    if (item.isLendable) capabilities.push("Borrow");
    if (item.isRentable) capabilities.push("Rent");
    if (item.isSwappable) capabilities.push("Swap");
    return capabilities;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 py-12">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-8"></div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-64 bg-gray-200 rounded-lg"></div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center justify-center gap-2">
            <Package className="h-8 w-8 text-primary" />
            My Shared Items
          </h1>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6">
          <Button
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
            size="sm"
          >
            All Items ({items.length})
          </Button>
          <Button
            variant={filter === "available" ? "default" : "outline"}
            onClick={() => setFilter("available")}
            size="sm"
          >
            Available ({items.filter((i) => i.isAvailable).length})
          </Button>
          <Button
            variant={filter === "unavailable" ? "default" : "outline"}
            onClick={() => setFilter("unavailable")}
            size="sm"
          >
            Unavailable ({items.filter((i) => !i.isAvailable).length})
          </Button>
          <div className="flex-1" />
          <Link href="/lend">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add Item
            </Button>
          </Link>
        </div>

        {/* Items Grid */}
        {filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <Package className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-600 mb-2">
              {filter === "all" ? "No items yet" : `No ${filter} items`}
            </h3>
            <p className="text-gray-500">
              {filter === "all"
                ? "Start sharing by adding your first item to the marketplace"
                : `You don't have any ${filter} items at the moment`}
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredItems.map((item) => (
              <Card
                key={item.id}
                className="overflow-hidden hover:shadow-lg transition-shadow"
              >
                <Link href={`/items/${item.id}`}>
                  <div className="h-32 bg-muted relative cursor-pointer">
                    {item.photos[0] ? (
                      <img
                        src={item.photos[0]}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="h-12 w-12 text-muted-foreground" />
                      </div>
                    )}
                    <div className="absolute top-2 right-2">
                      <Badge variant={item.isAvailable ? "default" : "secondary"}>
                        {item.isAvailable ? "Available" : "Unavailable"}
                      </Badge>
                    </div>
                  </div>
                </Link>
                <CardContent className="p-4">
                  <Link href={`/items/${item.id}`}>
                    <h3 className="font-semibold text-lg mb-2 hover:text-teal-600 cursor-pointer">{item.name}</h3>
                  </Link>
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                    {item.description}
                  </p>

                  {/* Capabilities */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {getItemCapabilities(item).map((capability) => (
                      <Badge
                        key={capability}
                        variant="outline"
                        className="text-xs"
                      >
                        {capability}
                      </Badge>
                    ))}
                  </div>

                  {/* Condition */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm text-muted-foreground">
                      Condition:
                    </span>
                    <Badge
                      variant={
                        item.isConditionVerified ? "default" : "secondary"
                      }
                      className="text-xs"
                    >
                      {(item as any).condition || `${item.conditionRating}/10`}{" "}
                      {item.isConditionVerified && "✓"}
                    </Badge>
                  </div>

                  {/* Tier Info - Same card as lend page */}
                  {(item as any).tier && (
                    <TooltipProvider>
                      <div className="p-4 bg-white rounded-lg border border-teal-200 mb-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-black font-medium">
                              {TIER_NAMES[(item as any).tier] || `Tier ${(item as any).tier}`}
                            </span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Sparkles className="h-4 w-4 text-teal-500 cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p className="text-sm font-medium mb-1">
                                  AI-Powered Valuation
                                </p>
                                <p className="text-xs">
                                  AI analyzes condition, brand quality, category demand, and seasonal factors to determine the exact rate.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <div className="flex items-center gap-1.5 bg-teal-50 px-3 py-1 rounded-full">
                            <Sparkles className="h-3.5 w-3.5 text-teal-600" />
                            <span className="text-xs text-teal-700 font-medium">
                              AI valued
                            </span>
                          </div>
                        </div>
                        <div className="mt-2">
                          <div className="flex items-center gap-1.5 text-sm">
                            <Coins className="h-5 w-5 text-teal-600" />
                            <span className="font-semibold text-teal-700 text-lg">
                              {TIER_SHARECOINS[(item as any).tier] || 5} ShareCoins/week
                            </span>
                          </div>
                        </div>
                      </div>
                    </TooltipProvider>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2">
                    <Link href={`/lend?edit=${item.id}`} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full">
                        <Edit className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      className="hover:bg-teal-50"
                      style={{ color: "#0DCEA1" }}
                      onClick={() => setItemToDelete(item)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="text-4xl">🗑️</div>
                <div>
                  <DialogTitle className="text-lg font-semibold mb-1">
                    Remove Item
                  </DialogTitle>
                  <DialogDescription className="text-sm text-gray-600">
                    Are you sure you want to remove <span className="font-medium">{itemToDelete?.name}</span> out of circulation? This action cannot be undone.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-4">
              <Button
                variant="outline"
                onClick={() => setItemToDelete(null)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={() => itemToDelete && deleteItemMutation.mutate(itemToDelete.id)}
                disabled={deleteItemMutation.isPending}
                className="flex-1 text-white"
                style={{ backgroundColor: "#0DCEA1" }}
              >
                {deleteItemMutation.isPending ? "Removing..." : "Yes, Remove Item"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* No Items Notification Dialog */}
        <Dialog open={showNoItemsDialog} onOpenChange={setShowNoItemsDialog}>
          <DialogContent className="sm:max-w-md">
            <button
              onClick={() => setShowNoItemsDialog(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            >
              ✕
            </button>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="text-4xl">📦</div>
                <div>
                  <DialogTitle className="text-lg font-semibold mb-1">
                    Need items to Share
                  </DialogTitle>
                  <DialogDescription className="text-sm text-gray-600">
                    You have {items.length} items in the ShareChest. Would you
                    like to add something to share with the community?
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-4">
              <Button
                variant="outline"
                onClick={() => setShowNoItemsDialog(false)}
                className="flex-1"
              >
                Browse Anyway
              </Button>
              <Button
                onClick={() => {
                  setShowNoItemsDialog(false);
                  navigate("/lend");
                }}
                className="flex-1 " style={{ backgroundColor: "#0DCEA1" }}
              >
                Add My First Item
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
