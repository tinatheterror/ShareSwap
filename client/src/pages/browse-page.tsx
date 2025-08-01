import { useState } from "react";
import { CategoryBrowser } from "@/components/discovery/category-browser";
import { AdvancedFilters } from "@/components/discovery/advanced-filters";
import { VerificationBadge, UserReputation } from "@/components/trust/verification-badge";
import { Filter, MapPin, Grid, List, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface FilterState {
  distance: number[];
  priceRange: number[];
  availability: "all" | "today" | "week" | "month";
  condition: string[];
  verificationLevel: string[];
  rating: number;
  freeOnly: boolean;
}

const defaultFilters: FilterState = {
  distance: [50],
  priceRange: [0, 1000],
  availability: "all",
  condition: [],
  verificationLevel: [],
  rating: 0,
  freeOnly: false
};

// Mock data for demonstration
const mockItems = [
  {
    id: 1,
    title: "Professional Camera Kit",
    description: "Canon EOS R5 with 24-70mm lens, perfect for events",
    price: 45,
    category: "photography",
    condition: "like-new",
    location: "Downtown",
    distance: 2.3,
    owner: {
      name: "Sarah Chen",
      avatar: "SC",
      verification: "trusted" as const,
      rating: 4.9,
      reputation: 87
    },
    images: ["/api/placeholder/300/200"]
  },
  {
    id: 2,
    title: "Power Drill Set",
    description: "DeWalt 20V cordless drill with bits and case",
    price: 0,
    category: "tools",
    condition: "good",
    location: "West End",
    distance: 5.1,
    owner: {
      name: "Mike Johnson",
      avatar: "MJ",
      verification: "verified" as const,
      rating: 4.7,
      reputation: 65
    },
    images: ["/api/placeholder/300/200"]
  },
  {
    id: 3,
    title: "Mountain Bike",
    description: "Trek mountain bike, great for trails and city riding",
    price: 25,
    category: "vehicles",
    condition: "good",
    location: "North Hill",
    distance: 8.2,
    owner: {
      name: "Alex Rivera",
      avatar: "AR",
      verification: "expert" as const,
      rating: 5.0,
      reputation: 95
    },
    images: ["/api/placeholder/300/200"]
  }
];

export default function BrowsePage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showFilters, setShowFilters] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);

  const filteredItems = mockItems.filter(item => {
    if (searchTerm && !item.title.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    if (selectedCategory && item.category !== selectedCategory) {
      return false;
    }
    if (filters.freeOnly && item.price > 0) {
      return false;
    }
    if (filters.condition.length > 0 && !filters.condition.includes(item.condition)) {
      return false;
    }
    if (filters.verificationLevel.length > 0 && !filters.verificationLevel.includes(item.owner.verification)) {
      return false;
    }
    if (item.owner.rating < filters.rating) {
      return false;
    }
    if (item.distance > filters.distance[0]) {
      return false;
    }
    if (item.price < filters.priceRange[0] || item.price > filters.priceRange[1]) {
      return false;
    }
    return true;
  });

  return (
    <div className="min-h-screen pb-20">
      {/* Search Header */}
      <div className="sticky top-0 bg-white border-b z-40 p-4">
        <div className="flex gap-2 mb-3">
          <Input
            placeholder="Search items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => setShowFilters(true)}
          >
            <Filter className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="flex gap-2 items-center">
          <Button
            variant={showMap ? "default" : "outline"}
            size="sm"
            onClick={() => setShowMap(!showMap)}
          >
            <MapPin className="w-4 h-4 mr-1" />
            Map
          </Button>
          
          <div className="flex border rounded-lg">
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("grid")}
            >
              <Grid className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
          
          <div className="text-sm text-gray-600 ml-auto">
            {filteredItems.length} items
          </div>
        </div>
      </div>

      {/* Category Browser */}
      <CategoryBrowser
        onCategorySelect={setSelectedCategory}
        selectedCategory={selectedCategory}
      />

      {/* Active Filters */}
      {(selectedCategory || filters.freeOnly || filters.condition.length > 0) && (
        <div className="px-4 py-2 flex flex-wrap gap-2">
          {selectedCategory && (
            <Badge variant="secondary" className="capitalize">
              {selectedCategory}
              <button
                onClick={() => setSelectedCategory(undefined)}
                className="ml-1 hover:text-red-600"
              >
                ×
              </button>
            </Badge>
          )}
          {filters.freeOnly && (
            <Badge variant="secondary">
              Free only
              <button
                onClick={() => setFilters(prev => ({ ...prev, freeOnly: false }))}
                className="ml-1 hover:text-red-600"
              >
                ×
              </button>
            </Badge>
          )}
          {filters.condition.map(condition => (
            <Badge key={condition} variant="secondary" className="capitalize">
              {condition}
              <button
                onClick={() => setFilters(prev => ({
                  ...prev,
                  condition: prev.condition.filter(c => c !== condition)
                }))}
                className="ml-1 hover:text-red-600"
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Map View */}
      {showMap && (
        <div className="h-64 bg-gray-100 m-4 rounded-xl flex items-center justify-center">
          <div className="text-center text-gray-600">
            <MapPin className="w-12 h-12 mx-auto mb-2" />
            <p>Interactive map view</p>
            <p className="text-sm">Showing {filteredItems.length} items near you</p>
          </div>
        </div>
      )}

      {/* Items Grid/List */}
      <div className="p-4">
        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map(item => (
              <div key={item.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
                <div className="aspect-video bg-gray-100 relative">
                  {item.price === 0 && (
                    <Badge className="absolute top-2 left-2 bg-green-600">
                      FREE
                    </Badge>
                  )}
                  <div className="absolute top-2 right-2">
                    <VerificationBadge level={item.owner.verification} size="sm" showLabel={false} />
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-semibold mb-1">{item.title}</h3>
                  <p className="text-sm text-gray-600 mb-2 line-clamp-2">{item.description}</p>
                  
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1 text-sm text-gray-600">
                      <MapPin className="w-3 h-3" />
                      {item.distance} km away
                    </div>
                    <div className="flex items-center gap-1 text-sm">
                      <Star className="w-3 h-3 text-yellow-400 fill-current" />
                      {item.owner.rating}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center text-xs font-medium text-white">
                        {item.owner.avatar}
                      </div>
                      <span className="text-sm font-medium">{item.owner.name}</span>
                    </div>
                    <div className="text-right">
                      {item.price > 0 ? (
                        <div className="font-bold text-primary">${item.price}/day</div>
                      ) : (
                        <div className="font-bold text-green-600">FREE</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredItems.map(item => (
              <div key={item.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow">
                <div className="flex gap-4">
                  <div className="w-24 h-24 bg-gray-100 rounded-lg flex-shrink-0 relative">
                    {item.price === 0 && (
                      <Badge className="absolute -top-1 -right-1 bg-green-600 text-xs">
                        FREE
                      </Badge>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-1">
                      <h3 className="font-semibold truncate">{item.title}</h3>
                      <VerificationBadge level={item.owner.verification} size="sm" showLabel={false} />
                    </div>
                    <p className="text-sm text-gray-600 mb-2 line-clamp-2">{item.description}</p>
                    
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-3 text-gray-600">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {item.distance} km
                        </span>
                        <span className="flex items-center gap-1">
                          <Star className="w-3 h-3 text-yellow-400 fill-current" />
                          {item.owner.rating}
                        </span>
                      </div>
                      <div className="font-bold text-primary">
                        {item.price > 0 ? `$${item.price}/day` : "FREE"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Advanced Filters Modal */}
      {showFilters && (
        <AdvancedFilters
          filters={filters}
          onFiltersChange={setFilters}
          onClose={() => setShowFilters(false)}
        />
      )}
    </div>
  );
}