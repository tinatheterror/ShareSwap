import { useAuth } from "@/hooks/use-auth";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
} from "@/components/ui/navigation-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Link } from "wouter";

export function Navbar() {
  const { user, logoutMutation } = useAuth();

  return (
    <nav className="border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <Link href="/">
            <a className="text-xl font-bold">ShareChest</a>
          </Link>

          <NavigationMenu>
            <NavigationMenuList className="space-x-4">
              {user ? (
                <>
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
