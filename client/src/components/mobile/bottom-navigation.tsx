import { Home, Search, MessageSquare, User, Plus } from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

const navItems = [
  { icon: Home, label: "Home", path: "/" },
  { icon: Search, label: "Browse", path: "/browse" },
  { icon: Plus, label: "Add", path: "/lend" },
  { icon: MessageSquare, label: "Chat", path: "/chat" },
  { icon: User, label: "Profile", path: "/profile" },
];

export function BottomNavigation() {
  const [location, navigate] = useLocation();

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 pb-safe">
      <div className="flex items-center justify-around py-2 px-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.path;
          
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "flex flex-col items-center justify-center p-2 rounded-lg transition-all duration-200",
                "min-w-[60px] min-h-[60px]",
                isActive
                  ? "text-primary bg-primary/10"
                  : "text-gray-600 hover:text-primary hover:bg-primary/5"
              )}
            >
              <Icon className={cn("w-6 h-6 mb-1", isActive && "scale-110")} />
              <span className="text-xs font-medium">{item.label}</span>
              {isActive && (
                <div className="absolute bottom-0 w-8 h-1 bg-primary rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}