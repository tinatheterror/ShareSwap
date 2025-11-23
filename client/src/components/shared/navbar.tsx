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
import { Coins, Gamepad2, Trophy, Heart, Crown, Users, Package, Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";

// Placeholder for NotificationBell component - actual implementation would fetch and display notifications
function NotificationBell() {
  const { user } = useAuth();

  // Fetch unread notifications (replace with actual API call)
  const { data: notifications } = useQuery({
    queryKey: ["unreadNotifications", user?.id],
    queryFn: async () => {
      // Simulate fetching unread notifications
      return { count: Math.floor(Math.random() * 5) };
    },
    enabled: !!user?.id, // Only run if user is logged in
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative p-2 hover:text-primary">
          <Bell className="h-5 w-5" />
          {(notifications?.count ?? 0) > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 p-1 text-xs font-bold flex items-center justify-center">
              {notifications?.count ?? 0}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="p-2">
          <h6 className="text-sm font-semibold text-primary mb-2">Notifications</h6>
          {(notifications?.count ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No new notifications</p>
          ) : (
            <>
              <Link href="/notifications">
                <DropdownMenuItem className="cursor-pointer hover:text-primary flex flex-col items-start">
                  <p className="font-medium">New Borrow Request</p>
                  <p className="text-xs text-muted-foreground">Someone wants to borrow your item!</p>
                </DropdownMenuItem>
              </Link>
              <DropdownMenuSeparator />
              <Link href="/notifications">
                <DropdownMenuItem className="cursor-pointer hover:text-primary">
                  <span>View All Notifications</span>
                </DropdownMenuItem>
              </Link>
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Navbar() {
  const { user, logoutMutation } = useAuth();

  return (
    <nav className="border-b bg-background">
      <div className="max-w-7xl mx-auto pl-0 pr-4 sm:pr-6 lg:pr-8">
        <div className="flex justify-between h-16 items-center">
          <Link href="/">
            <div className="flex items-center cursor-pointer pl-2">
              <img src="/shareswap-full-logo.png" alt="ShareSwap" className="h-[48px] w-auto" />
            </div>
          </Link>

          <NavigationMenu>
            <NavigationMenuList className="space-x-4">
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
                    <Link href="/premium">
                      <Button variant="ghost" className="flex items-center gap-2 hover:text-primary text-teal-600">
                        <Crown className="h-5 w-5" />
                        <span>Premium</span>
                      </Button>
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <div className="flex items-center gap-4">
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
        </div>
      </div>
    </nav>
  );
}