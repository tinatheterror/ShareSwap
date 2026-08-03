import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Navbar } from "@/components/shared/navbar";
import { HeartPeopleIcon } from "@/components/ui/heart-people-icon";
import {
  Heart,
  MapPin,
  Clock,
  ArrowRightLeft,
  DollarSign,
  ShoppingCart,
  Repeat,
  HandHeart,
  Calendar,
  Gift,
  EyeOff,
} from "lucide-react";
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
  isPrivate?: boolean;
  createdAt: string;
  username?: string;
  displayName?: string;
  distance?: string;
}

export default function CommunityWishlistsPage() {
  const { data: allWishlists = [], isLoading } = useQuery<Wishlist[]>({
    queryKey: ["/api/all-wishlists"],
  });

  // Check if item is urgently needed (within 7 days)
  const isUrgent = (neededDate?: string) => {
    if (!neededDate) return false;
    const today = new Date();
    const needed = new Date(neededDate);
    const daysUntilNeeded = Math.ceil(
      (needed.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    return daysUntilNeeded <= 7 && daysUntilNeeded >= 0;
  };

  const getNeedTypeIcon = (needType: string) => {
    switch (needType) {
      case "borrow":
        return <HandHeart className="h-4 w-4" />;
      case "rent":
        return <DollarSign className="h-4 w-4" />;
      case "swap":
        return <ArrowRightLeft className="h-4 w-4" />;
      case "gift":
        return <Gift className="h-4 w-4" />;
      default:
        return <ShoppingCart className="h-4 w-4" />;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F3F4F6]">
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
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center justify-center gap-2">
            <HeartPeopleIcon className="h-8 w-8 text-teal-600" />
            Community Wishlists
          </h1>
          <p className="text-muted-foreground">
            Help your neighbours by lending items they need. Earn ShareCoins and
            build trust!
          </p>
        </div>

        {allWishlists.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <HeartPeopleIcon className="h-12 w-12 text-slate-400" />
            </div>
            <h3 className="text-2xl font-bold text-slate-800 mb-3">
              No Wishlists Yet
            </h3>
            <p className="text-slate-600 text-lg mb-6 max-w-md mx-auto">
              Your community hasn't added any wishlist items yet. Check back
              soon!
            </p>
            <Link href="/wishlists">
              <Button className="" style={{ backgroundColor: "#0DCEA1" }}>
                Create Your Own Wishlist
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {allWishlists.map((wishlist) => (
              <Card
                key={wishlist.id}
                className="group hover:shadow-xl transition-all duration-100 border-0 bg-white backdrop-blur-sm hover:bg-white hover:scale-[1.02] overflow-hidden flex flex-col"
              >
                <div className="bg-gradient-to-r from-teal-500 to-teal-600 h-1.5 md:h-2"></div>
                <CardContent className="p-3 md:p-6 flex flex-col flex-1">
                  <div className="flex items-start justify-between mb-2 md:mb-4">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-sm md:text-xl text-slate-800 mb-1 md:mb-1 truncate">
                        {wishlist.itemName}
                      </h4>
                      <div className="flex items-center gap-1 md:gap-1.5 flex-wrap">
                        {isUrgent(wishlist.neededDate) && (
                          <Badge className="bg-[#EFE4B0] text-amber-900 border-amber-200 font-medium px-1.5 py-0.5 md:px-3 md:py-1 text-[10px] md:text-xs shrink-0">
                            <Clock className="h-2.5 w-2.5 md:h-3 md:w-3 mr-0.5 md:mr-1" />
                            URGENT
                          </Badge>
                        )}
                        {(wishlist.needType ? wishlist.needType.split(",") : [])
                          .sort((a, b) =>
                            a.trim() === "gift" ? 1 : b.trim() === "gift" ? -1 : 0,
                          )
                          .map((type) => {
                            const t = type.trim();
                            const isGift = t === "gift";
                            return (
                              <Badge
                                key={t}
                                variant="secondary"
                                className={`${isGift ? "bg-pink-50 text-pink-700 border-pink-200" : "bg-teal-50 text-teal-700 border-teal-200"} px-1.5 py-0.5 md:px-2 md:py-0.5 font-medium text-[10px] md:text-xs shrink-0`}
                              >
                                {getNeedTypeIcon(t)}
                                <span className="ml-0.5 md:ml-1">
                                  {t === "gift"
                                    ? "Be Gifted"
                                    : t.charAt(0).toUpperCase() + t.slice(1) + " It"}
                                </span>
                              </Badge>
                            );
                          })}
                      </div>
                    </div>
                  </div>

                  <div className="mb-2 md:mb-4 min-h-[2.5rem] md:min-h-0">
                    {wishlist.description ? (
                      <p className="text-slate-600 leading-relaxed text-xs md:text-base line-clamp-2 md:line-clamp-none">
                        {wishlist.description}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-1.5 md:space-y-3 mb-3 md:mb-6">
                    {wishlist.isPrivate ? (
                      <div className="flex items-center gap-2 md:gap-3">
                        <div className="w-6 h-6 md:w-8 md:h-8 bg-slate-200 rounded-full flex items-center justify-center">
                          <EyeOff className="h-3 w-3 md:h-4 md:w-4 text-slate-500" />
                        </div>
                        <span className="text-slate-500 font-medium text-xs md:text-base italic">
                          Private request
                        </span>
                      </div>
                    ) : wishlist.displayName || wishlist.username ? (
                      <div className="flex items-center gap-2 md:gap-3">
                        <div className="w-6 h-6 md:w-8 md:h-8 bg-teal-100 rounded-full flex items-center justify-center">
                          <span className="text-teal-700 font-bold text-xs md:text-sm">
                            {(wishlist.displayName || wishlist.username || "?")
                              .charAt(0)
                              .toUpperCase()}
                          </span>
                        </div>
                        <span className="text-slate-600 font-medium text-xs md:text-base">
                          {wishlist.displayName || wishlist.username}
                        </span>
                      </div>
                    ) : null}

                    {wishlist.preferredLocation && (
                      <div className="flex items-center gap-2 md:gap-3">
                        <div className="w-6 h-6 md:w-8 md:h-8 bg-slate-100 rounded-full flex items-center justify-center">
                          <MapPin className="h-3 w-3 md:h-4 md:w-4 text-slate-600" />
                        </div>
                        <span className="text-slate-600 font-medium text-xs md:text-base">
                          {wishlist.preferredLocation}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 md:gap-3">
                      <div className="w-6 h-6 md:w-8 md:h-8 bg-teal-100 rounded-full flex items-center justify-center">
                        <Calendar className="h-3 w-3 md:h-4 md:w-4 text-teal-600" />
                      </div>
                      <div>
                        <span className="text-slate-600 font-medium text-xs md:text-base">
                          Needed by:{" "}
                          {wishlist.neededDate
                            ? new Date(wishlist.neededDate).toLocaleDateString()
                            : "Whenever"}
                        </span>
                        {wishlist.neededDate && wishlist.returnDate &&
                          wishlist.needType === "borrow" && (
                            <div className="text-[10px] md:text-xs text-slate-500">
                              Return:{" "}
                              {new Date(wishlist.returnDate).toLocaleDateString()}
                            </div>
                          )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-auto pt-1">
                    <Link
                      href={`/lend?prefill=${encodeURIComponent(wishlist.itemName)}`}
                    >
                      <Button
                        size="lg"
                        className="w-full text-white font-semibold py-2 md:py-3 shadow-lg hover:shadow-xl transition-all duration-200 text-sm md:text-base"
                        style={{ backgroundColor: "#0DCEA1" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        I Have This Item!
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
