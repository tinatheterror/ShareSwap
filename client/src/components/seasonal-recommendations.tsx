import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Snowflake, Sun, Leaf, Flower, Camera, Coins, MapPin, Heart, DollarSign, ArrowLeftRight } from "lucide-react";
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
          <Card key={item.id} className="hover:shadow-lg transition-shadow rounded-xl overflow-hidden" style={{ backgroundColor: '#D4F7F1' }}>
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
            
            <CardContent className="px-6 pt-6 pb-4">
              <h3 className="font-bold text-xl mb-2 text-slate-800 truncate">
                {item.name}
              </h3>
              
              <div className="space-y-1 mb-3">
                <div className="flex items-center gap-2 text-slate-700">
                  <MapPin className="h-4 w-4" />
                  <span className="text-sm">
                    {item.city || "Nearby"}
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
  );
}