import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Truck, MapPin, Clock, CheckCircle, ShieldCheck, Crown } from "lucide-react";
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

interface QuoteData {
  uberFee: number;
  platformFee: number;
  totalFee: number;
  eta: string;
  quoteId: string;
  proDeliveriesUsed: number;
  proDeliveriesLimit: number;
  isPro: boolean;
}

export function CourierHandoffModal({ isOpen, onClose, requestId, itemName, onSuccess }: CourierHandoffModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("address");
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [quote, setQuote] = useState<QuoteData | null>(null);
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
            Private courier delivery
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                Arrange delivery of <span className="font-medium text-gray-800">{itemName}</span> via Uber Direct.
              </p>
              <div className="flex items-start gap-2 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
                <ShieldCheck className="h-4 w-4 text-teal-600 shrink-0 mt-0.5" />
                <p className="text-xs text-teal-700 leading-snug">
                  <span className="font-semibold">Neither party sees the other's address.</span> Both addresses go directly to the courier — never displayed to the other user in ShareSwap.
                </p>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        {step === "address" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-teal-600" />
                Pickup address (owner's location)
              </Label>
              <Input
                placeholder="123 Main St, City, Province"
                value={pickupAddress}
                onChange={(e) => setPickupAddress(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-gray-400" />
                Drop-off address (your location)
              </Label>
              <Input
                placeholder="456 Oak Ave, City, Province"
                value={dropoffAddress}
                onChange={(e) => setDropoffAddress(e.target.value)}
              />
            </div>
            <p className="text-xs text-gray-400">
              Addresses are shared securely with Uber Direct only. Typical delivery cost is $10–$20.
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
            {/* Pro delivery usage badge */}
            {quote.isPro && (
              <div className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <Crown className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-xs font-medium text-amber-700">Pro free deliveries</span>
                </div>
                <span className="text-xs text-amber-600 font-semibold">
                  {quote.proDeliveriesUsed} / {quote.proDeliveriesLimit} used this month
                </span>
              </div>
            )}

            {/* Fee breakdown */}
            <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 space-y-2.5">
              <div className="flex justify-between items-center text-sm text-teal-700">
                <span>Uber courier fee</span>
                <span className="font-medium">${quote.uberFee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-sm text-teal-700">
                <span className="flex items-center gap-1">
                  Private courier fee
                  {quote.platformFee === 0 && (
                    <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] px-1.5 py-0 h-4">Pro</Badge>
                  )}
                </span>
                {quote.platformFee === 0 ? (
                  <span className="font-medium text-green-600">Free</span>
                ) : (
                  <span className="font-medium">${quote.platformFee.toFixed(2)}</span>
                )}
              </div>
              <div className="border-t border-teal-200 pt-2 flex justify-between items-center">
                <span className="text-sm font-semibold text-teal-800">Total</span>
                <span className="text-xl font-bold text-teal-800">${quote.totalFee.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-teal-600">
                <Clock className="h-3.5 w-3.5" />
                <span>Estimated pickup: {quote.eta}</span>
              </div>
              <p className="text-xs text-gray-500">
                Your saved card will be charged when the delivery is booked.
              </p>
            </div>

            {quote.platformFee === 0 && quote.proDeliveriesUsed >= quote.proDeliveriesLimit - 1 && (
              <p className="text-xs text-amber-600 text-center">
                This is your last free delivery this month. Additional deliveries will be $1.50 each.
              </p>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep("address")}>Back</Button>
              <Button
                className="flex-1 bg-teal-600 hover:bg-teal-700"
                onClick={handleBook}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : `Confirm & book — $${quote.totalFee.toFixed(2)}`}
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
                A courier is on their way. Neither party's address was shared through ShareSwap.
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
