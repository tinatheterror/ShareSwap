import { 
  Laptop, 
  Car, 
  Wrench, 
  BookOpen, 
  Camera, 
  Music, 
  Gamepad2, 
  Home, 
  Shirt,
  Utensils,
  Baby,
  Dumbbell
} from "lucide-react";
import { cn } from "@/lib/utils";

const categories = [
  { id: "electronics", name: "Electronics", icon: Laptop, color: "bg-blue-100 text-blue-600" },
  { id: "vehicles", name: "Vehicles", icon: Car, color: "bg-red-100 text-red-600" },
  { id: "tools", name: "Tools", icon: Wrench, color: "bg-orange-100 text-orange-600" },
  { id: "books", name: "Books", icon: BookOpen, color: "bg-green-100 text-green-600" },
  { id: "photography", name: "Photography", icon: Camera, color: "bg-purple-100 text-purple-600" },
  { id: "music", name: "Music", icon: Music, color: "bg-pink-100 text-pink-600" },
  { id: "gaming", name: "Gaming", icon: Gamepad2, color: "bg-indigo-100 text-indigo-600" },
  { id: "household", name: "Household", icon: Home, color: "bg-yellow-100 text-yellow-600" },
  { id: "clothing", name: "Clothing", icon: Shirt, color: "bg-teal-100 text-teal-600" },
  { id: "kitchen", name: "Kitchen", icon: Utensils, color: "bg-amber-100 text-amber-600" },
  { id: "baby", name: "Baby & Kids", icon: Baby, color: "bg-rose-100 text-rose-600" },
  { id: "fitness", name: "Fitness", icon: Dumbbell, color: "bg-emerald-100 text-emerald-600" },
];

interface CategoryBrowserProps {
  onCategorySelect: (categoryId: string) => void;
  selectedCategory?: string;
}

export function CategoryBrowser({ onCategorySelect, selectedCategory }: CategoryBrowserProps) {
  return (
    <div className="p-4">
      <h3 className="text-lg font-semibold mb-4">Browse by Category</h3>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
        {categories.map((category) => {
          const Icon = category.icon;
          const isSelected = selectedCategory === category.id;
          
          return (
            <button
              key={category.id}
              onClick={() => onCategorySelect(category.id)}
              className={cn(
                "flex flex-col items-center p-4 rounded-2xl transition-all duration-200",
                "hover:scale-105 active:scale-95",
                isSelected 
                  ? "bg-primary text-white shadow-lg" 
                  : `${category.color} hover:shadow-md`
              )}
            >
              <Icon className="w-8 h-8 mb-2" />
              <span className="text-sm font-medium text-center leading-tight">
                {category.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}