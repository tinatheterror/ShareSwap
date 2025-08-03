import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Clock, CreditCard, Truck, AlertTriangle, Shield, MapPin } from "lucide-react";
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
  const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'delivery'>('pickup');
  const [depositMethod, setDepositMethod] = useState<'credit_card' | 'self_facilitated'>('credit_card');
  const [scheduledDate, setScheduledDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [scheduledTime, setScheduledTime] = useState('');
  const [pickupLocation, setPickupLocation] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [selfFacilitatedAgreement, setSelfFacilitatedAgreement] = useState(false);
  const [deliveryService, setDeliveryService] = useState('');
  
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

  const deliveryServices = [
    { value: 'uber', label: 'Uber Direct', fee: 15 },
    { value: 'doordash', label: 'DoorDash Drive', fee: 12 },
    { value: 'postmates', label: 'Postmates', fee: 18 },
    { value: 'local_courier', label: 'Local Courier', fee: 25 },
  ];

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

    if (deliveryMethod === 'delivery' && (!deliveryAddress || !deliveryService)) {
      toast({
        title: "Missing Information",
        description: "Please provide delivery address and select a delivery service.",
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
      pickupLocation: deliveryMethod === 'pickup' ? pickupLocation : null,
      deliveryAddress: deliveryMethod === 'delivery' ? deliveryAddress : null,
      deliveryService: deliveryMethod === 'delivery' ? deliveryService : null,
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
            <Label className="text-base font-semibold mb-3 block">Delivery Method</Label>
            <RadioGroup value={deliveryMethod} onValueChange={(value: any) => setDeliveryMethod(value)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="pickup" id="pickup" />
                <Label htmlFor="pickup" className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Self Pickup (Free)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="delivery" id="delivery" />
                <Label htmlFor="delivery" className="flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  Delivery Service (Additional fees apply)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Date and Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="date">Date</Label>
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
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label htmlFor="delivery-address">Delivery Address</Label>
                <Input
                  id="delivery-address"
                  placeholder="Enter your delivery address"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                />
              </div>
              <div>
                <Label>Delivery Service</Label>
                <Select value={deliveryService} onValueChange={setDeliveryService}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose delivery service" />
                  </SelectTrigger>
                  <SelectContent>
                    {deliveryServices.map((service) => (
                      <SelectItem key={service.value} value={service.value}>
                        {service.label} (+${service.fee} commission)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
            <Shield className="h-5 w-5 text-green-600" />
            Security Deposit Options
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-blue-50 p-4 rounded-lg border">
            <p className="text-sm font-medium text-blue-900 mb-1">
              Suggested Deposit: ${suggestedDepositAmount}
            </p>
            <p className="text-xs text-blue-700">
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
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  Self-Facilitated (At Your Own Risk)
                </Label>
                <Badge variant="outline" className="text-orange-600 border-orange-600">Higher Risk</Badge>
              </div>
              <p className="text-sm text-muted-foreground ml-6 mb-3">
                Handle deposit arrangements privately between yourselves. No fees, but ShareSwap cannot assist with disputes.
              </p>
              
              {depositMethod === 'self_facilitated' && (
                <div className="ml-6 bg-orange-50 p-3 rounded border-l-4 border-orange-400">
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