import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  RotateCcw,
  Loader2,
  CheckCircle2,
  Shield,
  Star,
  AlertCircle,
} from "lucide-react";

interface ReturnConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: number;
  itemName: string;
  depositAmount: number;
  userRole: "owner" | "borrower";
  onSuccess: () => void;
}

const CONDITION_RATINGS = [
  { value: 5, label: "Excellent", description: "Returned in perfect condition" },
  { value: 4, label: "Good", description: "Minor wear, as expected" },
  { value: 3, label: "Fair", description: "Some wear but acceptable" },
  { value: 2, label: "Poor", description: "Noticeable damage or wear" },
  { value: 1, label: "Damaged", description: "Significant damage occurred" },
];

export function ReturnConfirmationModal({
  isOpen,
  onClose,
  requestId,
  itemName,
  depositAmount,
  userRole,
  onSuccess,
}: ReturnConfirmationModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);
  const [conditionRating, setConditionRating] = useState(5);
  const [conditionNotes, setConditionNotes] = useState("");

  const initiateReturnMutation = useMutation({
    mutationFn: async () => {
      setIsProcessing(true);
      
      const response = await apiRequest(
        "POST",
        `/api/requests/${requestId}/return`,
        {}
      );
      return response.json();
    },
    onSuccess: (data) => {
      setIsProcessing(false);
      toast({
        title: "Return initiated!",
        description: "Waiting for lender to confirm the return.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      onSuccess();
    },
    onError: (error: any) => {
      setIsProcessing(false);
      toast({
        title: "Return failed",
        description: error.message || "Failed to initiate return",
        variant: "destructive",
      });
    },
  });

  const confirmReturnMutation = useMutation({
    mutationFn: async () => {
      setIsProcessing(true);
      
      const response = await apiRequest(
        "POST",
        `/api/requests/${requestId}/confirm-return`,
        {
          conditionRating,
          conditionNotes,
        }
      );
      return response.json();
    },
    onSuccess: (data) => {
      setIsProcessing(false);
      toast({
        title: "Return confirmed!",
        description: `Deposit of $${depositAmount} has been released.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      onSuccess();
    },
    onError: (error: any) => {
      setIsProcessing(false);
      toast({
        title: "Confirmation failed",
        description: error.message || "Failed to confirm return",
        variant: "destructive",
      });
    },
  });

  if (userRole === "borrower") {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-blue-600" />
              Return Item
            </DialogTitle>
            <DialogDescription>
              Initiate the return of{" "}
              <span className="font-medium text-gray-900">{itemName}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-blue-700 font-medium">
                <Shield className="h-4 w-4" />
                Your deposit will be released after lender confirms
              </div>
              <p className="text-sm text-blue-600 mt-1">
                Once the lender confirms the item is returned in good condition,
                your ${depositAmount} deposit will be automatically released.
              </p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
                <p className="text-xs text-amber-700">
                  Make sure you've returned the item to the lender before
                  initiating the return process.
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isProcessing}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={() => initiateReturnMutation.mutate()}
              disabled={isProcessing}
              className="flex-1 bg-blue-600 hover:bg-blue-700"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Initiating...
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Initiate Return
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Confirm Item Return
          </DialogTitle>
          <DialogDescription>
            Confirm that{" "}
            <span className="font-medium text-gray-900">{itemName}</span> has
            been returned
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Star className="h-4 w-4 text-amber-500" />
              Rate Item Condition
            </Label>
            <div className="space-y-2">
              {CONDITION_RATINGS.map((rating) => (
                <div
                  key={rating.value}
                  onClick={() => setConditionRating(rating.value)}
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                    conditionRating === rating.value
                      ? "border-teal-500 bg-teal-50"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <div>
                    <div className="font-medium text-sm">{rating.label}</div>
                    <div className="text-xs text-gray-500">
                      {rating.description}
                    </div>
                  </div>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={`h-4 w-4 ${
                          star <= rating.value
                            ? "fill-amber-400 text-amber-400"
                            : "text-gray-300"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Additional Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="Any comments about the item condition..."
              value={conditionNotes}
              onChange={(e) => setConditionNotes(e.target.value)}
              rows={2}
            />
          </div>

          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <div className="flex items-center gap-2 text-green-700 text-sm font-medium">
              <Shield className="h-4 w-4" />
              Borrower's deposit of ${depositAmount} will be released
            </div>
            <p className="text-xs text-green-600 mt-1">
              The borrower's trust score will also be updated based on your rating.
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isProcessing}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={() => confirmReturnMutation.mutate()}
            disabled={isProcessing}
            className="flex-1 bg-green-600 hover:bg-green-700"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Confirming...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Confirm Return
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
