import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Star, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const QUICK_TAGS = [
  { key: "on_time",             label: "Returned on time" },
  { key: "great_communication", label: "Great communication" },
  { key: "well_cared",          label: "Item well cared for" },
  { key: "late_return",         label: "Late return" },
  { key: "issue_reported",      label: "Issue reported" },
];

interface PostReturnReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  reviewedUserId: number;
  reviewedUserName: string;
  requestId: number;
  wasDisputed?: boolean;
  wasLate?: boolean;
}

export function PostReturnReviewModal({
  isOpen,
  onClose,
  reviewedUserId,
  reviewedUserName,
  requestId,
  wasDisputed = false,
  wasLate = false,
}: PostReturnReviewModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const defaultTags = wasDisputed
    ? ["issue_reported"]
    : wasLate
      ? ["late_return"]
      : [];

  const [rating, setRating] = useState<number>(0);
  const [hovered, setHovered] = useState<number>(0);
  const [tags, setTags] = useState<string[]>(defaultTags);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  const toggleTag = (key: string) => {
    setTags((prev) =>
      prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]
    );
  };

  const mutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/users/${reviewedUserId}/reviews`, {
        rating,
        comment: note.trim() || undefined,
        transactionId: requestId,
        feedbackTags: tags,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({ title: "Review submitted", description: "Thanks for your feedback!" });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't submit review",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const firstName = reviewedUserName.split(" ")[0];
  const canSubmit = rating > 0;

  const heading = wasDisputed
    ? "How was this experience overall?"
    : `How was your experience with ${firstName}?`;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm p-0 gap-0 overflow-hidden">
        <VisuallyHidden><DialogTitle>Leave a review</DialogTitle></VisuallyHidden>
        {/* Header */}
        <div className="px-6 pt-6 pb-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
            Transaction complete
          </p>
          <h2 className="text-lg font-bold text-foreground leading-snug">
            {heading}
          </h2>
        </div>

        {/* Stars */}
        <div className="flex justify-center gap-2 pb-5">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              onMouseEnter={() => setHovered(s)}
              onMouseLeave={() => setHovered(0)}
              onClick={() => {
                setRating(s);
                if (!showNote) setShowNote(true);
              }}
              className="transition-transform active:scale-90"
            >
              <Star
                className={cn(
                  "h-9 w-9 transition-colors",
                  (hovered || rating) >= s
                    ? "fill-amber-400 text-amber-400"
                    : "text-gray-200 fill-gray-200"
                )}
              />
            </button>
          ))}
        </div>

        {/* Quick tags */}
        <div className="px-6 pb-4">
          <p className="text-xs text-muted-foreground mb-2">Select what applied</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_TAGS.map((tag) => (
              <button
                key={tag.key}
                onClick={() => toggleTag(tag.key)}
                className={cn(
                  "text-xs px-3 py-1.5 rounded-full border font-medium transition-colors",
                  tags.includes(tag.key)
                    ? "bg-teal-600 text-white border-teal-600"
                    : "bg-white text-muted-foreground border-gray-200 hover:border-teal-400"
                )}
              >
                {tags.includes(tag.key) ? "✓ " : ""}{tag.label}
              </button>
            ))}
          </div>
        </div>

        {/* Optional note */}
        {showNote && (
          <div className="px-6 pb-4">
            <Textarea
              placeholder="Add a note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="text-sm resize-none h-20"
              maxLength={300}
            />
          </div>
        )}

        {/* Actions */}
        <div className="px-6 pb-6 flex flex-col gap-2">
          <Button
            className="w-full bg-teal-600 hover:bg-teal-700"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Submit review
          </Button>
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            Skip
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
