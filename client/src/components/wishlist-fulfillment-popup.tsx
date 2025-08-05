import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { Coins, Heart, MapPin, Clock, ArrowRightLeft, ShoppingCart, Repeat, X } from "lucide-react";
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
  isActive: boolean;
  createdAt: string;
  username?: string;
  distance?: string;
}

interface WishlistFulfillmentPopupProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WishlistFulfillmentPopup({ isOpen, onClose }: WishlistFulfillmentPopupProps) {
  const { data: allWishlists } = useQuery<Wishlist[]>({
    queryKey: ['/api/all-wishlists'],
    enabled: isOpen,
  });

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'urgent': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'normal': return 'bg-blue-100 text-blue-800';
      case 'low': return 'bg-gray-100 text-gray-800';
      default: return 'bg-blue-100 text-blue-800';
    }
  };

  const getNeedTypeIcon = (needType: string) => {
    switch (needType) {
      case 'borrow': return <ShoppingCart className="h-3 w-3" />;
      case 'rent': return <ArrowRightLeft className="h-3 w-3" />;
      case 'swap': return <Repeat className="h-3 w-3" />;
      default: return <ShoppingCart className="h-3 w-3" />;
    }
  };

  const urgentWishlists = allWishlists?.filter(w => w.urgency === 'urgent' || w.urgency === 'high').slice(0, 6) || [];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-6 w-6 text-yellow-600" />
            Earn ShareCoins Instantly
          </DialogTitle>
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-4 top-4"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-gradient-to-r from-yellow-50 to-green-50 p-4 rounded-lg border border-yellow-200">
            <h3 className="font-semibold text-green-800 mb-2 flex items-center gap-2">
              <Coins className="h-5 w-5 text-yellow-600" />
              Help Your Neighbors, Earn Immediately
            </h3>
            <p className="text-sm text-green-700">
              These neighbors are looking for items you might have. Fulfill their needs and earn ShareCoins the moment you complete the lending transaction!
            </p>
          </div>

          {urgentWishlists.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              {urgentWishlists.map((wishlist) => (
                <Card key={wishlist.id} className="hover:shadow-md transition-shadow border-2 border-dashed border-yellow-300">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <h4 className="font-semibold text-lg">{wishlist.itemName}</h4>
                      <Badge className={getUrgencyColor(wishlist.urgency)}>
                        <Clock className="h-3 w-3 mr-1" />
                        {wishlist.urgency}
                      </Badge>
                    </div>

                    {wishlist.description && (
                      <p className="text-sm text-muted-foreground mb-3">{wishlist.description}</p>
                    )}

                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Needed for:</span>
                        <Badge variant="secondary" className={
                          wishlist.needType === 'borrow' ? 'bg-blue-100 text-blue-800' :
                          wishlist.needType === 'rent' ? 'bg-purple-100 text-purple-800' :
                          'bg-orange-100 text-orange-800'
                        }>
                          {getNeedTypeIcon(wishlist.needType)}
                          <span className="ml-1">{wishlist.needType.charAt(0).toUpperCase() + wishlist.needType.slice(1)}</span>
                        </Badge>
                      </div>

                      {wishlist.preferredLocation && (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3 w-3 text-gray-500" />
                          <span className="text-muted-foreground">{wishlist.preferredLocation}</span>
                        </div>
                      )}

                      {wishlist.username && (
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Requested by:</span>
                          <span className="text-muted-foreground">{wishlist.username}</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-yellow-600">
                          <Coins className="h-4 w-4" />
                          <span className="text-sm font-medium">Earn 5-15 ShareCoins</span>
                        </div>
                        <Link href="/upload">
                          <Button size="sm" className="bg-green-600 hover:bg-green-700">
                            I Have This!
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Heart className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">No urgent requests right now</h3>
              <p className="text-muted-foreground mb-4">
                Check back later or browse all wishlists to find items you can share.
              </p>
              <Link href="/wishlists">
                <Button variant="outline">
                  View All Wishlists
                </Button>
              </Link>
            </div>
          )}

          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <h4 className="font-semibold text-blue-800 mb-2">How ShareCoin Earning Works:</h4>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• ShareCoins are earned only after successful lending completion</li>
              <li>• Amount varies based on item value and lending duration</li>
              <li>• Bonus ShareCoins for helping urgent requests</li>
              <li>• Build your reputation while earning rewards</li>
            </ul>
          </div>

          <div className="flex gap-4">
            <Link href="/wishlists" className="flex-1">
              <Button variant="outline" className="w-full">
                Browse All Neighbor Requests
              </Button>
            </Link>
            <Link href="/upload" className="flex-1">
              <Button className="w-full">
                Share an Item Now
              </Button>
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}