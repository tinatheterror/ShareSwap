import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Search, CheckCircle, AlertCircle, MapPin, X } from "lucide-react";
import type { SelectItem } from "@db/schema";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

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
  const { toast } = useToast();
  const [, navigate] = useLocation();

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
    queryKey: userLocation ? ['/api/items/nearby', userLocation.lat, userLocation.lon, radius] : ['/api/items'],
    queryFn: async () => {
      if (userLocation) {
        const response = await fetch(
          `/api/items/nearby?latitude=${userLocation.lat}&longitude=${userLocation.lon}&radius=${radius}`
        );
        if (!response.ok) {
          console.error('Nearby items API failed, falling back to all items');
          // Fall back to all items if nearby fails
          const fallbackResponse = await fetch('/api/items');
          if (!fallbackResponse.ok) throw new Error('Failed to fetch items');
          return fallbackResponse.json();
        }
        return response.json();
      } else {
        // Fallback to all items if no location
        const response = await fetch('/api/items');
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

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Search and Location Controls */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
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

        {/* Hero Card */}
        <div className="mb-8">
          <Card className="bg-gradient-to-r from-primary to-primary/80 text-white border-0 relative overflow-hidden">
            <CardContent className="p-8">
              <div className="grid md:grid-cols-2 gap-8 items-center">
                <div>
                  <p className="text-white/80 mb-2">Local Sharing</p>
                  <h1 className="text-4xl font-bold mb-4">Hey Share!</h1>
                  <p className="text-white/90 mb-6">
                    Discover neighbourhood resources within your reach
                  </p>
                  <Button 
                    className="bg-white text-primary hover:bg-white/90 font-semibold px-6"
                    onClick={() => setSearchQuery("")}
                  >
                    Browse
                  </Button>
                </div>
                <div className="relative">
                  <div className="bg-white/20 rounded-3xl p-6 transform rotate-3">
                    <div className="bg-white rounded-2xl p-4">
                      <div className="w-full h-32 bg-gray-800 rounded-lg mb-4 flex items-center justify-center">
                        <div className="w-16 h-12 bg-gray-600 rounded"></div>
                      </div>
                      <div className="space-y-2">
                        <div className="h-2 bg-gray-200 rounded"></div>
                        <div className="h-2 bg-gray-200 rounded w-3/4"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Items Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {filteredItems.map((item) => (
            <Card key={item.id} className="hover:shadow-lg transition-shadow bg-white border border-gray-200">
              <CardContent className="p-4">
                {item.photos && item.photos[0] ? (
                  <div className="w-full h-24 mb-3 bg-gray-100 rounded-lg overflow-hidden">
                    <img
                      src={item.photos[0]}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-full h-24 mb-3 bg-gray-100 rounded-lg flex items-center justify-center">
                    <div className="w-8 h-8 bg-gray-300 rounded"></div>
                  </div>
                )}
                <h3 className="font-semibold text-sm mb-1 line-clamp-2">{item.name}</h3>
                <p className="text-xs text-muted-foreground mb-2 line-clamp-1">
                  {item.description}
                </p>
                <div className="flex items-center justify-between mb-3">
                  {item.isConditionVerified ? (
                    <Badge className="bg-green-100 text-green-800 text-xs px-2 py-1">
                      Verified
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs px-2 py-1">
                      Pending
                    </Badge>
                  )}
                  {item.distance && (
                    <span className="text-xs text-muted-foreground">
                      {item.distance.toFixed(1)}km
                    </span>
                  )}
                </div>
              </CardContent>
              <CardFooter className="p-4 pt-0">
                <Button 
                  size="sm"
                  className="w-full bg-primary hover:bg-primary/90 text-xs font-medium" 
                  disabled={!item.isConditionVerified}
                  onClick={() => navigate(`/items/${item.id}`)}
                >
                  Share
                </Button>
              </CardFooter>
            </Card>
          ))}
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
      </main>
    </div>
  );
}