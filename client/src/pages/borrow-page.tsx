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
  Camera,
  HandHeart,
  UserPlus,
  Coins,
  Users,
  DollarSign,
  ArrowLeftRight,
  Sparkles,
  Gift,
  Heart,
  BadgeCheck,
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
import { Recommendations } from "@/components/recommendations";
import { SeasonalRecommendations } from "@/components/seasonal-recommendations";
import { WishlistFulfillmentPopup } from "@/components/wishlist-fulfillment-popup";
import { TutorialTooltip } from "@/components/tutorial-tooltip";
import { UserBadges } from "@/components/user-badges";
import { WishlistFormDialog } from "@/components/wishlist-form-dialog";

interface ItemWithDistance extends SelectItem {
  distance?: number;
  postalCode?: string;
  owner?: {
    id: number;
    username: string;
    isVerified: boolean;
    reputationLevel: string;
  };
}

export default function BorrowPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [radius, setRadius] = useState(72); // Default 72km radius
  const [userPostalCode, setUserPostalCode] = useState<string>("");
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showWishlistPopup, setShowWishlistPopup] = useState(false);
  const [showWishlistTutorial, setShowWishlistTutorial] = useState(false);
  const [showWishlistForm, setShowWishlistForm] = useState(false);
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
      setSearchQuery(""); // Clear search after adding to wishlist
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
            description:
              "Could not get your location. Some features may be limited.",
            variant: "destructive",
          });
        },
      );
    }
  }, []);

  // Query for nearby items (location-based)
  const {
    data: nearbyItems = [],
    error: nearbyError,
    isLoading: nearbyLoading,
  } = useQuery<ItemWithDistance[]>({
    queryKey: userLocation
      ? [
          "/api/items/nearby",
          userLocation.lat,
          userLocation.lon,
          radius,
          "borrow",
        ]
      : ["/api/items", "borrow"],
    queryFn: async () => {
      if (userLocation) {
        const response = await fetch(
          `/api/items/nearby?latitude=${userLocation.lat}&longitude=${userLocation.lon}&radius=${radius}&type=borrow`,
        );
        if (!response.ok) {
          console.error("Nearby items API failed, falling back to all items");
          const fallbackResponse = await fetch("/api/items?type=borrow");
          if (!fallbackResponse.ok) throw new Error("Failed to fetch items");
          return fallbackResponse.json();
        }
        return response.json();
      } else {
        const response = await fetch("/api/items?type=borrow");
        if (!response.ok) throw new Error("Failed to fetch items");
        return response.json();
      }
    },
    retry: 1,
  });

  // Query for all items (used when searching)
  const { data: allItems = [], isLoading: allItemsLoading } = useQuery<
    ItemWithDistance[]
  >({
    queryKey: ["/api/items", "borrow", "all"],
    queryFn: async () => {
      const response = await fetch("/api/items?type=borrow");
      if (!response.ok) throw new Error("Failed to fetch items");
      return response.json();
    },
    enabled: !!searchQuery, // Only fetch when searching
  });

  // Use all items when searching, nearby items otherwise
  const items = searchQuery ? allItems : nearbyItems;
  const error = nearbyError;
  const isLoading = searchQuery ? allItemsLoading : nearbyLoading;

  // Query for gift items (free items)
  const { data: giftItems = [] } = useQuery<ItemWithDistance[]>({
    queryKey: ["/api/items", "gifts"],
    queryFn: async () => {
      const response = await fetch("/api/items?type=gift");
      if (!response.ok) throw new Error("Failed to fetch gift items");
      return response.json();
    },
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

  const filteredGiftItems = giftItems.filter((item) => {
    if (!searchQuery) return true;
    const nameMatch = item.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const descMatch =
      item.description &&
      item.description.toLowerCase().includes(searchQuery.toLowerCase());
    return nameMatch || descMatch;
  });

  // Show wishlist tutorial on first visit
  useEffect(() => {
    const hasSeenWishlistTutorial = localStorage.getItem(
      "hasSeenWishlistTutorial",
    );
    if (!hasSeenWishlistTutorial && user) {
      const timer = setTimeout(() => {
        setShowWishlistTutorial(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [user]);

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />

      {/* Hero Section with Search - Inverted bottom left, rounded bottom right */}
      <div
        className="w-full relative"
        style={{
          backgroundImage: "url('/hero-banner.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          borderBottomRightRadius: "32px",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-12 pb-6 sm:pb-8">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 sm:gap-6">
            <div className="flex-1">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1 text-black">
                Browse the community ShareChest
              </h1>
              <p className="text-sm sm:text-base text-black/90">
                A trusted collection of items available{" "}
                {userPostalCode && ` near ${userPostalCode}`}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:gap-3 w-full md:w-72">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search items..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-white rounded-lg text-sm"
                  style={{ height: "43px" }}
                />
              </div>
              <Button
                variant="outline"
                className="w-full flex items-center justify-center gap-2 bg-white hover:bg-gray-50 rounded-lg text-sm"
                onClick={() => setShowLocationModal(true)}
                style={{ height: "43px" }}
              >
                <MapPin className="h-4 w-4" />
                {userPostalCode
                  ? `${userPostalCode} (${radius}km radius)`
                  : "Set Location"}
              </Button>
            </div>
          </div>
        </div>

        {/* Inverted corner on bottom left - grey circle overlay creating cutout effect */}
        <div
          className="absolute bottom-0 left-0 w-8 h-8"
          style={{ borderTopRightRadius: "100%", backgroundColor: "#f3f4f6" }}
        />
      </div>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* AI Recommendations Section - only show when not searching */}
        {!searchQuery && (
          <div className="mb-8">
            <Recommendations limit={6} />
          </div>
        )}

        {/* Seasonal Recommendations - only show when not searching */}
        {!searchQuery && (
          <div className="mb-8">
            <SeasonalRecommendations limit={6} />
          </div>
        )}

        {/* Free Gifts Section */}
        {filteredGiftItems.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-gradient-to-br from-pink-100 to-pink-200 rounded-lg">
                <Gift className="h-4 w-4 text-pink-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-800">
                Free Gifts
              </h3>
              <Badge className="bg-pink-100 text-pink-800 border-pink-200">
                {filteredGiftItems.length} available
              </Badge>
              <div className="flex-1 h-px bg-gradient-to-r from-pink-200 to-transparent"></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {filteredGiftItems.slice(0, 4).map((item) => (
                <Card
                  key={item.id}
                  className="hover:shadow-lg transition-shadow rounded-xl overflow-hidden bg-white border-pink-100"
                >
                  <div className="p-4">
                    <div
                      className="bg-pink-50 rounded-lg flex items-center justify-center overflow-hidden relative"
                      style={{ aspectRatio: "1 / 0.9" }}
                    >
                      <Badge className="absolute top-2 right-2 bg-pink-500 text-white">
                        FREE
                      </Badge>
                      {item.photos && item.photos[0] ? (
                        <img
                          src={item.photos[0]}
                          alt={item.name}
                          className="w-full h-full object-cover rounded-lg"
                        />
                      ) : (
                        <div className="w-full h-full bg-pink-100 flex items-center justify-center rounded-lg">
                          <Gift className="h-16 w-16 text-pink-400" />
                        </div>
                      )}
                    </div>
                  </div>
                  <CardContent className="px-4 pt-0 pb-4">
                    <h3 className="font-bold text-lg mb-1 text-slate-800 truncate">
                      {item.name}
                    </h3>
                    <div className="flex items-center gap-2 text-slate-600 mb-3">
                      <MapPin className="h-3 w-3" />
                      <span className="text-sm">
                        {item.city || userPostalCode || "Nearby"}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      className="w-full bg-pink-500 hover:bg-pink-600 text-white"
                      onClick={() => navigate(`/items/${item.id}`)}
                    >
                      <Gift className="h-3 w-3 mr-1" />
                      Claim Gift
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* All Available Items */}
        <div className="mt-8">
          <h2 className="text-xl font-bold mb-4">
            {searchQuery ? `Search Results for "${searchQuery}"` : "All Items"}
          </h2>
          {filteredItems.length === 0 && searchQuery ? (
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
                <h3
                  className="text-2xl font-bold mb-2"
                  style={{ color: "#0D9488" }}
                >
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
                        description:
                          "Please sign in to add items to your wishlist.",
                        variant: "destructive",
                      });
                      navigate("/auth");
                      return;
                    }
                    setShowWishlistForm(true);
                  }}
                >
                  <Sparkles className="h-5 w-5 mr-2" />
                  Add Your Wishlist
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {filteredItems.map((item) => (
                <Card
                  key={item.id}
                  className="hover:shadow-lg transition-shadow rounded-xl overflow-hidden bg-white"
                >
                  <div className="p-4">
                    <div
                      className="bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden"
                      style={{ aspectRatio: "1 / 0.9" }}
                    >
                      {item.photos && item.photos[0] ? (
                        <img
                          src={item.photos[0]}
                          alt={item.name}
                          className="w-full h-full object-cover rounded-lg"
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-200 flex items-center justify-center rounded-lg">
                          <Camera className="h-16 w-16 text-gray-400" />
                        </div>
                      )}
                    </div>
                  </div>

                  <CardContent className="px-6 pt-0 pb-4">
                    <h3 className="font-bold text-xl text-slate-800 truncate mb-1">
                      {item.name}
                    </h3>

                    <div className="space-y-0.5 mb-3">
                      <div className="flex items-center gap-2 text-slate-700">
                        <MapPin className="h-4 w-4" />
                        <span className="text-sm">
                          {item.city || userPostalCode || "Nearby"}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-sm text-slate-700">
                        <span>
                          <span className="font-medium">Condition:</span>{" "}
                          {item.conditionRating || 8}/10
                        </span>
                        {item.owner?.isVerified && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-white text-[#0DCEA1] border border-[#0DCEA1]/20">
                            Verified Owner
                          </span>
                        )}
                      </div>

                      {(item.isLendable || item.isRentable) && (
                        <div className="flex items-center gap-2 text-sm text-slate-700">
                          <div className="flex items-center gap-1">
                            <Coins className="h-4 w-4 text-teal-600" />
                            <span>{item.shareCoinPrice || 50} ShareCoins</span>
                          </div>
                          {item.isRentable && item.dollarsPrice && (
                            <>
                              <span className="text-slate-400">|</span>
                              <div className="flex items-center">
                                <DollarSign className="h-4 w-4 text-teal-600" />
                                <span>{item.dollarsPrice}/day</span>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-1">
                      {item.isLendable && (
                        <Button
                          size="sm"
                          className="text-white rounded-lg text-xs px-2 whitespace-nowrap"
                          style={{ backgroundColor: "#0DCEA1" }}
                          onClick={() => navigate(`/items/${item.id}`)}
                        >
                          <HandHeart className="h-3 w-3 mr-0.5" />
                          Borrow It
                        </Button>
                      )}
                      {item.isRentable && (
                        <Button
                          size="sm"
                          className="text-white rounded-lg text-xs px-2 whitespace-nowrap"
                          style={{ backgroundColor: "#0DCEA1" }}
                          onClick={() => navigate(`/items/${item.id}`)}
                        >
                          <DollarSign className="h-3 w-3 mr-0.5" />
                          Rent It
                        </Button>
                      )}
                      {item.isSwappable && (
                        <Button
                          size="sm"
                          className="text-white rounded-lg text-xs px-2 whitespace-nowrap"
                          style={{ backgroundColor: "#0DCEA1" }}
                          onClick={() => navigate(`/items/${item.id}`)}
                        >
                          <ArrowLeftRight className="h-3 w-3 mr-0.5" />
                          Swap It
                        </Button>
                      )}
                      {!item.isLendable &&
                        !item.isRentable &&
                        !item.isSwappable && (
                          <Button
                            size="sm"
                            className="text-white rounded-lg text-xs px-2 whitespace-nowrap"
                            style={{ backgroundColor: "#0DCEA1" }}
                            onClick={() => navigate(`/items/${item.id}`)}
                          >
                            View
                          </Button>
                        )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {showLocationModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg w-full max-w-md">
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold">Change location</h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowLocationModal(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-muted-foreground">
                      Search by city, neighborhood or ZIP code.
                    </label>
                    <Input
                      value={userPostalCode}
                      onChange={(e) => setUserPostalCode(e.target.value)}
                      placeholder="Enter location"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">
                      Radius
                    </label>
                    <select
                      value={radius}
                      onChange={(e) => setRadius(Number(e.target.value))}
                      className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2"
                    >
                      <option value={8}>8 kilometers</option>
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
          </div>
        )}

        <WishlistFulfillmentPopup
          isOpen={showWishlistPopup}
          onClose={() => setShowWishlistPopup(false)}
        />

        {/* Wishlist Tutorial Tooltip */}
        <TutorialTooltip
          isOpen={showWishlistTutorial}
          onClose={() => {
            localStorage.setItem("hasSeenWishlistTutorial", "true");
            setShowWishlistTutorial(false);
          }}
          targetSelector="[data-tutorial='wishlist']"
          title="Can't Find What You Need?"
          description="Add items to your wishlist and we'll notify you when they become available in the community!"
          actionLabel="View Wishlist"
          onAction={() => navigate("/wishlists")}
        />

        {/* Wishlist Form Dialog */}
        <WishlistFormDialog
          isOpen={showWishlistForm}
          onClose={() => {
            setShowWishlistForm(false);
            setSearchQuery("");
          }}
          initialItemName={searchQuery}
        />
      </main>
    </div>
  );
}
