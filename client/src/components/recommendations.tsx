import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Camera, Coins, MapPin, HandHeart, DollarSign, ArrowLeftRight } from "lucide-react";
import { useLocation } from "wouter";
import type { SelectItem } from "@db/schema";

interface RecommendedItem extends SelectItem {
  recommendationScore: number;
  recommendationReasons: string[];
}

interface RecommendationsProps {
  limit?: number;
  showTitle?: boolean;
}

export function Recommendations({ limit = 6, showTitle = true }: RecommendationsProps) {
  const [, navigate] = useLocation();

  const { data: recommendations = [], isLoading } = useQuery<RecommendedItem[]>({
    queryKey: ['/api/recommendations', limit],
    queryFn: async () => {
      const response = await fetch(`/api/recommendations?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch recommendations');
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {showTitle && (
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-gradient-to-br from-teal-100 to-teal-200 rounded-lg animate-pulse">
              <Sparkles className="h-4 w-4 text-teal-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800">Suggested for You</h3>
            <div className="flex-1 h-px bg-gradient-to-r from-teal-200 to-transparent"></div>
          </div>
        )}
        <div className="flex md:grid md:grid-cols-4 gap-4 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:overflow-x-visible scrollbar-hide">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse bg-white rounded-xl overflow-hidden border border-teal-100 flex-shrink-0 w-[200px] md:w-auto">
              <div className="aspect-square bg-teal-100"></div>
              <CardContent className="p-3">
                <div className="h-5 bg-teal-100 rounded mb-2"></div>
                <div className="h-4 bg-teal-100 rounded mb-2"></div>
                <div className="h-8 bg-teal-100 rounded"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (recommendations.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {showTitle && (
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 bg-gradient-to-br from-teal-100 to-teal-200 rounded-lg">
            <Sparkles className="h-4 w-4 text-teal-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-800">Suggested for You</h3>
          <div className="flex-1 h-px bg-gradient-to-r from-teal-200 to-transparent"></div>
        </div>
      )}
      
      <div className="flex md:grid md:grid-cols-4 gap-4 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:overflow-x-visible scrollbar-hide">
        {recommendations.map((item) => (
          <Card key={item.id} className="hover:shadow-lg transition-shadow rounded-xl overflow-hidden bg-white flex-shrink-0 w-[200px] md:w-auto">
            <div className="p-3 md:p-4">
              <div className="bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden relative aspect-square">
                {item.photos && item.photos.length > 0 ? (
                  <img
                    src={item.photos[0]}
                    alt={item.name}
                    className="w-full h-full object-cover rounded-lg"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-200 flex items-center justify-center rounded-lg">
                    <Camera className="h-16 w-16 text-gray-400" />
                  </div>
                )}
                {item.recommendationReasons.length > 0 && (
                  <div className="absolute top-3 right-3">
                    <Badge variant="secondary" className="bg-teal-100 text-teal-800 text-sm border-teal-200">
                      <Sparkles className="h-4 w-4 mr-1" />
                      AI Pick
                    </Badge>
                  </div>
                )}
              </div>
            </div>
            
            <CardContent className="px-3 md:px-6 pt-0 pb-3 md:pb-4">
              <h3 className="font-bold text-base md:text-xl mb-1 text-slate-800 truncate">
                {item.name}
              </h3>
              
              <div className="space-y-0.5 mb-2 md:mb-3">
                <div className="flex items-center gap-1.5 text-slate-700">
                  <MapPin className="h-3 w-3 md:h-4 md:w-4" />
                  <span className="text-xs md:text-sm truncate">
                    {item.city || "Nearby"}
                  </span>
                </div>
                
                {(item.isLendable || item.isRentable) && (
                  <div className="flex items-center gap-1.5 text-xs md:text-sm text-slate-700">
                    <Coins className="h-3 w-3 md:h-4 md:w-4 text-teal-600" />
                    <span>{item.shareCoinPrice || 50}</span>
                  </div>
                )}
              </div>

              <Button
                size="sm"
                className="w-full text-white rounded-lg text-xs px-2 whitespace-nowrap h-7 md:h-8"
                style={{ backgroundColor: '#0DCEA1' }}
                onClick={() => navigate(`/items/${item.id}`)}
              >
                {item.isLendable ? (
                  <>
                    <HandHeart className="h-3 w-3 mr-0.5" />
                    Borrow
                  </>
                ) : item.isRentable ? (
                  <>
                    <DollarSign className="h-3 w-3 mr-0.5" />
                    Rent
                  </>
                ) : item.isSwappable ? (
                  <>
                    <ArrowLeftRight className="h-3 w-3 mr-0.5" />
                    Swap
                  </>
                ) : (
                  "View"
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}