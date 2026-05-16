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
import { Trash2, Plus, Package, Coins, Sparkles, Pencil, AlertTriangle } from "lucide-react";
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

// ─── Grouped status system ───────────────────────────────────────────────────

type FilterGroup = "all" | "available" | "unavailable" | "out_with_neighbour" | "passed_on";

interface InventoryStatus {
  group: "available" | "unavailable" | "out_with_neighbour" | "passed_on";
  substatus: "available" | "reserved" | "in_dispute" | "paused" | "lent_out" | "rented_out" | "gifted" | "swapped";
  groupLabel: string;
  substatusLabel: string;
  canDelete: boolean;
  deleteLabel: string;
}

const ACTIVE_STATUSES = ["IN_PROGRESS", "HANDOFF_CONFIRMED", "DEPOSIT_CONFIRMED", "COURIER_PENDING", "AWAITING_HANDOFF_CONFIRM"];

function getInventoryStatus(item: any): InventoryStatus {
  const req = item.activeRequest;

  if (req) {
    const s: string = req.status;
    const t: string = req.requestType;

    if (s === "HANDOFF_DISPUTED" || s === "DISPUTED") {
      return { group: "unavailable", substatus: "in_dispute", groupLabel: "Unavailable", substatusLabel: "In dispute", canDelete: false, deleteLabel: "" };
    }
    if (ACTIVE_STATUSES.includes(s)) {
      if (t === "RENT") return { group: "out_with_neighbour", substatus: "rented_out", groupLabel: "Out with a neighbour", substatusLabel: "Rented out", canDelete: false, deleteLabel: "" };
      return { group: "out_with_neighbour", substatus: "lent_out", groupLabel: "Out with a neighbour", substatusLabel: "Lent out", canDelete: false, deleteLabel: "" };
    }
    if (s === "ACCEPTED" || s === "PENDING") {
      return { group: "unavailable", substatus: "reserved", groupLabel: "Unavailable", substatusLabel: "Reserved", canDelete: false, deleteLabel: "" };
    }
    if (s === "COMPLETED" || s === "COMPLETED_EARLY") {
      if (t === "GIFT") return { group: "passed_on", substatus: "gifted", groupLabel: "Passed on", substatusLabel: "Gifted", canDelete: true, deleteLabel: "Remove from history" };
      if (t === "SWAP") return { group: "passed_on", substatus: "swapped", groupLabel: "Passed on", substatusLabel: "Swapped", canDelete: true, deleteLabel: "Remove from history" };
    }
  }

  if (item.isAvailable) {
    return { group: "available", substatus: "available", groupLabel: "Available", substatusLabel: "", canDelete: true, deleteLabel: "Remove item" };
  }
  return { group: "unavailable", substatus: "paused", groupLabel: "Unavailable", substatusLabel: "Paused", canDelete: true, deleteLabel: "Remove item" };
}

// ─── Badge colours per substatus ─────────────────────────────────────────────

function getStatusBadgeClasses(status: InventoryStatus): { outer: string; dot: string } {
  switch (status.substatus) {
    case "available":      return { outer: "bg-teal-600/90 text-white",      dot: "bg-teal-300" };
    case "reserved":       return { outer: "bg-amber-500/90 text-white",     dot: "bg-amber-200" };
    case "in_dispute":     return { outer: "bg-red-600/90 text-white",       dot: "bg-red-300" };
    case "paused":         return { outer: "bg-gray-500/80 text-white",      dot: "bg-gray-300" };
    case "lent_out":       return { outer: "bg-blue-600/90 text-white",      dot: "bg-blue-300" };
    case "rented_out":     return { outer: "bg-indigo-600/90 text-white",    dot: "bg-indigo-300" };
    case "gifted":         return { outer: "bg-purple-500/90 text-white",    dot: "bg-purple-200" };
    case "swapped":        return { outer: "bg-violet-500/90 text-white",    dot: "bg-violet-200" };
    default:               return { outer: "bg-gray-600/80 text-white",      dot: "bg-gray-300" };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MyItemsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterGroup>("all");
  const [showNoItemsDialog, setShowNoItemsDialog] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<(SelectItem & { activeRequest?: any }) | null>(null);

  const { data: items = [], isLoading } = useQuery<(SelectItem & { activeRequest?: any })[]>({
    queryKey: ["/api/my-items"],
    enabled: !!user,
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: number) => {
      await apiRequest("DELETE", `/api/items/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-items"] });
      const status = itemToDelete ? getInventoryStatus(itemToDelete) : null;
      toast({
        title: status?.substatus === "gifted" || status?.substatus === "swapped" ? "Removed from history" : "Item Removed",
        description: "Your item has been removed from your inventory.",
      });
      setItemToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Cannot remove item",
        description: error.message || "Could not remove the item. Please try again.",
        variant: "destructive",
      });
      setItemToDelete(null);
    },
  });

  useEffect(() => {
    if (!isLoading && items.length === 0 && filter === "all") {
      setShowNoItemsDialog(true);
    }
  }, [items.length, isLoading, filter]);

  // ── Filtering ──────────────────────────────────────────────────────────────

  const filteredItems = items.filter((item) => {
    if (filter === "all") return true;
    const s = getInventoryStatus(item);
    if (filter === "available")          return s.group === "available";
    if (filter === "unavailable")        return s.group === "unavailable";
    if (filter === "out_with_neighbour") return s.group === "out_with_neighbour";
    if (filter === "passed_on")          return s.group === "passed_on";
    return true;
  });

  // ── Filter counts ──────────────────────────────────────────────────────────

  const counts = {
    all:                items.length,
    available:          items.filter((i) => getInventoryStatus(i).group === "available").length,
    unavailable:        items.filter((i) => getInventoryStatus(i).group === "unavailable").length,
    out_with_neighbour: items.filter((i) => getInventoryStatus(i).group === "out_with_neighbour").length,
    passed_on:          items.filter((i) => getInventoryStatus(i).group === "passed_on").length,
  };

  const getItemCapabilities = (item: SelectItem) => {
    const caps = [];
    if (item.isLendable) caps.push("Borrow");
    if (item.isRentable) caps.push("Rent");
    if (item.isSwappable) caps.push("Swap");
    return caps;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F3F4F6]">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 py-12">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-8" />
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-64 bg-gray-200 rounded-lg" />
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Deletion dialog content ────────────────────────────────────────────────

  const deleteStatus = itemToDelete ? getInventoryStatus(itemToDelete) : null;
  const isPassedOn = deleteStatus?.substatus === "gifted" || deleteStatus?.substatus === "swapped";

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center justify-center gap-2">
            <Package className="h-8 w-8 text-primary" />
            My ShareChest
          </h1>
        </div>

        {/* Filter Tabs */}
        <div className="flex flex-wrap gap-2 mb-6 items-center">
          {(
            [
              { key: "all",                label: "All Items" },
              { key: "available",          label: "Available" },
              { key: "unavailable",        label: "Unavailable" },
              { key: "out_with_neighbour", label: "Out with a Neighbour" },
              { key: "passed_on",          label: "Passed On" },
            ] as { key: FilterGroup; label: string }[]
          ).map(({ key, label }) => (
            <Button
              key={key}
              variant={filter === key ? "default" : "outline"}
              onClick={() => setFilter(key)}
              size="sm"
            >
              {label} ({counts[key]})
            </Button>
          ))}
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
              {filter === "all" ? "No items yet" : `No ${filter.replace(/_/g, " ")} items`}
            </h3>
            <p className="text-gray-500">
              {filter === "all"
                ? "Start sharing by adding your first item to the marketplace"
                : `You don't have any items in this category right now`}
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredItems.map((item) => {
              const status = getInventoryStatus(item);
              const badge = getStatusBadgeClasses(status);
              const isPassed = status.group === "passed_on";

              return (
                <Card
                  key={item.id}
                  className={`overflow-hidden hover:shadow-lg transition-shadow ${isPassed ? "opacity-75" : "cursor-pointer"}`}
                  onClick={() => !isPassed && navigate(`/lend?edit=${item.id}`)}
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
                      {!isPassed && (
                        <button
                          className="h-7 w-7 flex items-center justify-center rounded-md bg-white/90 hover:bg-white shadow-sm text-gray-500 hover:text-teal-600 transition-colors"
                          onClick={(e) => { e.stopPropagation(); navigate(`/lend?edit=${item.id}`); }}
                          title="Edit item"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {status.canDelete && (
                        <button
                          className="h-7 w-7 flex items-center justify-center rounded-md bg-white/90 hover:bg-white shadow-sm text-gray-500 hover:text-red-500 transition-colors"
                          onClick={(e) => { e.stopPropagation(); setItemToDelete(item); }}
                          title={status.deleteLabel}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Status badge — top right */}
                    <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                      <div className={`rounded-lg px-2.5 py-1 text-xs font-medium shadow-sm flex items-center gap-1.5 ${badge.outer}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                        <span>{status.groupLabel}</span>
                      </div>
                      {status.substatusLabel && (
                        <span className="text-[10px] font-medium text-gray-600 pr-0.5">{status.substatusLabel}</span>
                      )}
                    </div>
                  </div>

                  <CardContent className="p-4">
                    <h3 className="font-semibold text-lg mb-2">{item.name}</h3>
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{item.description}</p>

                    {/* Capabilities */}
                    <div className="flex flex-wrap gap-1 mb-3">
                      {getItemCapabilities(item).map((cap) => (
                        <Badge key={cap} variant="outline" className="text-xs">{cap}</Badge>
                      ))}
                    </div>

                    {/* Condition */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm text-muted-foreground">Condition:</span>
                      <Badge variant="secondary" className="text-xs">
                        {(item as any).condition || `${item.conditionRating}/10`}
                      </Badge>
                    </div>

                    {/* Tier Info */}
                    {(item as any).tier && (
                      <TooltipProvider>
                        <div className="p-4 bg-white rounded-xl border border-gray-200 mb-2">
                          <div className="inline-block bg-teal-50 text-teal-700 text-sm font-medium px-3 py-1 rounded-lg mb-2">
                            {TIER_NAMES[(item as any).tier] || `Tier ${(item as any).tier}`}
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
                                  AI analyzes condition, brand quality, category demand, and seasonal factors to determine the exact rate.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </TooltipProvider>
                    )}

                    {/* Undeletable notice */}
                    {!status.canDelete && (
                      <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-1">
                        <AlertTriangle className="h-3 w-3" />
                        <span>
                          {status.substatus === "in_dispute"
                            ? "Locked while in dispute"
                            : status.group === "out_with_neighbour"
                            ? "Locked while out with a neighbour"
                            : "Locked — active request pending"}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Delete / Remove-from-history Dialog */}
        <Dialog
          open={!!itemToDelete}
          onOpenChange={(open) => !open && setItemToDelete(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="text-4xl">{isPassedOn ? "📜" : "🗑️"}</div>
                <div>
                  <DialogTitle className="text-lg font-semibold mb-1">
                    {isPassedOn ? "Remove from History" : "Remove Item"}
                  </DialogTitle>
                  <DialogDescription className="text-sm text-gray-600">
                    {isPassedOn ? (
                      <>
                        This will hide{" "}
                        <span className="font-medium">{itemToDelete?.name}</span>{" "}
                        from your inventory history. All transaction records are preserved behind the scenes.
                      </>
                    ) : (
                      <>
                        Are you sure you want to remove{" "}
                        <span className="font-medium">{itemToDelete?.name}</span>{" "}
                        from circulation? Transaction history is preserved.
                      </>
                    )}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-4">
              <Button variant="outline" onClick={() => setItemToDelete(null)} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={() => itemToDelete && deleteItemMutation.mutate(itemToDelete.id)}
                disabled={deleteItemMutation.isPending}
                className="flex-1 text-white"
                style={{ backgroundColor: "#0DCEA1" }}
              >
                {deleteItemMutation.isPending
                  ? "Removing..."
                  : isPassedOn
                  ? "Yes, Remove from History"
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
                    Your ShareChest is empty
                  </DialogTitle>
                  <DialogDescription className="text-sm text-gray-600">
                    You haven't shared anything yet. Add your first item to start sharing with your neighbours.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-4">
              <Button variant="outline" onClick={() => setShowNoItemsDialog(false)} className="flex-1">
                Browse Anyway
              </Button>
              <Button
                onClick={() => { setShowNoItemsDialog(false); navigate("/lend"); }}
                className="flex-1"
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
