import { useEffect, useRef, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  RotateCcw,
  Loader2,
  CheckCircle2,
  Shield,
  Star,
  AlertCircle,
  AlertTriangle,
  Clock,
  Camera,
  X,
  ImagePlus,
  MessageSquare,
} from "lucide-react";

interface ReturnConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: number;
  itemName: string;
  depositAmount: number;
  userRole: "owner" | "borrower";
  requestType?: "BORROW" | "RENT";
  endDate?: string | Date | null;
  depositMethod?: string | null;
  onSuccess: () => void;
}

const CONDITION_RATINGS = [
  {
    value: 5,
    label: "Excellent",
    description: "Returned in perfect condition",
  },
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
  requestType = "BORROW",
  endDate,
  depositMethod,
  onSuccess,
}: ReturnConfirmationModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);
  const [sameCondition, setSameCondition] = useState(true);
  const [conditionRating, setConditionRating] = useState(5);
  const [conditionNotes, setConditionNotes] = useState("");
  const [confirmDispute, setConfirmDispute] = useState(false);
  const [disputePhoto, setDisputePhoto] = useState<File | null>(null);
  const [disputePhotoPreview, setDisputePhotoPreview] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const completionHandled = useRef(false);

  useEffect(() => {
    setRecoveryPending(false);
    if (isOpen) completionHandled.current = false;
  }, [isOpen, requestId, userRole]);

  const recoveryStatus = useQuery<Array<{ id: number; status: string }>>({
    queryKey: ["return-recovery-status", requestId],
    queryFn: async () => (await apiRequest("GET", "/api/requests")).json(),
    enabled: isOpen && userRole === "owner" && recoveryPending,
    refetchInterval: recoveryPending ? 3000 : false,
    retry: false,
  });

  useEffect(() => {
    if (!isOpen || !recoveryPending || completionHandled.current) return;
    const recovered = recoveryStatus.data?.find(request => request.id === requestId);
    if (!recovered || !["COMPLETED", "COMPLETED_EARLY"].includes(recovered.status)) return;
    completionHandled.current = true;
    setRecoveryPending(false);
    setIsProcessing(false);
    queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
    queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    toast({ title: "Return confirmed", description: "The return confirmation has been recovered and saved." });
    onSuccess();
  }, [isOpen, recoveryPending, recoveryStatus.data, requestId, queryClient, toast, onSuccess]);

  const shouldTriggerDispute = !sameCondition && conditionRating <= 2;
  const isRental = requestType === "RENT";
  const isEarlyReturn = endDate ? new Date() < new Date(endDate) : false;

  const initiateReturnMutation = useMutation({
    mutationFn: async () => {
      setIsProcessing(true);

      const response = await apiRequest(
        "POST",
        `/api/requests/${requestId}/return`,
        {},
      );
      return response.json();
    },
    onSuccess: (data) => {
      setIsProcessing(false);
      if (isEarlyReturn) {
        toast({
          title: "EARLY RETURN INITIATED",
          description: "Waiting for owner to confirm. No refund for unused days.",
        });
      } else {
        toast({
          title: "Return initiated!",
          description: "Waiting for owner to confirm the return.",
        });
      }
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

      let disputePhotoUrl: string | null = null;
      if (shouldTriggerDispute && disputePhoto) {
        setIsUploadingPhoto(true);
        const formData = new FormData();
        formData.append("photo", disputePhoto);
        const csrfRes = await fetch("/api/csrf-token", { credentials: "include" });
        const { csrfToken } = await csrfRes.json();
        const uploadRes = await fetch("/api/uploads/dispute-photo", {
          method: "POST",
          credentials: "include",
          headers: { "x-csrf-token": csrfToken },
          body: formData,
        });
        setIsUploadingPhoto(false);
        if (uploadRes.ok) {
          const data = await uploadRes.json();
          disputePhotoUrl = data.url;
        }
      }

      const response = await apiRequest(
        "POST",
        `/api/requests/${requestId}/confirm-return`,
        {
          conditionRating,
          conditionNotes,
          sameCondition,
          triggerDispute: shouldTriggerDispute,
          disputePhotoUrl,
        },
      );
      return response.json();
    },
    onSuccess: (data) => {
      if (completionHandled.current) return;
      completionHandled.current = true;
      setRecoveryPending(false);
      setIsProcessing(false);
      if (shouldTriggerDispute) {
        toast({
          title: "Dispute opened",
          description: "We'll review your claim and contact both parties.",
        });
      } else if (isEarlyReturn && isRental) {
        toast({
          title: "Item returned early. Rental period is completed.",
          description: `Deposit hold released — you were not charged for the deposit. Full rental fee was charged.`,
        });
      } else if (isEarlyReturn) {
        toast({
          title: "Item returned early. Deposit hold released.",
          description: `The temporary security deposit hold has been released. You were not charged.`,
        });
      } else {
        toast({
          title: "Return confirmed!",
          description: isRental
            ? `Deposit hold released — you were not charged for the deposit. Rental earnings added to your balance.`
            : `The temporary security deposit hold has been released. You were not charged.`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      onSuccess();
    },
    onError: (error: any) => {
      setIsProcessing(false);
      setRecoveryPending(error.status === 503);
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
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
        <DialogContent className="sm:max-w-md flex flex-col max-h-[90dvh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-blue-600" />
              {isEarlyReturn ? "Return Item Early" : "Return Item"}
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 -mx-1 px-1">
          <div className="space-y-4 py-4">
            {isEarlyReturn && (
              <p className="text-sm text-gray-600">
                {isRental
                  ? "You're returning this item before your rental period ends. No refund will be issued for unused days."
                  : "You're returning this item early. No penalty applies. The temporary deposit hold will be released once the owner confirms its safe return — you will not be charged."}
              </p>
            )}

            {depositMethod === "in_person" ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-center gap-2 text-amber-700 font-medium">
                  <Shield className="h-4 w-4" />
                  Remember to collect your deposit back in person
                </div>
                <p className="text-sm text-amber-600 mt-1">
                  {`Your $${depositAmount} deposit was paid in person. Make sure the owner returns it to you when you hand back the item.`}
                </p>
              </div>
            ) : null}

            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700">
                {isEarlyReturn
                  ? "Only initiate the early return process after you've communicated and returned the item to the owner."
                  : "Only confirm the return after you've physically handed the item back to the owner."}
              </p>
            </div>
          </div>
          </div>

          <div className="flex gap-3 pt-2">
            {isEarlyReturn && (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  onClose();
                  window.dispatchEvent(
                    new CustomEvent("open-chat-request", { detail: { requestId } })
                  );
                }}
              >
                <MessageSquare className="h-4 w-4 mr-1.5" />
                Message Owner
              </Button>
            )}
            <Button
              className="flex-1 bg-blue-600 hover:bg-blue-700"
              disabled={isProcessing || initiateReturnMutation.isPending}
              onClick={() => initiateReturnMutation.mutate()}
            >
              {initiateReturnMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              {isEarlyReturn ? "Initiate Early Return" : "Return Item"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md flex flex-col max-h-[90dvh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            {isEarlyReturn ? "Confirm Early Return" : "Confirm Item Return"}
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 -mx-1 px-1">
        <div className="space-y-4 py-4">
          {recoveryPending && (
            <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
              Return confirmation is being recovered. Checking for completion—you can retry safely or close this dialog.
            </div>
          )}
          {isEarlyReturn && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-blue-700 font-medium">
                <Clock className="h-4 w-4" />
                Early Return
              </div>
              <p className="text-sm text-blue-600 mt-1">
                {isRental
                  ? "You keep the full rental amount — no refund for unused days."
                  : "No ShareCoins deducted for early return. Borrower's temporary deposit hold will be released."}
              </p>
            </div>
          )}

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="sameCondition"
                checked={sameCondition}
                disabled={recoveryPending}
                onCheckedChange={(checked) => {
                  setSameCondition(checked === true);
                  if (checked) {
                    setConditionRating(5);
                    setConfirmDispute(false);
                  } else {
                    setConditionRating(4);
                  }
                }}
                className="mt-0.5 h-5 w-5 rounded-none"
              />
              <div className="flex-1">
                <Label
                  htmlFor="sameCondition"
                  className="text-sm font-medium cursor-pointer"
                >
                  Returned in the same condition
                </Label>
                <p className="text-xs text-gray-500 mt-1">
                  Item was returned with no damage or issues
                </p>
              </div>
            </div>
          </div>

          {!sameCondition && (
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <Star className="h-4 w-4 text-amber-500" />
                Rate Item Condition
              </Label>
              <div className="space-y-2">
                {CONDITION_RATINGS.filter((r) => r.value < 5).map((rating) => (
                  <div
                    key={rating.value}
                    onClick={() => { if (!recoveryPending) setConditionRating(rating.value); }}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                      conditionRating === rating.value
                        ? "border-teal-500 bg-teal-50"
                        : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-baseline gap-2">
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
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">
              Additional Notes{" "}
              {!sameCondition ? "(describe the issue)" : "(optional)"}
            </Label>
            <Textarea
              id="notes"
              placeholder={
                !sameCondition
                  ? "Please describe what happened to the item..."
                  : "Any comments about the item condition..."
              }
              value={conditionNotes}
              disabled={recoveryPending}
              onChange={(e) => setConditionNotes(e.target.value)}
              rows={2}
              required={!sameCondition}
            />
          </div>

          {shouldTriggerDispute && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
                <div className="flex-1 space-y-3">
                  <div>
                    <h4 className="font-medium text-red-800 text-sm">
                      This will open a dispute
                    </h4>
                    <p className="text-xs text-red-600 mt-1">
                      Since you reported damage, the{" "}
                      {isRental ? "renter's" : "borrower's"} ${depositAmount}{" "}
                      deposit hold will be converted into a charge while we review.
                      It is refunded if the claim is resolved in the{" "}
                      {isRental ? "renter's" : "borrower's"} favor. Both parties will be contacted to
                      resolve this.
                    </p>
                  </div>

                  {/* Photo evidence */}
                  <div>
                    <p className="text-xs font-medium text-red-800 mb-2 flex items-center gap-1.5">
                      <Camera className="h-3.5 w-3.5" />
                      Add a photo of the damage (recommended)
                    </p>
                    {disputePhotoPreview ? (
                      <div className="relative inline-block">
                        <img
                          src={disputePhotoPreview}
                          alt="Damage evidence"
                          className="h-28 w-28 object-cover rounded-lg border border-red-200"
                        />
                        <button
                          type="button"
                          onClick={() => { setDisputePhoto(null); setDisputePhotoPreview(null); }}
                          className="absolute -top-1.5 -right-1.5 h-5 w-5 bg-white border border-gray-300 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50"
                        >
                          <X className="h-3 w-3 text-gray-600" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center gap-2 cursor-pointer w-fit">
                        <div className="flex items-center gap-2 px-3 py-2 border border-dashed border-red-300 rounded-lg text-xs text-red-700 hover:bg-red-100 transition-colors">
                          <ImagePlus className="h-4 w-4" />
                          Take photo or upload
                        </div>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setDisputePhoto(file);
                            const reader = new FileReader();
                            reader.onloadend = () => setDisputePhotoPreview(reader.result as string);
                            reader.readAsDataURL(file);
                          }}
                        />
                      </label>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="confirmDispute"
                      checked={confirmDispute}
                      onCheckedChange={(checked) =>
                        setConfirmDispute(checked === true)
                      }
                      className="h-5 w-5 rounded-none"
                    />
                    <Label
                      htmlFor="confirmDispute"
                      className="text-xs text-red-700 cursor-pointer"
                    >
                      I understand and want to proceed with the dispute
                    </Label>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        </div>

        <div className="flex gap-3 pt-2">
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
            disabled={
              isProcessing ||
              (shouldTriggerDispute && !confirmDispute) ||
              (!sameCondition && !conditionNotes.trim())
            }
            className={`flex-1 ${shouldTriggerDispute ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}`}
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isUploadingPhoto ? "Uploading photo…" : shouldTriggerDispute ? "Opening Dispute…" : "Confirming…"}
              </>
            ) : (
              <>
                {shouldTriggerDispute ? (
                  <>
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    Open Dispute
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Confirm Return
                  </>
                )}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
