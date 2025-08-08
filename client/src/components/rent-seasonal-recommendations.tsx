import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Sun, Snowflake, Leaf, Flower, Camera } from "lucide-react";
import { useLocation } from "wouter";

interface RentSeasonalItem {
  id: number;
  name: string;
  description: string;
  photos: string[];
  dollarsPrice?: string;
  securityDeposit?: string;
  isConditionVerified: boolean;
  season?: string;
  seasonalReason?: string;
}

interface RentSeasonalRecommendationsProps {
  limit?: number;
  showTitle?: boolean;
}

export function RentSeasonalRecommendations({ limit = 6, showTitle = true }: RentSeasonalRecommendationsProps) {
  const [, navigate] = useLocation();

  const { data: seasonalItems = [], isLoading } = useQuery<RentSeasonalItem[]>({
    queryKey: ['/api/recommendations/seasonal', 'rent', limit],
    queryFn: async () => {
      const response = await fetch(`/api/recommendations/seasonal?type=rent&limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch seasonal rent recommendations');
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
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 bg-gradient-to-br from-orange-100 to-orange-200 rounded-lg animate-pulse">
            <Sun className="h-4 w-4 text-orange-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-800">All Items Available to Rent</h3>
          <div className="flex-1 h-px bg-gradient-to-r from-orange-200 to-transparent"></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse bg-white rounded-xl overflow-hidden border border-orange-100">
              <CardContent className="p-4">
                <div className="aspect-square bg-orange-100 rounded-lg mb-3"></div>
                <div className="h-4 bg-orange-100 rounded mb-2"></div>
                <div className="h-3 bg-orange-100 rounded mb-3"></div>
                <div className="h-8 bg-orange-100 rounded"></div>
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
        <div className="p-2 bg-gradient-to-br from-orange-100 to-orange-200 rounded-lg">
          <Sun className="h-4 w-4 text-orange-600" />
        </div>
        <h3 className="text-lg font-semibold text-gray-800">All Items Available to Rent</h3>
        <div className="flex-1 h-px bg-gradient-to-r from-orange-200 to-transparent"></div>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {seasonalItems.map((item) => (
          <Card key={item.id} className="group hover:shadow-md transition-all duration-300 bg-white rounded-xl overflow-hidden border border-orange-100 hover:border-orange-200 hover:-translate-y-1">
            <CardContent className="p-4">
              <div className="aspect-square bg-muted rounded-lg mb-3 overflow-hidden flex items-center justify-center relative">
                {item.photos && item.photos[0] ? (
                  <img
                    src={item.photos[0]}
                    alt={item.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <Camera className="h-8 w-8 text-gray-400" />
                )}
                {item.season && (
                  <Badge className={`absolute top-2 left-2 text-xs px-2 py-1 border flex items-center gap-1 ${getSeasonColor(item.season)}`}>
                    {getSeasonIcon(item.season)}
                    {item.season}
                  </Badge>
                )}
              </div>
              
              <div className="text-center mb-3">
                <h4 className="font-semibold text-sm mb-1 line-clamp-1">{item.name}</h4>
                <p className="text-xs text-gray-500 mb-1">
                  {item.isConditionVerified ? "Verified" : "Pending"}
                </p>
                <div className="flex items-center justify-center gap-1 mb-1">
                  <span className="text-xs font-semibold text-green-700">
                    ${Number(item.dollarsPrice || 10).toFixed(2)}/day
                  </span>
                </div>
                {item.seasonalReason && (
                  <p className="text-xs text-gray-600 italic">
                    {item.seasonalReason}
                  </p>
                )}
              </div>
              
              <Button 
                className="w-full bg-green-600 hover:bg-green-700 text-white text-sm py-2 rounded-lg group-hover:bg-green-700 transition-colors"
                disabled={!item.isConditionVerified}
                onClick={() => navigate(`/items/${item.id}`)}
              >
                {item.isConditionVerified ? "Rent Now" : "Pending"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}