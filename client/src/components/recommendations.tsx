import { useState, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Camera, Coins, MapPin, HandHeart, DollarSign, ArrowLeftRight, Gift } from "lucide-react";
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const { data: recommendations = [], isLoading } = useQuery<RecommendedItem[]>({
    queryKey: ['/api/recommendations', limit],
    queryFn: async () => {
      const response = await fetch(`/api/recommendations?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch recommendations');
      return response.json();
    },
  });

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = e.touches[0].clientX; // reset so stale value never triggers a swipe
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(() => {
    const diff = touchStartX.current - touchEndX.current;
    const threshold = 50;

    if (diff > threshold && currentIndex < recommendations.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else if (diff < -threshold && currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  }, [currentIndex, recommendations.length]);

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
        <div className="md:grid md:grid-cols-4 gap-4">
          <Card className="animate-pulse bg-white rounded-xl overflow-hidden border border-teal-100 md:hidden">
            <div className="p-2">
              <div className="bg-teal-100 rounded-lg" style={{ aspectRatio: "1 / 0.9" }}></div>
            </div>
            <CardContent className="px-3 pt-0 pb-2">
              <div className="h-4 bg-teal-100 rounded mb-1.5"></div>
              <div className="h-3 bg-teal-100 rounded mb-1"></div>
              <div className="h-6 bg-teal-100 rounded"></div>
            </CardContent>
          </Card>
          <div className="hidden md:contents">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="animate-pulse bg-white rounded-xl overflow-hidden border border-teal-100">
                <div className="p-4">
                  <div className="bg-teal-100 rounded-lg" style={{ aspectRatio: "1 / 0.9" }}></div>
                </div>
                <CardContent className="px-6 pt-0 pb-4">
                  <div className="h-6 bg-teal-100 rounded mb-1"></div>
                  <div className="h-4 bg-teal-100 rounded mb-1"></div>
                  <div className="h-8 bg-teal-100 rounded"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (recommendations.length === 0) {
    return null;
  }

  const currentItem = recommendations[currentIndex];

  const renderCard = (item: RecommendedItem) => (
    <Card className={`hover:shadow-lg transition-shadow rounded-xl overflow-hidden bg-white ${item.isGift ? "border-pink-100" : ""}`}>
      <div className="p-2 md:p-4">
        <div
          className={`rounded-lg flex items-center justify-center overflow-hidden relative ${item.isGift ? "bg-pink-50" : "bg-gray-100"}`}
          style={{ aspectRatio: "1 / 0.9" }}
        >
          {item.isGift && (
            <Badge className="absolute top-2 right-2 bg-pink-500 text-white text-[10px] md:text-xs">
              FREE
            </Badge>
          )}
          {item.recommendationReasons.length > 0 && !item.isGift && (
            <Badge variant="secondary" className="absolute top-2 right-2 bg-teal-100 text-teal-800 text-[10px] md:text-xs border-teal-200">
              <Sparkles className="h-3 w-3 mr-0.5" />
              AI Pick
            </Badge>
          )}
          {item.photos && item.photos.length > 0 ? (
            <img
              src={item.photos[0]}
              alt={item.name}
              className="w-full h-full object-cover rounded-lg"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = "none";
                target.parentElement?.classList.add(
                  item.isGift ? "bg-pink-100" : "bg-gray-200",
                  "flex",
                  "items-center",
                  "justify-center",
                );
              }}
            />
          ) : (
            <div className={`w-full h-full flex items-center justify-center rounded-lg ${item.isGift ? "bg-pink-100" : "bg-gray-200"}`}>
              {item.isGift
                ? <Gift className="h-10 w-10 md:h-16 md:w-16 text-pink-400" />
                : <Camera className="h-10 w-10 md:h-16 md:w-16 text-gray-400" />
              }
            </div>
          )}
        </div>
      </div>

      <CardContent className="px-3 md:px-6 pt-0 pb-2 md:pb-4">
        <h3 className="font-bold text-sm md:text-xl text-slate-800 truncate mb-0.5 md:mb-1">
          {item.name}
        </h3>

        <div className="space-y-0 md:space-y-0.5 mb-1.5 md:mb-3">
          <div className="flex items-center gap-1 md:gap-2 text-slate-700">
            <MapPin className="h-3 w-3 md:h-4 md:w-4" />
            <span className="text-xs md:text-sm">
              {item.city || "Nearby"}
            </span>
          </div>

          <div className="flex items-center gap-1 md:gap-2 text-xs md:text-sm text-slate-700">
            <span>
              <span className="font-medium">Condition:</span>{" "}
              {item.conditionRating || 8}/10
            </span>
          </div>

          {!item.isGift && (item.isLendable || item.isRentable) && (
            <div className="flex items-center gap-1 md:gap-2 text-xs md:text-sm text-slate-700">
              <div className="flex items-center gap-0.5 md:gap-1">
                <Coins className="h-3 w-3 md:h-4 md:w-4 text-teal-600" />
                <span>
                  {item.shareCoinPrice || item.shareCoinsReward || "5"} ShareCoins
                </span>
              </div>
              {item.isRentable && (
                <>
                  <span className="text-slate-400">|</span>
                  <div className="flex items-center">
                    <DollarSign className="h-3 w-3 md:h-4 md:w-4 text-teal-600" />
                    <span>${Number(item.dollarsPrice || 10).toFixed(0)}/wk</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-1">
          {item.isGift ? (
            <Button
              size="sm"
              className="w-full bg-pink-500 hover:bg-pink-600 text-white rounded-lg text-[10px] md:text-xs h-6 md:h-8 whitespace-nowrap"
              onClick={() => navigate(`/items/${item.id}`)}
            >
              <Gift className="h-2.5 w-2.5 md:h-3 md:w-3 mr-0.5" />
              Claim Gift
            </Button>
          ) : (
            <>
              {item.isLendable && (
                <Button
                  size="sm"
                  className="text-white rounded-lg text-[10px] md:text-xs px-1.5 md:px-2 h-6 md:h-8 whitespace-nowrap"
                  style={{ backgroundColor: "#0DCEA1" }}
                  onClick={() => navigate(`/items/${item.id}`)}
                >
                  <HandHeart className="h-2.5 w-2.5 md:h-3 md:w-3 mr-0.5" />
                  Borrow It
                </Button>
              )}
              {item.isRentable && (
                <Button
                  size="sm"
                  className="text-white rounded-lg text-[10px] md:text-xs px-1.5 md:px-2 h-6 md:h-8 whitespace-nowrap"
                  style={{ backgroundColor: "#0DCEA1" }}
                  onClick={() => navigate(`/items/${item.id}`)}
                >
                  <DollarSign className="h-2.5 w-2.5 md:h-3 md:w-3 mr-0.5" />
                  Rent It
                </Button>
              )}
              {item.isSwappable && (
                <Button
                  size="sm"
                  className="text-white rounded-lg text-[10px] md:text-xs px-1.5 md:px-2 h-6 md:h-8 whitespace-nowrap"
                  style={{ backgroundColor: "#0DCEA1" }}
                  onClick={() => navigate(`/items/${item.id}`)}
                >
                  <ArrowLeftRight className="h-2.5 w-2.5 md:h-3 md:w-3 mr-0.5" />
                  Swap It
                </Button>
              )}
              {!item.isLendable && !item.isRentable && !item.isSwappable && (
                <Button
                  size="sm"
                  className="text-white rounded-lg text-[10px] md:text-xs px-1.5 md:px-2 h-6 md:h-8 whitespace-nowrap"
                  style={{ backgroundColor: "#0DCEA1" }}
                  onClick={() => navigate(`/items/${item.id}`)}
                >
                  View Item
                </Button>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );

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

      {/* Mobile: Swipeable single card */}
      <div className="md:hidden">
        <div
          className="touch-pan-y"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {renderCard(currentItem)}
        </div>

        {/* Dot indicators */}
        {recommendations.length > 1 && (
          <div className="flex justify-center gap-1.5 mt-3">
            {recommendations.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentIndex(index)}
                className={`w-2 h-2 rounded-full transition-all ${
                  index === currentIndex
                    ? 'bg-teal-500 w-4'
                    : 'bg-gray-300'
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Desktop: Grid layout */}
      <div className="hidden md:grid md:grid-cols-4 gap-6">
        {recommendations.map((item) => (
          <div key={item.id}>
            {renderCard(item)}
          </div>
        ))}
      </div>
    </div>
  );
}
