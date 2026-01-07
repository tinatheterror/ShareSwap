import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Truck, Clock, MapPin, Loader2, User, AlertCircle } from "lucide-react";

interface CourierBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: number;
  itemName: string;
  defaultAddress?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

const PICKUP_WINDOWS = [
  { value: "9am-12pm", label: "Morning (9am - 12pm)" },
  { value: "12pm-3pm", label: "Afternoon (12pm - 3pm)" },
  { value: "3pm-6pm", label: "Evening (3pm - 6pm)" },
];

export function CourierBookingModal({
  isOpen,
  onClose,
  requestId,
  itemName,
  defaultAddress = "",
  onSuccess,
  onCancel,
}: CourierBookingModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [address, setAddress] = useState(defaultAddress);
  const [pickupWindow, setPickupWindow] = useState("12pm-3pm");
  const [isProcessing, setIsProcessing] = useState(false);

  const bookCourierMutation = useMutation({
    mutationFn: async () => {
      setIsProcessing(true);
      
      const response = await apiRequest(
        "POST",
        `/api/requests/${requestId}/book-courier`,
        {
          address,
          pickupWindow,
        }
      );
      return response.json();
    },
    onSuccess: (data) => {
      setIsProcessing(false);
      toast({
        title: "Courier booked!",
        description: `Pickup scheduled for ${pickupWindow}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      onSuccess();
    },
    onError: (error: any) => {
      setIsProcessing(false);
      toast({
        title: "Booking failed",
        description: error.message || "Failed to book courier",
        variant: "destructive",
      });
    },
  });

  const handleCancel = () => {
    onCancel();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-orange-600" />
            Book Courier Pickup
          </DialogTitle>
          <DialogDescription>
            Schedule a courier to pick up{" "}
            <span className="font-medium text-gray-900">{itemName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex items-center gap-2 text-blue-700 text-sm font-medium">
              <User className="h-4 w-4" />
              You (the borrower) are responsible for courier booking
            </div>
            <p className="text-xs text-blue-600 mt-1">
              The courier will pick up from the lender and deliver to your address.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address" className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-gray-500" />
              Delivery Address
            </Label>
            <Input
              id="address"
              placeholder="Enter your full delivery address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full"
            />
          </div>

          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-500" />
              Pickup Window
            </Label>
            <RadioGroup
              value={pickupWindow}
              onValueChange={setPickupWindow}
              className="space-y-2"
            >
              {PICKUP_WINDOWS.map((window) => (
                <div
                  key={window.value}
                  className="flex items-center space-x-3 border rounded-lg p-3 hover:bg-gray-50 cursor-pointer"
                >
                  <RadioGroupItem value={window.value} id={window.value} />
                  <label
                    htmlFor={window.value}
                    className="flex-1 cursor-pointer text-sm font-medium"
                  >
                    {window.label}
                  </label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
              <div className="text-xs text-amber-700">
                <p className="font-medium">Cancellation Policy</p>
                <p className="mt-0.5">
                  You can cancel courier booking anytime before pickup. The
                  transaction will pause but won't break.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isProcessing}
            className="flex-1"
          >
            Skip for Now
          </Button>
          <Button
            onClick={() => bookCourierMutation.mutate()}
            disabled={isProcessing || !address.trim()}
            className="flex-1 bg-orange-600 hover:bg-orange-700"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Booking...
              </>
            ) : (
              <>
                <Truck className="h-4 w-4 mr-2" />
                Book Courier
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
