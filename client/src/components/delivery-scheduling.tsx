import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calendar, CreditCard, Truck, AlertTriangle, Shield, MapPin, CalendarDays } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format, addDays } from "date-fns";

interface DeliverySchedulingProps {
  itemId: number;
  itemName: string;
  itemValue: number;
  ownerName: string;
  onComplete: () => void;
}

export function DeliveryScheduling({ itemId, itemName, itemValue, ownerName, onComplete }: DeliverySchedulingProps) {
  const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'uber_send'>('pickup');
  const [depositMethod, setDepositMethod] = useState<'credit_card' | 'self_facilitated'>('credit_card');
  const [scheduledDate, setScheduledDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [scheduledTime, setScheduledTime] = useState('');
  const [returnDate, setReturnDate] = useState(format(addDays(new Date(), 7), 'yyyy-MM-dd'));
  const [pickupLocation, setPickupLocation] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [selfFacilitatedAgreement, setSelfFacilitatedAgreement] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const createArrangementMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/delivery-arrangements", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/delivery-arrangements'] });
      toast({
        title: "Arrangement Scheduled",
        description: "Your pickup/delivery has been scheduled successfully!",
      });
      onComplete();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to schedule arrangement. Please try again.",
        variant: "destructive",
      });
    },
  });

  const suggestedDepositAmount = Math.min(itemValue * 0.2, 500); // 20% of item value, max $500
  const uberDeliveryFee = 15; // Uber Send Items fee

  const handleSubmit = () => {
    if (!scheduledTime) {
      toast({
        title: "Missing Information",
        description: "Please select a time for pickup/delivery.",
        variant: "destructive",
      });
      return;
    }

    if (deliveryMethod === 'pickup' && !pickupLocation) {
      toast({
        title: "Missing Information",
        description: "Please provide a pickup location.",
        variant: "destructive",
      });
      return;
    }

    if (deliveryMethod === 'uber_send' && !deliveryAddress) {
      toast({
        title: "Missing Information",
        description: "Please provide a delivery address for Uber Send.",
        variant: "destructive",
      });
      return;
    }

    if (depositMethod === 'self_facilitated' && !selfFacilitatedAgreement) {
      toast({
        title: "Agreement Required",
        description: "Please acknowledge the self-facilitated deposit terms.",
        variant: "destructive",
      });
      return;
    }

    const arrangementData = {
      itemId,
      deliveryMethod,
      depositMethod,
      scheduledDate,
      scheduledTime,
      returnDate,
      pickupLocation: deliveryMethod === 'pickup' ? pickupLocation : null,
      deliveryAddress: deliveryMethod === 'uber_send' ? deliveryAddress : null,
      deliveryService: deliveryMethod === 'uber_send' ? 'uber' : null,
      deliveryFee: deliveryMethod === 'uber_send' ? uberDeliveryFee : 0,
      specialInstructions,
      suggestedDepositAmount,
    };

    createArrangementMutation.mutate(arrangementData);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Schedule Pickup/Delivery
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Item Summary */}
          <div className="bg-muted p-4 rounded-lg">
            <h3 className="font-semibold mb-2">{itemName}</h3>
            <p className="text-sm text-muted-foreground">Owner: {ownerName}</p>
            <p className="text-sm text-muted-foreground">Estimated Value: ${itemValue}</p>
          </div>

          {/* Delivery Method */}
          <div>
            <Label className="text-base font-semibold mb-3 block">How will the item be picked up?</Label>
            <RadioGroup value={deliveryMethod} onValueChange={(value: any) => setDeliveryMethod(value)} className="space-y-3">
              <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value="pickup" id="pickup" className="mt-0.5" />
                <Label htmlFor="pickup" className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-2 font-medium">
                    <MapPin className="h-4 w-4 text-primary" />
                    Exchange Item In Person
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Meet the owner at an agreed location to pick up the item. Free!
                  </p>
                </Label>
              </div>
              <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value="uber_send" id="uber_send" className="mt-0.5" />
                <Label htmlFor="uber_send" className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-2 font-medium">
                    <Truck className="h-4 w-4 text-primary" />
                    Uber Direct
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Have Uber deliver the item directly to your address. +${uberDeliveryFee} delivery fee
                  </p>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Date and Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="date">Pickup/Delivery Date</Label>
              <Input
                id="date"
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                min={format(new Date(), 'yyyy-MM-dd')}
              />
            </div>
            <div>
              <Label htmlFor="time">Time</Label>
              <Input
                id="time"
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
              />
            </div>
          </div>

          {/* Return Date for Lending */}
          <div>
            <Label htmlFor="return-date" className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              Expected Return Date
            </Label>
            <Input
              id="return-date"
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              min={scheduledDate}
            />
            <p className="text-xs text-muted-foreground mt-1">
              This helps both parties plan the lending duration and enables calendar sync
            </p>
          </div>

          {/* Location Details */}
          {deliveryMethod === 'pickup' ? (
            <div>
              <Label htmlFor="pickup-location">Pickup Location</Label>
              <Input
                id="pickup-location"
                placeholder="Enter pickup address or meeting point"
                value={pickupLocation}
                onChange={(e) => setPickupLocation(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Suggest a safe, public location to meet the owner
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label htmlFor="delivery-address">Your Delivery Address</Label>
                <Input
                  id="delivery-address"
                  placeholder="Enter your full delivery address"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                />
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Truck className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-blue-800">
                    <p className="font-medium">Uber Direct</p>
                    <p className="mt-1">A courier will pick up the item from the owner and deliver it to your address. Delivery fee: <span className="font-semibold">${uberDeliveryFee}</span></p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Special Instructions */}
          <div>
            <Label htmlFor="instructions">Special Instructions (Optional)</Label>
            <Textarea
              id="instructions"
              placeholder="Any special delivery instructions..."
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Security Deposit Options */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-teal-600" />
            Security Deposit Options
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-teal-50 p-4 rounded-lg border">
            <p className="text-sm font-medium text-teal-900 mb-1">
              Suggested Deposit: ${suggestedDepositAmount}
            </p>
            <p className="text-xs text-teal-700">
              Based on 20% of item value for protection against damage or non-return
            </p>
          </div>

          <RadioGroup value={depositMethod} onValueChange={(value: any) => setDepositMethod(value)}>
            <div className="border rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <RadioGroupItem value="credit_card" id="credit_card" />
                <Label htmlFor="credit_card" className="flex items-center gap-2 font-semibold">
                  <CreditCard className="h-4 w-4" />
                  Credit Card Processing (Recommended)
                </Label>
                <Badge variant="secondary">Safe & Automated</Badge>
              </div>
              <p className="text-sm text-muted-foreground ml-6">
                We'll hold the deposit on your verified credit card. No charge unless damage occurs.
                Processing fee: 2.9% + $0.30 per transaction.
              </p>
            </div>

            <div className="border rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <RadioGroupItem value="self_facilitated" id="self_facilitated" />
                <Label htmlFor="self_facilitated" className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4 text-teal-500" />
                  Self-Facilitated (At Your Own Risk)
                </Label>
                <Badge variant="outline" className="text-teal-600 border-teal-600">Higher Risk</Badge>
              </div>
              <p className="text-sm text-muted-foreground ml-6 mb-3">
                Handle deposit arrangements privately between yourselves. Direct exchange, but ShareSwap cannot assist with disputes.
              </p>
              
              {depositMethod === 'self_facilitated' && (
                <div className="ml-6 bg-teal-50 p-3 rounded border-l-4 border-teal-400">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="agreement"
                      checked={selfFacilitatedAgreement}
                      onCheckedChange={(checked) => setSelfFacilitatedAgreement(checked as boolean)}
                    />
                    <Label htmlFor="agreement" className="text-xs leading-tight">
                      I understand that ShareSwap is not responsible for self-facilitated deposits. 
                      I accept full responsibility for deposit collection, return, and any disputes that may arise.
                      This option provides no platform protection or dispute resolution.
                    </Label>
                  </div>
                </div>
              )}
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Submit Button */}
      <Button 
        onClick={handleSubmit} 
        className="w-full" 
        size="lg"
        disabled={createArrangementMutation.isPending}
      >
        {createArrangementMutation.isPending ? "Scheduling..." : "Confirm Arrangement"}
      </Button>
    </div>
  );
}