import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Truck, MapPin, Clock, CheckCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CourierHandoffModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: number;
  itemName: string;
  onSuccess: (trackingUrl: string) => void;
}

type Step = "address" | "quote" | "booked";

export function CourierHandoffModal({ isOpen, onClose, requestId, itemName, onSuccess }: CourierHandoffModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("address");
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [quote, setQuote] = useState<{ fee: number; eta: string; quoteId: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [trackingUrl, setTrackingUrl] = useState("");

  const handleGetQuote = async () => {
    if (!pickupAddress.trim() || !dropoffAddress.trim()) {
      toast({ title: "Please enter both addresses", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/uber/handoff-quote", {
        requestId,
        pickupAddress: pickupAddress.trim(),
        dropoffAddress: dropoffAddress.trim(),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setQuote(data);
      setStep("quote");
    } catch (err: any) {
      toast({ title: "Quote failed", description: err.message || "Could not get a delivery quote.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleBook = async () => {
    if (!quote) return;
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/uber/book-handoff-delivery", {
        requestId,
        pickupAddress: pickupAddress.trim(),
        dropoffAddress: dropoffAddress.trim(),
        quoteId: quote.quoteId,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTrackingUrl(data.trackingUrl || "");
      setStep("booked");
      onSuccess(data.trackingUrl || "");
    } catch (err: any) {
      toast({ title: "Booking failed", description: err.message || "Could not book the delivery.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setStep("address");
      setQuote(null);
      setPickupAddress("");
      setDropoffAddress("");
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-teal-800">
            <Truck className="h-5 w-5 text-teal-600" />
            Book a delivery
          </DialogTitle>
          <DialogDescription className="text-teal-700">
            Send <span className="font-medium">{itemName}</span> with Uber Direct. The delivery fee will be charged to your saved payment method.
          </DialogDescription>
        </DialogHeader>

        {step === "address" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-teal-600" />
                Pickup address (your location)
              </Label>
              <Input
                placeholder="123 Main St, City, State"
                value={pickupAddress}
                onChange={(e) => setPickupAddress(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-gray-400" />
                Drop-off address (borrower's location)
              </Label>
              <Input
                placeholder="456 Oak Ave, City, State"
                value={dropoffAddress}
                onChange={(e) => setDropoffAddress(e.target.value)}
              />
            </div>
            <p className="text-xs text-gray-500">
              Typical cost is $10–$20. Your saved card will be charged after you confirm.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button
                className="flex-1 bg-teal-600 hover:bg-teal-700"
                onClick={handleGetQuote}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Get quote"}
              </Button>
            </div>
          </div>
        )}

        {step === "quote" && quote && (
          <div className="space-y-4">
            <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-teal-700 font-medium">Delivery fee</span>
                <span className="text-xl font-bold text-teal-800">${quote.fee.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-teal-600">
                <Clock className="h-3.5 w-3.5" />
                <span>Estimated pickup: {quote.eta}</span>
              </div>
              <p className="text-xs text-gray-500">
                Your card will be charged when the delivery is booked.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep("address")}>Back</Button>
              <Button
                className="flex-1 bg-teal-600 hover:bg-teal-700"
                onClick={handleBook}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : `Confirm & book — $${quote.fee.toFixed(2)}`}
              </Button>
            </div>
          </div>
        )}

        {step === "booked" && (
          <div className="space-y-4 text-center">
            <div className="flex justify-center">
              <CheckCircle className="h-14 w-14 text-teal-600" />
            </div>
            <div>
              <p className="font-semibold text-teal-800 text-lg">Delivery booked!</p>
              <p className="text-sm text-gray-600 mt-1">
                A courier is on their way. The borrower will receive the item and enter the handoff PIN when it arrives.
              </p>
            </div>
            {trackingUrl && (
              <a
                href={trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-teal-600 hover:underline font-medium"
              >
                <Truck className="h-4 w-4" />
                Track your delivery →
              </a>
            )}
            <Button className="w-full bg-teal-600 hover:bg-teal-700" onClick={onClose}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
