import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, CheckCircle2, AlertTriangle, KeyRound } from "lucide-react";

interface HandoffConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: number;
  itemName: string;
  shareCoinAmount: number;
  userRole: "owner" | "borrower";
  deliveryMethod: "in_person" | "courier";
  otherPartyConfirmed?: boolean;
  requestType?: "BORROW" | "RENT";
  pinExpiresAt?: string | null;
  pinUsed?: boolean;
  onSuccess: () => void;
}

type BorrowerView = "pin" | "manual" | "wrong_pin" | "expired" | "rate_limited";

export function HandoffConfirmationModal({
  isOpen,
  onClose,
  requestId,
  itemName,
  shareCoinAmount,
  userRole,
  deliveryMethod,
  otherPartyConfirmed = false,
  requestType = "BORROW",
  pinExpiresAt,
  pinUsed,
  onSuccess,
}: HandoffConfirmationModalProps) {
  const isRental = requestType === "RENT";
  const otherParty = isRental ? "renter" : "borrower";
  const OtherParty = otherParty.charAt(0).toUpperCase() + otherParty.slice(1);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Borrower state
  const [pinDigits, setPinDigits] = useState(["", "", "", ""]);
  const [view, setView] = useState<BorrowerView>("pin");
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [showDenyView, setShowDenyView] = useState(false);
  const inputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  const isPinExpired = pinExpiresAt ? new Date(pinExpiresAt) < new Date() : false;

  useEffect(() => {
    if (isOpen) {
      setPinDigits(["", "", "", ""]);
      setView(isPinExpired ? "expired" : "pin");
      setShowDenyView(false);
      // Auto-focus first digit after a tick
      setTimeout(() => inputRefs[0].current?.focus(), 100);
    }
  }, [isOpen]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
    queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
    queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
  };

  const verifyPinMutation = useMutation({
    mutationFn: async (pin: string) => {
      const res = await apiRequest("POST", `/api/requests/${requestId}/verify-pin`, { pin });
      const data = await res.json();
      if (!res.ok) throw data;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Handoff confirmed!", description: "Borrow period has started." });
      onSuccess();
    },
    onError: (err: any) => {
      if (err.rateLimited) {
        setView("rate_limited");
      } else if (err.expired) {
        setView("expired");
      } else if (err.incorrect) {
        setView("wrong_pin");
        setAttemptsRemaining(err.attemptsRemaining ?? null);
      } else {
        toast({ title: "Error", description: err.error || "Failed to verify PIN", variant: "destructive" });
      }
    },
  });

  const confirmHandoffMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/requests/${requestId}/handoff`, { confirmedBy: userRole });
      return res.json();
    },
    onSuccess: (data) => {
      invalidate();
      if (data.disputeTriggered) {
        toast({ title: "Dispute opened", description: "We've paused this transaction while we review.", variant: "destructive" });
      } else if (data.bothConfirmed) {
        toast({ title: "Handoff complete", description: "Borrow period has started." });
      }
      onSuccess();
    },
    onError: (error: any) => {
      toast({ title: "Handoff failed", description: error.message || "Failed to confirm handoff", variant: "destructive" });
    },
  });

  const denyHandoffMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/requests/${requestId}/deny-handoff`, {});
      return res.json();
    },
    onSuccess: (data) => {
      invalidate();
      if (data.disputeTriggered) {
        toast({ title: "Dispute opened", description: "We've paused this transaction while both sides are reviewed.", variant: "destructive" });
      } else {
        toast({ title: "Reported", description: "The other party has 24 hours to respond, then this will be flagged for review." });
      }
      onSuccess();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to report issue", variant: "destructive" });
    },
  });

  const isProcessing = verifyPinMutation.isPending || confirmHandoffMutation.isPending || denyHandoffMutation.isPending;

  const handleDigitChange = (i: number, val: string) => {
    if (!/^\d?$/.test(val)) return;
    const next = [...pinDigits];
    next[i] = val;
    setPinDigits(next);
    if (val && i < 3) inputRefs[i + 1].current?.focus();
    if (next.every((d) => d !== "")) {
      verifyPinMutation.mutate(next.join(""));
    }
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !pinDigits[i] && i > 0) {
      inputRefs[i - 1].current?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (text.length === 4) {
      setPinDigits(text.split(""));
      inputRefs[3].current?.focus();
      verifyPinMutation.mutate(text);
    }
  };

  // ----- OWNER VIEW -----
  if (userRole === "owner") {
    if (showDenyView) {
      return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                Item not handed off?
              </DialogTitle>
              <DialogDescription>
                {otherPartyConfirmed
                  ? `The ${otherParty} already confirmed. Reporting this will open a dispute.`
                  : `The ${otherParty} will have 24 hours to respond.`}
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-800">
              {otherPartyConfirmed
                ? "⚠️ This will open a dispute. Both parties must submit proof within 24 hours."
                : `We'll notify the ${otherParty} and wait for their response.`}
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="outline" onClick={() => setShowDenyView(false)} disabled={isProcessing} className="flex-1">Go back</Button>
              <Button onClick={() => denyHandoffMutation.mutate()} disabled={isProcessing} variant="destructive" className="flex-1">
                {isProcessing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Reporting...</> : "Report issue"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      );
    }

    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{deliveryMethod === "courier" ? "Confirm Item Sent" : "Confirm Item Handoff"}</DialogTitle>
            <DialogDescription>Confirm that {itemName} has been handed off.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {otherPartyConfirmed && (
              <div className="flex items-start gap-2 text-sm text-green-700">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{OtherParty} has already confirmed. Your confirmation will complete the handoff.</span>
              </div>
            )}
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
              <span className="text-amber-500 text-base leading-snug">⚠</span>
              <p className="text-sm text-amber-800">Only confirm once you've physically handed off the item.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} disabled={isProcessing} className="flex-1">Not yet</Button>
            <Button onClick={() => confirmHandoffMutation.mutate()} disabled={isProcessing} className="flex-1 bg-teal-600 hover:bg-teal-700">
              {isProcessing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Confirming...</> : "Confirm handoff"}
            </Button>
          </div>
          <button onClick={() => setShowDenyView(true)} className="text-xs text-red-500 hover:text-red-600 text-center w-full mt-1 underline-offset-2 hover:underline">
            Item was not handed off?
          </button>
          <p className="text-xs text-muted-foreground text-center -mt-1">
            If only one person confirms, we'll complete this automatically in 24 hours.
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  // ----- BORROWER VIEW — PIN-first -----
  const pinValue = pinDigits.join("");

  if (showDenyView) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Item not received?
            </DialogTitle>
            <DialogDescription>
              {otherPartyConfirmed
                ? "The owner already confirmed. Reporting this will open a dispute."
                : "The owner will have 24 hours to respond."}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-800">
            {otherPartyConfirmed
              ? "⚠️ This will open a dispute. Both parties must submit proof within 24 hours."
              : "We'll notify the owner and wait for their response before taking action."}
          </div>
          <div className="flex gap-3 pt-1">
            <Button variant="outline" onClick={() => setShowDenyView(false)} disabled={isProcessing} className="flex-1">Go back</Button>
            <Button onClick={() => denyHandoffMutation.mutate()} disabled={isProcessing} variant="destructive" className="flex-1">
              {isProcessing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Reporting...</> : "Report issue"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (view === "manual") {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{deliveryMethod === "courier" ? "Confirm Item Received" : "Confirm Item Received"}</DialogTitle>
            <DialogDescription>Confirm you've received {itemName}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {otherPartyConfirmed && (
              <div className="flex items-start gap-2 text-sm text-green-700">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Owner has already confirmed. Your confirmation will complete the handoff.</span>
              </div>
            )}
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
              <span className="text-amber-500 text-base leading-snug">⚠</span>
              <p className="text-sm text-amber-800">Only confirm once you've physically received the item.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setView("pin")} disabled={isProcessing} className="flex-1">Back</Button>
            <Button onClick={() => confirmHandoffMutation.mutate()} disabled={isProcessing} className="flex-1 bg-teal-600 hover:bg-teal-700">
              {isProcessing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Confirming...</> : "Confirm received"}
            </Button>
          </div>
          <button onClick={() => setShowDenyView(true)} className="text-xs text-red-500 hover:text-red-600 text-center w-full mt-1 underline-offset-2 hover:underline">
            Item was not received?
          </button>
          <p className="text-xs text-muted-foreground text-center -mt-1">
            If only one person confirms, we'll complete this automatically in 24 hours.
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-indigo-500" />
            Enter handoff code
          </DialogTitle>
          <DialogDescription>
            {view === "expired"
              ? "This code has expired."
              : view === "rate_limited"
              ? "Too many incorrect attempts."
              : view === "wrong_pin"
              ? "That code didn't match."
              : "Enter the 4-digit code from the owner."}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-4">
          {/* PIN digit boxes */}
          {view !== "expired" && view !== "rate_limited" && (
            <div className="flex justify-center gap-3">
              {pinDigits.map((digit, i) => (
                <input
                  key={i}
                  ref={inputRefs[i]}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onPaste={i === 0 ? handlePaste : undefined}
                  disabled={isProcessing}
                  className={`w-14 h-16 text-center text-2xl font-bold border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-colors ${
                    view === "wrong_pin"
                      ? "border-red-400 bg-red-50 text-red-700"
                      : "border-gray-300 bg-white"
                  } disabled:opacity-50`}
                />
              ))}
            </div>
          )}

          {view === "pin" && !verifyPinMutation.isPending && (
            <p className="text-xs text-center text-muted-foreground">
              Enter the code after you've checked the item and received it.
            </p>
          )}

          {verifyPinMutation.isPending && (
            <div className="flex items-center justify-center gap-2 text-sm text-indigo-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking code…
            </div>
          )}

          {view === "wrong_pin" && (
            <div className="text-center space-y-1">
              <p className="text-sm text-red-600 font-medium">That code didn't match.</p>
              {attemptsRemaining !== null && attemptsRemaining <= 2 && (
                <p className="text-xs text-red-500">{attemptsRemaining} attempt{attemptsRemaining !== 1 ? "s" : ""} remaining</p>
              )}
              <button
                onClick={() => { setPinDigits(["", "", "", ""]); setView("pin"); setTimeout(() => inputRefs[0].current?.focus(), 50); }}
                className="text-sm text-indigo-600 hover:underline mt-1 block mx-auto"
              >
                Try again
              </button>
            </div>
          )}

          {view === "expired" && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-3 text-center">
              <p className="text-sm font-medium text-amber-800">This code has expired</p>
              <p className="text-xs text-amber-700 mt-0.5">Ask the owner to confirm manually, or confirm below.</p>
            </div>
          )}

          {view === "rate_limited" && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-3 text-center">
              <p className="text-sm font-medium text-red-800">Too many attempts</p>
              <p className="text-xs text-red-700 mt-0.5">Please use the manual confirmation option below.</p>
            </div>
          )}
        </div>

        <div className="space-y-2 pt-1">
          {view !== "expired" && view !== "rate_limited" && (
            <Button variant="outline" onClick={onClose} disabled={isProcessing} className="w-full">
              Cancel
            </Button>
          )}
          <button
            onClick={() => setView("manual")}
            className="text-xs text-muted-foreground hover:text-indigo-600 text-center w-full py-0.5 transition-colors"
          >
            Didn't get a code? Confirm without code →
          </button>
          <button
            onClick={() => setShowDenyView(true)}
            className="text-xs text-red-500 hover:text-red-600 text-center w-full py-0.5 transition-colors"
          >
            Item was not received?
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
