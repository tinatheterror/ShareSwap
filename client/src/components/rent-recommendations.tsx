import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Camera } from "lucide-react";
import { useLocation } from "wouter";

interface RentRecommendedItem {
  id: number;
  name: string;
  description: string;
  photos: string[];
  dollarsPrice?: string;
  securityDeposit?: string;
  isConditionVerified: boolean;
  reason?: string;
}

interface RentRecommendationsProps {
  limit?: number;
  showTitle?: boolean;
}

export function RentRecommendations({ limit = 6, showTitle = true }: RentRecommendationsProps) {
  const [, navigate] = useLocation();

  const { data: recommendations = [], isLoading } = useQuery<RentRecommendedItem[]>({
    queryKey: ['/api/recommendations', 'rent', limit],
    queryFn: async () => {
      const response = await fetch(`/api/recommendations?type=rent&limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch rent recommendations');
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {showTitle && (
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-gradient-to-br from-green-100 to-green-200 rounded-lg animate-pulse">
              <Sparkles className="h-4 w-4 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800">Rentable Items for You</h3>
            <div className="flex-1 h-px bg-gradient-to-r from-green-200 to-transparent"></div>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse bg-white rounded-xl overflow-hidden border border-green-100">
              <CardContent className="p-4">
                <div className="aspect-square bg-green-100 rounded-lg mb-3"></div>
                <div className="h-4 bg-green-100 rounded mb-2"></div>
                <div className="h-3 bg-green-100 rounded mb-3"></div>
                <div className="h-8 bg-green-100 rounded"></div>
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
          <div className="p-2 bg-gradient-to-br from-green-100 to-green-200 rounded-lg">
            <Sparkles className="h-4 w-4 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-800">Rentable Items for You</h3>
          <div className="flex-1 h-px bg-gradient-to-r from-green-200 to-transparent"></div>
        </div>
      )}
      
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {recommendations.map((item) => (
          <Card key={item.id} className="group hover:shadow-md transition-all duration-300 bg-white rounded-xl overflow-hidden border border-green-100 hover:border-green-200 hover:-translate-y-1">
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
                {item.reason && (
                  <Badge className="absolute top-2 left-2 bg-green-100 text-green-800 text-xs px-2 py-1 border border-green-200">
                    {item.reason}
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