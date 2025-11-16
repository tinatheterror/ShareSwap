import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Star, Loader2, Share2 } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";

interface Recommendation {
  recommendation: {
    id: number;
    score: string;
    reason: string;
    createdAt: string;
  };
  item: {
    id: number;
    name: string;
    description: string;
    photos: string[];
    conditionRating: number;
    shareCoinsReward: string;
    isLendable: boolean;
    isSwappable: boolean;
    isRentable: boolean;
  };
}

export default function RecommendationsPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const { data: recommendations, isLoading } = useQuery<Recommendation[]>({
    queryKey: ["/api/recommendations"],
    enabled: !!user, // Only fetch when user is authenticated
  });

  const getScoreColor = (score: number) => {
    if (score >= 80) return "bg-teal-500";
    if (score >= 60) return "bg-teal-500";
    return "bg-teal-500";
  };

  if (!user) {
    navigate("/auth");
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 py-12">
          <div className="flex items-center justify-center min-h-[400px]">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Recommended for You</h1>
          <p className="text-muted-foreground">
            Discover items tailored to your interests and location
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {recommendations?.map(({ recommendation, item }) => (
            <Card key={recommendation.id} className="overflow-hidden">
              <div className="relative aspect-square">
                <img
                  src={item.photos[0]}
                  alt={item.name}
                  className="object-cover w-full h-full"
                />
                <div className="absolute top-2 right-2">
                  <Badge
                    className={`${getScoreColor(
                      parseFloat(recommendation.score)
                    )} text-white`}
                  >
                    <Star className="w-4 h-4 mr-1" />
                    {Math.round(parseFloat(recommendation.score))}% Match
                  </Badge>
                </div>
              </div>
              <CardContent className="p-4">
                <h3 className="text-lg font-semibold mb-1">{item.name}</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  {recommendation.reason}
                </p>
                <div className="flex gap-2 mb-4">
                  {item.isLendable && (
                    <Badge variant="outline">Available to Borrow</Badge>
                  )}
                  {item.isSwappable && (
                    <Badge variant="outline">Available to Swap</Badge>
                  )}
                  {item.isRentable && (
                    <Badge variant="outline">Available to Rent</Badge>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <Badge variant="secondary" className="text-sm">
                    {item.shareCoinsReward} ShareCoins
                  </Badge>
                  <Button
                    variant="default"
                    onClick={() => navigate(`/items/${item.id}`)}
                  >
                    <Share2 className="w-4 h-4 mr-2" />
                    View Details
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}