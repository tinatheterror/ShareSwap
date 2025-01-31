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
import { MessageCircle, Coins, Gamepad2, PlayCircle, InboxIcon } from "lucide-react";

export function Navbar() {
  const { user, logoutMutation } = useAuth();

  return (
    <nav className="border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <Link href="/">
            <a className="text-xl font-bold">ShareSwap</a>
          </Link>

          <NavigationMenu>
            <NavigationMenuList className="space-x-4">
              {user ? (
                <>
                  <NavigationMenuItem>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="flex items-center gap-2">
                          <Coins className="h-5 w-5 text-yellow-500" />
                          <div className="flex flex-col items-start">
                            <span className="text-xs text-muted-foreground">Total Balance</span>
                            <span>{user?.shareCoins ? Number(user.shareCoins).toFixed(2) : "0.00"} ShareCoins</span>
                          </div>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <Link href="/wallet">
                          <DropdownMenuItem className="cursor-pointer">
                            <Coins className="mr-2 h-4 w-4" />
                            <span>View Transactions</span>
                          </DropdownMenuItem>
                        </Link>
                        <DropdownMenuSeparator />
                        <h6 className="px-2 py-1.5 text-sm font-semibold">Earn More ShareCoins</h6>
                        <DropdownMenuItem className="cursor-pointer">
                          <PlayCircle className="mr-2 h-4 w-4" />
                          <span>Watch Advertisements</span>
                        </DropdownMenuItem>
                        <Link href="/games">
                          <DropdownMenuItem className="cursor-pointer">
                            <Gamepad2 className="mr-2 h-4 w-4" />
                            <span>Play Games</span>
                          </DropdownMenuItem>
                        </Link>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link href="/chat">
                      <Button variant="outline" className="flex items-center gap-2">
                        <MessageCircle className="h-5 w-5" />
                        <span>Messages</span>
                      </Button>
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link href="/requests">
                      <Button variant="outline" className="flex items-center gap-2">
                        <InboxIcon className="h-5 w-5" />
                        <span>Requests</span>
                      </Button>
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <div className="flex items-center gap-4">
                      <Avatar>
                        <AvatarFallback>
                          {user.username.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <Button
                        variant="outline"
                        onClick={() => logoutMutation.mutate()}
                      >
                        Logout
                      </Button>
                    </div>
                  </NavigationMenuItem>
                </>
              ) : (
                <NavigationMenuItem>
                  <Link href="/auth">
                    <Button>Login</Button>
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