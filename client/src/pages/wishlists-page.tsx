import { useState } from "react";
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Heart,
  Plus,
  MapPin,
  Clock,
  ArrowRightLeft,
  Repeat,
  Calendar,
  Trash2,
  HandHeart,
  X,
} from "lucide-react";

interface Wishlist {
  id: number;
  userId: number;
  itemName: string;
  description?: string;
  category?: string;
  needType: string;
  preferredLocation?: string;
  urgency: string;
  neededDate?: string;
  returnDate?: string;
  isActive: boolean;
  isExpired?: boolean;
  expirationReason?: string;
  createdAt: string;
}

export default function WishlistsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "archived">("all");
  const [formData, setFormData] = useState({
    itemName: "",
    description: "",
    needTypes: ["borrow"] as string[],
    preferredLocation: "",
    neededFromDate: "",
    neededToDate: "",
  });

  const toggleNeedType = (type: string) => {
    setFormData((prev) => {
      const current = prev.needTypes;
      if (current.includes(type)) {
        if (current.length === 1) return prev;
        return { ...prev, needTypes: current.filter((t) => t !== type) };
      } else {
        return { ...prev, needTypes: [...current, type] };
      }
    });
  };

  const isUrgent = (neededDate?: string) => {
    if (!neededDate) return false;
    const today = new Date();
    const needed = new Date(neededDate);
    const daysUntilNeeded = Math.ceil((needed.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilNeeded <= 7 && daysUntilNeeded >= 0;
  };

  const { data: wishlists = [], isLoading } = useQuery<Wishlist[]>({
    queryKey: ["/api/wishlists"],
  });

  const activeWishlists = wishlists.filter((w: Wishlist) => !w.isExpired);
  const archivedWishlists = wishlists.filter((w: Wishlist) => w.isExpired);

  const filteredWishlists = wishlists.filter((item) => {
    if (filter === "active") return !item.isExpired;
    if (filter === "archived") return item.isExpired;
    return true;
  });

  const addWishlistMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/wishlists", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlists"] });
      setShowAddDialog(false);
      setFormData({
        itemName: "",
        description: "",
        needTypes: ["borrow"],
        preferredLocation: "",
        neededFromDate: "",
        neededToDate: "",
      });
      toast({
        title: "Wishlist item added!",
        description: "We'll notify you when matching items become available.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add wishlist item. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.itemName) {
      toast({
        title: "Item name required",
        description: "Please enter the name of the item you're looking for.",
        variant: "destructive",
      });
      return;
    }
    addWishlistMutation.mutate({
      ...formData,
      needType: formData.needTypes.join(","),
      neededDate: formData.neededFromDate,
      returnDate: formData.neededToDate,
    });
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
            <Heart className="h-8 w-8 text-primary" />
            My Wishlist
          </h1>
          <p className="text-muted-foreground">
            Create demand signals for items you need. Get notified when they become available.
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6">
          <Button
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
            size="sm"
          >
            All Items ({wishlists.length})
          </Button>
          <Button
            variant={filter === "active" ? "default" : "outline"}
            onClick={() => setFilter("active")}
            size="sm"
          >
            Active ({activeWishlists.length})
          </Button>
          <Button
            variant={filter === "archived" ? "default" : "outline"}
            onClick={() => setFilter("archived")}
            size="sm"
          >
            Archived ({archivedWishlists.length})
          </Button>
          <div className="flex-1" />
          <Button onClick={() => setShowAddDialog(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Add Item
          </Button>
        </div>

        {/* Wishlist Grid */}
        {filteredWishlists.length === 0 ? (
          <div className="text-center py-12">
            <Heart className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-600 mb-2">
              {filter === "all" ? "No wishlist items yet" : `No ${filter} items`}
            </h3>
            <p className="text-gray-500 mb-6">
              {filter === "all"
                ? "Add items you're looking for and we'll notify you when they become available"
                : `You don't have any ${filter} wishlist items at the moment`}
            </p>
            {filter === "all" && (
              <Button onClick={() => setShowAddDialog(true)} className="flex items-center gap-2 mx-auto">
                <Plus className="h-4 w-4" />
                Add Your First Item
              </Button>
            )}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredWishlists.map((item) => (
              <Card
                key={item.id}
                className={`overflow-hidden hover:shadow-lg transition-shadow ${item.isExpired ? "opacity-75" : ""}`}
              >
                <div className="aspect-video bg-gradient-to-br from-primary/10 to-primary/5 relative flex items-center justify-center">
                  <Heart className="h-12 w-12 text-primary/30" />
                  <div className="absolute top-2 right-2 flex gap-1">
                    {isUrgent(item.neededDate) && !item.isExpired && (
                      <Badge className="bg-amber-100 text-amber-800 border-amber-200">
                        <Clock className="h-3 w-3 mr-1" />
                        Urgent
                      </Badge>
                    )}
                    {item.isExpired && (
                      <Badge variant="secondary">Archived</Badge>
                    )}
                  </div>
                </div>
                <CardContent className="p-4">
                  <h3 className="font-semibold text-lg mb-2">{item.itemName}</h3>
                  {item.description && (
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                      {item.description}
                    </p>
                  )}

                  {/* Need Types */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {(item.needType ? item.needType.split(",") : []).map((type: string) => (
                      <Badge key={type} variant="outline" className="text-xs">
                        {type === "borrow" && <HandHeart className="h-3 w-3 mr-1" />}
                        {type === "rent" && <ArrowRightLeft className="h-3 w-3 mr-1" />}
                        {type === "swap" && <Repeat className="h-3 w-3 mr-1" />}
                        {type.charAt(0).toUpperCase() + type.slice(1)} It
                      </Badge>
                    ))}
                  </div>

                  {/* Date Needed */}
                  {item.neededDate && (
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm text-muted-foreground">Needed:</span>
                      <Badge variant="outline" className="text-xs">
                        <Calendar className="h-3 w-3 mr-1" />
                        {new Date(item.neededDate).toLocaleDateString()}
                        {item.returnDate && ` - ${new Date(item.returnDate).toLocaleDateString()}`}
                      </Badge>
                    </div>
                  )}

                  {/* Location */}
                  {item.preferredLocation && (
                    <div className="flex items-center gap-2 mb-4">
                      <MapPin className="h-3 w-3 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {item.preferredLocation}
                      </span>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1">
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground mt-3">
                    Added {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Add Wishlist Dialog */}
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Heart className="h-5 w-5 text-primary" />
                Add to Wishlist
              </DialogTitle>
              <DialogDescription>
                Tell us what you're looking for and we'll notify you when it becomes available.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  I'm looking for *
                </label>
                <Input
                  value={formData.itemName}
                  onChange={(e) =>
                    setFormData({ ...formData, itemName: e.target.value })
                  }
                  placeholder="e.g., Power drill, Camping tent, Stand mixer"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Description
                </label>
                <Textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder="Describe what you need this item for or any specific requirements..."
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  I want to
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    type="button"
                    variant={formData.needTypes.includes("borrow") ? "default" : "outline"}
                    size="sm"
                    className="justify-center"
                    onClick={() => toggleNeedType("borrow")}
                  >
                    <HandHeart className="h-4 w-4 mr-1" />
                    Borrow It
                  </Button>
                  <Button
                    type="button"
                    variant={formData.needTypes.includes("rent") ? "default" : "outline"}
                    size="sm"
                    className="justify-center"
                    onClick={() => toggleNeedType("rent")}
                  >
                    <ArrowRightLeft className="h-4 w-4 mr-1" />
                    Rent It
                  </Button>
                  <Button
                    type="button"
                    variant={formData.needTypes.includes("swap") ? "default" : "outline"}
                    size="sm"
                    className="justify-center"
                    onClick={() => toggleNeedType("swap")}
                  >
                    <Repeat className="h-4 w-4 mr-1" />
                    Swap It
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Select one or more options</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Date Needed
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">From</label>
                    <Input
                      type="date"
                      value={formData.neededFromDate}
                      onChange={(e) =>
                        setFormData({ ...formData, neededFromDate: e.target.value })
                      }
                      min={new Date().toISOString().split("T")[0]}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">To</label>
                    <Input
                      type="date"
                      value={formData.neededToDate}
                      onChange={(e) =>
                        setFormData({ ...formData, neededToDate: e.target.value })
                      }
                      min={formData.neededFromDate || new Date().toISOString().split("T")[0]}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Preferred Location
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    value={formData.preferredLocation}
                    onChange={(e) =>
                      setFormData({ ...formData, preferredLocation: e.target.value })
                    }
                    placeholder="Neighborhood, postal code, or 'nearby'"
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddDialog(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={addWishlistMutation.isPending}
                  className="flex-1"
                >
                  {addWishlistMutation.isPending ? "Adding..." : "Add to Wishlist"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
