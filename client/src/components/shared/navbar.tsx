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
import { Link, useLocation } from "wouter";
import { Coins, Gamepad2, Trophy, Heart, Users, Package, Bell, HandHeart, HelpCircle, Menu, X, Home, User, LogOut, ArrowLeftRight, Mail, MessageSquareText, Star, TrendingUp, ShieldAlert, DollarSign, Unlock, UserCheck, Flag, Truck, Gift, HandshakeIcon, AlertTriangle, Clock, AlertCircle, ShieldCheck } from "lucide-react";
import { HeartPeopleIcon } from "@/components/ui/heart-people-icon";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import { WishlistFulfillmentPopup } from "@/components/wishlist-fulfillment-popup";
import { useUserJot } from "@/hooks/use-userjot";
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

function getNotificationIcon(type: string) {
  if (type === "return_reminder_overdue") return <AlertCircle className="h-4 w-4 text-red-500" />;
  if (type === "return_reminder_today") return <Clock className="h-4 w-4 text-orange-500" />;
  if (type === "return_reminder_tomorrow") return <Clock className="h-4 w-4 text-amber-400" />;
  if (type === "wishlist_match") return <Heart className="h-4 w-4 text-pink-500" />;
  if (type === "swap_match") return <ArrowLeftRight className="h-4 w-4 text-teal-500" />;
  if (type === "item_request" || type === "request_accepted") return <Package className="h-4 w-4 text-blue-500" />;
  if (type === "terms_counter_proposed") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (type === "terms_declined") return <AlertTriangle className="h-4 w-4 text-red-500" />;
  if (type === "gift_completed" || type === "gift_handoff_pending") return <Gift className="h-4 w-4 text-pink-500" />;
  if (type === "handoff_pending" || type === "handoff_confirmed") return <Clock className="h-4 w-4 text-amber-500" />;
  if (type === "handoff_dispute" || type === "handoff_disputed") return <AlertTriangle className="h-4 w-4 text-red-500" />;
  if (type === "handoff_flagged") return <Flag className="h-4 w-4 text-orange-500" />;
  if (type === "dispute_opened") return <ShieldAlert className="h-4 w-4 text-red-500" />;
  if (type === "delivery_confirmed") return <Truck className="h-4 w-4 text-teal-500" />;
  if (type === "courier_issue") return <AlertTriangle className="h-4 w-4 text-orange-500" />;
  if (type === "sharecoin_earned") return <Coins className="h-4 w-4 text-yellow-500" />;
  if (type === "milestone_achieved") return <Trophy className="h-4 w-4 text-amber-500" />;
  if (type === "badge_earned") return <Star className="h-4 w-4 text-purple-500" />;
  if (type === "level_up") return <TrendingUp className="h-4 w-4 text-green-500" />;
  if (type === "trust_score_changed") return <TrendingUp className="h-4 w-4 text-blue-500" />;
  if (type === "new_review_received") return <Star className="h-4 w-4 text-yellow-500" />;
  if (type === "referral_joined") return <Users className="h-4 w-4 text-teal-500" />;
  if (type === "security_deposit_released") return <Unlock className="h-4 w-4 text-green-500" />;
  if (type === "payment_received") return <DollarSign className="h-4 w-4 text-green-500" />;
  if (type === "verification_failed") return <ShieldAlert className="h-4 w-4 text-red-500" />;
  return <Bell className="h-4 w-4 text-primary" />;
}

function getNotificationUrl(n: Notification): string | null {
  if (n.requestId) return `/transactions/${n.requestId}`;
  if (n.itemId) return `/items/${n.itemId}`;
  return null;
}

function NotificationItem({ n, onAction }: { n: Notification; onAction: (n: Notification) => void }) {
  return (
    <button
      className={`w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer ${n.isRead ? "hover:bg-muted/50" : "bg-primary/5 hover:bg-primary/10"}`}
      onClick={() => onAction(n)}
    >
      <div className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-full bg-muted flex items-center justify-center">
        {getNotificationIcon(n.type)}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-snug ${n.isRead ? "font-normal text-foreground" : "font-medium text-foreground"}`}>
          {n.title}
        </p>
        {n.message && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.message}</p>
        )}
        <p className="text-xs text-muted-foreground/70 mt-1">
          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
        </p>
      </div>
      {!n.isRead && <div className="flex-shrink-0 mt-1.5 h-2 w-2 rounded-full bg-primary" />}
    </button>
  );
}

function NotificationBell() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    enabled: !!user?.id,
    refetchInterval: 120000,
  });

  const { data: allNotifications = [] } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    enabled: !!user?.id,
    refetchInterval: 120000,
  });

  useEffect(() => {
    if (!user?.id) return;
    let isCancelled = false;
    const checkReminders = async () => {
      if (isCancelled || !document.hasFocus()) return;
      try {
        await apiRequest("POST", "/api/notifications/check-return-reminders", {});
        if (!isCancelled) {
          queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
          queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
        }
      } catch {}
    };
    const timer = setTimeout(checkReminders, 5000);
    const interval = setInterval(checkReminders, 15 * 60 * 1000);
    return () => { isCancelled = true; clearTimeout(timer); clearInterval(interval); };
  }, [user?.id]);

  const markAsReadMutation = useMutation({
    mutationFn: (notificationId: number) =>
      apiRequest("PATCH", `/api/notifications/${notificationId}/read`),
    onMutate: async (notificationId: number) => {
      await queryClient.cancelQueries({ queryKey: ["/api/notifications"] });
      await queryClient.cancelQueries({ queryKey: ["/api/notifications/unread-count"] });
      const prev = queryClient.getQueryData<Notification[]>(["/api/notifications"]);
      const prevCount = queryClient.getQueryData<{ count: number }>(["/api/notifications/unread-count"]);
      queryClient.setQueryData<Notification[]>(["/api/notifications"], (old) =>
        old?.map((n) => n.id === notificationId ? { ...n, isRead: true } : n)
      );
      queryClient.setQueryData<{ count: number }>(["/api/notifications/unread-count"], (old) => ({
        count: Math.max(0, (old?.count ?? 1) - 1),
      }));
      return { prev, prevCount };
    },
    onError: (_err, _id, context) => {
      if (context?.prev) queryClient.setQueryData(["/api/notifications"], context.prev);
      if (context?.prevCount) queryClient.setQueryData(["/api/notifications/unread-count"], context.prevCount);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const handleNotificationClick = (n: Notification) => {
    if (!n.isRead) markAsReadMutation.mutate(n.id);
    const url = getNotificationUrl(n);
    if (url) navigate(url);
  };

  const unreadNotifications = allNotifications.filter((n) => !n.isRead);
  const recentNotifications = allNotifications.slice(0, 20);
  const unreadCount = unreadData?.count ?? 0;
  const hasNotifications = allNotifications.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative p-2 hover:text-primary">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 p-0 text-xs font-bold flex items-center justify-center min-w-0">
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h6 className="text-sm font-semibold">Notifications</h6>
          <Link href="/notifications" className="cursor-pointer text-xs text-primary hover:underline">
            See all
          </Link>
        </div>

        <div className="max-h-[440px] overflow-y-auto">
          {!hasNotifications ? (
            <p className="text-sm text-muted-foreground text-center py-8 px-4">
              Your recent activity will appear here
            </p>
          ) : (
            <>
              {/* Section 1: Unread */}
              {unreadNotifications.length > 0 && (
                <div>
                  <p className="px-3 pt-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Unread · {unreadNotifications.length}
                  </p>
                  <div className="px-1.5 pb-1 space-y-0.5">
                    {unreadNotifications.map((n) => (
                      <NotificationItem key={n.id} n={n} onAction={handleNotificationClick} />
                    ))}
                  </div>
                </div>
              )}

              {/* Section 2: Recent */}
              {recentNotifications.filter((n) => n.isRead).length > 0 && (
                <div className={unreadNotifications.length > 0 ? "border-t mt-1" : ""}>
                  <p className="px-3 pt-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Recent activity
                  </p>
                  <div className="px-1.5 pb-2 space-y-0.5">
                    {recentNotifications
                      .filter((n) => n.isRead)
                      .map((n) => (
                        <NotificationItem key={n.id} n={n} onAction={handleNotificationClick} />
                      ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EmailVerificationBanner() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isResending, setIsResending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  
  if (!user || user.emailVerified || user.authProvider === 'google') {
    return null;
  }
  
  const handleResend = async () => {
    setIsResending(true);
    setMessage(null);
    try {
      const response = await apiRequest('POST', '/api/auth/resend-verification');
      if (response.ok) {
        setMessage('Verification email sent! Check your inbox (and spam folder).');
      } else {
        const data = await response.json().catch(() => ({}));
        setMessage(data.message || 'Failed to send. Please try again.');
      }
    } catch (error) {
      setMessage('Failed to send verification email. Please try again.');
    }
    setIsResending(false);
  };
  
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 text-sm">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-amber-600 flex-shrink-0" />
          <span className="text-amber-800">
            {message || 'Please verify your email address to access all features.'}
          </span>
        </div>
        {!message && (
          <button
            onClick={handleResend}
            disabled={isResending}
            className="text-amber-700 hover:text-amber-900 font-medium underline underline-offset-2 disabled:opacity-50 text-left sm:text-right"
          >
            {isResending ? 'Sending...' : 'Resend email'}
          </button>
        )}
      </div>
    </div>
  );
}

export function Navbar() {
  const { user, logoutMutation } = useAuth();
  const [showWishlistPopup, setShowWishlistPopup] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileWalletOpen, setMobileWalletOpen] = useState(false);
  const tutorialWantsMenuOpen = useRef(false);

  useEffect(() => {
    const handleOpenMenu = () => {
      tutorialWantsMenuOpen.current = true;
      setMobileMenuOpen(true);
    };
    const handleCloseMenu = () => {
      tutorialWantsMenuOpen.current = false;
      setMobileMenuOpen(false);
    };
    window.addEventListener("tutorial-open-mobile-menu", handleOpenMenu);
    window.addEventListener("tutorial-close-mobile-menu", handleCloseMenu);
    return () => {
      window.removeEventListener("tutorial-open-mobile-menu", handleOpenMenu);
      window.removeEventListener("tutorial-close-mobile-menu", handleCloseMenu);
    };
  }, []);
  const { openFeedback } = useUserJot({
    userId: user?.id,
    username: user?.username,
  });

  return (
    <>
    <EmailVerificationBanner />
    <nav className="border-b bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-14 sm:h-16 items-center">
          <Link href="/">
            <div className="flex items-center cursor-pointer">
              <img src="/shareswap-full-logo.png" alt="ShareSwap" className="h-8 sm:h-12 w-auto scale-y-[0.85] sm:scale-y-100" />
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
                          <HeartPeopleIcon className="mr-2 h-4 w-4" />
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={openFeedback}
                        className="flex items-center gap-1.5 text-muted-foreground hover:text-primary hover:border-primary"
                      >
                        <MessageSquareText className="h-4 w-4" />
                        <span className="text-xs">Feedback</span>
                      </Button>
                      <NotificationBell />
                      <Link href="/profile">
                        <Avatar className="border-2 border-primary cursor-pointer hover:border-primary/80 transition-colors">
                          <AvatarFallback className="bg-primary/10 text-primary">
                            {((user as any).displayName || (user as any).handle || user.username).charAt(0).toUpperCase()}
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
                  <Button variant="outline" className="flex items-center gap-1 hover:text-primary hover:border-primary px-2 py-1 h-auto ml-1" data-tutorial="wallet">
                    <Coins className="h-3 w-3 text-primary flex-shrink-0" />
                    <div className="flex flex-col items-center">
                      <span className="text-[7px] text-muted-foreground leading-tight whitespace-nowrap">Total Balance</span>
                      <span className="text-[9px] font-medium whitespace-nowrap">{user?.shareCoins ? Number(user.shareCoins).toFixed(2) : "0.00"} ShareCoins</span>
                    </div>
                  </Button>
                </SheetTrigger>
                <SheetContent side="top" className="rounded-b-2xl pt-12 pb-6">
                  <div className="flex flex-col gap-3 pt-2">
                    <div className="flex flex-col items-center gap-1">
                      <h2 className="text-lg font-semibold text-center">Wallet</h2>
                    
                      {/* Balance Display */}
                      <div className="flex flex-col items-center rounded-lg">
                      <div className="flex items-center gap-2">
                        <Coins className="h-8 w-8 text-primary" />
                        <span className="text-3xl font-bold text-primary">{user?.shareCoins ? Number(user.shareCoins).toFixed(2) : "0.00"}</span>
                      </div>
                      <span className="text-sm text-muted-foreground mt-1">ShareCoins</span>
                      </div>
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
                          <HeartPeopleIcon className="h-5 w-5" />
                          Help Neighbours
                        </Button>
                      </div>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            )}
            {user && <NotificationBell />}
            <Sheet open={mobileMenuOpen} onOpenChange={(open) => {
              if (!open && tutorialWantsMenuOpen.current) return;
              setMobileMenuOpen(open);
            }}>
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
                              {((user as any).displayName || (user as any).handle || user.username).charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{(user as any).displayName || (user as any).handle || user.username}</p>
                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                              <User className="h-4 w-4" />
                              My Profile
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
                            openFeedback();
                            setMobileMenuOpen(false);
                          }}
                          className="w-full justify-start gap-3 text-muted-foreground hover:text-primary"
                        >
                          <MessageSquareText className="h-5 w-5" />
                          Send Feedback
                        </Button>
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
    </>
  );
}