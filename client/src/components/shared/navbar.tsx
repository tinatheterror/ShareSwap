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
import { MessageCircle, Coins, Gamepad2, Trophy, Heart, Crown, Users, Package } from "lucide-react";

export function Navbar() {
  const { user, logoutMutation } = useAuth();

  return (
    <nav className="border-b bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer">
              <span className="text-xl font-bold bg-gradient-to-r from-primary to-primary/80 bg-clip-text text-transparent">
                ShareSwap
              </span>
            </div>
          </Link>

          <NavigationMenu>
            <NavigationMenuList className="space-x-4">
              {user ? (
                <>
                  <NavigationMenuItem>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="flex items-center gap-2 hover:text-primary hover:border-primary">
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
                        <DropdownMenuSeparator />
                        <h6 className="px-2 py-1.5 text-sm font-semibold text-primary">Earn More ShareCoins</h6>
                        <Link href="/games">
                          <DropdownMenuItem className="cursor-pointer hover:text-primary">
                            <Gamepad2 className="mr-2 h-4 w-4" />
                            <span>Play Games</span>
                          </DropdownMenuItem>
                        </Link>
                        <Link href="/achievements">
                          <DropdownMenuItem className="cursor-pointer hover:text-primary">
                            <Trophy className="mr-2 h-4 w-4" />
                            <span>Achievements</span>
                          </DropdownMenuItem>
                        </Link>
                        <Link href="/wishlists">
                          <DropdownMenuItem className="cursor-pointer hover:text-primary">
                            <Heart className="mr-2 h-4 w-4" />
                            <span>My Wishlist</span>
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
                      <Button variant="ghost" className="flex items-center gap-2 hover:text-primary">
                        <Package className="h-5 w-5" />
                        <span>My ShareChest</span>
                      </Button>
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link href="/chat">
                      <Button variant="ghost" className="flex items-center gap-2 hover:text-primary">
                        <MessageCircle className="h-5 w-5" />
                        <span>Messages</span>
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