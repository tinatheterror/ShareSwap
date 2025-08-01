import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, MapPin, Clock, Star } from "lucide-react";

interface FilterState {
  distance: number[];
  priceRange: number[];
  availability: "all" | "today" | "week" | "month";
  condition: string[];
  verificationLevel: string[];
  rating: number;
  freeOnly: boolean;
}

interface AdvancedFiltersProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  onClose: () => void;
}

const conditionOptions = ["new", "like-new", "good", "fair"];
const verificationOptions = ["verified", "trusted", "expert"];

export function AdvancedFilters({ filters, onFiltersChange, onClose }: AdvancedFiltersProps) {
  const [localFilters, setLocalFilters] = useState<FilterState>(filters);

  const updateFilter = (key: keyof FilterState, value: any) => {
    setLocalFilters(prev => ({ ...prev, [key]: value }));
  };

  const toggleArrayFilter = (key: "condition" | "verificationLevel", value: string) => {
    const current = localFilters[key];
    const updated = current.includes(value) 
      ? current.filter(item => item !== value)
      : [...current, value];
    updateFilter(key, updated);
  };

  const applyFilters = () => {
    onFiltersChange(localFilters);
    onClose();
  };

  const clearFilters = () => {
    const defaultFilters: FilterState = {
      distance: [50],
      priceRange: [0, 1000],
      availability: "all",
      condition: [],
      verificationLevel: [],
      rating: 0,
      freeOnly: false
    };
    setLocalFilters(defaultFilters);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Advanced Filters</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {/* Distance Filter */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="w-4 h-4 text-primary" />
              <label className="font-medium">Distance</label>
            </div>
            <Slider
              value={localFilters.distance}
              onValueChange={(value) => updateFilter("distance", value)}
              max={100}
              min={1}
              step={1}
              className="mb-2"
            />
            <div className="text-sm text-gray-600">
              Within {localFilters.distance[0]} km
            </div>
          </div>

          {/* Price Range */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="font-medium">Price Range (per day)</span>
            </div>
            <Slider
              value={localFilters.priceRange}
              onValueChange={(value) => updateFilter("priceRange", value)}
              max={1000}
              min={0}
              step={10}
              className="mb-2"
            />
            <div className="text-sm text-gray-600">
              ${localFilters.priceRange[0]} - ${localFilters.priceRange[1]}
            </div>
          </div>

          {/* Free Only Toggle */}
          <div className="flex items-center justify-between">
            <span className="font-medium">Free items only</span>
            <Switch
              checked={localFilters.freeOnly}
              onCheckedChange={(checked) => updateFilter("freeOnly", checked)}
            />
          </div>

          {/* Availability */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-primary" />
              <label className="font-medium">Availability</label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "all", label: "Anytime" },
                { value: "today", label: "Today" },
                { value: "week", label: "This Week" },
                { value: "month", label: "This Month" }
              ].map(option => (
                <button
                  key={option.value}
                  onClick={() => updateFilter("availability", option.value)}
                  className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                    localFilters.availability === option.value
                      ? "border-primary bg-primary text-white"
                      : "border-gray-200 hover:border-primary"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Item Condition */}
          <div>
            <label className="font-medium mb-3 block">Item Condition</label>
            <div className="flex flex-wrap gap-2">
              {conditionOptions.map(condition => (
                <Badge
                  key={condition}
                  variant={localFilters.condition.includes(condition) ? "default" : "outline"}
                  className="cursor-pointer capitalize"
                  onClick={() => toggleArrayFilter("condition", condition)}
                >
                  {condition}
                </Badge>
              ))}
            </div>
          </div>

          {/* User Verification */}
          <div>
            <label className="font-medium mb-3 block">User Verification</label>
            <div className="flex flex-wrap gap-2">
              {verificationOptions.map(level => (
                <Badge
                  key={level}
                  variant={localFilters.verificationLevel.includes(level) ? "default" : "outline"}
                  className="cursor-pointer capitalize"
                  onClick={() => toggleArrayFilter("verificationLevel", level)}
                >
                  {level}
                </Badge>
              ))}
            </div>
          </div>

          {/* Minimum Rating */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Star className="w-4 h-4 text-primary" />
              <label className="font-medium">Minimum Rating</label>
            </div>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(rating => (
                <button
                  key={rating}
                  onClick={() => updateFilter("rating", rating)}
                  className={`p-1 ${
                    localFilters.rating >= rating ? "text-yellow-400" : "text-gray-300"
                  }`}
                >
                  <Star className="w-6 h-6 fill-current" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t p-4 flex gap-3">
          <Button variant="outline" onClick={clearFilters} className="flex-1">
            Clear All
          </Button>
          <Button onClick={applyFilters} className="flex-1">
            Apply Filters
          </Button>
        </div>
      </div>
    </div>
  );
}