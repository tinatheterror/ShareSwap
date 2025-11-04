import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Search, CheckCircle, AlertCircle, MapPin, X, Camera, Heart, HandHeart } from "lucide-react";
import type { SelectItem } from "@db/schema";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Recommendations } from "@/components/recommendations";
import { SeasonalRecommendations } from "@/components/seasonal-recommendations";
import { WishlistFulfillmentPopup } from "@/components/wishlist-fulfillment-popup";
import { Coins } from "lucide-react";

interface ItemWithDistance extends SelectItem {
  distance?: number;
  postalCode?: string;
}

export default function BorrowPage() {
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
              `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
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
            description: "Could not get your location. Some features may be limited.",
            variant: "destructive",
          });
        }
      );
    }
  }, []);

  const { data: items = [], error, isLoading } = useQuery<ItemWithDistance[]>({
    queryKey: userLocation ? ['/api/items/nearby', userLocation.lat, userLocation.lon, radius, 'borrow'] : ['/api/items', 'borrow'],
    queryFn: async () => {
      if (userLocation) {
        const response = await fetch(
          `/api/items/nearby?latitude=${userLocation.lat}&longitude=${userLocation.lon}&radius=${radius}&type=borrow`
        );
        if (!response.ok) {
          console.error('Nearby items API failed, falling back to all items');
          // Fall back to all borrow items if nearby fails
          const fallbackResponse = await fetch('/api/items?type=borrow');
          if (!fallbackResponse.ok) throw new Error('Failed to fetch items');
          return fallbackResponse.json();
        }
        return response.json();
      } else {
        // Fallback to all borrow items if no location
        const response = await fetch('/api/items?type=borrow');
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

  // Get items from followed users
  const { data: followingItems = [] } = useQuery<ItemWithDistance[]>({
    queryKey: ['/api/feed/following-items'],
    enabled: !!user,
  });

  // Check ShareCoins when component mounts
  useEffect(() => {
    if (user && Number(user.shareCoins) === 0) {
      setShowShareCoinsPrompt(true);
    }
  }, [user]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Available Items</h1>
            <p className="text-muted-foreground">
              Browse items available for borrowing
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
              {userPostalCode ? `${userPostalCode} (${radius}km radius)` : "Set Location"}
            </Button>
          </div>
        </div>

        {/* From People You Follow Section */}
        {user && followingItems.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Heart className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-bold">From People You Follow</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {followingItems.slice(0, 8).map((item) => (
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
                      <h3 className="font-semibold text-sm mb-1 line-clamp-1">{item.name}</h3>
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                        {item.description}
                      </p>
                      {(item as any).owner && (
                        <p className="text-xs text-primary font-medium mb-2">
                          by @{(item as any).owner.username}
                        </p>
                      )}
                      <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                        <CheckCircle className="h-3 w-3" />
                        Condition: {item.conditionRating}/10
                      </div>
                    </div>

                    <Link href={`/item/${item.id}/borrow`}>
                      <Button size="sm" className="w-full bg-primary hover:bg-primary/90">
                        Borrow
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Empty state for no followed users */}
        {user && followingItems.length === 0 && (
          <div className="mb-8 p-6 bg-teal-50 border-2 border-teal-200 rounded-lg text-center">
            <Heart className="h-12 w-12 text-teal-600 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-teal-900 mb-2">
              Follow neighbors to see their items here
            </h3>
            <p className="text-sm text-teal-700">
              When you follow other users, their newly posted items will appear in this feed
            </p>
          </div>
        )}

        {/* AI Recommendations Section */}
        <div className="mb-8">
          <Recommendations limit={6} />
        </div>

        {/* Seasonal Recommendations */}
        <div className="mb-8">
          <SeasonalRecommendations limit={6} />
        </div>

        {/* All Available Items */}
        <div className="mt-8">
          <h2 className="text-xl font-bold mb-4">All Items Available to Borrow</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                  <h3 className="font-semibold text-sm mb-1 line-clamp-1">{item.name}</h3>
                  <p className="text-xs text-gray-500 mb-1">
                    {item.isConditionVerified ? "Verificato" : "Reserveret"}
                  </p>
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Coins className="h-3 w-3 text-teal-600" />
                    <span className="text-xs font-semibold text-teal-700">
                      {item.shareCoinPrice || 5} ShareCoins
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">
                    {item.distance ? `${item.distance.toFixed(1)}km` : "Nearby"}
                  </p>
                </div>
                
                <Button 
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white text-sm py-2 rounded-lg"
                  disabled={!item.isConditionVerified}
                  onClick={() => navigate(`/items/${item.id}`)}
                >
                  {item.isConditionVerified ? "Share" : "Pending"}
                </Button>
              </CardContent>
            </Card>
          ))}
          </div>
        </div>

        {/* ShareCoins Prompt */}
        <Dialog open={showShareCoinsPrompt} onOpenChange={setShowShareCoinsPrompt}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>💰 Need ShareCoins to Borrow</DialogTitle>
              <DialogDescription>
                You have 0 ShareCoins to borrow items. Would you like to lend something out to earn ShareCoins?
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
                onClick={() => navigate("/lend")}
                className="flex-1"
              >
                Lend an Item
              </Button>
            </div>
          </DialogContent>
        </Dialog>

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
                    <label className="text-sm text-muted-foreground">Radius</label>
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

        {/* ShareCoin earning opportunity */}
        <div className="mt-8 bg-gradient-to-r from-primary/10 to-primary/5 p-6 rounded-lg border border-primary/20">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-primary mb-2">
              Can't find what you need?
            </h3>
            <p className="text-primary/80 mb-4">
              Add it to your wishlist and we'll notify you when it becomes available!
            </p>
            <Link href="/wishlists">
              <Button className="bg-primary hover:bg-primary/90">
                <Heart className="h-4 w-4 mr-2" />
                Add to Wishlist
              </Button>
            </Link>
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