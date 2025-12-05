import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Heart, HandHeart, ArrowRightLeft, Repeat, MapPin, Calendar } from "lucide-react";
import { useState, useEffect } from "react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  initialItemName: string;
};

export function WishlistFormDialog({ isOpen, onClose, initialItemName }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState({
    itemName: initialItemName,
    description: "",
    needTypes: ["borrow"] as string[],
    preferredLocation: "",
    neededFromDate: "",
    neededToDate: "",
  });

  useEffect(() => {
    if (isOpen) {
      setFormData({
        itemName: initialItemName,
        description: "",
        needTypes: ["borrow"],
        preferredLocation: "",
        neededFromDate: "",
        neededToDate: "",
      });
    }
  }, [isOpen, initialItemName]);

  const toggleNeedType = (type: string) => {
    setFormData((prev) => {
      const current = prev.needTypes;
      if (current.includes(type)) {
        if (current.length === 1) return prev;
        return { ...prev, needTypes: current.filter((t) => t !== type) };
      } else {
        return { ...prev, needTypes: [...current, type] };
      }
    });
  };

  const addWishlistMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/wishlists", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/all-wishlists"] });
      toast({
        title: "Wishlist item added!",
        description: "We'll notify you when matching items become available.",
      });
      onClose();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add wishlist item. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.itemName) {
      toast({
        title: "Item name required",
        description: "Please enter the name of the item you're looking for.",
        variant: "destructive",
      });
      return;
    }
    addWishlistMutation.mutate({
      ...formData,
      needType: formData.needTypes.join(","),
      neededDate: formData.neededFromDate,
      returnDate: formData.neededToDate,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-primary" />
            Add to Wishlist
          </DialogTitle>
          <DialogDescription>
            Tell us what you're looking for and we'll notify you when it is
            available.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">I need</label>
            <Input
              value={formData.itemName}
              onChange={(e) =>
                setFormData({ ...formData, itemName: e.target.value })
              }
              placeholder="e.g., Power drill, Camping tent, Stand mixer"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Description
            </label>
            <Textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder="Describe what you need this item for or any specific requirements..."
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              I want to
            </label>
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant={
                  formData.needTypes.includes("borrow")
                    ? "default"
                    : "outline"
                }
                size="sm"
                className="justify-center"
                onClick={() => toggleNeedType("borrow")}
              >
                <HandHeart className="h-4 w-4 mr-1" />
                Borrow It
              </Button>
              <Button
                type="button"
                variant={
                  formData.needTypes.includes("rent")
                    ? "default"
                    : "outline"
                }
                size="sm"
                className="justify-center"
                onClick={() => toggleNeedType("rent")}
              >
                <ArrowRightLeft className="h-4 w-4 mr-1" />
                Rent It
              </Button>
              <Button
                type="button"
                variant={
                  formData.needTypes.includes("swap")
                    ? "default"
                    : "outline"
                }
                size="sm"
                className="justify-center"
                onClick={() => toggleNeedType("swap")}
              >
                <Repeat className="h-4 w-4 mr-1" />
                Swap It
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              <Calendar className="h-4 w-4 inline mr-1" />
              When do you need it?
            </label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  From
                </label>
                <Input
                  type="date"
                  value={formData.neededFromDate}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      neededFromDate: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  To
                </label>
                <Input
                  type="date"
                  value={formData.neededToDate}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      neededToDate: e.target.value,
                    })
                  }
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              <MapPin className="h-4 w-4 inline mr-1" />
              Preferred Location
            </label>
            <Input
              value={formData.preferredLocation}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  preferredLocation: e.target.value,
                })
              }
              placeholder="e.g., Downtown, North side, etc."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={addWishlistMutation.isPending}>
              {addWishlistMutation.isPending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Adding...
                </>
              ) : (
                <>
                  <Heart className="h-4 w-4 mr-2" />
                  Add to Wishlist
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
