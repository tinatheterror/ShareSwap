import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Navbar } from "@/components/shared/navbar";
import { Heart, MapPin, Clock, ArrowRightLeft, ShoppingCart, Repeat, HandHeart, Calendar } from "lucide-react";
import { Link } from "wouter";

interface Wishlist {
  id: number;
  userId: number;
  itemName: string;
  description?: string;
  category?: string;
  needType: string;
  preferredLocation?: string;
  urgency: string;
  neededDate?: string;
  returnDate?: string;
  isActive: boolean;
  createdAt: string;
  username?: string;
  distance?: string;
}

export default function CommunityWishlistsPage() {
  const { data: allWishlists = [], isLoading } = useQuery<Wishlist[]>({
    queryKey: ['/api/all-wishlists'],
  });

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'urgent': return 'bg-teal-200 text-teal-900';
      case 'high': return 'bg-teal-100 text-teal-800';
      case 'normal': return 'bg-teal-50 text-teal-700';
      case 'low': return 'bg-gray-100 text-gray-800';
      default: return 'bg-teal-50 text-teal-700';
    }
  };

  const getNeedTypeIcon = (needType: string) => {
    switch (needType) {
      case 'borrow': return <HandHeart className="h-4 w-4" />;
      case 'rent': return <ArrowRightLeft className="h-4 w-4" />;
      case 'swap': return <Repeat className="h-4 w-4" />;
      default: return <ShoppingCart className="h-4 w-4" />;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 py-12">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
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
          <h1 className="text-3xl font-bold mb-2 flex items-center justify-center gap-2">
            <Heart className="h-8 w-8 text-teal-600" />
            Community Wishlists
          </h1>
          <p className="text-muted-foreground">
            Help your neighbors by lending items they need. Earn ShareCoins and build trust!
          </p>
        </div>

        {allWishlists.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Heart className="h-12 w-12 text-slate-400" />
            </div>
            <h3 className="text-2xl font-bold text-slate-800 mb-3">No Wishlists Yet</h3>
            <p className="text-slate-600 text-lg mb-6 max-w-md mx-auto">
              Your community hasn't added any wishlist items yet. Check back soon!
            </p>
            <Link href="/wishlists">
              <Button className="bg-teal-600 hover:bg-teal-700">
                Create Your Own Wishlist
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {allWishlists.map((wishlist) => (
              <Card key={wishlist.id} className="group hover:shadow-xl transition-all duration-75 border-0 bg-white backdrop-blur-sm hover:bg-white hover:scale-[1.02] overflow-hidden">
                <div className="bg-gradient-to-r from-teal-500 to-teal-600 h-2"></div>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h4 className="font-bold text-xl text-slate-800 mb-1">{wishlist.itemName}</h4>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`${getUrgencyColor(wishlist.urgency)} font-medium px-3 py-1`}>
                          <Clock className="h-3 w-3 mr-1" />
                          {wishlist.urgency.toUpperCase()}
                        </Badge>
                        <Badge variant="secondary" className="bg-teal-50 text-teal-700 border-teal-200 px-3 py-1 font-medium">
                          {getNeedTypeIcon(wishlist.needType)}
                          <span className="ml-1">{wishlist.needType.charAt(0).toUpperCase() + wishlist.needType.slice(1)}</span>
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {wishlist.description && (
                    <p className="text-slate-600 mb-4 leading-relaxed">{wishlist.description}</p>
                  )}

                  <div className="space-y-3 mb-6">
                    {wishlist.username && (
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center">
                          <span className="text-teal-700 font-bold text-sm">{wishlist.username.charAt(0).toUpperCase()}</span>
                        </div>
                        <span className="text-slate-600 font-medium">{wishlist.username}</span>
                      </div>
                    )}

                    {wishlist.preferredLocation && (
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center">
                          <MapPin className="h-4 w-4 text-slate-600" />
                        </div>
                        <span className="text-slate-600 font-medium">{wishlist.preferredLocation}</span>
                      </div>
                    )}

                    {wishlist.neededDate && (
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center">
                          <Calendar className="h-4 w-4 text-teal-600" />
                        </div>
                        <div>
                          <span className="text-slate-600 font-medium">Needed: {new Date(wishlist.neededDate).toLocaleDateString()}</span>
                          {wishlist.returnDate && wishlist.needType === 'borrow' && (
                            <div className="text-xs text-slate-500">Return: {new Date(wishlist.returnDate).toLocaleDateString()}</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <Link href="/lend">
                    <Button size="lg" className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 shadow-lg hover:shadow-xl transition-all duration-200">
                      I Have This Item!
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
