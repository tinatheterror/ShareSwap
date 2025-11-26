import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Search,
  CheckCircle,
  AlertCircle,
  MapPin,
  X,
  Gift,
  UserPlus,
  Coins,
  Users,
  Sparkles,
} from "lucide-react";
import type { SelectItem } from "@db/schema";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { UserBadges } from "@/components/user-badges";

interface ItemWithDistance extends SelectItem {
  distance?: number;
  postalCode?: string;
}

export default function TakePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [radius, setRadius] = useState(72);
  const [userPostalCode, setUserPostalCode] = useState<string>("");
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showWishlistPopup, setShowWishlistPopup] = useState(false);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const addWishlistMutation = useMutation({
    mutationFn: (data: { itemName: string }) => {
      return apiRequest("POST", "/api/wishlists", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/all-wishlists"] });
      toast({
        title: "Added to wishlist!",
        description: "You'll be notified when someone shares this item.",
      });
      setSearchQuery("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add item to wishlist. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          setUserLocation({
            lat: latitude,
            lon: longitude,
          });

          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            );
            const data = await response.json();
            if (data.address?.postcode) {
              setUserPostalCode(data.address.postcode);
            }
          } catch (error) {
            console.error("Error getting postal code:", error);
          }
        },
        (error) => {
          console.error("Error getting location:", error);
          toast({
            title: "Location Error",
            description:
              "Could not get your location. Some features may be limited.",
            variant: "destructive",
          });
        },
      );
    }
  }, []);

  const {
    data: items = [],
    error,
    isLoading,
  } = useQuery<ItemWithDistance[]>({
    queryKey: userLocation
      ? [
          "/api/items/nearby",
          userLocation.lat,
          userLocation.lon,
          radius,
          "gift",
        ]
      : ["/api/items", "gift"],
    queryFn: async () => {
      if (userLocation) {
        const response = await fetch(
          `/api/items/nearby?latitude=${userLocation.lat}&longitude=${userLocation.lon}&radius=${radius}&type=gift`,
        );
        if (!response.ok) {
          console.error("Nearby items API failed, falling back to all items");
          const fallbackResponse = await fetch("/api/items?type=gift");
          if (!fallbackResponse.ok) throw new Error("Failed to fetch items");
          return fallbackResponse.json();
        }
        return response.json();
      } else {
        const response = await fetch("/api/items?type=gift");
        if (!response.ok) throw new Error("Failed to fetch items");
        return response.json();
      }
    },
    retry: 1,
  });

  const filteredItems = items.filter((item) => {
    if (!searchQuery) return true;
    const nameMatch = item.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const descMatch =
      item.description &&
      item.description.toLowerCase().includes(searchQuery.toLowerCase());
    return nameMatch || descMatch;
  });

  const handleAddToWishlist = () => {
    if (searchQuery.trim()) {
      addWishlistMutation.mutate({ itemName: searchQuery.trim() });
    }
  };

  const handleLocationSave = async (postalCode: string) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?postalcode=${postalCode}&format=json&limit=1`,
      );
      const data = await response.json();
      if (data.length > 0) {
        setUserLocation({
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
        });
        setUserPostalCode(postalCode);
        toast({
          title: "Location Updated",
          description: `Showing gifts near ${postalCode}`,
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Could not find that postal code",
        variant: "destructive",
      });
    }
    setShowLocationModal(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Gift className="h-7 w-7 text-pink-500" />
              Free Gifts
            </h1>
            <p className="text-gray-600 text-sm mt-1">
              Items being given away for free by your neighbors
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLocationModal(true)}
              className="flex items-center gap-1"
            >
              <MapPin className="h-4 w-4" />
              {userPostalCode || "Set Location"}
            </Button>
          </div>
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
          <Input
            placeholder="Search for free items..."
            className="pl-10 pr-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[...Array(8)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <div className="h-48 bg-gray-200" />
                <CardContent className="p-4">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700">
              Error loading gifts
            </h3>
            <p className="text-gray-500">Please try again later</p>
          </div>
        ) : filteredItems.length === 0 && searchQuery ? (
          <div className="text-center py-12">
            <div className="max-w-md mx-auto bg-gradient-to-br from-pink-50 to-rose-50 rounded-xl p-8 border border-pink-100">
              <Gift className="h-16 w-16 text-pink-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-800 mb-2">
                No "{searchQuery}" available as a gift
              </h3>
              <p className="text-gray-600 mb-6">
                Add it to your wishlist and we'll notify you when someone offers it!
              </p>
              <Button
                onClick={handleAddToWishlist}
                disabled={addWishlistMutation.isPending}
                className="bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600"
              >
                {addWishlistMutation.isPending ? (
                  "Adding..."
                ) : (
                  <>
                    <Sparkles className="h-5 w-5 mr-2" />
                    Add to Wishlist
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <Gift className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              No free gifts available yet
            </h3>
            <p className="text-gray-500 mb-4">
              Be the first to share something with your community!
            </p>
            <Button asChild>
              <Link href="/lend">List an Item</Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {filteredItems.map((item) => (
              <Card
                key={item.id}
                className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer group relative"
                onClick={() => navigate(`/items/${item.id}`)}
              >
                <Badge className="absolute top-2 left-2 z-10 bg-gradient-to-r from-pink-500 to-rose-500 text-white">
                  <Gift className="h-3 w-3 mr-1" />
                  FREE
                </Badge>
                <div className="relative h-48 overflow-hidden">
                  {item.photos && item.photos.length > 0 ? (
                    <img
                      src={item.photos[0]}
                      alt={item.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-pink-100 to-rose-100 flex items-center justify-center">
                      <Gift className="h-12 w-12 text-pink-300" />
                    </div>
                  )}
                </div>
                <CardContent className="p-4">
                  <h3 className="font-semibold text-gray-900 mb-1 truncate">
                    {item.name}
                  </h3>
                  <p className="text-sm text-gray-500 line-clamp-2 mb-2">
                    {item.description}
                  </p>

                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center gap-1">
                      <Coins className="h-3 w-3 text-amber-500" />
                      <span>+{item.shareCoinsReward} SC</span>
                    </div>
                    {item.distance && (
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        <span>{item.distance.toFixed(1)} km</span>
                      </div>
                    )}
                  </div>

                  {(item as any).owner && (
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                      <div className="w-6 h-6 rounded-full bg-pink-100 flex items-center justify-center">
                        <Users className="h-3 w-3 text-pink-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">
                          {(item as any).owner.username}
                        </p>
                        <UserBadges
                          userId={(item as any).owner.id}
                          size="xs"
                          maxBadges={2}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showLocationModal} onOpenChange={setShowLocationModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Your Location</DialogTitle>
            <DialogDescription>
              Enter your postal code to find gifts near you
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <Input
              placeholder="Enter postal code"
              defaultValue={userPostalCode}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleLocationSave((e.target as HTMLInputElement).value);
                }
              }}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowLocationModal(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const input = document.querySelector(
                    'input[placeholder="Enter postal code"]',
                  ) as HTMLInputElement;
                  handleLocationSave(input?.value || "");
                }}
                className="flex-1"
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
