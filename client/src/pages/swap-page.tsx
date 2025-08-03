import { useState } from "react";
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Search, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { SelectItem } from "@db/schema";
import { useLocation } from "wouter";

interface SwappableItem extends SelectItem {
  distance?: number;
  postalCode?: string;
}

export default function SwapPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [, navigate] = useLocation();

  const { data: items = [], isLoading } = useQuery<SwappableItem[]>({
    queryKey: ['/api/items'],
  });

  // Filter for swappable items only
  const swappableItems = items.filter(item => item.isSwappable);
  
  const filteredItems = swappableItems.filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button variant="outline" size="icon">
            <Filter className="h-4 w-4" />
          </Button>
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
                      <Badge className="bg-purple-100 text-purple-800 text-xs">Swappable</Badge>
                    </div>
                    <p className="text-xs text-gray-600">
                      {item.distance ? `${item.distance.toFixed(1)}km away` : "Nearby"}
                    </p>
                  </div>
                  
                  <Button 
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white text-sm py-2 rounded-lg"
                    onClick={() => navigate(`/items/${item.id}`)}
                  >
                    Propose Swap
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}