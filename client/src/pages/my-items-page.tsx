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
import { Trash2, Plus, Package, Coins, Sparkles, Pencil } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SelectItem } from "@db/schema";

const TIER_NAMES: Record<number, string> = {
  1: "Tier 1 – Budget Friendly",
  2: "Tier 2 – Everyday Household",
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
        description:
          error.message || "Could not remove the item. Please try again.",
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
      <div className="min-h-screen bg-[#F3F4F6]">
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
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center justify-center gap-2">
            <Package className="h-8 w-8 text-primary" />
            My Shared Items
          </h1>
        </div>

        {/* Filter Tabs */}
        <div className="flex flex-wrap gap-2 mb-6 items-center">
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
          <div className="hidden sm:block flex-1" />
          <Link href="/lend" className="ml-auto sm:ml-0">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add Your Item
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
                className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => navigate(`/lend?edit=${item.id}`)}
              >
                <div className="aspect-video bg-muted relative">
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
                    {/* Top-left action buttons */}
                    <div className="absolute top-2 left-2 flex gap-1">
                      <button
                        className="h-7 w-7 flex items-center justify-center rounded-md bg-white/90 hover:bg-white shadow-sm text-gray-500 hover:text-teal-600 transition-colors"
                        onClick={(e) => { e.stopPropagation(); navigate(`/lend?edit=${item.id}`); }}
                        title="Edit item"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="h-7 w-7 flex items-center justify-center rounded-md bg-white/90 hover:bg-white shadow-sm text-gray-500 hover:text-red-500 transition-colors"
                        onClick={(e) => { e.stopPropagation(); setItemToDelete(item); }}
                        title="Delete item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {/* Availability badge — top right */}
                    <div className="absolute top-2 right-2">
                      <Badge
                        variant={item.isAvailable ? "default" : "secondary"}
                      >
                        {item.isAvailable ? "Available" : "Unavailable"}
                      </Badge>
                    </div>
                  </div>
                <CardContent className="p-4">
                    <h3 className="font-semibold text-lg mb-2">
                      {item.name}
                    </h3>
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
                    <Badge variant="secondary" className="text-xs">
                      {(item as any).condition || `${item.conditionRating}/10`}
                    </Badge>
                  </div>

                  {/* Tier Info */}
                  {(item as any).tier && (
                    <TooltipProvider>
                      <div className="p-4 bg-white rounded-xl border border-gray-200 mb-4">
                        <div className="inline-block bg-teal-50 text-teal-700 text-sm font-medium px-3 py-1 rounded-lg mb-2">
                          {TIER_NAMES[(item as any).tier] ||
                            `Tier ${(item as any).tier}`}
                        </div>
                        <div className="flex items-center gap-2">
                          <Coins className="h-5 w-5 text-teal-600 shrink-0" />
                          <span className="font-bold text-gray-900 text-lg leading-none">
                            {TIER_SHARECOINS[(item as any).tier] || 5}
                          </span>
                          <span className="text-sm text-gray-600">ShareCoins/week</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1 cursor-help ml-1">
                                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                                <span className="text-xs text-amber-500 font-medium">AI valued</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="text-sm font-medium mb-1">AI-Powered Valuation</p>
                              <p className="text-xs">
                                AI analyzes condition, brand quality, category
                                demand, and seasonal factors to determine the exact rate.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </TooltipProvider>
                  )}

                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog
          open={!!itemToDelete}
          onOpenChange={(open) => !open && setItemToDelete(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="text-4xl">🗑️</div>
                <div>
                  <DialogTitle className="text-lg font-semibold mb-1">
                    Remove Item
                  </DialogTitle>
                  <DialogDescription className="text-sm text-gray-600">
                    Are you sure you want to remove{" "}
                    <span className="font-medium">{itemToDelete?.name}</span>{" "}
                    out of circulation? This action cannot be undone.
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
                onClick={() =>
                  itemToDelete && deleteItemMutation.mutate(itemToDelete.id)
                }
                disabled={deleteItemMutation.isPending}
                className="flex-1 text-white"
                style={{ backgroundColor: "#0DCEA1" }}
              >
                {deleteItemMutation.isPending
                  ? "Removing..."
                  : "Yes, Remove Item"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* No Items Notification Dialog */}
        <Dialog open={showNoItemsDialog} onOpenChange={setShowNoItemsDialog}>
          <DialogContent className="sm:max-w-md">
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
                className="flex-1 "
                style={{ backgroundColor: "#0DCEA1" }}
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
