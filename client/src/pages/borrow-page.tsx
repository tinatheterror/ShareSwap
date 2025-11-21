import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  CheckCircle,
  AlertCircle,
  MapPin,
  X,
  Camera,
  Heart,
  HandHeart,
  UserPlus,
  Coins,
  Users,
  DollarSign,
  ArrowLeftRight,
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

interface ItemWithDistance extends SelectItem {
  distance?: number;
  postalCode?: string;
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
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { user } = useAuth();

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

          // Get postal code from coordinates
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
          // Fall back to all borrow items if nearby fails
          const fallbackResponse = await fetch("/api/items?type=borrow");
          if (!fallbackResponse.ok) throw new Error("Failed to fetch items");
          return fallbackResponse.json();
        }
        return response.json();
      } else {
        // Fallback to all borrow items if no location
        const response = await fetch("/api/items?type=borrow");
        if (!response.ok) throw new Error("Failed to fetch items");
        return response.json();
      }
    },
    retry: 1,
  });

  const filteredItems = items.filter(
    (item) => {
      if (!searchQuery) return true;
      const nameMatch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const descMatch = item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase());
      return nameMatch || descMatch;
    }
  );


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
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">
              Browse the community ShareChest
            </h1>
            <p className="text-muted-foreground">
              Items available for borrowing
              {userPostalCode && ` near ${userPostalCode}`}
            </p>
          </div>
          <div className="w-full md:w-96 space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              className="w-full flex items-center gap-2"
              onClick={() => setShowLocationModal(true)}
            >
              <MapPin className="h-4 w-4" />
              {userPostalCode
                ? `${userPostalCode} (${radius}km radius)`
                : "Set Location"}
            </Button>
          </div>
        </div>


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

        {/* All Available Items */}
        <div className="mt-8">
          <h2 className="text-xl font-bold mb-4">
            {searchQuery ? `Search Results for "${searchQuery}"` : "All Items"}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {filteredItems.map((item) => (
              <Card
                key={item.id}
                className="hover:shadow-lg transition-shadow rounded-xl overflow-hidden"
                style={{ backgroundColor: '#D4F7F1' }}
              >
                <div className="aspect-[16/9] bg-gray-100 flex items-center justify-center overflow-hidden">
                  {item.photos && item.photos[0] ? (
                    <img
                      src={item.photos[0]}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                      <Camera className="h-16 w-16 text-gray-400" />
                    </div>
                  )}
                </div>
                
                <CardContent className="p-6">
                  <h3 className="font-bold text-xl mb-3 text-slate-800 truncate">
                    {item.name}
                  </h3>
                  
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-slate-700">
                      <MapPin className="h-4 w-4" />
                      <span className="text-sm">
                        {item.city || userPostalCode || "Nearby"}
                      </span>
                    </div>
                    
                    <div className="text-sm text-slate-700">
                      <span className="font-medium">Condition:</span> {item.conditionRating || 8}/10
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
                        className="bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-xs px-2 whitespace-nowrap"
                        onClick={() => navigate(`/items/${item.id}`)}
                      >
                        <Heart className="h-3 w-3 mr-0.5" />
                        Borrow It
                      </Button>
                    )}
                    {item.isRentable && (
                      <Button
                        size="sm"
                        className="bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-xs px-2 whitespace-nowrap"
                        onClick={() => navigate(`/items/${item.id}`)}
                      >
                        <DollarSign className="h-3 w-3 mr-0.5" />
                        Rent It
                      </Button>
                    )}
                    {item.isSwappable && (
                      <Button
                        size="sm"
                        className="bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-xs px-2 whitespace-nowrap"
                        onClick={() => navigate(`/items/${item.id}`)}
                      >
                        <ArrowLeftRight className="h-3 w-3 mr-0.5" />
                        Swap It
                      </Button>
                    )}
                    {!item.isLendable && !item.isRentable && !item.isSwappable && (
                      <Button
                        size="sm"
                        className="bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-xs px-2 whitespace-nowrap"
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
      </main>
    </div>
  );
}
