import { useAuth } from "@/hooks/use-auth";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
} from "@/components/ui/navigation-menu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Link } from "wouter";
import { Coins, Gamepad2, Trophy, Heart, Users, Package, Bell, HandHeart, HelpCircle, Menu, X, Home, User, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { WishlistFulfillmentPopup } from "@/components/wishlist-fulfillment-popup";
import { Clock, AlertCircle } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { formatDistanceToNow } from "date-fns";

interface Notification {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  itemId: number | null;
  requestId: number | null;
  isRead: boolean;
  createdAt: string;
}

function NotificationBell() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Fetch unread count (check every 2 minutes instead of 30s to reduce load)
  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    enabled: !!user?.id,
    refetchInterval: 120000, // Refetch every 2 minutes
  });

  // Fetch notifications
  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    enabled: !!user?.id,
    refetchInterval: 120000, // Refetch every 2 minutes
  });

  // Check for return reminders periodically
  useEffect(() => {
    if (!user?.id) return;

    const checkReminders = async () => {
      try {
        await apiRequest("POST", "/api/notifications/check-return-reminders", {});
        // Refresh notifications after checking
        queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      } catch (error) {
        console.error("Error checking return reminders:", error);
      }
    };

    // Check immediately on mount
    checkReminders();

    // Then check every 15 minutes (reduced from 5min to reduce server load)
    const interval = setInterval(checkReminders, 15 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user?.id, queryClient]);

  // Mark notification as read
  const markAsReadMutation = useMutation({
    mutationFn: (notificationId: number) => {
      return fetch(`/api/notifications/${notificationId}/read`, {
        method: "PATCH",
        credentials: "include",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const unreadNotifications = notifications.filter(n => !n.isRead).slice(0, 5);
  const unreadCount = unreadData?.count ?? 0;

  const getNotificationIcon = (type: string) => {
    if (type.includes('return_reminder_overdue')) {
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    } else if (type.includes('return_reminder')) {
      return <Clock className="h-4 w-4 text-orange-500" />;
    }
    return <Bell className="h-4 w-4 text-primary" />;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative p-2 hover:text-primary">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 p-1 text-xs font-bold flex items-center justify-center">
              {unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-[500px] overflow-y-auto">
        <div className="p-2">
          <div className="flex items-center justify-between mb-2">
            <h6 className="text-sm font-semibold text-primary">Notifications</h6>
            {unreadCount > 0 && (
              <span className="text-xs text-muted-foreground">{unreadCount} unread</span>
            )}
          </div>
          {unreadNotifications.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No new notifications</p>
          ) : (
            <>
              {unreadNotifications.map((notification) => (
                <div key={notification.id}>
                  <DropdownMenuItem 
                    className="cursor-pointer hover:bg-gray-100 flex flex-col items-start p-3 gap-1"
                    onClick={() => markAsReadMutation.mutate(notification.id)}
                  >
                    <div className="flex items-start gap-2 w-full">
                      {getNotificationIcon(notification.type)}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{notification.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{notification.message}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </div>
              ))}
              {unreadCount > 5 && (
                <div className="text-center text-xs text-muted-foreground py-2">
                  +{unreadCount - 5} more notifications
                </div>
              )}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Navbar() {
  const { user, logoutMutation } = useAuth();
  const [showWishlistPopup, setShowWishlistPopup] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileWalletOpen, setMobileWalletOpen] = useState(false);

  return (
    <nav className="border-b bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-14 sm:h-16 items-center">
          <Link href="/">
            <div className="flex items-center cursor-pointer">
              <img src="/shareswap-full-logo.png" alt="ShareSwap" className="h-10 sm:h-12 w-auto" />
            </div>
          </Link>

          {/* Desktop Navigation */}
          <NavigationMenu className="hidden lg:flex">
            <NavigationMenuList className="space-x-2">
              {user ? (
                <>
                  <NavigationMenuItem>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="flex items-center gap-2 hover:text-primary hover:border-primary" data-tutorial="wallet">
                          <Coins className="h-5 w-5 text-primary" />
                          <div className="flex flex-col items-start">
                            <span className="text-xs text-muted-foreground">Total Balance</span>
                            <span>{user?.shareCoins ? Number(user.shareCoins).toFixed(2) : "0.00"} ShareCoins</span>
                          </div>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <Link href="/wallet">
                          <DropdownMenuItem className="cursor-pointer hover:text-primary">
                            <Coins className="mr-2 h-4 w-4" />
                            <span>View Transactions</span>
                          </DropdownMenuItem>
                        </Link>
                        <Link href="/achievements">
                          <DropdownMenuItem className="cursor-pointer hover:text-primary">
                            <Trophy className="mr-2 h-4 w-4" />
                            <span>Achievements</span>
                          </DropdownMenuItem>
                        </Link>
                        <DropdownMenuSeparator />
                        <h6 className="px-2 py-1.5 text-sm font-semibold text-primary">Earn More ShareCoins</h6>
                        <Link href="/games">
                          <DropdownMenuItem className="cursor-pointer hover:text-primary">
                            <Gamepad2 className="mr-2 h-4 w-4" />
                            <span>Play Games</span>
                          </DropdownMenuItem>
                        </Link>
                        <Link href="/referrals">
                          <DropdownMenuItem className="cursor-pointer hover:text-primary">
                            <Users className="mr-2 h-4 w-4" />
                            <span>Invite Friends</span>
                          </DropdownMenuItem>
                        </Link>
                        <DropdownMenuItem 
                          className="cursor-pointer hover:text-primary"
                          onClick={() => setShowWishlistPopup(true)}
                        >
                          <Heart className="mr-2 h-4 w-4" />
                          <span>Help Neighbours</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link href="/my-items">
                      <Button variant="ghost" className="flex items-center gap-2 hover:text-primary" data-tutorial="sharechest">
                        <Package className="h-5 w-5" />
                        <span>My Shared Items</span>
                      </Button>
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link href="/wishlists">
                      <Button variant="ghost" className="flex items-center gap-2 hover:text-primary" data-tutorial="wishlist">
                        <Heart className="h-5 w-5" />
                        <span>My Wishlist</span>
                      </Button>
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link href="/help">
                      <Button variant="ghost" className="flex items-center gap-2 hover:text-primary text-gray-500">
                        <HelpCircle className="h-4 w-4" />
                        <span className="text-sm">How It Works</span>
                      </Button>
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <div className="flex items-center gap-3">
                      <NotificationBell />
                      <Link href="/profile">
                        <Avatar className="border-2 border-primary cursor-pointer hover:border-primary/80 transition-colors">
                          <AvatarFallback className="bg-primary/10 text-primary">
                            {user.username.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </Link>
                      <Button
                        variant="ghost"
                        onClick={() => logoutMutation.mutate()}
                        className="hover:text-primary"
                      >
                        Logout
                      </Button>
                    </div>
                  </NavigationMenuItem>
                </>
              ) : (
                <NavigationMenuItem>
                  <Link href="/auth">
                    <Button variant="outline" className="border-primary text-primary hover:bg-primary hover:text-white">
                      Login
                    </Button>
                  </Link>
                </NavigationMenuItem>
              )}
            </NavigationMenuList>
          </NavigationMenu>

          {/* Mobile Navigation */}
          <div className="flex lg:hidden items-center gap-2">
            {user && (
              <Sheet open={mobileWalletOpen} onOpenChange={setMobileWalletOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" className="flex items-center gap-1.5 hover:text-primary hover:border-primary px-2 py-1 h-auto" style={{ maxWidth: '115px' }}>
                    <Coins className="h-4 w-4 text-primary flex-shrink-0" />
                    <div className="flex flex-col items-start min-w-0">
                      <span className="text-[8px] text-muted-foreground leading-tight">Total Balance</span>
                      <span className="text-[10px] font-medium truncate">{user?.shareCoins ? Number(user.shareCoins).toFixed(2) : "0.00"} ShareCoins</span>
                    </div>
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="rounded-t-2xl pb-8">
                  <div className="flex flex-col gap-4 pt-2">
                    <h2 className="text-lg font-semibold text-center">Wallet</h2>
                    
                    {/* Balance Display */}
                    <div className="flex flex-col items-center py-4 bg-primary/5 rounded-lg">
                      <Coins className="h-8 w-8 text-primary mb-2" />
                      <span className="text-3xl font-bold text-primary">{user?.shareCoins ? Number(user.shareCoins).toFixed(2) : "0.00"}</span>
                      <span className="text-sm text-muted-foreground">ShareCoins</span>
                    </div>

                    {/* Wallet Actions */}
                    <div className="flex flex-col gap-1">
                      <Link href="/wallet" onClick={() => setMobileWalletOpen(false)}>
                        <Button variant="ghost" className="w-full justify-start gap-3">
                          <Coins className="h-5 w-5" />
                          View Transactions
                        </Button>
                      </Link>
                      <Link href="/achievements" onClick={() => setMobileWalletOpen(false)}>
                        <Button variant="ghost" className="w-full justify-start gap-3">
                          <Trophy className="h-5 w-5" />
                          Achievements
                        </Button>
                      </Link>
                    </div>

                    {/* Earn More Section */}
                    <div className="border-t pt-4">
                      <h6 className="px-3 pb-2 text-sm font-semibold text-primary">Earn More ShareCoins</h6>
                      <div className="flex flex-col gap-1">
                        <Link href="/games" onClick={() => setMobileWalletOpen(false)}>
                          <Button variant="ghost" className="w-full justify-start gap-3">
                            <Gamepad2 className="h-5 w-5" />
                            Play Games
                          </Button>
                        </Link>
                        <Link href="/referrals" onClick={() => setMobileWalletOpen(false)}>
                          <Button variant="ghost" className="w-full justify-start gap-3">
                            <Users className="h-5 w-5" />
                            Invite Friends
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          className="w-full justify-start gap-3"
                          onClick={() => {
                            setMobileWalletOpen(false);
                            setShowWishlistPopup(true);
                          }}
                        >
                          <HandHeart className="h-5 w-5" />
                          Help Neighbours
                        </Button>
                      </div>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            )}
            {user && <NotificationBell />}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-6 w-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[280px] sm:w-[320px] overflow-y-auto">
                <div className="flex flex-col gap-4 mt-6 pb-8">
                  {user ? (
                    <>
                      {/* User Info */}
                      <Link href="/profile" onClick={() => setMobileMenuOpen(false)}>
                        <div className="flex items-center gap-3 pb-4 border-b cursor-pointer hover:opacity-80">
                          <Avatar className="h-12 w-12 border-2 border-primary">
                            <AvatarFallback className="bg-primary/10 text-primary text-lg">
                              {user.username.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{user.username}</p>
                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                              <User className="h-4 w-4" />
                              View Profile
                            </p>
                          </div>
                        </div>
                      </Link>

                      {/* Navigation Links */}
                      <Link href="/" onClick={() => setMobileMenuOpen(false)}>
                        <Button variant="ghost" className="w-full justify-start gap-3">
                          <Home className="h-5 w-5" />
                          Home
                        </Button>
                      </Link>
                      <Link href="/my-items" onClick={() => setMobileMenuOpen(false)}>
                        <Button variant="ghost" className="w-full justify-start gap-3" data-tutorial="sharechest">
                          <Package className="h-5 w-5" />
                          My Shared Items
                        </Button>
                      </Link>
                      <Link href="/wishlists" onClick={() => setMobileMenuOpen(false)}>
                        <Button variant="ghost" className="w-full justify-start gap-3" data-tutorial="wishlist">
                          <Heart className="h-5 w-5" />
                          My Wishlist
                        </Button>
                      </Link>
                      <Link href="/help" onClick={() => setMobileMenuOpen(false)}>
                        <Button variant="ghost" className="w-full justify-start gap-3 text-gray-500 hover:text-primary">
                          <HelpCircle className="h-5 w-5" />
                          How It Works
                        </Button>
                      </Link>

                      <div className="border-t pt-4 mt-2">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            logoutMutation.mutate();
                            setMobileMenuOpen(false);
                          }}
                          className="w-full justify-start gap-3 text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <LogOut className="h-5 w-5" />
                          Logout
                        </Button>
                      </div>
                    </>
                  ) : (
                    <Link href="/auth" onClick={() => setMobileMenuOpen(false)}>
                      <Button className="w-full" style={{ backgroundColor: "#0DCEA1" }}>
                        Login / Sign Up
                      </Button>
                    </Link>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
      <WishlistFulfillmentPopup
        isOpen={showWishlistPopup}
        onClose={() => setShowWishlistPopup(false)}
      />
    </nav>
  );
}