import { useState, useEffect, useMemo } from "react";
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Search, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { SelectItem } from "@db/schema";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Recommendations } from "@/components/recommendations";
import { SeasonalRecommendations } from "@/components/seasonal-recommendations";

interface SwappableItem extends SelectItem {
  distance?: number;
  postalCode?: string;
}

export default function SwapPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showInventoryPrompt, setShowInventoryPrompt] = useState(false);
  const [, navigate] = useLocation();
  const { user } = useAuth();
  
  console.log('SwapPage render - searchQuery:', searchQuery);

  const { data: items = [], isLoading } = useQuery<SwappableItem[]>({
    queryKey: ['/api/items', 'swap'],
    queryFn: async () => {
      const response = await fetch('/api/items?type=swap');
      if (!response.ok) throw new Error('Failed to fetch swappable items');
      return response.json();
    },
  });

  // Check user's inventory (items they own)
  const { data: userItems = [] } = useQuery<SelectItem[]>({
    queryKey: ['/api/user-items'],
    queryFn: async () => {
      const response = await fetch('/api/items');
      if (!response.ok) throw new Error('Failed to fetch items');
      const allItems = await response.json();
      return allItems.filter((item: SelectItem) => item.ownerId === user?.id);
    },
    enabled: !!user?.id,
  });

  // Items are already filtered for swappable on the backend
  const swappableItems = items;
  
  // Debug logging
  console.log('Total items:', items.length);
  console.log('Swappable items:', swappableItems.length);
  console.log('Search query:', searchQuery);
  
  const filteredItems = useMemo(() => {
    console.log('Computing filtered items with searchQuery:', searchQuery);
    if (searchQuery.trim() === '') {
      return swappableItems;
    }
    
    const searchLower = searchQuery.toLowerCase().trim();
    const filtered = swappableItems.filter(item => {
      const nameMatch = (item.name || '').toLowerCase().includes(searchLower);
      const descMatch = (item.description || '').toLowerCase().includes(searchLower);
      const result = nameMatch || descMatch;
      console.log(`Filtering "${item.name}" with "${searchQuery}": nameMatch=${nameMatch}, descMatch=${descMatch}, result=${result}`);
      return result;
    });
    
    console.log('Filtered results:', filtered.length, 'out of', swappableItems.length);
    return filtered;
  }, [swappableItems, searchQuery]);
  
  console.log('Filtered items count:', filteredItems.length);

  // Check user's inventory when component mounts
  useEffect(() => {
    if (user && userItems.length === 0 && !isLoading) {
      setShowInventoryPrompt(true);
    }
  }, [user, userItems.length, isLoading]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <ArrowLeftRight className="h-12 w-12 text-teal-600" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Item Swapping</h1>
          <p className="text-muted-foreground">
            Exchange items with other community members
          </p>
        </div>

        {/* Search and Filters */}
        <div className="flex gap-4 mb-6 max-w-2xl mx-auto">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Search swappable items..."
              value={searchQuery}
              onChange={(e) => {
                console.log('Search input changed:', e.target.value);
                setSearchQuery(e.target.value);
              }}
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

        <div>
          <h2 className="text-xl font-bold mb-4">
            All Swappable Items
            <span className="text-sm font-normal text-muted-foreground ml-2">
              (Search: "{searchQuery}" | Showing {filteredItems.length} of {swappableItems.length} items)
            </span>
          </h2>
        </div>

        {/* Items Grid */}
        {filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <ArrowLeftRight className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">No swappable items found</h3>
            <p className="text-gray-500 mb-4">
              {swappableItems.length === 0 
                ? "No items are currently available for swapping"
                : "Try adjusting your search terms"
              }
            </p>
            <Button onClick={() => navigate("/lend")}>
              List an Item for Swapping
            </Button>
          </div>
        ) : (
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
                        <ArrowLeftRight className="h-8 w-8 text-gray-400" />
                      </div>
                    )}
                  </div>
                  
                  <div className="text-center mb-3">
                    <h3 className="font-semibold text-sm mb-1 line-clamp-1">{item.name}</h3>
                    <div className="flex justify-center mb-2">
                      <Badge className="bg-teal-100 text-teal-800 text-xs">Swappable</Badge>
                    </div>
                    <p className="text-xs text-gray-600">
                      {item.distance ? `${item.distance.toFixed(1)}km away` : "Nearby"}
                    </p>
                  </div>
                  
                  <Button 
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white text-sm py-2 rounded-lg"
                    onClick={() => navigate(`/items/${item.id}`)}
                  >
                    Propose Swap
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Inventory Prompt */}
        <Dialog open={showInventoryPrompt} onOpenChange={setShowInventoryPrompt}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>📦 Empty ShareChest</DialogTitle>
              <DialogDescription>
                You have 0 items in your ShareChest to swap. Would you like to add an item?
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-3 mt-4">
              <Button
                variant="outline"
                onClick={() => setShowInventoryPrompt(false)}
                className="flex-1"
              >
                Browse Anyway
              </Button>
              <Button
                onClick={() => navigate("/lend")}
                className="flex-1"
              >
                Add an Item
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}