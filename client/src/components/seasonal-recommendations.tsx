import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Snowflake, Sun, Leaf, Flower, Camera } from "lucide-react";
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
      case 'winter': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'summer': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'fall':
      case 'autumn': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'spring': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Sun className="h-5 w-5 text-orange-500" />
          <h2 className="text-xl font-bold">Seasonal Picks</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="aspect-square bg-gray-200 rounded-lg mb-3"></div>
                <div className="h-4 bg-gray-200 rounded mb-2"></div>
                <div className="h-3 bg-gray-200 rounded mb-3"></div>
                <div className="h-8 bg-gray-200 rounded"></div>
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
      <div className="flex items-center gap-2">
        {getSeasonIcon(seasonalItems[0]?.seasonalRelevance || 'summer')}
        <h2 className="text-xl font-bold">
          {seasonalItems[0]?.seasonalRelevance} Essentials
        </h2>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {seasonalItems.map((item) => (
          <Card key={item.id} className={`hover:shadow-md transition-shadow bg-white rounded-xl overflow-hidden border ${getSeasonColor(item.seasonalRelevance)}`}>
            <CardContent className="p-4">
              <div className="aspect-square bg-muted rounded-lg mb-3 overflow-hidden flex items-center justify-center relative">
                {item.photos && item.photos.length > 0 ? (
                  <img
                    src={item.photos[0]}
                    alt={item.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center text-gray-400">
                    <Camera className="h-8 w-8" />
                  </div>
                )}
                <div className="absolute top-2 right-2">
                  <Badge className={`text-xs ${getSeasonColor(item.seasonalRelevance)}`}>
                    {getSeasonIcon(item.seasonalRelevance)}
                    <span className="ml-1">{item.seasonalRelevance}</span>
                  </Badge>
                </div>
              </div>
              
              <div className="text-center mb-3">
                <h3 className="font-semibold text-sm mb-1 line-clamp-1">{item.name}</h3>
                <div className="flex flex-wrap gap-1 justify-center mb-2">
                  {item.recommendationReasons.slice(0, 1).map((reason, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {reason}
                    </Badge>
                  ))}
                </div>
              </div>
              
              <Button 
                className="w-full text-white text-sm py-2 rounded-lg"
                disabled={!item.isConditionVerified}
                onClick={() => navigate(`/items/${item.id}`)}
                style={{
                  backgroundColor: item.seasonalRelevance.toLowerCase() === 'winter' ? '#3b82f6' :
                                   item.seasonalRelevance.toLowerCase() === 'summer' ? '#f97316' :
                                   item.seasonalRelevance.toLowerCase() === 'fall' ? '#f59e0b' : '#10b981'
                }}
              >
                {item.isConditionVerified ? "View Details" : "Pending"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}