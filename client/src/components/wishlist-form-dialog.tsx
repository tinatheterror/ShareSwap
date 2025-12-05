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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Heart, Clock, Calendar, Sparkles } from "lucide-react";
import { useState } from "react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  initialItemName: string;
};

export function WishlistFormDialog({ isOpen, onClose, initialItemName }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [itemName, setItemName] = useState(initialItemName);
  const [urgency, setUrgency] = useState("normal");
  const [description, setDescription] = useState("");

  const addWishlistMutation = useMutation({
    mutationFn: (data: { itemName: string; urgency: string; description?: string }) => {
      return apiRequest("POST", "/api/wishlists", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/all-wishlists"] });
      toast({
        title: "Added to wishlist!",
        description: "You'll be notified when someone shares this item.",
      });
      onClose();
      setItemName("");
      setUrgency("normal");
      setDescription("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add to wishlist. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim()) {
      toast({
        title: "Item name required",
        description: "Please enter the name of the item you're looking for.",
        variant: "destructive",
      });
      return;
    }
    addWishlistMutation.mutate({
      itemName: itemName.trim(),
      urgency,
      description: description.trim() || undefined,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-pink-500" />
            Add to Wishlist
          </DialogTitle>
          <DialogDescription>
            Tell us what you're looking for and we'll notify you when it becomes available.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="itemName" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-teal-600" />
              What are you looking for?
            </Label>
            <Input
              id="itemName"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="e.g., Camping tent, Power drill, Baby stroller..."
              className="text-base"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="urgency" className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-600" />
              When do you need it?
            </Label>
            <Select value={urgency} onValueChange={setUrgency}>
              <SelectTrigger>
                <SelectValue placeholder="Select urgency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                    No rush - Whenever available
                  </div>
                </SelectItem>
                <SelectItem value="normal">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    Soon - Within the next few weeks
                  </div>
                </SelectItem>
                <SelectItem value="high">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    This week - Need it fairly soon
                  </div>
                </SelectItem>
                <SelectItem value="urgent">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500"></span>
                    ASAP - Need it right away!
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-purple-600" />
              Any specific details? (optional)
            </Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Prefer 4-person tent, need it for a camping trip next month..."
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={addWishlistMutation.isPending}
              style={{ backgroundColor: "#0DCEA1" }}
              className="text-white"
            >
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
