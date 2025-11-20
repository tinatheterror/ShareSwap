import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Snowflake, Sun, Leaf, Flower, Camera, Coins, MapPin } from "lucide-react";
import { useLocation } from "wouter";
import type { SelectItem } from "@db/schema";

interface SeasonalItem extends SelectItem {
  seasonalRelevance: string;
  recommendationReasons: string[];
}

interface SeasonalRecommendationsProps {
  limit?: number;
}

export function SeasonalRecommendations({ limit = 6 }: SeasonalRecommendationsProps) {
  const [, navigate] = useLocation();

  const { data: seasonalItems = [], isLoading } = useQuery<SeasonalItem[]>({
    queryKey: ['/api/recommendations/seasonal', limit],
    queryFn: async () => {
      const response = await fetch(`/api/recommendations/seasonal?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch seasonal recommendations');
      return response.json();
    },
  });

  const getSeasonIcon = (season: string) => {
    switch (season.toLowerCase()) {
      case 'winter': return <Snowflake className="h-4 w-4" />;
      case 'summer': return <Sun className="h-4 w-4" />;
      case 'fall':
      case 'autumn': return <Leaf className="h-4 w-4" />;
      case 'spring': return <Flower className="h-4 w-4" />;
      default: return <Sun className="h-4 w-4" />;
    }
  };

  const getSeasonColor = (season: string) => {
    switch (season.toLowerCase()) {
      case 'winter': return 'bg-teal-100 text-teal-800 border-teal-200';
      case 'summer': return 'bg-teal-100 text-teal-800 border-teal-200';
      case 'fall':
      case 'autumn': return 'bg-teal-100 text-teal-800 border-teal-200';
      case 'spring': return 'bg-teal-100 text-teal-800 border-teal-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 bg-gradient-to-br from-teal-100 to-teal-200 rounded-lg animate-pulse">
            <Sun className="h-4 w-4 text-teal-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-800">Seasonal Picks</h3>
          <div className="flex-1 h-px bg-gradient-to-r from-teal-200 to-transparent"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse bg-white rounded-xl overflow-hidden border border-teal-100">
              <div className="aspect-[16/9] bg-teal-100"></div>
              <CardContent className="p-6">
                <div className="h-6 bg-teal-100 rounded mb-4"></div>
                <div className="h-4 bg-teal-100 rounded mb-2"></div>
                <div className="h-4 bg-teal-100 rounded mb-4"></div>
                <div className="h-10 bg-teal-100 rounded"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (seasonalItems.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 bg-gradient-to-br from-teal-100 to-teal-200 rounded-lg">
          {getSeasonIcon(seasonalItems[0]?.seasonalRelevance || 'summer')}
        </div>
        <h3 className="text-lg font-semibold text-gray-800">
          {seasonalItems[0]?.seasonalRelevance} Picks
        </h3>
        <div className="flex-1 h-px bg-gradient-to-r from-teal-200 to-transparent"></div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {seasonalItems.map((item) => (
          <Card key={item.id} className="group hover:shadow-lg transition-all duration-300 bg-white rounded-xl overflow-hidden border border-teal-100 hover:border-teal-200">
            <div className="aspect-[16/9] bg-gray-100 flex items-center justify-center overflow-hidden relative">
              {item.photos && item.photos.length > 0 ? (
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
              <div className="absolute top-3 right-3">
                <Badge className="text-sm bg-teal-100 text-teal-800 border-teal-200">
                  {getSeasonIcon(item.seasonalRelevance)}
                  <span className="ml-1">{item.seasonalRelevance}</span>
                </Badge>
              </div>
            </div>
            
            <CardContent className="p-6 bg-gray-50">
              <h3 className="font-bold text-xl mb-3 text-slate-800">
                {item.name}
              </h3>
              
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-slate-700">
                  <MapPin className="h-4 w-4" />
                  <span className="text-sm">
                    {item.city || "Nearby"}
                  </span>
                </div>
                
                <div className="text-sm text-slate-700">
                  <span className="font-medium">Condition:</span> {item.conditionRating || 8}/10
                </div>
                
                <div className="text-sm text-slate-700">
                  <span className="font-medium">Value:</span>{" "}
                  {item.dollarsPrice && item.shareCoinPrice
                    ? `${item.shareCoinPrice} ShareCoins or $${item.dollarsPrice}/day`
                    : item.dollarsPrice
                    ? `$${item.dollarsPrice}/day`
                    : `${item.shareCoinPrice || 50} ShareCoins`}
                </div>
                
                <div className="flex flex-wrap gap-1 mt-2">
                  {item.recommendationReasons.slice(0, 2).map((reason, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs border-teal-200 text-teal-700 bg-teal-50">
                      {reason}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                {item.isLendable && (
                  <Button
                    className="bg-teal-500 hover:bg-teal-600 text-white rounded-lg px-6"
                    onClick={() => navigate(`/items/${item.id}`)}
                  >
                    Borrow It
                  </Button>
                )}
                {item.isRentable && (
                  <Button
                    className="bg-teal-500 hover:bg-teal-600 text-white rounded-lg px-6"
                    onClick={() => navigate(`/items/${item.id}`)}
                  >
                    Rent It
                  </Button>
                )}
                {item.isSwappable && (
                  <Button
                    className="bg-teal-500 hover:bg-teal-600 text-white rounded-lg px-6"
                    onClick={() => navigate(`/items/${item.id}`)}
                  >
                    Swap It
                  </Button>
                )}
                {!item.isLendable && !item.isRentable && !item.isSwappable && (
                  <Button
                    className="bg-teal-500 hover:bg-teal-600 text-white rounded-lg px-6"
                    onClick={() => navigate(`/items/${item.id}`)}
                  >
                    View Details
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}