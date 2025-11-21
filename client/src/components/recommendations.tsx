import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Camera, Coins, MapPin, Heart, DollarSign, ArrowLeftRight } from "lucide-react";
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
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {recommendations.map((item) => (
          <Card 
            key={item.id} 
            className="h-[420px] flex flex-col hover:shadow-lg transition-shadow rounded-xl overflow-hidden" 
            style={{ backgroundColor: '#D4F7F1' }}
          >
            <div className="h-[60%] bg-gray-100 flex items-center justify-center overflow-hidden relative flex-shrink-0">
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
              {item.recommendationReasons.length > 0 && (
                <div className="absolute top-3 right-3">
                  <Badge variant="secondary" className="bg-teal-100 text-teal-800 text-sm border-teal-200">
                    <Sparkles className="h-4 w-4 mr-1" />
                    AI Pick
                  </Badge>
                </div>
              )}
            </div>
            
            <CardContent 
              className="h-[40%] flex flex-col min-h-0 flex-shrink-0"
              style={{ 
                padding: 'clamp(0.75rem, 1.5vh, 1.25rem)',
                gap: 'clamp(0.35rem, 0.8vh, 0.75rem)'
              }}
            >
              <h3 
                className="font-bold text-slate-800 truncate min-w-0"
                style={{ fontSize: 'clamp(0.95rem, 1.8vh, 1.25rem)' }}
              >
                {item.name}
              </h3>
              
              <div 
                className="flex flex-col min-h-0 flex-1"
                style={{ gap: 'clamp(0.25rem, 0.6vh, 0.5rem)' }}
              >
                <div 
                  className="flex items-center gap-1 text-slate-700 min-w-0"
                  style={{ fontSize: 'clamp(0.75rem, 1.4vh, 0.875rem)' }}
                >
                  <MapPin style={{ width: 'clamp(0.75rem, 1.4vh, 1rem)', height: 'clamp(0.75rem, 1.4vh, 1rem)' }} />
                  <span className="truncate min-w-0">
                    {item.city || "Nearby"}
                  </span>
                </div>
                
                <div 
                  className="text-slate-700"
                  style={{ fontSize: 'clamp(0.75rem, 1.4vh, 0.875rem)' }}
                >
                  <span className="font-medium">Condition:</span> {item.conditionRating || 8}/10
                </div>
                
                {(item.isLendable || item.isRentable) && (
                  <div 
                    className="flex items-center gap-1 text-slate-700 flex-wrap"
                    style={{ fontSize: 'clamp(0.75rem, 1.4vh, 0.875rem)' }}
                  >
                    <div className="flex items-center gap-0.5">
                      <Coins style={{ width: 'clamp(0.75rem, 1.4vh, 1rem)', height: 'clamp(0.75rem, 1.4vh, 1rem)' }} className="text-teal-600" />
                      <span>{item.shareCoinPrice || 50} ShareCoins</span>
                    </div>
                    {item.isRentable && item.dollarsPrice && (
                      <>
                        <span className="text-slate-400">|</span>
                        <div className="flex items-center">
                          <DollarSign style={{ width: 'clamp(0.75rem, 1.4vh, 1rem)', height: 'clamp(0.75rem, 1.4vh, 1rem)' }} className="text-teal-600" />
                          <span>{item.dollarsPrice}/day</span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div 
                className="flex gap-1 flex-wrap mt-auto"
                style={{ gap: 'clamp(0.25rem, 0.6vh, 0.5rem)' }}
              >
                {item.isLendable && (
                  <Button
                    className="bg-teal-500 hover:bg-teal-600 text-white whitespace-nowrap"
                    style={{
                      fontSize: 'clamp(0.7rem, 1.3vh, 0.8rem)',
                      padding: 'clamp(0.3rem, 0.7vh, 0.5rem) clamp(0.5rem, 1vh, 0.75rem)',
                      height: 'clamp(1.75rem, 3.5vh, 2.25rem)',
                      borderRadius: 'clamp(0.35rem, 0.8vh, 0.5rem)'
                    }}
                    onClick={() => navigate(`/items/${item.id}`)}
                  >
                    <Heart style={{ width: 'clamp(0.65rem, 1.2vh, 0.75rem)', height: 'clamp(0.65rem, 1.2vh, 0.75rem)', marginRight: '0.15rem' }} />
                    Borrow It
                  </Button>
                )}
                {item.isRentable && (
                  <Button
                    className="bg-teal-500 hover:bg-teal-600 text-white whitespace-nowrap"
                    style={{
                      fontSize: 'clamp(0.7rem, 1.3vh, 0.8rem)',
                      padding: 'clamp(0.3rem, 0.7vh, 0.5rem) clamp(0.5rem, 1vh, 0.75rem)',
                      height: 'clamp(1.75rem, 3.5vh, 2.25rem)',
                      borderRadius: 'clamp(0.35rem, 0.8vh, 0.5rem)'
                    }}
                    onClick={() => navigate(`/items/${item.id}`)}
                  >
                    <DollarSign style={{ width: 'clamp(0.65rem, 1.2vh, 0.75rem)', height: 'clamp(0.65rem, 1.2vh, 0.75rem)', marginRight: '0.15rem' }} />
                    Rent It
                  </Button>
                )}
                {item.isSwappable && (
                  <Button
                    className="bg-teal-500 hover:bg-teal-600 text-white whitespace-nowrap"
                    style={{
                      fontSize: 'clamp(0.7rem, 1.3vh, 0.8rem)',
                      padding: 'clamp(0.3rem, 0.7vh, 0.5rem) clamp(0.5rem, 1vh, 0.75rem)',
                      height: 'clamp(1.75rem, 3.5vh, 2.25rem)',
                      borderRadius: 'clamp(0.35rem, 0.8vh, 0.5rem)'
                    }}
                    onClick={() => navigate(`/items/${item.id}`)}
                  >
                    <ArrowLeftRight style={{ width: 'clamp(0.65rem, 1.2vh, 0.75rem)', height: 'clamp(0.65rem, 1.2vh, 0.75rem)', marginRight: '0.15rem' }} />
                    Swap It
                  </Button>
                )}
                {!item.isLendable && !item.isRentable && !item.isSwappable && (
                  <Button
                    className="bg-teal-500 hover:bg-teal-600 text-white whitespace-nowrap"
                    style={{
                      fontSize: 'clamp(0.7rem, 1.3vh, 0.8rem)',
                      padding: 'clamp(0.3rem, 0.7vh, 0.5rem) clamp(0.5rem, 1vh, 0.75rem)',
                      height: 'clamp(1.75rem, 3.5vh, 2.25rem)',
                      borderRadius: 'clamp(0.35rem, 0.8vh, 0.5rem)'
                    }}
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