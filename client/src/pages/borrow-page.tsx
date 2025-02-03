import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Search, CheckCircle, AlertCircle, MapPin } from "lucide-react";
import type { SelectItem } from "@db/schema";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

interface ItemWithDistance extends SelectItem {
  distance?: number;
}

export default function BorrowPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [radius, setRadius] = useState(10); // Default 10km radius
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Get user's location when the component mounts
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          });
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

  const { data: items = [] } = useQuery<ItemWithDistance[]>({
    queryKey: ['/api/items/nearby', userLocation?.lat, userLocation?.lon, radius],
    queryFn: async () => {
      if (!userLocation) return [];
      const response = await fetch(
        `/api/items/nearby?latitude=${userLocation.lat}&longitude=${userLocation.lon}&radius=${radius}`
      );
      if (!response.ok) throw new Error('Failed to fetch nearby items');
      return response.json();
    },
    enabled: !!userLocation,
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
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Available Items</h1>
            <p className="text-muted-foreground">
              Browse items available for borrowing
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
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <Input
                type="number"
                min="1"
                max="100"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">km radius</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {filteredItems.map((item) => (
            <Card key={item.id} className="hover:shadow-lg transition-shadow">
              <CardContent className="pt-6">
                {item.photos && item.photos[0] && (
                  <img
                    src={item.photos[0]}
                    alt={item.name}
                    className="w-full h-48 object-cover rounded-md mb-4"
                  />
                )}
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xl font-semibold">{item.name}</h3>
                  {item.isConditionVerified ? (
                    <Badge className="bg-green-100 text-green-800 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      Verified
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Pending
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  {item.description}
                </p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Condition:</span>
                    <span className="font-medium">{item.conditionRating}/10</span>
                  </div>
                  {item.lendingDuration && (
                    <div className="flex justify-between text-sm">
                      <span>Duration:</span>
                      <span className="font-medium">{item.lendingDuration} days</span>
                    </div>
                  )}
                  {item.securityDeposit && (
                    <div className="flex justify-between text-sm">
                      <span>Deposit:</span>
                      <span className="font-medium">${item.securityDeposit}</span>
                    </div>
                  )}
                  {item.distance && (
                    <div className="flex justify-between text-sm">
                      <span>Distance:</span>
                      <span className="font-medium">{item.distance.toFixed(1)} km</span>
                    </div>
                  )}
                </div>
              </CardContent>
              <CardFooter>
                <Button 
                  className="w-full" 
                  disabled={!item.isConditionVerified}
                  onClick={() => navigate(`/items/${item.id}`)}
                >
                  {item.isConditionVerified ? "View Details" : "Pending Verification"}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}