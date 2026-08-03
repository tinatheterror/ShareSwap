import { Card, CardContent } from "@/components/ui/card";
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
  HandHeart,
  MapPin,
  Clock,
  ArrowLeftRight,
  ShoppingCart,
  DollarSign,
  Calendar,
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

  const getNeedTypeIcon = (needType: string) => {
    switch (needType) {
      case "borrow":
        return <HandHeart className="h-3 w-3" />;
      case "rent":
        return <DollarSign className="h-3 w-3" />;
      case "swap":
        return <ArrowLeftRight className="h-3 w-3" />;
      default:
        return <ShoppingCart className="h-3 w-3" />;
    }
  };

  const isUrgent = (neededDate?: string) => {
    if (!neededDate) return false;
    const today = new Date();
    const needed = new Date(neededDate);
    const daysUntilNeeded = Math.ceil(
      (needed.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    return daysUntilNeeded <= 7 && daysUntilNeeded >= 0;
  };

  const displayedWishlists = allWishlists?.slice(0, 6) || [];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto bg-gradient-to-br from-slate-50 to-teal-50 border-2 border-teal-200 shadow-2xl">
        <DialogHeader className="relative pb-6">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-teal-600 rounded-full mb-4 shadow-lg">
              <Coins className="h-4 w-4 text-white" />
            </div>
            <DialogTitle className="text-sm sm:text-xl font-bold text-slate-800 mb-2 whitespace-nowrap">
              Neighbours are looking for these items
            </DialogTitle>
            <p className="text-slate-500 text-xs sm:text-lg whitespace-nowrap">
              Fulfill urgent wishlists and earn extra ShareCoins!
            </p>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {displayedWishlists.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
              {displayedWishlists.map((wishlist) => (
                <Card
                  key={wishlist.id}
                  className="group hover:shadow-xl transition-all duration-100 border-0 bg-white backdrop-blur-sm hover:bg-white hover:scale-[1.02] overflow-hidden flex flex-col"
                >
                  <div className="bg-gradient-to-r from-teal-500 to-teal-600 h-1.5 md:h-2" />
                  <CardContent className="p-3 md:p-6 flex flex-col flex-1">
                    {/* Title + badges */}
                    <div className="flex items-start justify-between mb-2 md:mb-4">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-sm md:text-xl text-slate-800 mb-1 truncate">
                          {wishlist.itemName}
                        </h4>
                        <div className="flex items-center gap-1 md:gap-2 flex-nowrap overflow-hidden">
                          {isUrgent(wishlist.neededDate) && (
                            <Badge className="bg-[#EFE4B0] text-amber-900 border-amber-200 font-medium px-1.5 py-0.5 md:px-3 md:py-1 text-[10px] md:text-xs shrink-0">
                              <Clock className="h-2.5 w-2.5 md:h-3 md:w-3 mr-0.5 md:mr-1" />
                              URGENT
                            </Badge>
                          )}
                          <Badge
                            variant="secondary"
                            className="bg-teal-50 text-teal-700 border-teal-200 px-1.5 py-0.5 md:px-3 md:py-1 font-medium text-[10px] md:text-xs shrink-0"
                          >
                            {getNeedTypeIcon(wishlist.needType)}
                            <span className="ml-0.5 md:ml-1">
                              {wishlist.needType.charAt(0).toUpperCase() +
                                wishlist.needType.slice(1)}
                            </span>
                          </Badge>
                        </div>
                      </div>
                    </div>

                    {/* Description */}
                    <div className="mb-2 md:mb-4 min-h-[2.5rem] md:min-h-0">
                      {wishlist.description ? (
                        <p className="text-slate-600 leading-relaxed text-xs md:text-base line-clamp-2 md:line-clamp-none">
                          {wishlist.description}
                        </p>
                      ) : null}
                    </div>

                    {/* Metadata rows */}
                    <div className="space-y-1.5 md:space-y-3 mb-3 md:mb-4 flex-1">
                      {wishlist.isPrivate ? (
                        <div className="flex items-center gap-2 md:gap-3">
                          <div className="w-6 h-6 md:w-8 md:h-8 bg-teal-50 border border-teal-200 rounded-full flex items-center justify-center shrink-0">
                            <EyeOff className="h-3 w-3 md:h-4 md:w-4 text-teal-500" />
                          </div>
                          <span className="text-slate-500 font-medium text-xs md:text-base italic">
                            Private request
                          </span>
                        </div>
                      ) : wishlist.displayName || wishlist.username ? (
                        <div className="flex items-center gap-2 md:gap-3">
                          <div className="w-6 h-6 md:w-8 md:h-8 bg-teal-50 border border-teal-200 rounded-full flex items-center justify-center shrink-0">
                            <span className="text-teal-600 font-bold text-xs md:text-sm">
                              {(wishlist.displayName || wishlist.username || "?")
                                .charAt(0)
                                .toUpperCase()}
                            </span>
                          </div>
                          <span className="text-slate-700 font-medium text-xs md:text-base">
                            {wishlist.displayName || wishlist.username}
                          </span>
                        </div>
                      ) : null}

                      {wishlist.preferredLocation && (
                        <div className="flex items-center gap-2 md:gap-3">
                          <div className="w-6 h-6 md:w-8 md:h-8 bg-teal-50 border border-teal-200 rounded-full flex items-center justify-center shrink-0">
                            <MapPin className="h-3 w-3 md:h-4 md:w-4 text-teal-600" />
                          </div>
                          <span className="text-slate-700 font-medium text-xs md:text-base">
                            {wishlist.preferredLocation}
                          </span>
                        </div>
                      )}

                      <div className="flex items-start gap-2 md:gap-3">
                        <div className="w-6 h-6 md:w-8 md:h-8 bg-teal-50 border border-teal-200 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                          <Calendar className="h-3 w-3 md:h-4 md:w-4 text-teal-600" />
                        </div>
                        <div className="flex flex-col justify-center">
                          <span className="text-slate-700 font-medium text-xs md:text-base">
                            Needed:{" "}
                            {wishlist.neededDate
                              ? new Date(wishlist.neededDate).toLocaleDateString()
                              : "Whenever"}
                          </span>
                          {wishlist.neededDate && wishlist.returnDate &&
                            wishlist.needType === "borrow" && (
                              <span className="text-slate-500 text-[10px] md:text-sm">
                                Return: {new Date(wishlist.returnDate).toLocaleDateString()}
                              </span>
                            )}
                        </div>
                      </div>
                    </div>

                    {/* Earn ShareCoins */}
                    <div className="bg-gradient-to-r from-teal-50 to-teal-100 p-2 md:p-4 rounded-lg border border-teal-200/50 mb-2 md:mb-3">
                      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-1.5 md:gap-2">
                          <Coins className="h-3.5 w-3.5 md:h-5 md:w-5 text-teal-600 shrink-0" />
                          <span className="font-bold text-teal-800 text-[11px] md:text-base">
                            Earn 10 ShareCoins
                          </span>
                        </div>
                        <span className="text-[10px] md:text-xs text-teal-600 font-medium pl-5 sm:pl-0">
                          Upon completion
                        </span>
                      </div>
                    </div>

                    {/* CTA */}
                    <Link
                      href={`/lend?prefill=${encodeURIComponent(wishlist.itemName)}`}
                    >
                      <Button
                        size="sm"
                        className="w-full text-black font-semibold shadow-lg hover:shadow-xl transition-all duration-200 text-xs md:text-sm md:py-3"
                        style={{ backgroundColor: "#0DCEA1" }}
                        onClick={(e) => e.stopPropagation()}
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
