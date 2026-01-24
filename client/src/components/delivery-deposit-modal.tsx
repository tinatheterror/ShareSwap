import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Shield, Truck, AlertTriangle, Check, Star, ArrowLeft, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface DeliveryDepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (selections: {
    deliveryMethod: 'self_arrange' | 'shareswap_delivery';
    depositMethod: 'self_arrange' | 'shareswap_deposit';
    uberQuoteFee?: number;
    depositAmount?: number;
    depositProcessingFee?: number;
  }) => void;
  itemValue: number;
}

export function DeliveryDepositModal({ 
  isOpen, 
  onClose, 
  onComplete,
  itemValue 
}: DeliveryDepositModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [deliveryMethod, setDeliveryMethod] = useState<'self_arrange' | 'shareswap_delivery' | null>(null);
  const [depositMethod, setDepositMethod] = useState<'self_arrange' | 'shareswap_deposit' | null>(null);

  // Reset state whenever modal closes
  const handleClose = () => {
    setStep(1);
    setDeliveryMethod(null);
    setDepositMethod(null);
    onClose();
  };

  // Simulated delivery fee (Test mode - will be replaced with real Uber Direct API)
  const estimatedBaseFee = 8.50;
  const deliveryMargin = 2.00;
  const totalDeliveryFee = estimatedBaseFee + deliveryMargin;
  const estimatedDeliveryTime = "30-45 min";

  // Calculate deposit fee (5% of item value)
  const depositAmount = itemValue || 50; // Default to $50 if no value
  const depositProcessingFee = depositAmount * 0.05;

  const handleContinue = () => {
    if (step === 1 && deliveryMethod) {
      setStep(2);
    } else if (step === 2 && depositMethod && deliveryMethod) {
      onComplete({
        deliveryMethod,
        depositMethod,
        uberQuoteFee: deliveryMethod === 'shareswap_delivery' ? totalDeliveryFee : undefined,
        depositAmount: depositMethod === 'shareswap_deposit' ? depositAmount : undefined,
        depositProcessingFee: depositMethod === 'shareswap_deposit' ? depositProcessingFee : undefined,
      });
      // Reset state after successful completion
      setStep(1);
      setDeliveryMethod(null);
      setDepositMethod(null);
    }
  };

  const canContinue = step === 1 ? !!deliveryMethod : !!depositMethod;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold mb-6">
            {step === 1 ? "How would you like to exchange the item?" : "Secure Your Exchange"}
          </DialogTitle>
        </DialogHeader>

        {/* Progress Indicator */}
        <div className="flex items-center justify-center mb-8">
          <div className="flex items-center gap-4">
            <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
              step >= 1 ? 'bg-primary border-primary text-white' : 'border-gray-300'
            }`}>
              {step > 1 ? <Check className="h-5 w-5" /> : '1'}
            </div>
            <div className={`w-16 h-0.5 ${step > 1 ? 'bg-primary' : 'bg-gray-300'}`} />
            <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
              step >= 2 ? 'bg-primary border-primary text-white' : 'border-gray-300'
            }`}>
              2
            </div>
          </div>
        </div>

        {step === 1 ? (
          // Step 1: Delivery Method
          <div className="space-y-6">
            <RadioGroup value={deliveryMethod || ''} onValueChange={(value) => setDeliveryMethod(value as any)}>
              {/* ShareSwap Delivery (Recommended) */}
              <Card 
                className={`relative cursor-pointer transition-all ${
                  deliveryMethod === 'shareswap_delivery' 
                    ? 'border-3 border-primary bg-teal-100 shadow-lg' 
                    : 'bg-teal-50 border-2 border-teal-200 hover:bg-teal-100 hover:border-primary/50 hover:shadow-md'
                }`}
                onClick={() => setDeliveryMethod('shareswap_delivery')}
              >
                <Badge className="absolute -top-3 right-4 bg-gradient-to-r from-teal-500 to-teal-700 text-white font-semibold px-3 py-1 shadow-md">
                  <Star className="h-3 w-3 mr-1 inline" />
                  RECOMMENDED
                </Badge>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Truck className="h-5 w-5 text-primary" />
                        <h3 className="font-semibold text-lg">ShareSwap Delivery (Test)</h3>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        Simulated delivery service • Estimated fees and times shown
                      </p>
                    </div>
                    <RadioGroupItem value="shareswap_delivery" className="mt-1" />
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600" />
                      <span>Simulated real-time tracking</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600" />
                      <span>Preview of insurance coverage</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600" />
                      <span>Test mode features</span>
                    </div>
                  </div>

                  <div className="bg-teal-100/50 border border-teal-200 rounded-lg p-4">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Estimated base fee</span>
                      <span className="font-medium">${estimatedBaseFee.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Platform margin</span>
                      <span className="font-medium">${deliveryMargin.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-muted-foreground">Estimated time</span>
                      <span className="font-medium">{estimatedDeliveryTime}</span>
                    </div>
                    <div className="flex justify-between font-bold text-base border-t border-teal-300 pt-2">
                      <span>Total estimated fee</span>
                      <span className="text-teal-700">${totalDeliveryFee.toFixed(2)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Self-Arrange Delivery */}
              <Card 
                className={`cursor-pointer transition-all ${
                  deliveryMethod === 'self_arrange' 
                    ? 'border-3 border-primary bg-teal-100 shadow-lg' 
                    : 'bg-teal-50 border-2 border-teal-200 hover:bg-teal-100 hover:border-primary/50 hover:shadow-md'
                }`}
                onClick={() => setDeliveryMethod('self_arrange')}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-lg">Arrange Yourself</h3>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        Coordinate directly with your neighbour
                      </p>
                    </div>
                    <RadioGroupItem value="self_arrange" className="mt-1" />
                  </div>

                  <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 mb-4 rounded">
                    <div className="flex gap-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-yellow-800">
                        <p className="font-semibold mb-1">No platform protection</p>
                        <p>ShareSwap is not responsible for lost or damaged items during self-arranged delivery.</p>
                      </div>
                    </div>
                  </div>

                  <div className="font-bold text-lg">
                    Free
                  </div>
                </CardContent>
              </Card>
            </RadioGroup>
          </div>
        ) : (
          // Step 2: Security Deposit
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground mb-4">
              To protect both parties, add a refundable deposit for this item.
            </p>

            <RadioGroup value={depositMethod || ''} onValueChange={(value) => setDepositMethod(value as any)}>
              {/* ShareSwap Deposit (Recommended) */}
              <Card 
                className={`relative cursor-pointer transition-all ${
                  depositMethod === 'shareswap_deposit' 
                    ? 'border-3 border-primary bg-teal-100 shadow-lg' 
                    : 'bg-teal-50 border-2 border-teal-200 hover:bg-teal-100 hover:border-primary/50 hover:shadow-md'
                }`}
                onClick={() => setDepositMethod('shareswap_deposit')}
              >
                <Badge className="absolute -top-3 right-4 bg-gradient-to-r from-teal-500 to-teal-700 text-white font-semibold px-3 py-1 shadow-md">
                  <Star className="h-3 w-3 mr-1 inline" />
                  RECOMMENDED
                </Badge>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Shield className="h-5 w-5 text-primary" />
                        <h3 className="font-semibold text-lg">Use ShareSwap Deposit</h3>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        We securely hold your deposit and refund it automatically when the item is returned
                      </p>
                    </div>
                    <RadioGroupItem value="shareswap_deposit" className="mt-1" />
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600" />
                      <span>Automatic refund on safe return</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600" />
                      <span>Dispute protection via Stripe</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600" />
                      <span>Secure payment authorization hold</span>
                    </div>
                  </div>

                  <div className="bg-teal-100/50 border border-teal-200 rounded-lg p-4">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Security deposit</span>
                      <span className="font-medium">${depositAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-muted-foreground">Processing fee (5%)</span>
                      <span className="font-medium">${depositProcessingFee.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-base border-t border-teal-300 pt-2">
                      <span>Total hold amount</span>
                      <span className="text-teal-700">${(depositAmount + depositProcessingFee).toFixed(2)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Deposit + fee are authorized (held) on your card and fully refunded when item is returned safely
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Self-Arrange Deposit */}
              <Card 
                className={`cursor-pointer transition-all ${
                  depositMethod === 'self_arrange' 
                    ? 'border-3 border-primary bg-teal-100 shadow-lg' 
                    : 'bg-teal-50 border-2 border-teal-200 hover:bg-teal-100 hover:border-primary/50 hover:shadow-md'
                }`}
                onClick={() => setDepositMethod('self_arrange')}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-lg">Arrange Deposit Yourself</h3>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        Coordinate directly with your neighbour
                      </p>
                    </div>
                    <RadioGroupItem value="self_arrange" className="mt-1" />
                  </div>

                  <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4 rounded">
                    <div className="flex gap-2">
                      <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-red-800">
                        <p className="font-semibold mb-1">⚠️ High Risk</p>
                        <p className="mb-2">ShareSwap is not responsible for lost deposits or damages. No platform mediation for disputes.</p>
                        <ul className="list-disc list-inside space-y-1 text-xs">
                          <li>No payment protection</li>
                          <li>No dispute resolution</li>
                          <li>Full liability on you</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="font-bold text-lg">
                    Free
                  </div>
                </CardContent>
              </Card>
            </RadioGroup>
          </div>
        )}

        {/* Navigation Footer */}
        <div className="flex items-center justify-between pt-6 border-t mt-6">
          <Button
            variant="ghost"
            onClick={() => {
              if (step === 1) {
                handleClose();
              } else {
                setStep(1);
              }
            }}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>

          <div className="flex gap-2">
            <div className={`w-2 h-2 rounded-full ${step === 1 ? 'bg-primary' : 'bg-gray-300'}`} />
            <div className={`w-2 h-2 rounded-full ${step === 2 ? 'bg-primary' : 'bg-gray-300'}`} />
          </div>

          <Button
            onClick={handleContinue}
            disabled={!canContinue}
            className="bg-primary hover:bg-primary/90"
          >
            {step === 1 ? 'Continue' : 'Complete'}
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
