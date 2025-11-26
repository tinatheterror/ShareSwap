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
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Link, useLocation } from "wouter";
import { Edit, Trash2, Eye, Plus, Package, Coins } from "lucide-react";
import type { SelectItem } from "@db/schema";

export default function MyItemsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<"all" | "available" | "unavailable">(
    "all",
  );
  const [showNoItemsDialog, setShowNoItemsDialog] = useState(false);

  const { data: items = [], isLoading } = useQuery<SelectItem[]>({
    queryKey: ["/api/my-items"],
    enabled: !!user,
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
          <p className="text-muted-foreground">
            Manage your uploaded items and track their availability
          </p>
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
                  <div className="absolute top-2 right-2">
                    <Badge variant={item.isAvailable ? "default" : "secondary"}>
                      {item.isAvailable ? "Available" : "Unavailable"}
                    </Badge>
                  </div>
                </div>
                <CardContent className="p-4">
                  <h3 className="font-semibold text-lg mb-2">{item.name}</h3>
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
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-sm text-muted-foreground">
                      Condition:
                    </span>
                    <Badge
                      variant={
                        item.isConditionVerified ? "default" : "secondary"
                      }
                      className="text-xs"
                    >
                      {item.conditionRating}/10{" "}
                      {item.isConditionVerified && "✓"}
                    </Badge>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-2">
                    <Link href={`/items/${item.id}`}>
                      <Button variant="outline" size="sm" className="flex-1">
                        <Eye className="h-3 w-3 mr-1" />
                        View
                      </Button>
                    </Link>
                    <Button variant="outline" size="sm" className="flex-1">
                      <Edit className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-teal-600 hover:text-teal-700"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

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
