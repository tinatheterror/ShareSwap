import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import {
  Coins,
  Heart,
  MapPin,
  Clock,
  ArrowLeftRight,
  ShoppingCart,
  DollarSign,
  X,
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
  createdAt: string;
  username?: string;
  distance?: string;
}

interface WishlistFulfillmentPopupProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WishlistFulfillmentPopup({
  isOpen,
  onClose,
}: WishlistFulfillmentPopupProps) {
  const { data: allWishlists } = useQuery<Wishlist[]>({
    queryKey: ["/api/all-wishlists"],
    enabled: isOpen,
  });

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case "urgent":
        return "bg-teal-200 text-teal-900";
      case "high":
        return "bg-teal-100 text-teal-800";
      case "normal":
        return "bg-teal-50 text-teal-700";
      case "low":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-teal-50 text-teal-700";
    }
  };

  const getNeedTypeIcon = (needType: string) => {
    switch (needType) {
      case "borrow":
        return <Heart className="h-3 w-3" />;
      case "rent":
        return <DollarSign className="h-3 w-3" />;
      case "swap":
        return <ArrowLeftRight className="h-3 w-3" />;
      default:
        return <ShoppingCart className="h-3 w-3" />;
    }
  };

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

  // Show ALL wishlists, not just urgent ones
  const displayedWishlists = allWishlists?.slice(0, 6) || [];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto bg-gradient-to-br from-slate-50 to-teal-50 border-2 border-teal-200 shadow-2xl">
        <DialogHeader className="relative pb-6">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-teal-600 rounded-full mb-4 shadow-lg">
              <Coins className="h-8 w-8 text-white" />
            </div>
            <DialogTitle className="text-2xl font-bold text-slate-800 mb-2">
              Fulfill a Wishlist + Earn ShareCoins✨
            </DialogTitle>
            <p className="text-slate-600 text-lg">
              Neighbours need these items!! Lend, rent, or swap it out to them.
              You'll earn ShareCoins, and strengthen connections.
            </p>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Two Column Layout */}
          {displayedWishlists.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-6">
              {displayedWishlists.map((wishlist) => (
                <Card
                  key={wishlist.id}
                  className="group hover:shadow-xl transition-all duration-300 border-0 bg-white/90 backdrop-blur-sm hover:bg-white hover:scale-[1.02] overflow-hidden"
                >
                  <div className="bg-gradient-to-r from-teal-500 to-teal-600 h-2"></div>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h4 className="font-bold text-xl text-slate-800 mb-1">
                          {wishlist.itemName}
                        </h4>
                        <div className="flex items-center gap-2 flex-wrap">
                          {isUrgent(wishlist.neededDate) && (
                            <Badge className="bg-[#EBC135] text-amber-900 border-amber-200 font-medium px-3 py-1">
                              <Clock className="h-3 w-3 mr-1" />
                              URGENT
                            </Badge>
                          )}
                          <Badge
                            variant="secondary"
                            className="bg-teal-50 text-teal-700 border-teal-200 px-3 py-1 font-medium"
                          >
                            {getNeedTypeIcon(wishlist.needType)}
                            <span className="ml-1">
                              {wishlist.needType.charAt(0).toUpperCase() +
                                wishlist.needType.slice(1)}
                            </span>
                          </Badge>
                        </div>
                      </div>
                    </div>

                    {wishlist.description && (
                      <p className="text-slate-600 mb-4 leading-relaxed">
                        {wishlist.description}
                      </p>
                    )}

                    <div className="space-y-3 mb-6">
                      {wishlist.preferredLocation && (
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center">
                            <MapPin className="h-4 w-4 text-slate-600" />
                          </div>
                          <span className="text-slate-600 font-medium">
                            {wishlist.preferredLocation}
                          </span>
                        </div>
                      )}

                      {wishlist.username && (
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center">
                            <span className="text-teal-700 font-bold text-sm">
                              {wishlist.username.charAt(0)}
                            </span>
                          </div>
                          <span className="text-slate-600 font-medium">
                            {wishlist.username}
                          </span>
                        </div>
                      )}

                      {wishlist.neededDate && (
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center">
                            <span className="text-teal-700 font-bold text-xs">
                              📅
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-600 font-medium">
                              Needed:{" "}
                              {new Date(
                                wishlist.neededDate,
                              ).toLocaleDateString()}
                            </span>
                            {wishlist.returnDate &&
                              wishlist.needType === "borrow" && (
                                <div className="text-xs text-slate-500">
                                  Return:{" "}
                                  {new Date(
                                    wishlist.returnDate,
                                  ).toLocaleDateString()}
                                </div>
                              )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="bg-gradient-to-r from-teal-50 to-teal-100 p-4 rounded-lg border border-teal-200/50 mb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Coins className="h-5 w-5 text-teal-600" />
                          <span className="font-bold text-teal-800">
                            Earn 10 ShareCoins
                          </span>
                        </div>
                        <span className="text-xs text-teal-600 font-medium">
                          Upon completion
                        </span>
                      </div>
                    </div>

                    <Link href="/lend">
                      <Button
                        size="lg"
                        className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 shadow-lg hover:shadow-xl transition-all duration-200"
                      >
                        I Have This Item!
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <Heart className="h-12 w-12 text-slate-400" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-3">
                No Wishlists Yet
              </h3>
              <p className="text-slate-600 text-lg mb-6 max-w-md mx-auto">
                Your community hasn't added any wishlist items yet. Check back
                soon!
              </p>
            </div>
          )}

          <div className="bg-white/70 backdrop-blur-sm p-3 rounded-xl border border-slate-200 shadow-sm">
            <h4 className="font-bold text-slate-800 text-base mb-3 flex items-center gap-2">
              <div className="w-6 h-6 bg-gradient-to-r from-teal-500 to-teal-600 rounded-full flex items-center justify-center shadow-md">
                <Coins className="h-3.5 w-3.5 text-white" />
              </div>
              How ShareCoin Earning Works
            </h4>

            <div className="space-y-3">
              {/* Primary Earning Rules */}
              <div className="bg-gradient-to-r from-teal-50 to-teal-100 p-3 rounded-lg border border-teal-200">
                <div className="flex items-center justify-between mb-2">
                  <h5 className="font-semibold text-teal-800 text-sm flex items-center gap-1.5">
                    <div className="w-4 h-4 bg-teal-500 rounded-full flex items-center justify-center">
                      <span className="text-white text-[10px]">✓</span>
                    </div>
                    Earning Requirements
                  </h5>
                  <Link href="/sharecoins-info">
                    <button className="text-xs text-teal-700 hover:text-teal-900 font-semibold hover:underline">
                      Learn More →
                    </button>
                  </Link>
                </div>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 bg-teal-500 rounded-full mt-1 flex-shrink-0"></div>
                    <div>
                      <span className="text-slate-700 text-sm font-medium">
                        ShareCoins earned only after successful completion
                      </span>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Your reward is guaranteed when the item is safely
                        returned
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 bg-teal-500 rounded-full mt-1 flex-shrink-0"></div>
                    <div>
                      <span className="text-slate-700 text-sm font-medium">
                        Reward amount varies by item value & duration
                      </span>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Higher value items and longer lending periods earn more
                        ShareCoins
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bonus Opportunities */}
              <div className="bg-gradient-to-r from-teal-50 to-teal-100 p-3 rounded-lg border border-teal-200">
                <h5 className="font-semibold text-teal-800 text-sm mb-2 flex items-center gap-1.5">
                  <div className="w-4 h-4 bg-teal-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-[10px]">★</span>
                  </div>
                  Bonus Opportunities
                </h5>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 bg-teal-500 rounded-full mt-1 flex-shrink-0"></div>
                    <div>
                      <span className="text-slate-700 text-sm font-medium">
                        Extra ShareCoins for urgent requests
                      </span>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Help neighbours in need and earn bonus rewards
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 bg-teal-500 rounded-full mt-1 flex-shrink-0"></div>
                    <div>
                      <span className="text-slate-700 text-sm font-medium">
                        Build reputation while earning rewards
                      </span>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Each successful lending increases your community
                        standing
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Link href="/community-wishlists" className="block">
              <Button
                variant="outline"
                size="lg"
                className="w-full h-14 border-2 border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold"
              >
                Explore All Wishlists
              </Button>
            </Link>
            <Link href="/lend" className="block">
              <Button
                size="lg"
                className="w-full h-14 bg-teal-600 hover:bg-teal-700 font-semibold shadow-lg"
              >
                Share an Item Now
              </Button>
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
