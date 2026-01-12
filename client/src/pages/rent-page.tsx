import { useState, useEffect } from "react";
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Search, Filter, MapPin, Coins, Camera, Heart, Sparkles, BadgeCheck } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Recommendations } from "@/components/recommendations";
import { SeasonalRecommendations } from "@/components/seasonal-recommendations";
import { WishlistFulfillmentPopup } from "@/components/wishlist-fulfillment-popup";

type ItemWithDistance = {
  id: number;
  name: string;
  description: string;
  photos: string[];
  dollarsPrice?: string;
  shareCoinPrice?: string;
  securityDeposit?: string;
  isConditionVerified: boolean;
  distance?: number;
  isRentable: boolean;
  owner?: {
    id: number;
    username: string;
    isVerified: boolean;
    reputationLevel: string;
  };
};

export default function RentPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [radius, setRadius] = useState(72); // Default 72km radius
  const [userPostalCode, setUserPostalCode] = useState<string>("");
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showShareCoinsPrompt, setShowShareCoinsPrompt] = useState(false);
  const [showWishlistPopup, setShowWishlistPopup] = useState(false);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Add to wishlist mutation
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

  // Get user's location when the component mounts
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          setUserLocation({
            lat: latitude,
            lon: longitude,
          });

          // Get postal code from coordinates using OpenStreetMap Nominatim
          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`,
              {
                headers: {
                  'User-Agent': 'ShareSwap/1.0',
                },
              }
            );
            if (response.ok) {
              const data = await response.json();
              const postcode = data.address?.postcode || data.address?.postal_code;
              if (postcode) {
                setUserPostalCode(postcode);
              }
            }
          } catch (error) {
            console.error("Error getting postal code:", error);
          }
        },
        (error) => {
          console.error("Error getting location:", error);
          toast({
            title: "Location Error",
            description: "Could not get your location. Some features may be limited.",
            variant: "destructive",
          });
        }
      );
    }
  }, []);

  const { data: items = [], error, isLoading } = useQuery<ItemWithDistance[]>({
    queryKey: userLocation ? ['/api/items/nearby', userLocation.lat, userLocation.lon, radius, 'rent'] : ['/api/items', 'rent'],
    queryFn: async () => {
      if (userLocation) {
        const response = await fetch(
          `/api/items/nearby?latitude=${userLocation.lat}&longitude=${userLocation.lon}&radius=${radius}&type=rent`
        );
        if (!response.ok) {
          console.error('Nearby items API failed, falling back to all items');
          // Fall back to all rent items if nearby fails
          const fallbackResponse = await fetch('/api/items?type=rent');
          if (!fallbackResponse.ok) throw new Error('Failed to fetch items');
          return fallbackResponse.json();
        }
        return response.json();
      } else {
        // Fallback to all rent items if no location
        const response = await fetch('/api/items?type=rent');
        if (!response.ok) throw new Error('Failed to fetch items');
        return response.json();
      }
    },
    retry: 1,
  });

  const filteredItems = items.filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Check if user has sufficient funds for rentals
  useEffect(() => {
    if (user && items.length > 0) {
      // This would normally check if user has sufficient payment method set up
      // For now, we'll assume they do if they're verified
    }
  }, [user, items]);

  const handleLocationChange = () => {
    setShowLocationModal(true);
  };

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="text-center mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-2">Rent Items</h1>
            <p className="text-sm sm:text-base text-muted-foreground">
              Browse items available for rental with daily pricing
              {userPostalCode && ` near ${userPostalCode}`}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={handleLocationChange}
            className="mt-4"
          >
            <MapPin className="h-4 w-4 mr-2" />
            {userPostalCode ? `Change Location (${userPostalCode})` : "Set Location"}
          </Button>
        </div>

        {/* Search and Filters */}
        <div className="flex gap-2 sm:gap-4 mb-6 max-w-2xl mx-auto">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Search rentable items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button variant="outline" size="icon">
            <Filter className="h-4 w-4" />
          </Button>
        </div>

        {/* AI Recommendations Section */}
        <div className="mb-8">
          <Recommendations limit={6} />
        </div>

        {/* Seasonal Recommendations */}
        <div className="mb-8">
          <SeasonalRecommendations limit={6} />
        </div>

        {/* All Rentable Items Grid */}
        <div className="mt-6 sm:mt-8">
          <h2 className="text-lg sm:text-xl font-bold mb-4">All Items Available to Rent ({filteredItems.length})</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
          {filteredItems.map((item) => (
            <Card key={item.id} className="hover:shadow-md transition-shadow bg-white rounded-xl overflow-hidden">
              <CardContent className="p-4">
                <div className="aspect-square bg-gray-100 rounded-lg mb-3 flex items-center justify-center overflow-hidden">
                  {item.photos && item.photos[0] ? (
                    <img
                      src={item.photos[0]}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-gray-200 rounded-lg flex items-center justify-center">
                      <Camera className="h-8 w-8 text-gray-400" />
                    </div>
                  )}
                </div>
                
                <div className="text-center mb-3">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <h3 className="font-semibold text-sm line-clamp-1">{item.name}</h3>
                    {item.owner?.isVerified && (
                      <BadgeCheck className="h-4 w-4 text-teal-600 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mb-1">
                    {item.isConditionVerified ? "Verified" : "Pending"}
                  </p>
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <span className="text-xs font-semibold text-teal-700">
                      ${Number(item.dollarsPrice || 10).toFixed(2)}/day
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">
                    {item.distance ? `${item.distance.toFixed(1)}km` : "Nearby"}
                  </p>
                </div>
                
                <Button 
                  className="w-full  text-white text-sm py-2 rounded-lg" style={{ backgroundColor: "#0DCEA1" }}
                  disabled={!item.isConditionVerified}
                  onClick={() => navigate(`/items/${item.id}`)}
                >
                  {item.isConditionVerified ? "Rent" : "Pending"}
                </Button>
              </CardContent>
            </Card>
          ))}
          </div>
        </div>

        {/* Empty state with wishlist prompt */}
        {filteredItems.length === 0 && !isLoading && searchQuery && (
          <div className="flex flex-col items-center justify-center py-16">
            <div
              className="rounded-2xl p-8 max-w-md w-full text-center"
              style={{ backgroundColor: "#D4F7F1" }}
            >
              <div
                className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
                style={{ backgroundColor: "#0DCEA1" }}
              >
                <Heart className="h-8 w-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold mb-2" style={{ color: "#0D9488" }}>
                No "{searchQuery}" found
              </h3>
              <p className="text-gray-700 mb-6">
                This item isn't available yet, but you can add it to your
                wishlist and we'll notify you when someone shares it!
              </p>
              <Button
                size="lg"
                className="text-white font-semibold"
                style={{ backgroundColor: "#0DCEA1" }}
                onClick={() => {
                  if (!user) {
                    toast({
                      title: "Sign in required",
                      description: "Please sign in to add items to your wishlist.",
                      variant: "destructive",
                    });
                    navigate("/auth");
                    return;
                  }
                  addWishlistMutation.mutate({ itemName: searchQuery });
                }}
                disabled={addWishlistMutation.isPending}
              >
                {addWishlistMutation.isPending ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Adding...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-5 w-5 mr-2" />
                    Add to Wishlist
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
        {filteredItems.length === 0 && !isLoading && !searchQuery && (
          <div className="text-center py-12">
            <h3 className="text-lg font-semibold text-gray-700 mb-2">No rentable items found</h3>
            <p className="text-gray-500 mb-4">
              No items are currently available for rent in your area
            </p>
          </div>
        )}

        {/* ShareCoins prompt for users who want to rent but don't have payment method */}
        <Dialog open={showShareCoinsPrompt} onOpenChange={setShowShareCoinsPrompt}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>💳 Payment Method Required</DialogTitle>
              <DialogDescription>
                You need a verified payment method to rent items. Complete verification to access rental features.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-3 mt-4">
              <Button
                variant="outline"
                onClick={() => setShowShareCoinsPrompt(false)}
                className="flex-1"
              >
                Browse Anyway
              </Button>
              <Button
                onClick={() => navigate("/verification")}
                className="flex-1"
              >
                Complete Verification
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {showLocationModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold mb-4">Change Location</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Search Radius</label>
                  <select
                    value={radius}
                    onChange={(e) => setRadius(Number(e.target.value))}
                    className="w-full p-2 border rounded-lg"
                  >
                    <option value={1}>1 kilometer</option>
                    <option value={5}>5 kilometers</option>
                    <option value={10}>10 kilometers</option>
                    <option value={24}>24 kilometers</option>
                    <option value={40}>40 kilometers</option>
                    <option value={72}>72 kilometers</option>
                    <option value={100}>100 kilometers</option>
                  </select>
                </div>
              </div>
              <Button
                className="w-full mt-6"
                onClick={() => setShowLocationModal(false)}
              >
                Apply
              </Button>
            </div>
          </div>
        )}

        {/* Can't find what you need - Rent-specific */}
        <div className="mt-8 bg-gradient-to-r from-primary/10 to-primary/5 p-6 rounded-lg border border-primary/20">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-primary mb-2">
              Need something for rent?
            </h3>
            <p className="text-primary/80 mb-4">
              Add it to your wishlist and we'll notify you when it becomes available for rent!
            </p>
            <Button
              onClick={() => navigate("/wishlists")}
              className="bg-primary hover:bg-primary/90"
            >
              <Coins className="h-4 w-4 mr-2" />
              Add to Wishlist
            </Button>
          </div>
        </div>

        <WishlistFulfillmentPopup
          isOpen={showWishlistPopup}
          onClose={() => setShowWishlistPopup(false)}
        />
      </main>
    </div>
  );
}