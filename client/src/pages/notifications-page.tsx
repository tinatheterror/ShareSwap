
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Bell, Check, Package, Heart, AlertCircle, CheckCircle2, ArrowLeftRight, X, Shield, Trophy, TrendingUp, Coins, Clock, Flag, Zap, Truck, Gift, FileText, Star, RotateCcw, Users, Unlock, DollarSign, ShieldAlert } from "lucide-react";
import type { SelectNotification } from "@db/schema";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface ItemDetails {
  id: number;
  name: string;
  description: string | null;
  photos: string[] | null;
  owner?: {
    username: string;
    isVerified: boolean;
  };
}

export default function NotificationsPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [showWishlistMatchModal, setShowWishlistMatchModal] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<SelectNotification | null>(null);
  const [matchedItemDetails, setMatchedItemDetails] = useState<ItemDetails | null>(null);
  const [isLoadingItem, setIsLoadingItem] = useState(false);

  const { data: notifications = [], isLoading } = useQuery<SelectNotification[]>({
    queryKey: ['/api/notifications'],
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("PATCH", `/api/notifications/${id}/read`);
      return response.json();
    },
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ['/api/notifications'] });
      await queryClient.cancelQueries({ queryKey: ['/api/notifications/unread-count'] });
      
      const previousNotifications = queryClient.getQueryData<SelectNotification[]>(['/api/notifications']);
      const previousCount = queryClient.getQueryData<{ count: number }>(['/api/notifications/unread-count']);
      
      queryClient.setQueryData<SelectNotification[]>(['/api/notifications'], (old) =>
        old?.map((n) => n.id === id ? { ...n, isRead: true } : n)
      );
      
      queryClient.setQueryData<{ count: number }>(['/api/notifications/unread-count'], (old) => ({
        count: Math.max(0, (old?.count ?? 1) - 1)
      }));
      
      return { previousNotifications, previousCount };
    },
    onError: (err, id, context) => {
      if (context?.previousNotifications) {
        queryClient.setQueryData(['/api/notifications'], context.previousNotifications);
      }
      if (context?.previousCount) {
        queryClient.setQueryData(['/api/notifications/unread-count'], context.previousCount);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notifications/unread-count'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/notifications/read-all");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notifications/unread-count'] });
    },
  });

  const handleNotificationClick = async (notification: SelectNotification) => {
    if (!notification.isRead) {
      markAsReadMutation.mutate(notification.id);
    }
    
    // Handle wishlist_match notifications with special modal
    if (notification.type === 'wishlist_match' && notification.itemId) {
      setSelectedNotification(notification);
      setIsLoadingItem(true);
      setShowWishlistMatchModal(true);
      
      try {
        const response = await fetch(`/api/items/${notification.itemId}`, {
          credentials: 'include',
        });
        if (response.ok) {
          const itemData = await response.json();
          setMatchedItemDetails(itemData);
        }
      } catch (error) {
        console.error('Error fetching item details:', error);
      } finally {
        setIsLoadingItem(false);
      }
      return;
    }
    
    if (notification.requestId) {
      window.dispatchEvent(new CustomEvent("open-chat-requests"));
    } else if (notification.itemId) {
      navigate(`/items/${notification.itemId}`);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      // Requests
      case 'item_request':
        return <Package className="h-5 w-5 text-primary" />;
      case 'request_accepted':
      case 'terms_accepted':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'request_declined':
      case 'terms_declined':
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      case 'terms_counter_proposed':
        return <FileText className="h-5 w-5 text-blue-500" />;
      // Discovery
      case 'wishlist_match':
        return <Heart className="h-5 w-5 text-pink-500" />;
      case 'swap_match':
        return <ArrowLeftRight className="h-5 w-5 text-teal-500" />;
      // Handoff — positive
      case 'handoff_confirmed':
      case 'handoff_auto_advanced':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'handoff_pending':
        return <Clock className="h-5 w-5 text-amber-500" />;
      // Handoff — disputes
      case 'handoff_dispute':
      case 'handoff_disputed':
      case 'dispute_opened':
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      case 'handoff_flagged':
        return <Flag className="h-5 w-5 text-orange-500" />;
      // Gifts
      case 'gift_handoff_pending':
        return <Gift className="h-5 w-5 text-amber-500" />;
      case 'gift_completed':
        return <Gift className="h-5 w-5 text-green-600" />;
      // Delivery
      case 'delivery_confirmed':
        return <Truck className="h-5 w-5 text-green-600" />;
      case 'courier_issue':
        return <Truck className="h-5 w-5 text-red-600" />;
      // Return reminders
      case 'return_reminder_tomorrow':
        return <Clock className="h-5 w-5 text-amber-500" />;
      case 'return_reminder_today':
        return <Clock className="h-5 w-5 text-orange-500" />;
      case 'return_reminder_overdue':
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      // Gamification
      case 'sharecoin_earned':
        return <Coins className="h-5 w-5 text-yellow-500" />;
      case 'milestone_achieved':
        return <Trophy className="h-5 w-5 text-amber-500" />;
      case 'badge_earned':
        return <Star className="h-5 w-5 text-purple-600" />;
      case 'level_up':
        return <TrendingUp className="h-5 w-5 text-purple-600" />;
      case 'trust_score_changed':
        return <Shield className="h-5 w-5 text-blue-600" />;
      // Reviews
      case 'new_review_received':
        return <Star className="h-5 w-5 text-yellow-500" />;
      // Social / referrals
      case 'referral_joined':
        return <Users className="h-5 w-5 text-teal-500" />;
      // Payments & deposits
      case 'security_deposit_released':
        return <Unlock className="h-5 w-5 text-green-600" />;
      case 'payment_received':
        return <DollarSign className="h-5 w-5 text-green-600" />;
      // Verification
      case 'verification_failed':
        return <ShieldAlert className="h-5 w-5 text-red-600" />;
      default:
        return <Bell className="h-5 w-5 text-gray-600" />;
    }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F3F4F6]">
        <Navbar />
        <main className="max-w-4xl mx-auto px-4 py-8">
          <div className="animate-pulse space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Bell className="h-8 w-8 text-primary" />
              Notifications
            </h1>
            <p className="text-muted-foreground mt-2">
              {unreadCount > 0 ? `You have ${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'All caught up!'}
            </p>
          </div>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
            >
              <Check className="h-4 w-4 mr-2" />
              Mark all as read
            </Button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="text-center py-12">
            <Bell className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-600 mb-2">
              No notifications yet
            </h3>
            <p className="text-gray-500">
              You'll see notifications here when someone interacts with your items
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((notification) => (
              <Card
                key={notification.id}
                className={`cursor-pointer transition-all hover:shadow-md ${
                  !notification.isRead ? 'border-l-4 border-l-primary bg-primary/5' : ''
                }`}
                onClick={() => handleNotificationClick(notification)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="mt-1">
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-semibold text-lg">
                            {notification.title}
                          </h3>
                          <p className="text-muted-foreground mt-1">
                            {notification.message}
                          </p>
                        </div>
                        {!notification.isRead && (
                          <Badge variant="default" className="shrink-0">
                            New
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        {new Date(notification.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Wishlist Match Modal */}
      <AnimatePresence>
        {showWishlistMatchModal && (
          <motion.div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden"
              initial={{ scale: 0.8, opacity: 0, y: 50 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: 50 }}
              transition={{ type: "spring", damping: 20, stiffness: 300 }}
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-pink-500 to-rose-500 p-4 text-white relative">
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-2 right-2 text-white hover:bg-white/20"
                  onClick={() => {
                    setShowWishlistMatchModal(false);
                    setMatchedItemDetails(null);
                    setSelectedNotification(null);
                  }}
                >
                  <X className="h-5 w-5" />
                </Button>
                <div className="flex items-center gap-2">
                  <Heart className="h-6 w-6" />
                  <h2 className="text-lg font-bold">Great news!</h2>
                </div>
                <p className="text-white/90 text-sm mt-1">
                  A neighbour has an item that matches your wishlist
                </p>
              </div>

              {/* Content */}
              <div className="p-4">
                {isLoadingItem ? (
                  <div className="animate-pulse space-y-4">
                    <div className="h-40 bg-gray-200 rounded-lg"></div>
                    <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                  </div>
                ) : matchedItemDetails ? (
                  <>
                    {/* Item Photo */}
                    {matchedItemDetails.photos && matchedItemDetails.photos.length > 0 && (
                      <div className="relative h-48 rounded-lg overflow-hidden mb-4">
                        <img
                          src={matchedItemDetails.photos[0]}
                          alt={matchedItemDetails.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}

                    {/* Item Info */}
                    <h3 className="text-xl font-bold text-gray-900 mb-2">
                      {matchedItemDetails.name}
                    </h3>
                    
                    {matchedItemDetails.description && (
                      <p className="text-gray-600 text-sm mb-4 line-clamp-3">
                        {matchedItemDetails.description}
                      </p>
                    )}

                    {/* Owner Info with Verified Badge */}
                    {matchedItemDetails.owner && (
                      <div className="flex items-center gap-2 mb-6 p-3 bg-gray-50 rounded-lg">
                        <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center text-teal-600 font-semibold">
                          {(matchedItemDetails.owner.username || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-1">
                            <span className="font-medium">
                              {matchedItemDetails.owner.username}
                            </span>
                            {matchedItemDetails.owner.isVerified && (
                              <Shield className="h-4 w-4 text-teal-500" />
                            )}
                          </div>
                          {matchedItemDetails.owner.isVerified ? (
                            <span className="text-xs text-teal-600">Verified user</span>
                          ) : (
                            <span className="text-xs text-gray-500">Not verified</span>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-gray-500 text-center py-8">Could not load item details</p>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3 mt-4">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setShowWishlistMatchModal(false);
                      setMatchedItemDetails(null);
                      setSelectedNotification(null);
                    }}
                  >
                    Decline
                  </Button>
                  <Button
                    className="flex-1 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white"
                    onClick={() => {
                      if (matchedItemDetails?.id) {
                        navigate(`/items/${matchedItemDetails.id}`);
                      }
                      setShowWishlistMatchModal(false);
                      setMatchedItemDetails(null);
                      setSelectedNotification(null);
                    }}
                    disabled={!matchedItemDetails}
                  >
                    Request this item
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
