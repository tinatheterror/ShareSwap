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
import { useState, useEffect, useRef, useCallback } from "react";
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

const ITEM_CATEGORIES = [
  "Baby & Kids",
  "Clothing & Accessories",
  "Electronics",
  "Hobbies & Collectibles",
  "Home & Kitchen",
  "Tools & Equipment",
] as const;

const inferCategory = (itemName: string): string => {
  const name = itemName.toLowerCase();
  
  if (/baby|stroller|crib|diaper|toddler|kid|child|toy|pacifier|bottle|carrier/i.test(name)) {
    return "Baby & Kids";
  }
  if (/clothing|dress|shirt|pants|jacket|coat|shoes|boots|hat|scarf|bag|purse|accessory|jewelry|watch/i.test(name)) {
    return "Clothing & Accessories";
  }
  if (/phone|tablet|laptop|computer|camera|tv|television|speaker|headphone|charger|electronic|gaming|console|monitor/i.test(name)) {
    return "Electronics";
  }
  if (/camping|tent|bike|bicycle|golf|sports|game|book|guitar|instrument|hobby|collect|fishing|kayak|ski|snowboard/i.test(name)) {
    return "Hobbies & Collectibles";
  }
  if (/kitchen|blender|mixer|pot|pan|plate|utensil|furniture|chair|table|lamp|decor|vacuum|appliance|oven|microwave|fridge|toaster|coffee/i.test(name)) {
    return "Home & Kitchen";
  }
  if (/drill|saw|hammer|tool|wrench|screwdriver|mower|lawn|garden|ladder|equipment|pressure washer|generator|chainsaw/i.test(name)) {
    return "Tools & Equipment";
  }
  
  return "Other";
};

export default function BorrowPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [radius, setRadius] = useState(25); // Default 25km radius (user preference)
  const [userPostalCode, setUserPostalCode] = useState<string>("");
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showWishlistPopup, setShowWishlistPopup] = useState(false);
  const [showWishlistTutorial, setShowWishlistTutorial] = useState(false);
  const [showWishlistForm, setShowWishlistForm] = useState(false);
  const [giftCarouselIndex, setGiftCarouselIndex] = useState(0);
  const [categoryCarouselIndices, setCategoryCarouselIndices] = useState<Record<string, number>>({});
  const categoryTouchRefs = useRef<Record<string, { startX: number; endX: number }>>({});
  const giftTouchStartX = useRef(0);
  const giftTouchEndX = useRef(0);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Load saved location preferences from user profile
  useEffect(() => {
    if (user?.defaultPostalCode && !userPostalCode) {
      setUserPostalCode(user.defaultPostalCode);
    }
    if (user?.locationRadius) {
      setRadius(user.locationRadius);
    }
  }, [user?.defaultPostalCode, user?.locationRadius]);

  // Save postal code to user profile mutation
  const savePostalCodeMutation = useMutation({
    mutationFn: (postalCode: string) => {
      return apiRequest("PATCH", "/api/user-profile", { defaultPostalCode: postalCode });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
  });

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

          // Get postal code from coordinates - try BigDataCloud first, then Nominatim
          let postcode: string | null = null;
          
          // Try BigDataCloud first (better postal code coverage, no API key needed)
          try {
            const bdcResponse = await fetch(
              `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
            );
            if (bdcResponse.ok) {
              const bdcData = await bdcResponse.json();
              postcode = bdcData.postcode || null;
            }
          } catch (e) {
            console.log("BigDataCloud failed, trying Nominatim...");
          }
          
          // Fallback to OpenStreetMap Nominatim if BigDataCloud didn't return postal code
          if (!postcode) {
            try {
              const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`,
                {
                  headers: {
                    "User-Agent": "ShareSwap/1.0",
                  },
                },
              );
              if (response.ok) {
                const data = await response.json();
                postcode = data.address?.postcode || data.address?.postal_code || null;
              }
            } catch (error) {
              console.error("Error getting postal code:", error);
            }
          }
          
          if (postcode) {
            setUserPostalCode(postcode);
          } else {
            console.log("Could not determine postal code from coordinates");
          }
        },
        async (error: GeolocationPositionError) => {
          console.log("Geolocation error, falling back to saved location:", error.message);
          
          // Fall back to geocoding user's saved postal code or city
          if (user?.defaultPostalCode || user?.defaultCity) {
            const query = user.defaultPostalCode || user.defaultCity || "";
            try {
              const response = await fetch(`/api/geo/geocode?query=${encodeURIComponent(query)}`);
              if (response.ok) {
                const data = await response.json();
                if (data.lat && data.lon) {
                  setUserLocation({ lat: data.lat, lon: data.lon });
                  setUserPostalCode(user.defaultPostalCode || "");
                  console.log("Using geocoded saved location:", data);
                  return; // Success - no error message needed
                }
              }
            } catch (e) {
              console.log("Geocoding failed:", e);
            }
          }
          
          // Only show error if we couldn't fall back to saved location
          if (error.code === 1 && !user?.defaultPostalCode && !user?.defaultCity) {
            toast({
              title: "Location Needed",
              description: "Enable location or set your city in settings for nearby items.",
              variant: "default",
            });
          }
        },
        {
          enableHighAccuracy: false,
          timeout: 30000,
          maximumAge: 600000,
        }
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
        ]
      : ["/api/items", "all"],
    queryFn: async () => {
      if (userLocation) {
        const response = await fetch(
          `/api/items/nearby?latitude=${userLocation.lat}&longitude=${userLocation.lon}&radius=${radius}`,
        );
        if (!response.ok) {
          console.error("Nearby items API failed, falling back to all items");
          const fallbackResponse = await fetch("/api/items");
          if (!fallbackResponse.ok) throw new Error("Failed to fetch items");
          return fallbackResponse.json();
        }
        return response.json();
      } else {
        const response = await fetch("/api/items");
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
    queryKey: ["/api/items", "search", "all"],
    queryFn: async () => {
      const response = await fetch("/api/items");
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

  const handleGiftTouchStart = useCallback((e: React.TouchEvent) => {
    giftTouchStartX.current = e.touches[0].clientX;
  }, []);

  const handleGiftTouchMove = useCallback((e: React.TouchEvent) => {
    giftTouchEndX.current = e.touches[0].clientX;
  }, []);

  const handleGiftTouchEnd = useCallback(() => {
    const diff = giftTouchStartX.current - giftTouchEndX.current;
    const threshold = 50;

    if (diff > threshold && giftCarouselIndex < filteredGiftItems.length - 1) {
      setGiftCarouselIndex(prev => prev + 1);
    } else if (diff < -threshold && giftCarouselIndex > 0) {
      setGiftCarouselIndex(prev => prev - 1);
    }
  }, [giftCarouselIndex, filteredGiftItems.length]);

  // Group items by category (infer from name if no category set)
  // Sort items with photos first within each category
  const itemsByCategory = ITEM_CATEGORIES.reduce((acc, category) => {
    const categoryItems = filteredItems.filter(item => {
      const itemCategory = (item as any).category || inferCategory(item.name);
      return itemCategory === category;
    });
    // Sort: items with photos first
    acc[category] = categoryItems.sort((a, b) => {
      const aHasPhoto = a.photos && a.photos.length > 0 && a.photos[0] ? 1 : 0;
      const bHasPhoto = b.photos && b.photos.length > 0 && b.photos[0] ? 1 : 0;
      return bHasPhoto - aHasPhoto;
    });
    return acc;
  }, {} as Record<string, ItemWithDistance[]>);

  // Category carousel handlers
  const handleCategoryTouchStart = useCallback((category: string, e: React.TouchEvent) => {
    if (!categoryTouchRefs.current[category]) {
      categoryTouchRefs.current[category] = { startX: 0, endX: 0 };
    }
    categoryTouchRefs.current[category].startX = e.touches[0].clientX;
  }, []);

  const handleCategoryTouchMove = useCallback((category: string, e: React.TouchEvent) => {
    if (!categoryTouchRefs.current[category]) {
      categoryTouchRefs.current[category] = { startX: 0, endX: 0 };
    }
    categoryTouchRefs.current[category].endX = e.touches[0].clientX;
  }, []);

  const handleCategoryTouchEnd = useCallback((category: string, maxIndex: number) => {
    const refs = categoryTouchRefs.current[category];
    if (!refs) return;
    
    const diff = refs.startX - refs.endX;
    const threshold = 50;
    const currentIndex = categoryCarouselIndices[category] || 0;

    if (diff > threshold && currentIndex < maxIndex) {
      setCategoryCarouselIndices(prev => ({ ...prev, [category]: currentIndex + 1 }));
    } else if (diff < -threshold && currentIndex > 0) {
      setCategoryCarouselIndices(prev => ({ ...prev, [category]: currentIndex - 1 }));
    }
  }, [categoryCarouselIndices]);

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
        className="w-full relative -mt-[1px] bg-cover bg-bottom sm:bg-center rounded-b-[32px]"
        style={{
          backgroundImage: "url('/hero-banner.png')",
        }}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-4 pb-16 sm:py-10">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-1.5 sm:gap-6">
            <div className="flex-1">
              <h1 className="text-lg sm:text-3xl md:text-4xl font-bold mb-0 sm:mb-1 text-black">
                Browse the community ShareChest
              </h1>
              <p className="text-[11px] sm:text-base text-black/90">
                A trusted collection of items available{" "}
                {userPostalCode && ` near ${userPostalCode}`}
              </p>
            </div>

            <div className="flex flex-col gap-1 sm:gap-3 w-full md:w-72">
              <div className="relative">
                <Search className="absolute left-2 top-1.5 sm:top-2.5 h-3 w-3 sm:h-4 sm:w-4 text-gray-400" />
                <Input
                  placeholder="Search items..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-7 sm:pl-9 bg-white rounded-lg text-[11px] sm:text-sm h-6 sm:h-[43px]"
                />
              </div>
              <Button
                variant="outline"
                className="w-full flex items-center justify-center gap-1 sm:gap-2 bg-white hover:bg-gray-50 rounded-lg text-[11px] sm:text-sm h-6 sm:h-[43px]"
                onClick={() => setShowLocationModal(true)}
              >
                <MapPin className="h-3 w-3 sm:h-4 sm:w-4" />
                {userPostalCode
                  ? `${userPostalCode} (${radius}km radius)`
                  : "Set Location"}
              </Button>
            </div>
          </div>
        </div>

        {/* Inverted corner on bottom left - grey circle overlay creating cutout effect */}
        <div
          className="absolute bottom-0 left-0 w-6 h-6 sm:w-8 sm:h-8"
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
            
            {/* Mobile: Swipeable carousel */}
            <div className="md:hidden">
              <div
                className="touch-pan-y"
                onTouchStart={handleGiftTouchStart}
                onTouchMove={handleGiftTouchMove}
                onTouchEnd={handleGiftTouchEnd}
              >
                {filteredGiftItems[giftCarouselIndex] && (
                  <Card className="hover:shadow-lg transition-shadow rounded-xl overflow-hidden bg-white border-pink-100">
                    <div className="p-4">
                      <div
                        className="bg-pink-50 rounded-lg flex items-center justify-center overflow-hidden relative aspect-square"
                      >
                        <Badge className="absolute top-2 right-2 bg-pink-500 text-white text-xs">
                          FREE
                        </Badge>
                        {filteredGiftItems[giftCarouselIndex].photos && filteredGiftItems[giftCarouselIndex].photos[0] ? (
                          <img
                            src={filteredGiftItems[giftCarouselIndex].photos[0]}
                            alt={filteredGiftItems[giftCarouselIndex].name}
                            className="w-full h-full object-cover rounded-lg"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              target.parentElement?.classList.add('bg-pink-100', 'flex', 'items-center', 'justify-center');
                              const icon = document.createElement('div');
                              icon.innerHTML = '<svg class="h-16 w-16 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"></path></svg>';
                              target.parentElement?.appendChild(icon);
                            }}
                          />
                        ) : (
                          <div className="w-full h-full bg-pink-100 flex items-center justify-center rounded-lg">
                            <Gift className="h-16 w-16 text-pink-400" />
                          </div>
                        )}
                      </div>
                    </div>
                    <CardContent className="px-4 pt-0 pb-4">
                      <h3 className="font-bold text-xl mb-1 text-slate-800 truncate">
                        {filteredGiftItems[giftCarouselIndex].name}
                      </h3>
                      <div className="flex items-center gap-2 text-slate-600 mb-3">
                        <MapPin className="h-4 w-4" />
                        <span className="text-sm">
                          {filteredGiftItems[giftCarouselIndex].city || userPostalCode || "Nearby"}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        className="w-full bg-pink-500 hover:bg-pink-600 text-white text-sm h-10"
                        onClick={() => navigate(`/items/${filteredGiftItems[giftCarouselIndex].id}`)}
                      >
                        <Gift className="h-4 w-4 mr-1" />
                        Claim Gift
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
              
              {/* Dot indicators */}
              {filteredGiftItems.length > 1 && (
                <div className="flex justify-center gap-1.5 mt-3">
                  {filteredGiftItems.slice(0, 6).map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setGiftCarouselIndex(index)}
                      className={`w-2 h-2 rounded-full transition-all ${
                        index === giftCarouselIndex 
                          ? 'bg-pink-500 w-4' 
                          : 'bg-gray-300'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
            
            {/* Desktop: Grid layout */}
            <div className="hidden md:grid md:grid-cols-4 gap-4">
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
                      <Badge className="absolute top-2 right-2 bg-pink-500 text-white text-xs">
                        FREE
                      </Badge>
                      {item.photos && item.photos[0] ? (
                        <img
                          src={item.photos[0]}
                          alt={item.name}
                          className="w-full h-full object-cover rounded-lg"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            target.parentElement?.classList.add('bg-pink-100', 'flex', 'items-center', 'justify-center');
                            const icon = document.createElement('div');
                            icon.innerHTML = '<svg class="h-16 w-16 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"></path></svg>';
                            target.parentElement?.appendChild(icon);
                          }}
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
                      className="w-full bg-pink-500 hover:bg-pink-600 text-white text-xs h-8"
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

        {/* Items by Category - Mobile Carousels, Desktop Grid */}
        <div className="mt-8">
          {searchQuery && (
            <h2 className="text-xl font-bold mb-4">
              Search Results for "{searchQuery}"
            </h2>
          )}
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
            <>
              {/* Mobile: Category Carousels */}
              <div className="md:hidden space-y-6">
                {ITEM_CATEGORIES.map((category) => {
                  const categoryItems = itemsByCategory[category] || [];
                  if (categoryItems.length === 0) return null;
                  
                  const currentIndex = categoryCarouselIndices[category] || 0;
                  const currentItem = categoryItems[currentIndex];
                  
                  return (
                    <div key={category} className="mb-6">
                      <h3 className="text-lg font-bold mb-3 text-slate-800">{category}</h3>
                      
                      <div
                        className="touch-pan-x"
                        onTouchStart={(e) => handleCategoryTouchStart(category, e)}
                        onTouchMove={(e) => handleCategoryTouchMove(category, e)}
                        onTouchEnd={() => handleCategoryTouchEnd(category, categoryItems.length - 1)}
                      >
                        {currentItem && (
                          <Card className="hover:shadow-lg transition-shadow rounded-xl overflow-hidden bg-white">
                            <div className="p-3">
                              <div
                                className="bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden"
                                style={{ aspectRatio: "1 / 0.9" }}
                              >
                                {currentItem.photos && currentItem.photos[0] ? (
                                  <img
                                    src={currentItem.photos[0]}
                                    alt={currentItem.name}
                                    className="w-full h-full object-cover rounded-lg"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement;
                                      target.style.display = 'none';
                                      target.parentElement?.classList.add('bg-gray-200', 'flex', 'items-center', 'justify-center');
                                      const icon = document.createElement('div');
                                      icon.innerHTML = '<svg class="h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>';
                                      target.parentElement?.appendChild(icon);
                                    }}
                                  />
                                ) : (
                                  <div className="w-full h-full bg-gray-200 flex items-center justify-center rounded-lg">
                                    <Camera className="h-12 w-12 text-gray-400" />
                                  </div>
                                )}
                              </div>
                            </div>
                            <CardContent className="px-3 pt-0 pb-3">
                              <h4 className="font-bold text-lg text-slate-800 truncate mb-1">
                                {currentItem.name}
                              </h4>
                              <div className="space-y-1 mb-2">
                                <div className="flex items-center gap-2 text-slate-700">
                                  <MapPin className="h-4 w-4" />
                                  <span className="text-sm">
                                    {currentItem.city || userPostalCode || "Nearby"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-slate-700">
                                  <span>
                                    <span className="font-medium">Condition:</span> {currentItem.conditionRating || 8}/10
                                  </span>
                                  {currentItem.owner?.isVerified && (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-white text-[#0DCEA1] border border-[#0DCEA1]/20">
                                      Verified
                                    </span>
                                  )}
                                </div>
                                {(currentItem.isLendable || currentItem.isRentable) && (
                                  <div className="flex items-center gap-2 text-sm text-slate-700">
                                    <div className="flex items-center gap-1">
                                      <Coins className="h-4 w-4 text-teal-600" />
                                      <span>{currentItem.shareCoinPrice || currentItem.shareCoinsReward || "5"} ShareCoins</span>
                                    </div>
                                    {currentItem.isRentable && (
                                      <>
                                        <span className="text-slate-400">|</span>
                                        <div className="flex items-center">
                                          <DollarSign className="h-4 w-4 text-teal-600" />
                                          <span>${Number(currentItem.dollarsPrice || 10).toFixed(2)}/day</span>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex gap-2">
                                {currentItem.isLendable && (
                                  <Button
                                    size="sm"
                                    className="flex-1 text-white rounded-lg text-xs"
                                    style={{ backgroundColor: "#0DCEA1" }}
                                    onClick={() => navigate(`/items/${currentItem.id}`)}
                                  >
                                    <HandHeart className="h-3 w-3 mr-1" />
                                    Borrow
                                  </Button>
                                )}
                                {currentItem.isRentable && (
                                  <Button
                                    size="sm"
                                    className="flex-1 text-white rounded-lg text-xs"
                                    style={{ backgroundColor: "#0DCEA1" }}
                                    onClick={() => navigate(`/items/${currentItem.id}`)}
                                  >
                                    <DollarSign className="h-3 w-3 mr-1" />
                                    Rent
                                  </Button>
                                )}
                                {currentItem.isSwappable && (
                                  <Button
                                    size="sm"
                                    className="flex-1 text-white rounded-lg text-xs"
                                    style={{ backgroundColor: "#0DCEA1" }}
                                    onClick={() => navigate(`/items/${currentItem.id}`)}
                                  >
                                    <ArrowLeftRight className="h-3 w-3 mr-1" />
                                    Swap
                                  </Button>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                      
                      {/* Dot indicators */}
                      {categoryItems.length > 1 && (
                        <div className="flex justify-center gap-1.5 mt-3">
                          {categoryItems.slice(0, 8).map((_, index) => (
                            <button
                              key={index}
                              onClick={() => setCategoryCarouselIndices(prev => ({ ...prev, [category]: index }))}
                              className={`w-2 h-2 rounded-full transition-all ${
                                index === currentIndex 
                                  ? 'bg-teal-500 w-4' 
                                  : 'bg-gray-300'
                              }`}
                            />
                          ))}
                          {categoryItems.length > 8 && (
                            <span className="text-xs text-gray-400 ml-1">+{categoryItems.length - 8}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              
              {/* Desktop: Grid Layout */}
              <div className="hidden md:grid md:grid-cols-4 gap-6">
              {filteredItems.map((item) => (
                <Card
                  key={item.id}
                  className="hover:shadow-lg transition-shadow rounded-xl overflow-hidden bg-white"
                >
                  <div className="p-2 md:p-4">
                    <div
                      className="bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden"
                      style={{ aspectRatio: "1 / 0.9" }}
                    >
                      {item.photos && item.photos[0] ? (
                        <img
                          src={item.photos[0]}
                          alt={item.name}
                          className="w-full h-full object-cover rounded-lg"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            target.parentElement?.classList.add('bg-gray-200', 'flex', 'items-center', 'justify-center');
                            const icon = document.createElement('div');
                            icon.innerHTML = '<svg class="h-10 w-10 md:h-16 md:w-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>';
                            target.parentElement?.appendChild(icon);
                          }}
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-200 flex items-center justify-center rounded-lg">
                          <Camera className="h-10 w-10 md:h-16 md:w-16 text-gray-400" />
                        </div>
                      )}
                    </div>
                  </div>

                  <CardContent className="px-3 md:px-6 pt-0 pb-2 md:pb-4">
                    <h3 className="font-bold text-sm md:text-xl text-slate-800 truncate mb-0.5 md:mb-1">
                      {item.name}
                    </h3>

                    <div className="space-y-0 md:space-y-0.5 mb-1.5 md:mb-3">
                      <div className="flex items-center gap-1 md:gap-2 text-slate-700">
                        <MapPin className="h-3 w-3 md:h-4 md:w-4" />
                        <span className="text-xs md:text-sm">
                          {item.city || userPostalCode || "Nearby"}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 md:gap-2 text-xs md:text-sm text-slate-700">
                        <span>
                          <span className="font-medium">Condition:</span>{" "}
                          {item.conditionRating || 8}/10
                        </span>
                        {item.owner?.isVerified && (
                          <span className="text-[10px] md:text-xs px-1 md:px-1.5 py-0.5 rounded bg-white text-[#0DCEA1] border border-[#0DCEA1]/20">
                            Verified Owner
                          </span>
                        )}
                      </div>

                      {(item.isLendable || item.isRentable) && (
                        <div className="flex items-center gap-1 md:gap-2 text-xs md:text-sm text-slate-700">
                          <div className="flex items-center gap-0.5 md:gap-1">
                            <Coins className="h-3 w-3 md:h-4 md:w-4 text-teal-600" />
                            <span>{item.shareCoinPrice || item.shareCoinsReward || "5"} ShareCoins</span>
                          </div>
                          {item.isRentable && (
                            <>
                              <span className="text-slate-400">|</span>
                              <div className="flex items-center">
                                <DollarSign className="h-3 w-3 md:h-4 md:w-4 text-teal-600" />
                                <span>${Number(item.dollarsPrice || 10).toFixed(2)}/day</span>
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
                          className="text-white rounded-lg text-[10px] md:text-xs px-1.5 md:px-2 h-6 md:h-8 whitespace-nowrap"
                          style={{ backgroundColor: "#0DCEA1" }}
                          onClick={() => navigate(`/items/${item.id}`)}
                        >
                          <HandHeart className="h-2.5 w-2.5 md:h-3 md:w-3 mr-0.5" />
                          Borrow It
                        </Button>
                      )}
                      {item.isRentable && (
                        <Button
                          size="sm"
                          className="text-white rounded-lg text-[10px] md:text-xs px-1.5 md:px-2 h-6 md:h-8 whitespace-nowrap"
                          style={{ backgroundColor: "#0DCEA1" }}
                          onClick={() => navigate(`/items/${item.id}`)}
                        >
                          <DollarSign className="h-2.5 w-2.5 md:h-3 md:w-3 mr-0.5" />
                          Rent It
                        </Button>
                      )}
                      {item.isSwappable && (
                        <Button
                          size="sm"
                          className="text-white rounded-lg text-[10px] md:text-xs px-1.5 md:px-2 h-6 md:h-8 whitespace-nowrap"
                          style={{ backgroundColor: "#0DCEA1" }}
                          onClick={() => navigate(`/items/${item.id}`)}
                        >
                          <ArrowLeftRight className="h-2.5 w-2.5 md:h-3 md:w-3 mr-0.5" />
                          Swap It
                        </Button>
                      )}
                      {!item.isLendable &&
                        !item.isRentable &&
                        !item.isSwappable && (
                          <Button
                            size="sm"
                            className="text-white rounded-lg text-[10px] md:text-xs px-1.5 md:px-2 h-6 md:h-8 whitespace-nowrap"
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
            </>
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
                      Search by city, neighbourhood or postal code.
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
                  onClick={() => {
                    // Save location to user profile if logged in
                    if (user && userPostalCode) {
                      savePostalCodeMutation.mutate(userPostalCode);
                    }
                    setShowLocationModal(false);
                  }}
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
          description="Add it to your wishlist and get notified when it is available in the community!"
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
